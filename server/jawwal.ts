// JawwalPay payment gateway integration.
// Flow: POST /api/jawwal/otp  →  customer receives an SMS code for the package price
//       POST /api/jawwal/pay  →  confirm the code: Jawwal charges, then the points are credited
//
// Server .env:
//   JAWWAL_USERNAME  JAWWAL_PASSWORD  JAWWAL_HMAC_SECRET   (the gateway is off, 503, until all three are set)
//   JAWWAL_BASE_URL  the gateway address; defaults to the test environment (https://apitest.jawwalpay.ps)
//
// Prices come from src/data/packages.ts, the same list the customer sees. Every payment attempt is a row in
// jawwal_payments, so a charge is never lost: a charge that could not be credited, or a payment call that got no
// answer, stays visible to admins (GET /api/jawwal/payments).

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from './auth.ts';
import { creditPurchase } from './credits.ts';
import { listJawwalPayments, pendingJawwalPayment, startJawwalPayment, updateJawwalPayment } from './db.ts';
import { PACKAGES, CreditPackage, packageTotalSeconds } from '../src/data/packages.ts';

const BASE_URL = (process.env.JAWWAL_BASE_URL || 'https://apitest.jawwalpay.ps').replace(/\/+$/, '');
const MODE = /apitest/i.test(BASE_URL) ? 'test' : 'live';

const USERNAME  = process.env.JAWWAL_USERNAME  ?? '';
const PASSWORD  = process.env.JAWWAL_PASSWORD  ?? '';
const HMAC_KEY  = process.env.JAWWAL_HMAC_SECRET ?? '';

const enabled = () => Boolean(USERNAME && PASSWORD && HMAC_KEY);

const UNAVAILABLE = 'خدمة الدفع غير متاحة حالياً، يرجى المحاولة بعد قليل.';

/** A refusal from Jawwal Pay itself (wrong code, insufficient balance…): its message is meant for the customer. */
class GatewayRefusal extends Error {}

// ── helpers ──────────────────────────────────────────────────────────────────

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64'),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Jawwal login HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data.errorCd !== '00') throw new Error(`Jawwal login: ${data.desc ?? data.errorCd}`);
  const token = data.extraData?.find((x: any) => x.key === 'access_token')?.value;
  if (!token) throw new Error('No access_token in Jawwal login response');
  _token = token;
  _tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
  return token;
}

/**
 * Jawwal Pay's signature: the request's values plus the login access token, sorted as strings, joined with
 * nothing, then HMAC-SHA512 with the account's secret, lower-case hex (as in Jawwal's working scripts on the
 * server, /var/www/mg/check.py: "API values & auth key (login output)").
 */
function secureHash(params: Record<string, string>, accessToken: string): string {
  const joined = [...Object.values(params).map(String), accessToken].sort().join('');
  return crypto.createHmac('sha512', HMAC_KEY).update(joined).digest('hex').toLowerCase();
}

function msgId(): string {
  return String(BigInt('0x' + crypto.randomBytes(7).toString('hex'))).slice(0, 14);
}

async function post(path: string, payload: Record<string, string>, timeoutMs = 20_000): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const token = await getToken();
    // The token is part of the signature, so it is signed again after a fresh login
    const body = { ...payload, secureHash: secureHash(payload, token) };
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // An expired token is refused before anything happens: log in again once
    if (res.status === 401 && attempt === 1) {
      _token = null;
      continue;
    }
    if (!res.ok) throw new Error(`Jawwal ${path} HTTP ${res.status}`);
    const data = await res.json() as any;
    if (data.errorCd && data.errorCd !== '00') throw new GatewayRefusal(String(data.desc || `رفضت جوال باي العملية (${data.errorCd})`));
    return data;
  }
}

/** What the customer is told: Jawwal's own refusal message, or a neutral line for anything technical. */
function customerError(e: unknown) {
  return e instanceof GatewayRefusal ? e.message : UNAVAILABLE;
}

// Never 502/504: Cloudflare replaces those with its own page, and the customer would lose our message
const failureStatus = (e: unknown) => (e instanceof GatewayRefusal ? 400 : 503);

// ── packages and input ───────────────────────────────────────────────────────

/** A package this account may buy (the admin test package is refused for everyone else). */
const packageFor = (id: unknown, user: { role: string }): CreditPackage | undefined =>
  PACKAGES.find(p => p.id === id && (!p.adminOnly || user.role === 'admin'));

/** Palestinian mobile in the gateway's format: 00970 followed by 9 digits starting with 5. */
const PHONE_RE = /^009705\d{8}$/;

// ── routes ───────────────────────────────────────────────────────────────────

export const jawwalRouter = Router();
jawwalRouter.use(requireAuth);

