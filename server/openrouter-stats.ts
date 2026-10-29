// What the site's OpenRouter key has spent and what is left of its limit, for the admin dashboard, so nobody has to keep
// the OpenRouter activity page open. Read with the site's own key (GET /key); the account's total balance needs a
// management key and is not asked for. Cached for a minute.

export interface OpenRouterStats {
  configured: boolean;
  /** TTS_PROVIDER is openrouter: the site's voices actually go through it. */
  active: boolean;
  label: string | null;
  /** The key's spending cap in USD for each period (null: none), what is left of it, and when it resets. */
  limit: number | null;
  remaining: number | null;
  resetInterval: string | null;
  resetsAt: string | null;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  expiresAt: string | null;
  fetchedAt: string;
}

let cache: { at: number; stats: OpenRouterStats } | null = null;

const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const nullable = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function openRouterStats(): Promise<OpenRouterStats> {
  const key = process.env.OPENROUTER_API_KEY || '';
  const active = process.env.TTS_PROVIDER === 'openrouter';
  if (!key) {
    return { configured: false, active, label: null, limit: null, remaining: null, resetInterval: null, resetsAt: null, usage: 0, usageDaily: 0, usageWeekly: 0, usageMonthly: 0, expiresAt: null, fetchedAt: new Date().toISOString() };
  }
  if (cache && Date.now() - cache.at < 60_000 && cache.stats.active === active) return cache.stats;

  const res = await fetch(`${process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1'}/key`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const d = (await res.json())?.data ?? {};
  const stats: OpenRouterStats = {
    configured: true,
    active,
    label: typeof d.label === 'string' ? d.label : null,
    limit: nullable(d.limit),
    remaining: nullable(d.limit_remaining),
    resetInterval: typeof d.limit_reset === 'string' ? d.limit_reset : null,
    resetsAt: typeof d.effective_budget?.resets_at === 'string' ? d.effective_budget.resets_at : null,
    usage: number(d.usage),
    usageDaily: number(d.usage_daily),
    usageWeekly: number(d.usage_weekly),
    usageMonthly: number(d.usage_monthly),
    expiresAt: typeof d.expires_at === 'string' ? d.expires_at : null,
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), stats };
  return stats;
}
