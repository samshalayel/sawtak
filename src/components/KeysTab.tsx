import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { api, card, date, num, td, th, usd } from './adminShared';

interface ApiKeyInfo {
  id: number;
  label: string;
  masked: string; // first 6 + last 4 characters only; the full key never reaches the browser
  enabled: number;
  priority: number;
  cooldown_until: string | null; // ISO timestamp
  last_error: string | null;
  last_error_at: string | null;
  last_used_at: string | null;
  success_count: number;
  error_count: number;
  requests: number;
  requests_today: number;
  prompt_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  cost_usd: number;
}

type KeyState = 'active' | 'cooldown' | 'disabled';

function keyState(k: ApiKeyInfo): KeyState {
  if (!k.enabled) return 'disabled';
  if (k.cooldown_until && new Date(k.cooldown_until) > new Date()) return 'cooldown';
  return 'active';
}

const STATE_STYLES: Record<KeyState, string> = {
  active: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  cooldown: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  disabled: 'text-slate-400 bg-slate-800 border-slate-700',
};

function stateLabel(k: ApiKeyInfo): string {
  const state = keyState(k);
  if (state === 'disabled') return 'معطّل';
  if (state === 'cooldown') {
    const until = new Date(k.cooldown_until!).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    return `متوقف مؤقتاً حتى ${until}`;
  }
  return 'فعّال';
}

const smallBtn = 'px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40';

export const KeysTab: React.FC = () => {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busyId, setBusyId] = useState<number | 'add' | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(() => {
    api<{ keys: ApiKeyInfo[] }>('/api/admin/keys')
      .then(d => setKeys(d.keys))
      .catch(e => setMessage({ text: e.message, ok: false }));
  }, []);
  useEffect(load, [load]);

  const run = async (id: number | 'add', action: () => Promise<{ message?: string } | void>, okText = 'تم') => {
    setBusyId(id);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ text: (result && result.message) || okText, ok: true });
    } catch (e: any) {
      setMessage({ text: e.message, ok: false });
    } finally {
      setBusyId(null);
      load();
    }
  };

  const addKey = (e: React.FormEvent) => {
    e.preventDefault();
    run('add', async () => {
      await api('/api/admin/keys', { method: 'POST', body: JSON.stringify({ apiKey: newKey, label: newLabel }) });
      setNewKey('');
      setNewLabel('');
    }, 'تم اختبار المفتاح وإضافته بنجاح ✓');
  };

  const patch = (id: number, body: object, okText: string) =>
    run(id, () => api(`/api/admin/keys/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), okText);

  const readyCount = keys?.filter(k => keyState(k) === 'active').length ?? 0;

  return (
    <div className="space-y-4">
      <div className={`${card} text-xs text-slate-400 leading-relaxed`}>
        يستخدم النظام المفاتيح <b className="text-slate-200">بالترتيب من الأعلى</b>. إذا انتهت حصة مفتاح أو لم يستجب أو كان غير صالح،
        يُوقَف مؤقتاً وينتقل الطلب <b className="text-slate-200">تلقائياً</b> إلى المفتاح التالي، ولا تظهر للعميل رسالة
        «الخوادم مشغولة» إلا إذا فشلت كل المفاتيح.
        {keys && (
          <span className={`block mt-2 font-semibold ${readyCount > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            المفاتيح الجاهزة الآن: {readyCount} من {keys.length}
          </span>
        )}
      </div>

      <form onSubmit={addKey} className={`${card} flex flex-wrap items-end gap-2`}>
        <label className="block">
          <span className="text-xs font-semibold text-slate-300">اسم المفتاح</span>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="مثال: الحساب المدفوع"
            className="mt-1 w-56 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </label>
        <label className="block flex-1 min-w-[260px]">
          <span className="text-xs font-semibold text-slate-300">مفتاح Gemini API</span>
          <input
            type="password"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="AIza..."
            autoComplete="off"
            dir="ltr"
            required
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </label>
        <button
          type="submit"
          disabled={busyId === 'add' || !newKey.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-60"
        >
          {busyId === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          اختبار وإضافة
        </button>
      </form>

      {message && <p className={`text-xs ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>}

      {!keys ? (
        <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
      ) : (
        <div className={`${card} p-0 overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={th}>#</th><th className={th}>المفتاح</th><th className={th}>الحالة</th>
                <th className={th}>طلبات اليوم</th><th className={th}>كل الطلبات</th><th className={th}>توكن إخراج</th>
                <th className={th}>ثواني صوت</th><th className={th}>التكلفة</th><th className={th}>أخطاء</th>
                <th className={th}>آخر استخدام</th><th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k, i) => {
                const busy = busyId === k.id;
                return (
                  <tr key={k.id} className="border-b border-slate-800/50 text-slate-200 align-top">
                    <td className={`${td} text-slate-500`}>{i + 1}</td>
                    <td className={td}>
                      <div className="font-medium">{k.label || '—'}</div>
                      <div className="font-mono text-slate-400" dir="ltr" style={{ textAlign: 'right' }}>{k.masked}</div>
                    </td>
                    <td className={td}>
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] ${STATE_STYLES[keyState(k)]}`}>
                        {stateLabel(k)}
                      </span>
                      {k.last_error && (
                        <div className="text-[10px] text-rose-300/80 mt-1 max-w-[220px] whitespace-normal" title={k.last_error}>
                          آخر خطأ: {k.last_error} · {date(k.last_error_at)}
                        </div>
                      )}
                    </td>
                    <td className={td}>{num(k.requests_today)}</td>
                    <td className={td}>{num(k.requests)}</td>
                    <td className={td}>{num(k.output_tokens)}</td>
                    <td className={td}>{num(k.audio_seconds)}</td>
                    <td className={td}>{usd(k.cost_usd)}</td>
                    <td className={td}>{num(k.error_count)}</td>
                    <td className={td}>{date(k.last_used_at)}</td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        <button type="button" disabled={busy || i === 0} title="رفع الأولوية"
                          onClick={() => patch(k.id, { move: 'up' }, 'تم تغيير الترتيب')} className={smallBtn}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" disabled={busy || i === keys.length - 1} title="خفض الأولوية"
                          onClick={() => patch(k.id, { move: 'down' }, 'تم تغيير الترتيب')} className={smallBtn}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" disabled={busy} className={smallBtn}
                          onClick={() => run(k.id, () => api<{ message: string }>(`/api/admin/keys/${k.id}/test`, { method: 'POST' }))}>
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'اختبار'}
                        </button>
                        <button type="button" disabled={busy} className={smallBtn}
                          onClick={() => patch(k.id, { enabled: !k.enabled }, k.enabled ? 'تم تعطيل المفتاح' : 'تم تفعيل المفتاح')}>
                          {k.enabled ? 'تعطيل' : 'تفعيل'}
                        </button>
                        <button type="button" disabled={busy}
                          className="px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                          onClick={() => {
                            if (window.confirm(`حذف المفتاح ${k.masked} نهائياً؟`)) {
                              run(k.id, () => api(`/api/admin/keys/${k.id}`, { method: 'DELETE' }), 'تم حذف المفتاح');
                            }
                          }}>
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {keys.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-4 text-center text-rose-300">لا توجد مفاتيح — التوليد متوقف حتى تضيف مفتاحاً</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
