import express from 'express';
import crypto from 'crypto';
import { promisify } from 'util';
import {
  db, getSettings, getUserById, getUserByNormalizedEmail, grantSignupBonusOnce, hasPermission, Permission, publicUser, UserRow
} from './db.ts';
import { checkEmailDeliverable, normalizeEmail } from './email-checks.ts';
import { sendVerificationEmail } from './mailer.ts';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const SESSION_COOKIE = 'sawtik_session';
const GOOGLE_STATE_COOKIE = 'sawtik_g_state';
const SESSION_DAYS = 30;
const VERIFY_TOKEN_HOURS = 24;
const IS_PROD = process.env.NODE_ENV === 'production';
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => normalizeEmail(e))
  .filter(e => e.includes('@'));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const isGoogleEnabled = () => Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

const isAdminEmail = (email: string) => ADMIN_EMAILS.includes(normalizeEmail(email));

// Public base URL for links in emails and the Google redirect URI.
// Set PUBLIC_URL in production (e.g. https://tts.sillar.us); otherwise derived from the request.
// Several domains can serve the site (PUBLIC_URL plus EXTRA_PUBLIC_URLS, comma-separated). Links in e-mails
// and the Google redirect stay on the domain the visitor is using; unknown hosts fall back to PUBLIC_URL.
const PUBLIC_ORIGINS = [process.env.PUBLIC_URL, ...(process.env.EXTRA_PUBLIC_URLS || '').split(',')]
  .map(u => (u || '').trim().replace(/\/$/, ''))
  .filter(Boolean);

function baseUrl(req: express.Request): string {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  if (PUBLIC_ORIGINS.length === 0) return requestOrigin;
  return PUBLIC_ORIGINS.find(o => o.toLowerCase() === requestOrigin.toLowerCase()) ?? PUBLIC_ORIGINS[0];
}

// ---------- Passwords ----------

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- Sessions ----------

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function createSession(res: express.Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expires.toISOString());
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    expires,
    path: '/',
  });
}

function readCookie(req: express.Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Attaches req.user when a valid session cookie is present
export function loadUser(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { user_id: number; expires_at: string }
      | undefined;
    if (row && new Date(row.expires_at) > new Date()) {
      const user = getUserById(row.user_id);
      if (user && !user.disabled) req.user = user;
    }
  }
  next();
}

export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'يرجى تسجيل الدخول للمتابعة', code: 'AUTH_REQUIRED' });
  }
  next();
}

// Paid features need a confirmed inbox so throwaway sign-ups can't consume Gemini quota
export function requireVerifiedEmail(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user?.email_verified) {
    return res.status(403).json({
      success: false,
      error: 'يرجى تأكيد بريدك الإلكتروني أولاً من الرابط المرسل إليك',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }
  next();
}

export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'غير مصرح لك بالوصول' });
  }
  next();
}

/** Lets admins and accounts that were granted this feature through. */
export const requirePermission = (p: Permission) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!hasPermission(req.user, p)) {
    return res.status(403).json({ success: false, error: 'هذه الميزة غير مفعّلة لحسابك' });
  }
  next();
};

// ---------- Simple in-memory rate limiter ----------

export function createRateLimiter(limit: () => number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit()) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

const authAttemptLimiter = createRateLimiter(() => 10, 15 * 60 * 1000);
const signupPerIpLimiter = createRateLimiter(() => 5, 24 * 60 * 60 * 1000);
const resendShortLimiter = createRateLimiter(() => 1, 60 * 1000);
const resendDailyLimiter = createRateLimiter(() => 5, 24 * 60 * 60 * 1000);

// ---------- Email verification ----------

async function sendVerificationLink(req: express.Request, user: UserRow): Promise<boolean> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + VERIFY_TOKEN_HOURS * 60 * 60 * 1000);
  // Only the newest link stays valid
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'verify_email'").run(user.id);
  db.prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, 'verify_email', ?)")
    .run(sha256(token), user.id, expires.toISOString());

  const link = `${baseUrl(req)}/api/auth/verify-email?token=${token}`;
  const { signupBonusCredits } = getSettings();
  const bonusText = !user.bonus_granted && signupBonusCredits > 0
    ? (signupBonusCredits >= 60 ? `${Math.floor(signupBonusCredits / 60)} دقيقة` : `${signupBonusCredits} ثانية`)
    : '';
  try {
    await sendVerificationEmail(user.email, user.name, link, bonusText);
    return true;
  } catch (err) {
    console.error('Failed to send verification email:', err);
    return false;
  }
}

function markEmailVerified(userId: number) {
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  grantSignupBonusOnce(userId);
}

