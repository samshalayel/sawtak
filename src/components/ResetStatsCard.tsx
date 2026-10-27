import React, { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api, card, num } from './adminShared';

// Fresh start before launch: clears the chosen statistics. Users, their balances, settings, API keys and Jawwal Pay
// payments are never touched (POST /api/admin/reset-stats).

const PARTS = [
  { id: 'usage', label: 'سجل الاستهلاك وتكاليف Google', hint: 'ومعه أرقام «المستهلك» و«طلبات» في جدول المستخدمين' },
  { id: 'transactions', label: 'حركات الرصيد', hint: 'السجل فقط؛ أرصدة المستخدمين تبقى كما هي' },
  { id: 'quran', label: 'سجل ريلز الآيات', hint: '' },
  { id: 'moderation', label: 'سجل الرقابة على المحتوى', hint: 'الكلمات المحظورة نفسها تبقى' },
  { id: 'motion', label: 'إحصاءات الموشن جرافيك', hint: '' },
  { id: 'benchmark', label: 'نتائج اختبار الأداء', hint: '' },
] as const;
type Part = (typeof PARTS)[number]['id'];

export const ResetStatsCard: React.FC = () => {
  const [chosen, setChosen] = useState<Record<Part, boolean>>({ usage: true, transactions: true, quran: true, moderation: true, motion: true, benchmark: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reset = async () => {
    const parts = PARTS.filter(p => chosen[p.id]);
    if (!parts.length) return;
    const ok = window.confirm(
      `سيتم مسح نهائياً:\n${parts.map(p => `• ${p.label}`).join('\n')}\n\nالمستخدمون وأرصدتهم ومدفوعات جوال باي والإعدادات لن تُمس.\nهل أنت متأكد؟`,
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const d = await api<{ deleted: Record<string, number> }>('/api/admin/reset-stats', { method: 'POST', body: JSON.stringify(chosen) });
      setMessage(`تم المسح: ${parts.map(p => `${p.label} (${num(d.deleted[p.id] ?? 0)})`).join('، ')}`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} border-rose-500/40 space-y-3 max-w-2xl`}>
      <div>
        <h3 className="text-sm font-bold text-white">🧹 تصفير الإحصاءات قبل الإطلاق</h3>
        <p className="text-[11px] text-slate-400 mt-1">يمسح سجلات التجربة لتبدأ الأرقام من الصفر. المستخدمون وأرصدتهم ومدفوعات جوال باي والإعدادات والمفاتيح تبقى كما هي.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {PARTS.map(p => (
          <label key={p.id} className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer">
            <input type="checkbox" checked={chosen[p.id]} onChange={e => setChosen(c => ({ ...c, [p.id]: e.target.checked }))} className="mt-0.5 accent-rose-500" />
            <span>{p.label}{p.hint && <span className="block text-[10px] text-slate-500">{p.hint}</span>}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={reset} disabled={busy || !PARTS.some(p => chosen[p.id])}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-[#ffffff] text-sm font-bold disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} مسح المحدد
      </button>
      {message && <p className="text-xs text-slate-300">{message}</p>}
    </div>
  );
};
