import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api, card, usd } from './adminShared';

interface Stats {
  configured: boolean;
  active: boolean;
  label: string | null;
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

const PERIODS: Record<string, string> = { daily: 'يومياً', weekly: 'أسبوعياً', monthly: 'شهرياً' };

/** Spending of the site's OpenRouter key (the voices) and what is left of its cap: replaces watching their activity page. */
export const OpenRouterCard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ stats: Stats }>('/api/admin/openrouter')
      .then(d => { setStats(d.stats); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!stats && !error) return <div className={card}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;
  if (stats && !stats.configured) return null; // no OpenRouter key set: nothing to show

  const s = stats;
  const used = s && s.limit ? s.limit - (s.remaining ?? s.limit) : 0;
  const ratio = s && s.limit ? Math.min(1, used / s.limit) : 0;
  const bar = ratio >= 0.95 ? 'bg-rose-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
  const daysLeft = s?.expiresAt ? Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 86_400_000) : null;
  const tile = (label: string, value: number) => (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-base font-bold text-slate-100 font-mono" dir="ltr">{usd(value)}</div>
    </div>
  );

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold text-white">
          ☁️ OpenRouter (الصوت)
          {s && (
            <span className={`mr-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.active ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-slate-400 bg-slate-800 border-slate-700'}`}>
              {s.active ? 'الصوت يمرّ منه الآن' : 'غير مفعّل للصوت (TTS_PROVIDER)'}
            </span>
          )}
        </div>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>

      {error && <div className="text-xs text-rose-300">{error}</div>}

      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tile('اليوم', s.usageDaily)}
            {tile('هذا الأسبوع', s.usageWeekly)}
            {tile('هذا الشهر', s.usageMonthly)}
            {tile('إجمالي المفتاح', s.usage)}
          </div>

          {s.limit != null ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-300 flex-wrap gap-1">
                <span>حد الصرف {PERIODS[s.resetInterval ?? ''] ?? ''}: <b className="font-mono" dir="ltr">{usd(used)} / {usd(s.limit)}</b></span>
                <span className={ratio >= 0.8 ? 'text-amber-300 font-semibold' : 'text-slate-400'}>
                  المتبقي <span className="font-mono" dir="ltr">{usd(s.remaining ?? 0)}</span>
                  {s.resetsAt && ` · يتجدد ${new Date(s.resetsAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full ${bar} transition-all`} style={{ width: `${Math.max(2, ratio * 100)}%` }} /></div>
              {ratio >= 0.8 && (
                <div className="text-[11px] text-amber-300">
                  {ratio >= 1
                    ? 'بلغ المفتاح حدّه: الأصوات تتحوّل لمفاتيح Google إن وُجدت وإلا تفشل. ارفع الحد من openrouter.ai/settings/keys.'
                    : 'يقترب من حدّ الصرف. عند بلوغه تتحوّل الأصوات لمفاتيح Google إن وُجدت وإلا تفشل. يمكنك رفع الحد من openrouter.ai/settings/keys.'}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400">لا يوجد حد صرف على المفتاح (الحد الفعلي هو رصيد حسابك في OpenRouter).</div>
          )}

          {daysLeft != null && daysLeft <= 30 && (
            <div className="text-[11px] text-amber-300">ينتهي هذا المفتاح خلال {daysLeft} يوماً، أنشئ بديلاً قبل ذلك.</div>
          )}
        </>
      )}
    </div>
  );
};