// ---------- Routes ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || '').trim().slice(0, 80);

  if (!authAttemptLimiter(`ip:${req.ip}`)) {
    return res.status(429).json({ success: false, error: 'محاولات كثيرة، يرجى المحاولة بعد قليل' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: 'البريد الإلكتروني غير صالح' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  }
  if (req.body?.acceptTerms !== true) {
    return res.status(400).json({ success: false, error: 'يجب الموافقة على شروط الاستخدام لإنشاء الحساب' });
  }

  const check = await checkEmailDeliverable(email);
  if (!check.ok) {
    return res.status(400).json({ success: false, error: check.error, suggestion: check.suggestion });
  }
  if (getUserByNormalizedEmail(email)) {
    return res.status(409).json({ success: false, error: 'هذا البريد مسجّل مسبقاً، جرّب تسجيل الدخول' });
  }
  if (!signupPerIpLimiter(`ip:${req.ip}`)) {
    return res.status(429).json({ success: false, error: 'تم إنشاء عدد كبير من الحسابات من هذه الشبكة اليوم، يرجى المحاولة غداً' });
  }

  const passwordHash = await hashPassword(password);
  const role = isAdminEmail(email) ? 'admin' : 'user';

  // Welcome credits are granted only after the email is confirmed
  const result = db.prepare(
    "INSERT INTO users (email, email_normalized, name, password_hash, role, credits, email_verified, bonus_granted, terms_accepted_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, datetime('now'))"
  ).run(email, normalizeEmail(email), name, passwordHash, role);
  const user = getUserById(Number(result.lastInsertRowid))!;

  const verificationSent = await sendVerificationLink(req, user);
  createSession(res, user.id);
  res.json({ success: true, user: publicUser(user), verificationSent });
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!authAttemptLimiter(`ip:${req.ip}`) || !authAttemptLimiter(`email:${normalizeEmail(email)}`)) {
    return res.status(429).json({ success: false, error: 'محاولات كثيرة، يرجى المحاولة بعد قليل' });
  }

  const user = getUserByNormalizedEmail(email);
  if (user && !user.password_hash && user.google_sub) {
    return res.status(400).json({ success: false, error: 'هذا الحساب مسجّل عبر Google، استخدم زر "المتابعة بحساب Google"' });
  }
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    return res.status(401).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }
  if (user.disabled) {
    return res.status(403).json({ success: false, error: 'تم إيقاف هذا الحساب، يرجى التواصل مع الدعم' });
  }

  // Promote on login too, so an ADMIN_EMAIL added after signup takes effect
  if (isAdminEmail(user.email) && user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  }

  createSession(res, user.id);
  res.json({ success: true, user: publicUser(getUserById(user.id)!) });
});

// Starred voices (settings, not content): replaced as a whole list
authRouter.put('/favorites', requireAuth, (req, res) => {
  const voices = [...new Set((Array.isArray(req.body?.voices) ? req.body.voices : [])
    .filter((v: unknown) => typeof v === 'string' && /^[A-Za-z]{2,24}$/.test(v)))].slice(0, 40);
  db.prepare('UPDATE users SET favorite_voices = ? WHERE id = ?').run(JSON.stringify(voices), req.user!.id);
  res.json({ success: true, favoriteVoices: voices });
});

authRouter.post('/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

authRouter.get('/me', (req, res) => {
  const { signupBonusCredits, maxTextChars, contactWhatsapp } = getSettings();
  res.json({
    success: true,
    user: req.user ? publicUser(req.user) : null,
    config: { signupBonusCredits, maxTextChars, contactWhatsapp, googleEnabled: isGoogleEnabled() },
  });
});

// Link from the verification email: confirms the inbox, grants the welcome credits and signs the user in
authRouter.get('/verify-email', (req, res) => {
  const token = String(req.query.token || '');
  const row = token
    ? db.prepare("SELECT user_id, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = 'verify_email'")
        .get(sha256(token)) as { user_id: number; expires_at: string; used_at: string | null } | undefined
    : undefined;

  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return res.redirect('/#/verify-failed');
  }
  const user = getUserById(row.user_id);
  if (!user || user.disabled) return res.redirect('/#/verify-failed');

  db.prepare("UPDATE email_tokens SET used_at = datetime('now') WHERE token_hash = ?").run(sha256(token));
  markEmailVerified(user.id);
  if (req.user?.id !== user.id) createSession(res, user.id);
  res.redirect('/#/email-verified');
});

authRouter.post('/resend-verification', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.email_verified) {
    return res.status(400).json({ success: false, error: 'بريدك مؤكد بالفعل' });
  }
  if (!resendShortLimiter(`user:${user.id}`)) {
    return res.status(429).json({ success: false, error: 'تم إرسال رسالة قبل قليل، يرجى الانتظار دقيقة قبل إعادة الإرسال' });
  }
  if (!resendDailyLimiter(`user:${user.id}`)) {
    return res.status(429).json({ success: false, error: 'تجاوزت الحد اليومي لإعادة الإرسال، يرجى المحاولة غداً' });
  }
  const sent = await sendVerificationLink(req, user);
  if (!sent) {
    return res.status(503).json({ success: false, error: 'تعذّر إرسال الرسالة حالياً، يرجى المحاولة لاحقاً' });
  }
  res.json({ success: true });
});

