import dns from 'dns/promises';

// Gmail ignores dots and "+tags" in the local part, so a.b+1@gmail.com is the same inbox as ab@gmail.com.
// We store this canonical form to stop one person farming signup bonuses with address variants.
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
  } else {
    // Most providers (Outlook, Yahoo, iCloud...) support +tags as aliases too
    local = local.split('+')[0];
  }
  return `${local}@${domain}`;
}

// Common throwaway-inbox providers
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la', '10minutemail.com',
  '10minutemail.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net', 'temp-mail.io', 'tempmailo.com',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com',
  'trashmail.de', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'moakt.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'burnermail.io',
  'spamgourmet.com', 'mailcatch.com', 'mytemp.email', 'inboxkitten.com', 'emailfake.com', 'fakemail.net',
  'mail.tm', 'mail.gw', 'tempinbox.com', 'discard.email', 'spam4.me', 'byom.de', 'cock.li', 'mvrht.net',
]);

// Frequent typos of popular domains -> suggested fix
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gmai.com': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmailcom': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outloook.com': 'outlook.com',
  'icloud.co': 'icloud.com', 'iclod.com': 'icloud.com',
};

export type EmailCheckResult =
  | { ok: true }
  | { ok: false; error: string; suggestion?: string };

async function hasMailServer(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    return records.length > 0;
  } catch (err: any) {
    // Only reject on a definitive "no such domain / no MX"; network hiccups shouldn't block signups
    return !['ENOTFOUND', 'ENODATA'].includes(err?.code);
  }
}

export async function checkEmailDeliverable(email: string): Promise<EmailCheckResult> {
  const lower = email.trim().toLowerCase();
  const domain = lower.split('@')[1] || '';

  const fix = DOMAIN_TYPOS[domain];
  if (fix) {
    const suggestion = `${lower.split('@')[0]}@${fix}`;
    return { ok: false, error: `يبدو أن هناك خطأ إملائياً، هل تقصد ${suggestion}؟`, suggestion };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, error: 'لا يمكن التسجيل ببريد مؤقت، يرجى استخدام بريدك الحقيقي' };
  }
  if (!(await hasMailServer(domain))) {
    return { ok: false, error: 'نطاق البريد الإلكتروني لا يستقبل رسائل، يرجى التأكد من العنوان' };
  }
  return { ok: true };
}
