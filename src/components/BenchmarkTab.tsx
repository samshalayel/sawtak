import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, StopCircle } from 'lucide-react';
import { card } from './adminShared';

type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface StepState {
  status: StepStatus;
  progress: number;
  ms: number | null;
  label: string;
  icon: string;
}

const STEPS_INIT: StepState[] = [
  { status: 'idle', progress: 0, ms: null, label: 'كتابة السكربت', icon: '📝' },
  { status: 'idle', progress: 0, ms: null, label: 'توليد الصوت',   icon: '🎙️' },
  { status: 'idle', progress: 0, ms: null, label: 'رندر الفيديو',  icon: '🎬' },
];

const SCRIPT_TIMEOUT_MS  = 3 * 60 * 1000; // 3 min
const RENDER_TIMEOUT_MS  = 6 * 60 * 1000; // 6 min

const fmtMs = (ms: number) =>
  ms >= 60000
    ? `${Math.floor(ms / 60000)}د ${Math.round((ms % 60000) / 1000)}ث`
    : `${(ms / 1000).toFixed(1)} ث`;

// ── Ring ──────────────────────────────────────────────────────────────────────

const Ring: React.FC<{ step: StepState; size?: number; elapsed?: number }> = ({ step, size = 88, elapsed }) => {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - step.progress / 100);
  const color =
    step.status === 'done'    ? '#10b981' :
    step.status === 'error'   ? '#ef4444' :
    step.status === 'running' ? '#f59e0b' : '#334155';

  const label =
    step.status === 'idle'    ? '—' :
    step.status === 'running' ? `${Math.round(step.progress)}%` :
    step.status === 'done'    ? '✓' : '✗';

  return (
    <div className="flex flex-col items-center gap-1 select-none w-28">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={8} />
          <circle
            cx={size/2} cy={size/2} r={r}
            fill="none" stroke={color} strokeWidth={8}
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.3s' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-sm font-extrabold text-white">{label}</span>
        </div>
      </div>
      <div className="text-xl mt-1">{step.icon}</div>
      <div className="text-xs font-semibold text-slate-300 text-center">{step.label}</div>
      <div className="text-[11px] text-slate-400 min-h-[16px]">
        {step.ms != null
          ? fmtMs(step.ms)
          : step.status === 'running' && elapsed != null
          ? `⏱ ${fmtMs(elapsed)}`
          : null}
      </div>
    </div>
  );
};

// ── BenchmarkTab ──────────────────────────────────────────────────────────────