// Send the confirmation code to the customer's phone
jawwalRouter.post('/otp', async (req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  const { phone, packageId } = req.body as { phone?: string; packageId?: string };
  const p = packageFor(packageId, req.user!);
  if (!p) return res.status(400).json({ success: false, error: 'باقة غير موجودة' });
  if (!phone || !PHONE_RE.test(phone)) return res.status(400).json({ success: false, error: 'رقم الهاتف غير صحيح، اكتب رقم جوال يبدأ بـ 05' });

  try {
    await post('/v1/business/send_otp', { msgId: msgId(), receiver: phone, amount: String(p.priceIls), lang: 'AR' });
    res.json({ success: true });
  } catch (e: any) {
    console.error(`[jawwal] send_otp failed (${MODE}):`, e?.message);
    res.status(failureStatus(e)).json({ success: false, error: customerError(e) });
  }
});

// Confirm the code: Jawwal charges the package price, then the points are added to the account
jawwalRouter.post('/pay', async (req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  const user = req.user!;
  const { phone, otp, packageId } = req.body as { phone?: string; otp?: string; packageId?: string };
  const p = packageFor(packageId, user);
  if (!p || !phone || !PHONE_RE.test(phone) || !otp || !/^\d{4,8}$/.test(otp)) {
    return res.status(400).json({ success: false, error: 'بيانات ناقصة أو غير صحيحة' });
  }
  if (pendingJawwalPayment(user.id)) {
    return res.status(409).json({ success: false, error: 'عندك عملية دفع قيد التنفيذ، انتظر نتيجتها قبل المحاولة مرة أخرى.' });
  }

  const id = msgId();
  const credits = packageTotalSeconds(p);
  const paymentId = startJawwalPayment({ userId: user.id, packageId: p.id, amountIls: p.priceIls, credits, phone, msgId: id });

  // OTP must be SHA-256 then base64
  const otpHashed = Buffer.from(crypto.createHash('sha256').update(otp).digest()).toString('base64');

  let data: any;
  try {
    data = await post('/v1/business/MFP', { msgId: id, receiver: phone, amount: String(p.priceIls), otp: otpHashed, lang: 'AR' }, 45_000);
  } catch (e: any) {
    // A refusal means nothing was charged. Anything else (timeout, network) leaves the outcome unknown.
    const refused = e instanceof GatewayRefusal;
    updateJawwalPayment(paymentId, { status: refused ? 'failed' : 'unknown', error: String(e?.message || e).slice(0, 300) });
    console.error(`[jawwal] MFP ${refused ? 'refused' : 'no answer'} (${MODE}) payment #${paymentId}:`, e?.message);
    return res.status(failureStatus(e)).json({
      success: false,
      error: refused ? customerError(e) : `لم تصلنا نتيجة الدفع. إن خُصم المبلغ من محفظتك فسنضيف نقاطك بعد التحقق (رقم المرجع ${paymentId}).`,
    });
  }

  // Jawwal returns its transaction reference as the top-level `ref` (the `reference` in search_trans)
  const ref = data?.transactionId ?? data?.ref;
  const txId = ref != null && ref !== '' ? String(ref) : null;
  try {
    const balance = creditPurchase(paymentId, user.id, credits, txId, `جوال باي · ${p.id} · ₪${p.priceIls} · ${txId ?? id}`);
    res.json({ success: true, txId, balance });
  } catch (e: any) {
    // Charged but the points could not be added: keep it visible for an admin to credit by hand
    updateJawwalPayment(paymentId, { status: 'charged_not_credited', txId, error: String(e?.message || e).slice(0, 300) });
    console.error(`[jawwal] CHARGED BUT NOT CREDITED payment #${paymentId} user ${user.id} tx ${txId}:`, e?.message);
    res.status(500).json({ success: false, error: `تم الدفع لكن لم تُضف النقاط تلقائياً، وسنضيفها لك يدوياً (رقم المرجع ${paymentId}).` });
  }
});

// Admins: every payment attempt, newest first, and whether the gateway is in test or live mode
jawwalRouter.get('/payments', requireAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, mode: MODE, enabled: enabled(), payments: listJawwalPayments(2000) });
});

// ── admin: merchant wallet and the gateway's own transaction list ─────────────

const last4 = (v: unknown) => {
  const s = String(v ?? '');
  return s.length > 4 ? `…${s.slice(-4)}` : s;
};

// Admins: the merchant wallet balance (bank details and IBAN are not sent to the browser)
jawwalRouter.get('/balance', requireAdmin, async (_req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  try {
    const data = await post('/v1/get_balance', { msgId: msgId(), lang: 'AR' });
    const info = JSON.parse(data.extraData?.find((x: any) => x.key === 'info')?.value ?? '{}');
    res.json({
      success: true,
      mode: MODE,
      name: info.fullName ?? '',
      accounts: (info.accounts ?? []).map((a: any) => ({
        account: last4(a.accountNumber), type: a.accountType, category: a.accountCategory, balance: Number(a.balance) || 0,
      })),
    });
  } catch (e: any) {
    console.error(`[jawwal] get_balance failed (${MODE}):`, e?.message);
    res.status(failureStatus(e)).json({ success: false, error: customerError(e) });
  }
});

