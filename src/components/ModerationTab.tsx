import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X, ShieldAlert, BrainCircuit } from 'lucide-react';
import { api, card, date, td, th } from './adminShared';
import { usePaged } from './Pager';

type Mode = 'block' | 'flag' | 'off';

interface ModerationData {
  mode: Mode;
  ai: 'on' | 'off';
  words: { id: number; word: string }[];
  events: { id: number; feature: string; matched: string; excerpt: string; action: 'blocked' | 'flagged'; created_at: string; email: string | null }[];
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'block', label: 'حظر', hint: 'يُرفض الطلب وتظهر للعميل رسالة مهذّبة' },
  { id: 'flag', label: 'تنبيه فقط', hint: 'يمر الطلب ويُسجَّل هنا للمراجعة' },
  { id: 'off', label: 'إيقاف', hint: 'بدون أي فحص' },
];

const FEATURE_LABELS: Record<string, string> = {
  tts: 'توليد صوت', dialogue: 'حوار', script: 'كتابة حوار', video: 'فيديو', 'text-tool': 'تشكيل/تحسين',
};

export const ModerationTab: React.FC = () => {
  const [data, setData] = useState<ModerationData | null>(null);
  const eventsPage = usePaged(data?.events);
  const [newWords, setNewWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ModerationData>('/api/admin/moderation').then(setData).catch(e => setMessage(e.message));
  }, []);
  useEffect(load, [load]);

  const saveSetting = async (patch: Record<string, string>) => {
    setBusy(true);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
      load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addWords = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { added } = await api<{ added: number }>('/api/admin/moderation/words', { method: 'POST', body: JSON.stringify({ words: newWords }) });
      setMessage(added ? `تمت إضافة ${added} كلمة` : 'الكلمات موجودة مسبقاً');
      setNewWords('');
      load();
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeWord = async (id: number) => {
    await api(`/api/admin/moderation/words/${id}`, { method: 'DELETE' }).catch(e => setMessage(e.message));
    load();
  };

  if (!data) return message ? <p className="text-rose-300 text-sm">{message}</p> : <Loader2 className="w-5 h-5 animate-spin text-amber-400" />;

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <ShieldAlert className="w-4 h-4 text-amber-400" /> سياسة الألفاظ الخادشة
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => saveSetting({ moderationMode: m.id })}
              className={`flex-1 rounded-xl border p-3 text-right transition-colors ${
                data.mode === m.id ? 'border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/30' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
              }`}
            >
              <div className="text-sm font-bold text-white">{m.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{m.hint}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          الفحص ذكي: يتجاهل التشكيل والحروف المكرّرة والنقاط والمسافات بين الحروف، ويلتقط الكلمة مع «ال» و«و» و«ب» وضمائر النهاية.
          الكلمات القصيرة (حرفان) تُطابَق بالضبط فقط لتجنّب حظر كلمات عادية.
        </p>

        <div className="flex items-start justify-between gap-3 border-t border-slate-800 pt-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-bold text-white">
              <BrainCircuit className="w-4 h-4 text-amber-400" /> الفحص الذكي للمعنى
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xl">
              بعد قائمة الكلمات، يقرأ Gemini النص ويحكم على معناه: الإيحاءات الجنسية والتلميح، الإهانة، الكراهية، التهديد، وغيرها،
              بأي لهجة أو كتابة ملتوية. إذا تأخر الرد أكثر من 8 ثوانٍ يُتجاوز الفحص ولا يُمنع العميل، وتبقى قائمة الكلمات فعّالة. يُنصح بتفعيله بعد ربط مفتاح مدفوع، لأن المفاتيح المجانية بطيئة جداً في الرد.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={data.ai === 'on'}
            disabled={busy || data.mode === 'off'}
            onClick={() => saveSetting({ moderationAi: data.ai === 'on' ? 'off' : 'on' })}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50 ${
              data.ai === 'on' ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {data.ai === 'on' ? 'مفعّل' : 'متوقف'}
          </button>
        </div>
      </div>

      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-white">قائمة الكلمات المحظورة ({data.words.length})</div>
        <form onSubmit={addWords} className="flex flex-col sm:flex-row gap-2">
          <textarea
            value={newWords}
            onChange={e => setNewWords(e.target.value)}
            rows={2}
            placeholder="كلمة أو عبارة، أو عدة كلمات مفصولة بفاصلة أو سطر جديد"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={busy || !newWords.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-60"
          >
            <Plus className="w-4 h-4" /> إضافة
          </button>
        </form>
        {message && <p className="text-xs text-slate-300">{message}</p>}
        <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
          {data.words.map(w => (
            <span key={w.id} className="flex items-center gap-1 pl-1 pr-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300">
              {w.word}
              <button type="button" onClick={() => removeWord(w.id)} className="p-0.5 rounded text-slate-500 hover:text-rose-300" title="حذف">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className={`${card} p-0 overflow-x-auto`}>
        <div className="px-4 pt-4 pb-2 text-sm font-bold text-white">سجل المحاولات</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              <th className={th}>الوقت</th><th className={th}>المستخدم</th><th className={th}>الخدمة</th>
              <th className={th}>الكلمات</th><th className={th}>مقتطف من النص</th><th className={th}>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {eventsPage.rows.map(ev => (
              <tr key={ev.id} className="border-b border-slate-800/50 text-slate-200 align-top">
                <td className={td}>{date(ev.created_at)}</td>
                <td className={`${td} text-slate-400`} dir="ltr">{ev.email ?? '—'}</td>
                <td className={td}>{FEATURE_LABELS[ev.feature] ?? ev.feature}</td>
                <td className={`${td} text-rose-300`}>{ev.matched}</td>
                <td className="px-3 py-2 text-slate-400 max-w-xs whitespace-normal">{ev.excerpt}</td>
                <td className={td}>
                  {ev.action === 'blocked' ? <span className="text-rose-300">حُظر</span> : <span className="text-amber-300">تنبيه</span>}
                </td>
              </tr>
            ))}
            {data.events.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">لا توجد محاولات مسجّلة</td></tr>
            )}
          </tbody>
        </table>
        {eventsPage.pager}
      </div>
    </div>
  );
};
