import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Save, Send } from 'lucide-react';
import { api, card } from './adminShared';

interface SmtpSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;     // always empty from the server (write-only)
  smtpPassSet: boolean;
  mailFrom: string;
}

// Common providers: host + port (465 = SSL, 587 = STARTTLS)
const PRESETS = [
  { label: 'Zoho (خطة مدفوعة)', host: 'smtppro.zoho.com', port: 465, hint: 'لبريد الدومين على خطة Zoho مدفوعة' },
  { label: 'Zoho (خطة مجانية)', host: 'smtp.zoho.com', port: 465, hint: 'لحسابات zohomail.com أو المؤسسات المجانية' },
  { label: 'Gmail', host: 'smtp.gmail.com', port: 465, hint: 'يتطلب App Password من حساب Google' },
  { label: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, hint: 'مجاني حتى 300 رسالة يومياً' },
];

const input = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500';

export const SmtpCard: React.FC = () => {
  const [form, setForm] = useState<SmtpSettings | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ settings: SmtpSettings }>('/api/admin/settings').then(d => setForm({ ...d.settings, smtpPass: '' }));
  }, []);

  if (!form) return <Loader2 className="w-5 h-5 animate-spin text-amber-400" />;

  const update = (patch: Partial<SmtpSettings>) => setForm({ ...form, ...patch });

  const persist = async () => {
    const { smtpHost, smtpPort, smtpUser, smtpPass, mailFrom } = form;
    const d = await api<{ settings: SmtpSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ smtpHost, smtpPort: Number(smtpPort) || 0, smtpUser, smtpPass, mailFrom }),
    });
    setForm({ ...d.settings, smtpPass: '' });
  };

  const save = async () => {
    setBusy('save');
    setResult(null);
    try {
      await persist();
      setResult({ ok: true, text: 'تم الحفظ. اضغط «إرسال رسالة تجريبية» للتأكد.' });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      // Test exactly what is on screen: save first
      await persist();
      const d = await api<{ message: string }>('/api/admin/smtp/test', { method: 'POST' });
      setResult({ ok: true, text: d.message });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${card} space-y-4 max-w-2xl`}>
      <div className="flex items-center gap-2 text-sm font-bold text-white">
        <Mail className="w-4 h-4 text-amber-400" /> البريد الإلكتروني (رسائل تأكيد الحساب)
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => update({ smtpHost: p.host, smtpPort: p.port })}
            title={p.hint}
            className={`px-2.5 py-1.5 rounded-lg border text-xs ${
              form.smtpHost === p.host ? 'border-amber-500/70 bg-amber-500/10 text-amber-300' : 'border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-slate-300">خادم SMTP</span>
          <input value={form.smtpHost} onChange={e => update({ smtpHost: e.target.value })} placeholder="smtppro.zoho.com" dir="ltr" className={input} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-300">المنفذ</span>
          <input type="number" value={form.smtpPort || ''} onChange={e => update({ smtpPort: Number(e.target.value) })} placeholder="465" dir="ltr" className={input} />
        </label>
        <label className="block sm:col-span-3">
          <span className="text-xs font-semibold text-slate-300">اسم المستخدم (البريد الكامل)</span>
          <input value={form.smtpUser} onChange={e => update({ smtpUser: e.target.value })} placeholder="info@smartcloud.ps" dir="ltr" className={input} />
        </label>
        <label className="block sm:col-span-3">
          <span className="text-xs font-semibold text-slate-300">كلمة المرور / App Password</span>
          <input
            type="password"
            value={form.smtpPass}
            onChange={e => update({ smtpPass: e.target.value })}
            placeholder={form.smtpPassSet ? '•••••••• محفوظة — اتركها فارغة للإبقاء عليها' : 'App Password'}
            autoComplete="new-password"
            dir="ltr"
            className={input}
          />
        </label>
        <label className="block sm:col-span-3">
          <span className="text-xs font-semibold text-slate-300">اسم وعنوان المُرسِل</span>
          <input value={form.mailFrom} onChange={e => update({ mailFrom: e.target.value })} placeholder="صوتك الذكي <info@smartcloud.ps>" className={input} />
          <span className="text-[11px] text-slate-500">يجب أن يكون نفس بريد اسم المستخدم أو اسماً مستعاراً (alias) له.</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy !== null} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-60">
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
        </button>
        <button type="button" onClick={test} disabled={busy !== null} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700 text-slate-200 hover:text-white text-sm font-semibold disabled:opacity-60">
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} إرسال رسالة تجريبية لبريدك
        </button>
      </div>

      {result && (
        <p className={`text-xs rounded-lg px-3 py-2 border ${result.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-rose-300 bg-rose-500/10 border-rose-500/30'}`} dir="auto">
          {result.text}
        </p>
      )}
    </div>
  );
};
