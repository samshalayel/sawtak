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

function secureHash(params: Record<string, string>): string {
  const sorted = Object.values(params).map(String).sort().join('');
  return crypto.createHmac('sha512', HMAC_KEY).update(sorted).digest('hex');
}

function msgId(): string {
  return String(BigInt('0x' + crypto.randomBytes(7).toString('hex'))).slice(0, 14);
}

async function post(path: string, payload: Record<string, string>, timeoutMs = 20_000): Promise<any> {
  payload.secureHash = secureHash(payload);
  for (let attempt = 1; ; attempt++) {
    const token = await getToken();
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify(payload),
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
    res.status(502).json({ success: false, error: customerError(e) });
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
    return res.status(502).json({
      success: false,
      error: refused ? customerError(e) : `لم تصلنا نتيجة الدفع. إن خُصم المبلغ من محفظتك فسنضيف نقاطك بعد التحقق (رقم المرجع ${paymentId}).`,
    });
  }

  const txId = data?.transactionId != null ? String(data.transactionId) : null;
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
  res.json({ success: true, mode: MODE, enabled: enabled(), payments: listJawwalPayments(100) });
});
