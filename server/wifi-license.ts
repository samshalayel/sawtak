// Licenses for the "مين شابك على الواي فاي" router monitor (a desktop installer for DD-WRT routers).
// Flow: the installer opens /wifi/buy?router=…&tier=…&claim=…  →  the customer pays with Jawwal Pay (phone + SMS
//       code, no account needed)  →  the key is signed here and attached to the claim token  →  the installer picks
//       it up from GET /api/wifi/claim/:token and activates itself.
//
// A key is an Ed25519 signature over "W2" + tier byte + the router's MAC, in the same format as the seller's offline
// keygen (license.py in the installer project), so the installer checks both with public keys only.
//
// Server .env:
//   WIFI_LICENSE_PRIVATE_KEY   Ed25519 private key, PEM with \n for new lines (sales are off, 503, until it is set)
//   WIFI_PRICE_BASIC  WIFI_PRICE_PRO   prices in shekels (default 50 and 100); an upgrade costs the difference
//
// Every payment attempt is a row in wifi_payments, so a charge is never lost: a charge that got no key, or a payment
// call that got no answer, stays visible to admins (GET /api/wifi/admin).

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router, Request, Response } from 'express';
import { requireAdmin } from './auth.ts';
import { db } from './db.ts';
import { enabled as jawwalEnabled, post, msgId, GatewayRefusal, customerError, failureStatus, PHONE_RE } from './jawwal.ts';

