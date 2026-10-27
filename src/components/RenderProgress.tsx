import React from 'react';

// Pop-up shown while a reel is being made: a ring with the percentage, what is happening now, and the time left
// (worked out on the server from the reel's length and the videos before it in line).

/** Time left in words: "أقل من دقيقة", "حوالي دقيقتين", "حوالي 5 دقائق"… */
export function timeLeftText(seconds: number | null) {
  if (seconds == null) return 'نحسب الوقت…';
  if (seconds < 45) return 'أقل من دقيقة';
  if (seconds < 90) return 'حوالي دقيقة';
  if (seconds < 150) return 'حوالي دقيقتين';
  const minutes = Math.round(seconds / 60);
  return minutes <= 10 ? `حوالي ${minutes} دقائق` : `حوالي ${minutes} دقيقة`;
}

export const RenderProgress: React.FC<{
  title: string;
  stage: string;
  percent: number;
  secondsLeft: number | null;
}> = ({ title, stage, percent, secondsLeft }) => {
  const r = 52;
  const circle = 2 * Math.PI * r;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-xs rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl px-6 py-7 text-center space-y-4">
        <div className="relative mx-auto w-36 h-36">
          <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full -rotate-90">
            <circle cx="60" cy="60" r={r} fill="none" strokeWidth="9" className="stroke-slate-800" />
            <circle cx="60" cy="60" r={r} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
              strokeDasharray={circle} strokeDashoffset={circle * (1 - Math.min(100, percent) / 100)} />
          </svg>
          {/* Spinner: a short arc turning around the ring, so it always looks alive */}
          <svg viewBox="0 0 120 120" className="absolute -inset-2 w-[calc(100%+1rem)] h-[calc(100%+1rem)] animate-spin [animation-duration:1.4s]">
            <circle cx="60" cy="60" r="58" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-emerald-400/70"
              strokeDasharray={`${2 * Math.PI * 58 * 0.18} ${2 * Math.PI * 58}`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl font-extrabold text-white tabular-nums" dir="ltr">{Math.round(percent)}%</span>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-lg font-extrabold text-white">{title}</div>
          <div className="text-sm text-slate-300">{stage}</div>
        </div>
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
          <div className="text-[11px] text-slate-400">الوقت المتبقي</div>
          <div className="text-base font-bold text-emerald-300">{timeLeftText(secondsLeft)}</div>
        </div>
        <p className="text-[11px] text-slate-500">لا تغلق الصفحة حتى يجهز الريل.</p>
      </div>
    </div>
  );
};