export const BenchmarkTab: React.FC = () => {
  const [idea, setIdea]     = useState('');
  const [steps, setSteps]   = useState<StepState[]>(STEPS_INIT.map(s => ({ ...s })));
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [stepStart, setStepStart]   = useState<number | null>(null);
  const [elapsed, setElapsed]       = useState(0);
  const [success, setSuccess]       = useState<{ ms: number[] } | null>(null);
  const [errMsg, setErrMsg]         = useState<string | null>(null);

  const abortCtrlRef = useRef<AbortController | null>(null);
  const tickerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // live elapsed counter
  useEffect(() => {
    if (activeStep !== null && stepStart !== null) {
      elapsedRef.current = setInterval(() => setElapsed(Date.now() - stepStart), 500);
    } else {
      elapsedRef.current && clearInterval(elapsedRef.current);
      setElapsed(0);
    }
    return () => { elapsedRef.current && clearInterval(elapsedRef.current); };
  }, [activeStep, stepStart]);

  const setStep = (i: number, patch: Partial<StepState>) =>
    setSteps(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const startTicker = (i: number) => {
    tickerRef.current && clearInterval(tickerRef.current);
    let v = 8;
    tickerRef.current = setInterval(() => {
      v = Math.min(v + Math.random() * 2.5, 88);
      setStep(i, { progress: v });
    }, 400);
  };
  const stopTicker = () => { tickerRef.current && clearInterval(tickerRef.current); tickerRef.current = null; };

  const cancel = () => {
    abortCtrlRef.current?.abort();
    stopTicker();
  };

  const apiWithTimeout = async <T,>(url: string, init: RequestInit, timeoutMs: number): Promise<T> => {
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'تعذّر إتمام الطلب');
      return data as T;
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error('انتهت مهلة الطلب أو تم الإلغاء');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async () => {
    if (!idea.trim() || running) return;
    setRunning(true);
    setErrMsg(null);
    setSuccess(null);
    setSteps(STEPS_INIT.map(s => ({ ...s })));
    const timings: number[] = [];

    const startStep = (i: number) => {
      setActiveStep(i);
      setStepStart(Date.now());
      setStep(i, { status: 'running', progress: 8 });
      startTicker(i);
    };
    const doneStep = (i: number, ms: number) => {
      stopTicker();
      setActiveStep(null);
      setStepStart(null);
      setStep(i, { status: 'done', progress: 100, ms });
    };

    try {
      // ── Step 0: Script ──────────────────────────────
      startStep(0);
      const t0 = Date.now();
      const scriptRes = await apiWithTimeout<{ success: boolean; script: string; title: string }>(
        '/api/motion/script',
        { method: 'POST', body: JSON.stringify({ source: idea, mode: 'idea', minutes: 1, dialect: 'levantine', audience: 'general' }) },
        SCRIPT_TIMEOUT_MS
      );
      timings.push(Date.now() - t0);
      doneStep(0, timings[0]);

      // ── Step 1: Voice + job ─────────────────────────
      startStep(1);
      const t1 = Date.now();
      const jobRes = await apiWithTimeout<{ success: boolean; id: string }>(
        '/api/motion/jobs',
        {
          method: 'POST',
          body: JSON.stringify({
            script: scriptRes.script, title: scriptRes.title,
            voice: 'Charon', formats: ['vertical'],
            dialect: 'levantine', tone: 'educational_tutor',
            style: 'library', look: 'classic',
          }),
        },
        90_000 // 90 s for TTS
      );
      timings.push(Date.now() - t1);
      doneStep(1, timings[1]);

      // ── Step 2: Poll render ─────────────────────────
      startStep(2);
      const t2 = Date.now();
      const deadline = t2 + RENDER_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000));
        if (abortCtrlRef.current?.signal.aborted) throw new Error('تم الإلغاء');
        const ctrl = new AbortController();
        abortCtrlRef.current = ctrl;
        const res  = await fetch(`/api/motion/jobs/${jobRes.id}`, { signal: ctrl.signal });
        const data = await res.json().catch(() => ({}));
        const prog = Math.max(5, Math.min(95, data.status?.progress ?? 0));
        setStep(2, { progress: prog });
        if (data.status?.state === 'done')  { timings.push(Date.now() - t2); break; }
        if (data.status?.state === 'error') throw new Error('فشل الرندر');
      }
      if (timings.length < 3) throw new Error('انتهت مهلة الرندر (6 دقائق)');
      doneStep(2, timings[2]);
      setSuccess({ ms: timings });

    } catch (e: any) {
      stopTicker();
      setActiveStep(null);
      setStepStart(null);
      setStep(timings.length, { status: 'error', progress: 0 });
      setErrMsg(e.message ?? 'خطأ غير متوقع');
    } finally {
      stopTicker();
      setRunning(false);
    }
  };

  const total = success ? success.ms.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className={`${card} max-w-2xl space-y-6`}>
      <div>
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-amber-400" />
          اختبار أداء الـ Pipeline
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          يقيس زمن كل خطوة: سكربت → صوت → رندر. الاختبار لا يُحسب من رصيد المستخدمين.
        </p>
      </div>

      <div className="flex gap-3">
        <textarea
          rows={3}
          value={idea}
          onChange={e => setIdea(e.target.value)}
          disabled={running}
          placeholder="اكتب فكرة الفيديو… مثلاً: كيف تعمل الألواح الشمسية؟"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-amber-500 disabled:opacity-50"
          dir="rtl"
        />
        <div className="flex flex-col gap-2 self-start">
          <button
            type="button"
            onClick={run}
            disabled={running || !idea.trim()}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-sm font-bold flex items-center gap-1.5 whitespace-nowrap"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
            {running ? 'جارٍ…' : 'ابدأ'}
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-sm font-bold flex items-center gap-1.5 whitespace-nowrap"
            >
              <StopCircle className="w-4 h-4" />
              إلغاء
            </button>
          )}
        </div>
      </div>

      <div className="flex justify-around py-6 border border-slate-800 rounded-2xl bg-slate-950/50">
        {steps.map((s, i) => (
          <Ring key={i} step={s} elapsed={activeStep === i ? elapsed : undefined} />
        ))}
      </div>

      {errMsg && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl px-4 py-3 text-sm text-rose-300">
          ❌ {errMsg}
        </div>
      )}

      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl" dir="rtl">
            <div className="text-5xl mb-3">✅</div>
            <h3 className="text-xl font-bold text-white mb-1">تم الاختبار بنجاح</h3>
            <p className="text-xs text-slate-400 mb-5">نتائج قياس الأداء</p>
            <div className="space-y-2 text-sm mb-6">
              {steps.map((s, i) => (
                <div key={i} className="flex justify-between items-center bg-slate-800/60 rounded-lg px-4 py-2">
                  <span className="text-slate-300">{s.icon} {s.label}</span>
                  <span className="font-bold text-emerald-300">{fmtMs(success.ms[i])}</span>
                </div>
              ))}
              <div className="flex justify-between items-center bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2 mt-1">
                <span className="font-bold text-white">⏱️ المجموع</span>
                <span className="font-extrabold text-amber-300 text-base">{fmtMs(total)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-2.5 rounded-xl transition-colors"
            >
              حسناً
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