// Some env_file readers keep the quotes and the \n escapes as written, others undo them: accept both
const PRIVATE_PEM = (process.env.WIFI_LICENSE_PRIVATE_KEY ?? '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\n/g, '\n').trim();
const PRICES = {
  basic: Number(process.env.WIFI_PRICE_BASIC) || 50,
  pro: Number(process.env.WIFI_PRICE_PRO) || 100,
} as const;

type Tier = keyof typeof PRICES;
const TIERS: Tier[] = ['basic', 'pro'];
const TIER_BYTE: Record<Tier, number> = { basic: 1, pro: 2 };

let privateKey: crypto.KeyObject | null = null;
try {
  if (PRIVATE_PEM) privateKey = crypto.createPrivateKey(PRIVATE_PEM);
} catch (e: any) {
  console.error('[wifi] WIFI_LICENSE_PRIVATE_KEY is not a valid PEM key:', e?.message);
}

const salesOn = () => Boolean(privateKey && jawwalEnabled());
const UNAVAILABLE = 'البيع متوقف حالياً، يرجى المحاولة بعد قليل.';

db.exec(`
  CREATE TABLE IF NOT EXISTS wifi_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_mac TEXT NOT NULL,
    tier TEXT NOT NULL,
    amount_ils REAL NOT NULL,
    phone_last4 TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'unknown', 'paid_no_key')),
    tx_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wifi_payments_mac ON wifi_payments(router_mac, created_at);

  CREATE TABLE IF NOT EXISTS wifi_licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    router_mac TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
    license_key TEXT NOT NULL,
    payment_id INTEGER REFERENCES wifi_payments(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wifi_licenses_mac ON wifi_licenses(router_mac);

  -- The installer's one-time pickup token (only its hash is kept)
  CREATE TABLE IF NOT EXISTS wifi_claims (
    token_hash TEXT PRIMARY KEY,
    license_id INTEGER NOT NULL REFERENCES wifi_licenses(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface LicenseRow { id: number; router_mac: string; tier: Tier; license_key: string }

// ── keys ─────────────────────────────────────────────────────────────────────

/** "fc:d7:33:0e:76:38" or "FCD7330E7638" → "FCD7330E7638", or null. */
function normMac(v: unknown): string | null {
  const h = String(v ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return h.length === 12 ? h : null;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function makeKey(mac: string, tier: Tier): string {
  const payload = Buffer.concat([Buffer.from('W2'), Buffer.from([TIER_BYTE[tier]]), Buffer.from(mac, 'hex')]);
  const sig = crypto.sign(null, payload, privateKey!);
  return base32(Buffer.concat([payload, sig])).match(/.{1,6}/g)!.join('-');
}

// ── data ─────────────────────────────────────────────────────────────────────

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const CLAIM_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** The router's highest license (pro beats basic). */
function bestLicense(mac: string): LicenseRow | undefined {
  return db.prepare(`SELECT id, router_mac, tier, license_key FROM wifi_licenses WHERE router_mac = ?
    ORDER BY CASE tier WHEN 'pro' THEN 2 ELSE 1 END DESC, id DESC LIMIT 1`).get(mac) as unknown as LicenseRow | undefined;
}

/** What this router pays for `tier`: the full price, the difference for an upgrade, or null when it already has it. */
function priceFor(mac: string, tier: Tier): number | null {
  const have = bestLicense(mac);
  if (!have) return PRICES[tier];
  if (TIER_BYTE[have.tier] >= TIER_BYTE[tier]) return null;
  return Math.max(PRICES[tier] - PRICES[have.tier], 0);
}

function attachClaim(claim: string | undefined, licenseId: number) {
  if (claim && CLAIM_RE.test(claim)) {
    db.prepare('INSERT OR REPLACE INTO wifi_claims (token_hash, license_id) VALUES (?, ?)').run(hashToken(claim), licenseId);
  }
}

// ── SMS abuse limits (each code is a real SMS on the merchant account) ───────

const hits = new Map<string, number[]>();

function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

// ── input ────────────────────────────────────────────────────────────────────

function readOrder(body: any) {
  const mac = normMac(body?.router);
  const tier = TIERS.includes(body?.tier) ? (body.tier as Tier) : null;
  return { mac, tier };
}

// ── routes ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WIFI_BUY_PAGE = path.join(__dirname, 'wifi-buy.html');

export const wifiRouter = Router();

// The buy page asks this first: prices, and what this router already has
wifiRouter.get('/info', (req: Request, res: Response) => {
  const mac = normMac(req.query.router);
  if (!mac) return res.status(400).json({ success: false, error: 'رقم الراوتر غير صحيح' });
  const have = bestLicense(mac);
  res.json({
    success: true,
    enabled: salesOn(),
    prices: PRICES,
    current: have?.tier ?? null,
    toPay: { basic: priceFor(mac, 'basic'), pro: priceFor(mac, 'pro') },
  });
});

// Send the confirmation code to the customer's phone
wifiRouter.post('/otp', async (req: Request, res: Response) => {
  if (!salesOn()) return res.status(503).json({ success: false, error: UNAVAILABLE });
  const { mac, tier } = readOrder(req.body);
  const phone = String(req.body?.phone ?? '');
  if (!mac || !tier) return res.status(400).json({ success: false, error: 'بيانات الطلب غير صحيحة' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ success: false, error: 'رقم الهاتف غير صحيح، اكتب رقم جوال يبدأ بـ 05' });
  const amount = priceFor(mac, tier);
  if (amount === null) return res.status(409).json({ success: false, error: 'هالراوتر عنده هالنسخة أصلاً', owned: true });
  if (tooMany(`p:${phone}`, 3, 10 * 60_000) || tooMany(`ip:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ success: false, error: 'طلبات كثيرة، استنى شوي وجرّب كمان مرة.' });
  }
  try {
    await post('/v1/business/send_otp', { msgId: msgId(), receiver: phone, amount: String(amount), lang: 'AR' });
    res.json({ success: true, amount });
  } catch (e: any) {
    console.error('[wifi] send_otp failed:', e?.message);
    res.status(failureStatus(e)).json({ success: false, error: customerError(e) });
  }
});

