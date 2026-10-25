import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, FileArchive, Loader2, Square, Trash2, XCircle, RotateCcw } from 'lucide-react';
import { formatCredits } from '../types/auth';

// Progress and downloads of a bulk greeting job (server/greeting-batch.ts).

export interface BatchStatus {
  id: string;
  status: 'queued' | 'running' | 'done' | 'stopped';
  stopReason?: string;
  total: number;
  done: number;
  failed: number;
  creditsUsed: number;
  ahead: number;
  expiresAt: number;
  items: { n: number; name: string; status: 'pending' | 'working' | 'done' | 'error'; error?: string; ready: boolean }[];
}

interface Props {
  batch: BatchStatus;
  onUpdate: (b: BatchStatus | null) => void;
  onBalanceRefresh: () => void;
  onNew: () => void;
}

export const GreetingBatchView: React.FC<Props> = ({ batch, onUpdate, onBalanceRefresh, onNew }) => {
  const [busy, setBusy] = useState(false);
  const active = batch.status === 'queued' || batch.status === 'running';

  // Poll while the server is working; refresh the balance once it finishes
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      while (!stop) {
        await new Promise(r => setTimeout(r, 2000));
        const res = await fetch(`/api/greetings/batch/${batch.id}`).catch(() => null);
        const data = await res?.json().catch(() => null);
        if (stop) return;
        if (!res?.ok || !data?.batch) return onUpdate(null);
        onUpdate(data.batch);
        if (data.batch.status !== 'queued' && data.batch.status !== 'running') return onBalanceRefresh();
      }
    };
    tick();
    return () => { stop = true; };
  }, [batch.id, active]);

  const stopBatch = async () => {
    setBusy(true);
    const res = await fetch(`/api/greetings/batch/${batch.id}/stop`, { method: 'POST' }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.batch) onUpdate(data.batch);
    onBalanceRefresh();
    setBusy(false);
  };

  const remove = async () => {
    if (!window.confirm('حذف كل فيديوهات هذه الدفعة من الخادم الآن؟ تأكد أنك حمّلتها أولاً.')) return;
    setBusy(true);
    await fetch(`/api/greetings/batch/${batch.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    onNew();
  };

  const percent = batch.total ? Math.round(((batch.done + batch.failed) / batch.total) * 100) : 0;
  const hoursLeft = Math.max(1, Math.round((batch.expiresAt - Date.now()) / 3_600_000));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-extrabold text-white">
          {active ? 'نجهّز التهاني…' : batch.status === 'done' ? 'التهاني جاهزة!' : 'توقفت الدفعة'}
        </h2>
        <p className="text-xs text-slate-400">
          {active
            ? batch.status === 'queued' && batch.ahead > 0
              ? `في الانتظار، أمامك ${batch.ahead} دفعة. يمكنك إغلاق الصفحة والعودة لاحقاً.`
              : 'يعمل الخادم عليها الآن. يمكنك إغلاق الصفحة والعودة لاحقاً من نفس الحساب.'
            : `تبقى الفيديوهات على الخادم ${hoursLeft} ساعة تقريباً ثم تُحذف تلقائياً.`}
        </p>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex justify-between text-sm text-slate-200">
          <span>{batch.done} من {batch.total} جاهزة{batch.failed ? ` · ${batch.failed} تعذّر تجهيزها` : ''}</span>
          <span className="font-mono text-amber-300">{percent}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-gradient-to-l from-amber-400 to-amber-600 transition-all duration-700" style={{ width: `${Math.max(3, percent)}%` }} />
        </div>
        <div className="text-[11px] text-slate-500">الرصيد المستخدم حتى الآن: {formatCredits(batch.creditsUsed)}</div>
        {batch.stopReason && <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{batch.stopReason}</div>}

        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={batch.done ? `/api/greetings/batch/${batch.id}/zip` : undefined}
            aria-disabled={!batch.done}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm ${
              batch.done ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-500 pointer-events-none'
            }`}
          >
            <FileArchive className="w-4 h-4" /> تحميل الكل (ZIP){active && batch.done ? ' — الجاهز حتى الآن' : ''}
          </a>
          {active ? (
            <button type="button" onClick={stopBatch} disabled={busy} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm hover:text-white disabled:opacity-50">
              <Square className="w-4 h-4" /> إيقاف
            </button>
          ) : (
            <>
              <button type="button" onClick={remove} disabled={busy} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-500/40 text-rose-300 text-sm hover:bg-rose-500/10 disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> احذفها من الخادم الآن
              </button>
              <button type="button" onClick={onNew} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm hover:text-white">
                <RotateCcw className="w-4 h-4" /> دفعة جديدة
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          ملف ZIP يحتوي فيديو لكل عضو باسمه، وملف «قائمة-التهاني.csv» بالأسماء وأرقام الجوال لتسهيل الإرسال.
        </p>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl divide-y divide-slate-800 max-h-[50vh] overflow-y-auto">
        {batch.items.map(item => (
          <div key={item.n} className="flex items-center gap-3 px-4 py-2 text-sm">
            {item.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              : item.status === 'error' ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              : item.status === 'working' ? <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
              : <Clock className="w-4 h-4 text-slate-500 shrink-0" />}
            <span className="flex-1 text-slate-200 truncate">{item.name}</span>
            {item.error && <span className="text-[11px] text-rose-300">{item.error}</span>}
            {item.ready && (
              <a href={`/api/greetings/batch/${batch.id}/items/${item.n}`} download={`${item.name}.mp4`} className="text-slate-400 hover:text-amber-300" title="تحميل">
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
