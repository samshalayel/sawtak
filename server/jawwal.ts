// JawwalPay payment gateway integration.
// Flow: POST /api/jawwal/otp  →  customer receives SMS code
//       POST /api/jawwal/pay  →  confirm OTP, charge, add credits
//
// Credentials are read from the server .env:
//   JAWWAL_USERNAME  JAWWAL_PASSWORD  JAWWAL_HMAC_SECRET
// The gateway is disabled (503) when JAWWAL_USERNAME is not set.

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { grantCredits } from './credits.ts';

const BASE_URL = 'https://apitest.jawwalpay.ps'; // switch to prod URL when go-live

const USERNAME  = process.env.JAWWAL_USERNAME  ?? '';
const PASSWORD  = process.env.JAWWAL_PASSWORD  ?? '';
const HMAC_KEY  = process.env.JAWWAL_HMAC_SECRET ?? '';

const enabled = () => Boolean(USERNAME && PASSWORD && HMAC_KEY);

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

async function post(path: string, payload: Record<string, string>): Promise<any> {
  const token = await getToken();
  payload.secureHash = secureHash(payload);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Jawwal ${path} HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data.errorCd && data.errorCd !== '00') throw new Error(data.desc ?? `Jawwal error ${data.errorCd}`);
  return data;
}

// ── package lookup ────────────────────────────────────────────────────────────

interface Pkg { id: string; priceIls: number; minutes: number; bonusMinutes: number }
// Kept in sync with src/data/packages.ts
const PACKAGES: Pkg[] = [
  { id: 'p50',  priceIls: 10,  minutes: 50,  bonusMinutes: 0   },
  { id: 'p100', priceIls: 20,  minutes: 100, bonusMinutes: 10  },
  { id: 'p250', priceIls: 50,  minutes: 250, bonusMinutes: 50  },
  { id: 'p500', priceIls: 100, minutes: 500, bonusMinutes: 100 },
];
const OFFER_ENDS = new Date('2026-12-31T23:59:59+02:00');
const pkg = (id: string) => PACKAGES.find(p => p.id === id);

// ── routes ───────────────────────────────────────────────────────────────────

export const jawwalRouter = Router();

// Send OTP to customer
jawwalRouter.post('/otp', async (req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  const user = (req as any).user;
  if (!user) return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول' });
  const { phone, packageId } = req.body as { phone?: string; packageId?: string };
  const p = pkg(packageId ?? '');
  if (!p) return res.status(400).json({ success: false, error: 'باقة غير موجودة' });
  if (!phone || phone.replace(/\D/g, '').length < 10) return res.status(400).json({ success: false, error: 'رقم الهاتف غير صحيح' });

  try {
    await post('/v1/business/send_otp', {
      msgId: msgId(),
      receiver: phone,
      amount: String(p.priceIls),
      lang: 'AR',
    });
    res.json({ success: true });
  } catch (e: any) {
    res.status(502).json({ success: false, error: e.message });
  }
});

// Confirm OTP + charge + credit the account
jawwalRouter.post('/pay', async (req: Request, res: Response) => {
  if (!enabled()) return res.status(503).json({ success: false, error: 'بوابة الدفع غير مفعّلة حالياً' });
  const user = (req as any).user;
  if (!user) return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول' });
  const { phone, otp, packageId } = req.body as { phone?: string; otp?: string; packageId?: string };
  const p = pkg(packageId ?? '');
  if (!p || !phone || !otp) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

  // OTP must be SHA-256 then base64
  const otpHashed = Buffer.from(
    crypto.createHash('sha256').update(otp).digest()
  ).toString('base64');

  try {
    const data = await post('/v1/business/MFP', {
      msgId: msgId(),
      receiver: phone,
      amount: String(p.priceIls),
      otp: otpHashed,
      lang: 'AR',
    });

    // Credit the account
    const offerActive = new Date() <= OFFER_ENDS;
    const bonus = offerActive ? p.bonusMinutes : 0;
    const totalSeconds = (p.minutes + bonus) * 60;
    grantCredits(user.id, totalSeconds, 0, `جوال باي · ${p.id} · ${data.transactionId ?? 'ok'}`);

    res.json({ success: true, txId: data.transactionId ?? null });
  } catch (e: any) {
    res.status(502).json({ success: false, error: e.message });
  }
});