/** "dd/MM/yyyy HH:mm:ss" in Palestine time (the gateway's clock) -> epoch ms. */
function gatewayTime(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0));
  // Offset of Palestine at that moment (summer and winter time differ)
  const local = new Date(asUtc).toLocaleString('sv-SE', { timeZone: 'Asia/Gaza' }).replace(' ', 'T') + 'Z';
  return asUtc - (Date.parse(local) - asUtc);
}

const MAX_DAYS = 31;

// Admins: the gateway's transactions for a date range. search_trans only accepts one day (00:00 to 23:59 of the
// same date), so the range is fetched day by day. Each one is matched to our own payment log. The merchant account
// is shared with another platform (a partner's, with its own books), so every transaction gets a `source`:
//   ours  — one of our payments (same Jawwal reference)
//   check — not matched, but one of our attempts with no known outcome has the same amount and time: a customer may
//           have paid without getting the points
//   other — everything else (the other platform's payments, wallet movements)
// and the totals count ours only.
jawwalRouter.get('/transactions', requireAdmin, async (req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  const from = new Date(`${String(req.query.from)}T00:00:00Z`);
  const to = new Date(`${String(req.query.to)}T00:00:00Z`);
  if (isNaN(+from) || isNaN(+to) || to < from) return res.status(400).json({ success: false, error: 'تواريخ غير صحيحة' });
  const days = Math.round((+to - +from) / 86_400_000) + 1;
  if (days > MAX_DAYS) return res.status(400).json({ success: false, error: `الحد الأقصى ${MAX_DAYS} يوماً في المرة` });

  const dd = (n: number) => String(n).padStart(2, '0');
  const ours = listJawwalPayments(1000);
  const txs: any[] = [];
  const failedDays: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(+from + i * 86_400_000);
    const day = `${dd(d.getUTCDate())}/${dd(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    try {
      const data = await post('/v1/business/search_trans', { msgId: msgId(), dateFrom: `${day} 00:00`, dateTo: `${day} 23:59`, lang: 'AR' });
      const list = JSON.parse(data.extraData?.find((x: any) => x.key === 'txs')?.value || '[]');
      for (const t of list) {
        const at = gatewayTime(t.transDate);
        const amount = Number(t.totalAmount) || 0;
        // Our payment: same Jawwal reference, or (older rows without one) same amount within 5 minutes
        const match = ours.find(p => p.tx_id && p.tx_id === String(t.reference))
          ?? ours.find(p => !p.tx_id && p.status === 'credited' && Math.abs(p.amount_ils - amount) < 0.001
            && Math.abs(Date.parse(p.created_at.replace(' ', 'T') + 'Z') - at) < 5 * 60_000);
        const incoming = t.debitCreditFlag === 'CREDIT' && !t.isReversed;
        const attempt = !match && incoming
          ? ours.find(p => ['unknown', 'pending', 'charged_not_credited'].includes(p.status) && Math.abs(p.amount_ils - amount) < 0.001
            && Math.abs(Date.parse(p.created_at.replace(' ', 'T') + 'Z') - at) < 15 * 60_000)
          : undefined;
        txs.push({
          reference: String(t.reference), date: t.transDate, at, amount, fee: Number(t.chargePlusTax) || 0,
          flag: t.debitCreditFlag, status: t.processingStatus, reversed: !!t.isReversed, currency: t.currency,
          operation: t.localOperationName || t.latinOperationName || t.serviceName || '',
          counterparty: last4(t.debitCreditFlag === 'CREDIT' ? t.senderInfo : t.receiverInfo),
          payment: match ? { id: match.id, email: match.email, packageId: match.package_id, status: match.status } : null,
          attempt: attempt ? { id: attempt.id, email: attempt.email, packageId: attempt.package_id, status: attempt.status } : null,
          source: match ? 'ours' : attempt ? 'check' : 'other',
        });
      }
    } catch (e: any) {
      console.error(`[jawwal] search_trans ${day} failed (${MODE}):`, e?.message);
      failedDays.push(day);
    }
  }
  txs.sort((a, b) => b.at - a.at);
  const incoming = (source: string) => txs.filter(t => t.source === source && t.flag === 'CREDIT' && !t.reversed);
  const mine = incoming('ours');
  const others = incoming('other');
  res.json({
    success: true, mode: MODE, days, failedDays, txs,
    totals: { count: mine.length, amount: mine.reduce((s, t) => s + t.amount, 0), fees: mine.reduce((s, t) => s + t.fee, 0) },
    others: { count: others.length, amount: others.reduce((s, t) => s + t.amount, 0) },
    toCheck: incoming('check').length,
  });
});
