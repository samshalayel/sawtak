import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, History, Loader2, StopCircle } from 'lucide-react';
import { api, card, td, th } from './adminShared';
import { BenchmarkRun, Span, SpanProvider, spanMs } from '../types/spans';

// Admin performance test: runs one real motion video (idea -> script -> voice -> worker) and shows every stage as a
// span on a waterfall: when it started, how long it took, what it cost, and how long it waited for a shared slot.
// Runs are saved so they can be compared. Admins are not charged points.

type Style = 'library' | 'free';

const LIMIT_MS: Record<Style, number> = { library: 15 * 60_000, free: 60 * 60_000 };
const POLL_MS = 3000;

const PROVIDERS: Record<SpanProvider, { label: string; color: string }> = {
  gemini: { label: 'Gemini', color: '#3b82f6' },
  aws: { label: 'AWS', color: '#f59e0b' },
  claude: { label: 'Claude', color: '#a855f7' },
  local: { label: 'السيرفر', color: '#14b8a6' },
  wait: { label: 'انتظار', color: '#475569' },
};

const fmtMs = (ms: number) =>
  ms >= 60_000 ? `${Math.floor(ms / 60_000)}د ${Math.round((ms % 60_000) / 1000)}ث` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}ث` : `${Math.round(ms)}ms`;
const fmtUsd = (v: number) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 3)}`;

/** Time covered by at least one span (overlaps counted once). */
function coveredMs(spans: Span[]) {
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    } else curEnd = Math.max(curEnd, s.end);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

function summarize(spans: Span[], now?: number) {
  const t0 = spans.length ? Math.min(...spans.map(s => s.start)) : 0;
  const tEnd = Math.max(now ?? 0, ...spans.map(s => s.end));
  const total = Math.max(0, tEnd - t0);
  const work = spans.filter(s => s.provider !== 'wait');
  const slowest = work.reduce<Span | null>((m, s) => (!m || spanMs(s) > spanMs(m) ? s : m), null);
  const waitMs = spans.filter(s => s.provider === 'wait').reduce((sum, s) => sum + spanMs(s), 0);
  const cost = spans.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const estimated = spans.some(s => s.estimated && (s.costUsd ?? 0) > 0);
  const byProvider = (Object.keys(PROVIDERS) as SpanProvider[])
    .map(p => ({ p, ms: spans.filter(s => s.provider === p).reduce((sum, s) => sum + spanMs(s), 0), cost: spans.filter(s => s.provider === p).reduce((sum, s) => sum + (s.costUsd ?? 0), 0) }))
    .filter(x => x.ms > 0);
  return { t0, total, slowest, waitMs, cost, estimated, byProvider, unmeasured: Math.max(0, total - coveredMs(spans)) };
}

const Stat: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({ label, value, hint, tone = 'text-white' }) => (
  <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 min-w-0">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={`text-base font-extrabold truncate ${tone}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-500 truncate">{hint}</div>}
  </div>
);