// ---------- Google sign-in (OAuth 2.0 authorization code flow) ----------

// Domains whose callback URL is registered in the Google OAuth client (GOOGLE_OAUTH_ORIGINS, comma-separated).
// Visitors on any other site domain go through the first registered one and are handed back afterwards.
const GOOGLE_ORIGINS = (process.env.GOOGLE_OAUTH_ORIGINS || PUBLIC_ORIGINS[0] || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const googleBase = (origin: string) => (GOOGLE_ORIGINS.includes(origin) || GOOGLE_ORIGINS.length === 0 ? origin : GOOGLE_ORIGINS[0]);

// OAuth "state" is HMAC-signed so it survives the hop between domains (a cookie on one domain isn't sent to the other)
const stateKey = () => crypto.createHash('sha256').update(`sawtik-oauth-state:${GOOGLE_CLIENT_SECRET}`).digest();

function signState(returnOrigin: string): string {
  const payload = Buffer.from(JSON.stringify({ n: crypto.randomBytes(12).toString('base64url'), t: Date.now(), o: returnOrigin })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state: string): { returnOrigin: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: number; o: string };
  if (Date.now() - data.t > 10 * 60 * 1000) return null;
  return { returnOrigin: PUBLIC_ORIGINS.includes(data.o) ? data.o : '' };
}

// One-time codes that carry a fresh Google login back to the domain the visitor started on
const handoffCodes = new Map<string, { userId: number; expires: number }>();

authRouter.get('/google', (req, res) => {
  if (!isGoogleEnabled()) return res.redirect('/#/google-error');
  const origin = baseUrl(req);
  const state = signState(origin);
  res.cookie(GOOGLE_STATE_COOKIE, state, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${googleBase(origin)}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

interface GoogleIdClaims {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

authRouter.get('/google/callback', async (req, res) => {
  const cookieState = readCookie(req, GOOGLE_STATE_COOKIE);
  res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });

  try {
    const state = String(req.query.state || '');
    const verified = verifyState(state);
    // Same-domain logins must also match the browser cookie; cross-domain ones rely on the signature
    if (!isGoogleEnabled() || !req.query.code || !verified || (cookieState && cookieState !== state)) {
      throw new Error('Invalid Google OAuth state');
    }

    // Server-to-server code exchange over TLS; the returned id_token comes straight from Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${baseUrl(req)}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json() as { id_token?: string; error?: string };
    if (!tokenRes.ok || !tokens.id_token) throw new Error(`Google token exchange failed: ${tokens.error}`);

    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()) as GoogleIdClaims;
    if (
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      claims.aud !== GOOGLE_CLIENT_ID ||
      claims.exp * 1000 < Date.now() ||
      !claims.email ||
      !claims.email_verified
    ) {
      throw new Error('Invalid Google ID token claims');
    }

    const email = claims.email.toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub) as UserRow | undefined;

    if (!user) {
      user = getUserByNormalizedEmail(email);
      if (user) {
        // Same inbox as an existing email/password account: Google has proven ownership, so link them
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(claims.sub, user.id);
      } else {
        const result = db.prepare(
          "INSERT INTO users (email, email_normalized, name, password_hash, role, credits, email_verified, bonus_granted, google_sub, terms_accepted_at) VALUES (?, ?, ?, '', ?, 0, 1, 0, ?, datetime('now'))"
        ).run(email, normalizeEmail(email), (claims.name || '').slice(0, 80), isAdminEmail(email) ? 'admin' : 'user', claims.sub);
        user = getUserById(Number(result.lastInsertRowid))!;
      }
    }

    if (user.disabled) return res.redirect('/#/account-disabled');

    markEmailVerified(user.id);
    if (isAdminEmail(user.email) && user.role !== 'admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    }
    if (verified.returnOrigin && verified.returnOrigin !== baseUrl(req)) {
      const code = crypto.randomBytes(24).toString('base64url');
      handoffCodes.set(code, { userId: user.id, expires: Date.now() + 60_000 });
      return res.redirect(`${verified.returnOrigin}/api/auth/handoff?code=${code}`);
    }
    createSession(res, user.id);
    res.redirect('/#/');
  } catch (err) {
    console.error('Google sign-in failed:', err);
    res.redirect('/#/google-error');
  }
});

// Second half of a cross-domain Google login: exchange the one-time code for a session on this domain
authRouter.get('/handoff', (req, res) => {
  const code = String(req.query.code || '');
  const entry = handoffCodes.get(code);
  handoffCodes.delete(code);
  for (const [k, v] of handoffCodes) if (v.expires < Date.now()) handoffCodes.delete(k);
  const user = entry && entry.expires > Date.now() ? getUserById(entry.userId) : undefined;
  if (!user || user.disabled) return res.redirect('/#/google-error');
  createSession(res, user.id);
  res.redirect('/#/');
});
