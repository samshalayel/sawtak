import nodemailer from 'nodemailer';
import { getSettings } from './db.ts';

// SMTP settings come from the admin page (Settings → Email); .env values (SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, MAIL_FROM) are the fallback. Any provider works: Zoho, Gmail app password, Brevo, hosting...
interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }

// A display name alone ("صوتك الذكي") isn't a valid sender: attach the login address to it
function senderAddress(from: string, user: string): string {
  const name = from.trim().replace(/^"|"$/g, '');
  if (name.includes('@')) return name;
  if (!user) return 'no-reply@localhost';
  return name ? `"${name}" <${user}>` : user;
}

function smtpConfig(): SmtpConfig | null {
  const s = getSettings();
  const host = s.smtpHost || process.env.SMTP_HOST || '';
  const user = s.smtpUser || process.env.SMTP_USER || '';
  const pass = s.smtpPass || process.env.SMTP_PASS || '';
  // Treat SMTP as not configured until the password is filled in, so a half-done setup doesn't break sign-ups
  if (!host || (user && !pass)) return null;
  return {
    host,
    port: Number(s.smtpPort || process.env.SMTP_PORT) || 587,
    user,
    pass,
    from: senderAddress(s.mailFrom || process.env.MAIL_FROM || '', user),
  };
}

// Reuse the transport until the settings change
let cached: { key: string; transport: ReturnType<typeof nodemailer.createTransport> } | null = null;
function transportFor(config: SmtpConfig) {
  const key = JSON.stringify(config);
  if (cached?.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        connectionTimeout: 15_000,
      }),
    };
  }
  return cached.transport;
}

// Log the SMTP login result once at startup so a wrong host/password shows up immediately
{
  const config = smtpConfig();
  if (config) {
    transportFor(config).verify()
      .then(() => console.log(`[mail] SMTP ready (${config.host} as ${config.user})`))
      .catch((err: any) => console.error(`[mail] SMTP login failed (${config.host}):`, err?.message || err));
  } else {
    console.warn('[mail] SMTP is not configured — verification emails are disabled until it is set in the admin page');
  }
}

/** Admin "send test email": verifies the login and sends a short message; returns the provider's exact error. */
export async function sendTestEmail(to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = smtpConfig();
  if (!config) return { ok: false, error: 'إعدادات SMTP غير مكتملة (الخادم أو كلمة المرور فارغة)' };
  try {
    const transport = transportFor(config);
    await transport.verify();
    await transport.sendMail({
      from: config.from,
      to,
      subject: 'رسالة تجريبية — صوتك الذكي',
      text: 'إذا وصلتك هذه الرسالة فإعدادات البريد تعمل بشكل صحيح ✅',
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.response || err?.message || err).slice(0, 300) };
  }
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const isMailerConfigured = () => smtpConfig() !== null;

export async function sendVerificationEmail(to: string, name: string, link: string, bonusText: string) {
  const config = smtpConfig();
  if (!config) {
    // In production this is a real failure: the user must not be told an email was sent
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP is not configured');
    // Local development without SMTP: print the link so the flow can still be tested
    console.log(`\n[mail:dev] Verification link for ${to}:\n${link}\n`);
    return;
  }

  const greeting = name ? `أهلاً ${name}،` : 'أهلاً بك،';
  const htmlGreeting = escapeHtml(greeting);
  await transportFor(config).sendMail({
    from: config.from,
    to,
    subject: 'تأكيد بريدك الإلكتروني — صوتك الذكي',
    text: `${greeting}\n\nلتفعيل حسابك في صوتك الذكي${bonusText ? ` والحصول على ${bonusText} مجاناً` : ''}، افتح الرابط التالي:\n${link}\n\nالرابط صالح لمدة 24 ساعة. إذا لم تنشئ حساباً، تجاهل هذه الرسالة.`,
    html: `
      <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;max-width:480px;margin:auto">
        <h2 style="color:#fbbf24;margin:0 0 16px">صوتك الذكي 🎙️</h2>
        <p style="font-size:15px">${htmlGreeting}</p>
        <p style="font-size:15px;line-height:1.8">
          شكراً لتسجيلك! اضغط الزر أدناه لتأكيد بريدك وتفعيل حسابك${bonusText ? ` والحصول على <b style="color:#6ee7b7">${bonusText} مجاناً</b>` : ''}.
        </p>
        <p style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:12px;display:inline-block">تأكيد البريد الإلكتروني</a>
        </p>
        <p style="font-size:12px;color:#94a3b8;line-height:1.7">
          الرابط صالح لمدة 24 ساعة. إذا لم تنشئ حساباً في صوتك الذكي، تجاهل هذه الرسالة.<br>
          إذا لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:<br>
          <span style="direction:ltr;unicode-bidi:embed;color:#cbd5e1;word-break:break-all">${link}</span>
        </p>
      </div>
    `,
  });
}