export const Waterfall: React.FC<{ spans: Span[]; now?: number }> = ({ spans, now }) => {
  const sorted = useMemo(() => [...spans].sort((a, b) => a.start - b.start || a.end - b.end), [spans]);
  const s = summarize(sorted, now);
  if (!sorted.length) return null;
  const pct = (ms: number) => `${(100 * ms) / Math.max(1, s.total)}%`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="الوقت الكلي" value={fmtMs(s.total)} />
        <Stat label="التكلفة" value={fmtUsd(s.cost)} hint={s.estimated ? 'تشمل أرقام تقديرية' : undefined} tone="text-amber-300" />
        <Stat label="أبطأ مرحلة" value={s.slowest ? fmtMs(spanMs(s.slowest)) : '—'} hint={s.slowest?.label} tone="text-rose-300" />
        <Stat label="وقت الانتظار" value={fmtMs(s.waitMs)} hint="طابور وأدوار مشتركة" />
        <Stat label="وقت غير مقاس" value={fmtMs(s.unmeasured)} hint="بين المراحل" />
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        {s.byProvider.map(({ p, ms, cost }) => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PROVIDERS[p].color }} />
            {PROVIDERS[p].label}: {fmtMs(ms)}{cost > 0 ? ` · ${fmtUsd(cost)}` : ''}
          </span>
        ))}
      </div>

      <div className="border border-slate-800 rounded-xl overflow-hidden">
        {sorted.map((sp, i) => {
          const isSlowest = sp === s.slowest;
          const meta = Object.entries(sp.meta ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
          return (
            <div key={i} className={`grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2 px-3 py-1.5 text-xs ${i % 2 ? 'bg-slate-950/40' : ''}`} title={[sp.label, meta, sp.error].filter(Boolean).join('\n')}>
              <div className={`truncate ${sp.provider === 'wait' ? 'text-slate-500' : 'text-slate-200'} ${isSlowest ? 'font-bold text-rose-300' : ''}`}>
                {sp.error ? '⚠️ ' : ''}{sp.label}
              </div>
              {/* The bar runs left to right like a timeline, even in the RTL page */}
              <div className="relative h-4 bg-slate-950 rounded" dir="ltr">
                <div
                  className={`absolute top-0 h-4 rounded ${sp.error ? 'ring-1 ring-rose-500' : ''}`}
                  style={{
                    left: pct(sp.start - s.t0),
                    width: `max(2px, ${pct(spanMs(sp))})`,
                    background: sp.provider === 'wait'
                      ? `repeating-linear-gradient(45deg, ${PROVIDERS.wait.color}, ${PROVIDERS.wait.color} 3px, transparent 3px, transparent 6px)`
                      : PROVIDERS[sp.provider].color,
                  }}
                />
              </div>
              <div className={`text-left tabular-nums ${isSlowest ? 'text-rose-300 font-bold' : 'text-slate-300'}`} dir="ltr">{fmtMs(spanMs(sp))}</div>
              <div className="text-left tabular-nums text-amber-200/90" dir="ltr">
                {sp.costUsd === undefined ? '—' : `${sp.estimated && sp.costUsd > 0 ? '~' : ''}${fmtUsd(sp.costUsd)}`}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        مرّر على أي مرحلة لترى التفاصيل (الموديل، التوكنز، النتيجة). ~ تكلفة تقديرية: Claude على الاشتراك لا يُحاسَب لكل طلب
        (الرقم هو سعر الـ API المكافئ)، و Transcribe محسوب من سعر الدقيقة. "—" تكلفة غير مقاسة (مثل فحص المحتوى).
      </p>
    </div>
  );
};

export const BenchmarkTab: React.FC = () => {
  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState<Style>('library');
  const [running, setRunning] = useState(false);
  const [spans, setSpans] = useState<Span[]>([]);
  const [step, setStep] = useState<string | null>(null);
  const [now, setNow] = useState<number | undefined>(undefined);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<BenchmarkRun[]>([]);
  const [selected, setSelected] = useState<BenchmarkRun | null>(null);
  const cancelled = useRef(false);

  const loadHistory = () => api<{ runs: BenchmarkRun[] }>('/api/motion/benchmarks').then(d => setHistory(d.runs)).catch(() => {});
  useEffect(() => { loadHistory(); }, []);

  // Keep the running bar moving between polls
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const save = (body: { jobId: string | null; status: 'done' | 'error'; error?: string; spans: Span[] }) =>
    body.spans.length
      ? api('/api/motion/benchmarks', { method: 'POST', body: JSON.stringify({ idea, ...body }) }).then(loadHistory).catch(() => {})
      : Promise.resolve();

  const run = async () => {
    if (!idea.trim() || running) return;
    cancelled.current = false;
    setRunning(true);
    setErrMsg(null);
    setSelected(null);
    setSpans([]);
    setNow(Date.now());
    let all: Span[] = [];
    let jobId: string | null = null;
    try {
      setStep('كتابة السكربت');
      const s = await api<{ script: string; title: string; spans?: Span[] }>('/api/motion/script', {
        method: 'POST',
        body: JSON.stringify({ source: idea, mode: 'idea', minutes: 1, dialect: 'levantine', audience: 'general' }),
      });
      all = s.spans ?? [];
      setSpans(all);
      if (cancelled.current) throw new Error('تم الإلغاء');

      setStep('توليد الصوت');
      const job = await api<{ id: string }>('/api/motion/jobs', {
        method: 'POST',
        body: JSON.stringify({ script: s.script, title: s.title, voice: 'Charon', formats: ['vertical'], dialect: 'levantine', tone: 'educational_tutor', style, look: 'classic' }),
      });
      jobId = job.id;

      const deadline = Date.now() + LIMIT_MS[style];
      for (;;) {
        if (cancelled.current) throw new Error('تم إيقاف المتابعة (الفيديو يكمل على السيرفر)');
        if (Date.now() > deadline) throw new Error(`انتهت مهلة الاختبار (${LIMIT_MS[style] / 60_000} دقيقة)`);
        await new Promise(r => setTimeout(r, POLL_MS));
        const d = await api<{ status: { state: string; step?: string; error?: string; spans?: Span[] } }>(`/api/motion/jobs/${job.id}`);
        all = [...(s.spans ?? []), ...(d.status.spans ?? [])];
        setSpans(all);
        setStep(d.status.step ?? d.status.state);
        if (d.status.state === 'done') break;
        if (d.status.state === 'error') throw new Error(d.status.error || 'فشل تجهيز الفيديو');
      }
      await save({ jobId, status: 'done', spans: all });
    } catch (e: any) {
      setErrMsg(e.message ?? 'خطأ غير متوقع');
      await save({ jobId, status: 'error', error: e.message, spans: all });
    } finally {
      setRunning(false);
      setStep(null);
      setNow(undefined);
    }
  };

  const shown = selected ? selected.spans : spans;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className={`${card} space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-amber-400" />
            اختبار أداء الموشن
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            يصنع فيديو حقيقي (دقيقة، عمودي) ويقيس كل مرحلة: متى بدأت، كم أخذت، كم كلّفت، وكم انتظرت دورها. لا يُخصم من الرصيد.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <textarea
            rows={2}
            value={idea}
            onChange={e => setIdea(e.target.value)}
            disabled={running}
            placeholder="فكرة الفيديو… مثلاً: كيف تعمل الألواح الشمسية؟"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-amber-500 disabled:opacity-50"
            dir="rtl"
          />
          <div className="flex sm:flex-col gap-2 self-start">
            <select
              value={style}
              onChange={e => setStyle(e.target.value as Style)}
              disabled={running}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            >
              <option value="library">نسق جاهز</option>
              <option value="free">نسق حر (أبطأ)</option>
            </select>
            {running ? (
              <button type="button" onClick={() => (cancelled.current = true)} className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-sm font-bold flex items-center gap-1.5 whitespace-nowrap">
                <StopCircle className="w-4 h-4" /> إيقاف
              </button>
            ) : (
              <button type="button" onClick={run} disabled={!idea.trim()} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-sm font-bold flex items-center gap-1.5 whitespace-nowrap">
                <FlaskConical className="w-4 h-4" /> ابدأ
              </button>
            )}
          </div>
        </div>

        {running && (
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> الآن: {step}
          </div>
        )}
        {errMsg && <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl px-4 py-2 text-sm text-rose-300">❌ {errMsg}</div>}
        {selected && (
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>تعرض الآن تجربة محفوظة: {selected.idea || '—'} ({selected.createdAt})</span>
            <button type="button" onClick={() => setSelected(null)} className="text-amber-300 hover:underline">رجوع للتجربة الحالية</button>
          </div>
        )}

        <Waterfall spans={shown} now={selected ? undefined : now} />
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-slate-400" /> التجارب السابقة
        </h3>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد تجارب محفوظة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className={th}>الوقت</th>
                  <th className={th}>الفكرة</th>
                  <th className={th}>النتيجة</th>
                  <th className={th}>المدة</th>
                  <th className={th}>التكلفة</th>
                  <th className={th}>أبطأ مرحلة</th>
                </tr>
              </thead>
              <tbody>
                {history.map(r => {
                  const s = summarize(r.spans);
                  return (
                    <tr key={r.id} onClick={() => setSelected(r)} className={`border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/40 ${selected?.id === r.id ? 'bg-slate-800/60' : ''}`}>
                      <td className={`${td} text-slate-400`}>{r.createdAt}</td>
                      <td className={`${td} max-w-[16rem] truncate text-slate-200`}>{r.idea || '—'}</td>
                      <td className={td}>{r.status === 'done' ? <span className="text-emerald-400">✓ تم</span> : <span className="text-rose-400" title={r.error ?? ''}>✗ فشل</span>}</td>
                      <td className={`${td} tabular-nums`}>{fmtMs(r.totalMs)}</td>
                      <td className={`${td} tabular-nums text-amber-200`}>{fmtUsd(r.totalCostUsd)}</td>
                      <td className={`${td} text-slate-300`}>{s.slowest ? `${s.slowest.label} (${fmtMs(spanMs(s.slowest))})` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