// Confirm the code: Jawwal charges, then the key is signed and left for the installer's claim token
wifiRouter.post('/pay', async (req: Request, res: Response) => {
  if (!salesOn()) return res.status(503).json({ success: false, error: UNAVAILABLE });
  const { mac, tier } = readOrder(req.body);
  const phone = String(req.body?.phone ?? '');
  const otp = String(req.body?.otp ?? '');
  const claim = typeof req.body?.claim === 'string' ? req.body.claim : undefined;
  if (!mac || !tier || !PHONE_RE.test(phone) || !/^\d{4,8}$/.test(otp)) {
    return res.status(400).json({ success: false, error: 'بيانات ناقصة أو غير صحيحة' });
  }
  const amount = priceFor(mac, tier);
  if (amount === null) return res.status(409).json({ success: false, error: 'هالراوتر عنده هالنسخة أصلاً', owned: true });
  const pending = db.prepare(`SELECT id FROM wifi_payments WHERE router_mac = ? AND status = 'pending'
    AND created_at > datetime('now', '-120 seconds') LIMIT 1`).get(mac);
  if (pending) return res.status(409).json({ success: false, error: 'في عملية دفع قيد التنفيذ لهالراوتر، انتظر نتيجتها.' });

  const id = msgId();
  const paymentId = Number(db.prepare(`INSERT INTO wifi_payments (router_mac, tier, amount_ils, phone_last4, msg_id)
    VALUES (?, ?, ?, ?, ?)`).run(mac, tier, amount, phone.slice(-4), id).lastInsertRowid);
  const setStatus = (status: string, txId: string | null, error: string | null) =>
    db.prepare(`UPDATE wifi_payments SET status = ?, tx_id = COALESCE(?, tx_id), error = ?, updated_at = datetime('now')
      WHERE id = ?`).run(status, txId, error, paymentId);

  // OTP must be SHA-256 then base64
  const otpHashed = crypto.createHash('sha256').update(otp).digest('base64');
  let data: any;
  try {
    data = await post('/v1/business/MFP', { msgId: id, receiver: phone, amount: String(amount), otp: otpHashed, lang: 'AR' }, 45_000);
  } catch (e: any) {
    // A refusal means nothing was charged. Anything else (timeout, network) leaves the outcome unknown.
    const refused = e instanceof GatewayRefusal;
    setStatus(refused ? 'failed' : 'unknown', null, String(e?.message || e).slice(0, 300));
    console.error(`[wifi] MFP ${refused ? 'refused' : 'no answer'} payment #${paymentId}:`, e?.message);
    return res.status(failureStatus(e)).json({
      success: false,
      error: refused ? customerError(e) : `لم تصلنا نتيجة الدفع. إن خُصم المبلغ من محفظتك فسنرسل لك المفتاح بعد التحقق (رقم المرجع ${paymentId}).`,
    });
  }

  const ref = data?.transactionId ?? data?.ref;
  const txId = ref != null && ref !== '' ? String(ref) : null;
  try {
    const key = makeKey(mac, tier);
    const licenseId = Number(db.prepare('INSERT INTO wifi_licenses (router_mac, tier, license_key, payment_id) VALUES (?, ?, ?, ?)')
      .run(mac, tier, key, paymentId).lastInsertRowid);
    attachClaim(claim, licenseId);
    setStatus('paid', txId, null);
    res.json({ success: true, tier, key, txId });
  } catch (e: any) {
    // Charged but no key: keep it visible for an admin to send one by hand
    setStatus('paid_no_key', txId, String(e?.message || e).slice(0, 300));
    console.error(`[wifi] CHARGED BUT NO KEY payment #${paymentId} router ${mac} tx ${txId}:`, e?.message);
    res.status(500).json({ success: false, error: `تم الدفع لكن ما انعمل المفتاح تلقائياً، وبنبعتلك ياه (رقم المرجع ${paymentId}).` });
  }
});

// A router that already paid (new computer, reinstall): hand its key to this installer again. A key only works on
// its own router, so knowing a router's number gives nothing that router's owner does not already have.
wifiRouter.post('/restore', (req: Request, res: Response) => {
  const mac = normMac(req.body?.router);
  const have = mac ? bestLicense(mac) : undefined;
  if (!have) return res.status(404).json({ success: false, error: 'ما في ترخيص لهالراوتر' });
  attachClaim(typeof req.body?.claim === 'string' ? req.body.claim : undefined, have.id);
  res.json({ success: true, tier: have.tier, key: have.license_key });
});

// The installer polls this with its claim token until the customer has paid
wifiRouter.get('/claim/:token', (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!CLAIM_RE.test(token)) return res.status(400).json({ success: false });
  const row = db.prepare(`SELECT l.tier, l.license_key FROM wifi_claims c JOIN wifi_licenses l ON l.id = c.license_id
    WHERE c.token_hash = ? AND c.created_at > datetime('now', '-7 days')`).get(hashToken(token)) as any;
  if (!row) return res.status(404).json({ success: false, pending: true });
  res.json({ success: true, tier: row.tier, key: row.license_key });
});

// Admins: every payment attempt and license, newest first
wifiRouter.get('/admin', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    success: true,
    enabled: salesOn(),
    prices: PRICES,
    payments: db.prepare('SELECT * FROM wifi_payments ORDER BY id DESC LIMIT 1000').all(),
    licenses: db.prepare('SELECT id, router_mac, tier, payment_id, created_at FROM wifi_licenses ORDER BY id DESC LIMIT 1000').all(),
  });
});
