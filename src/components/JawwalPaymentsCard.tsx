import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { api, card, td, th } from './adminShared';
import { usePaged } from './Pager';

// Admin overview: every Jawwal Pay attempt and the gateway mode. A charge that was not credited, or a payment call
// that got no answer, is shown in red so it can be checked in Jawwal Pay and credited by hand.

interface Payment {
  id: number; email: string; package_id: string; amount_ils: number; credits: number; phone_last4: string;
  status: 'pending' | 'credited' | 'failed' | 'charged_not_credited' | 'unknown'; tx_id: string | null; error: string | null; created_at: string;
}

const STATUS: Record<Payment['status'], { label: string; tone: string }> = {
  credited: { label: 'تمّت وأُضيفت النقاط', tone: 'text-emerald-400' },
  failed: { label: 'رُفضت (لم يُخصم شيء)', tone: 'text-slate-400' },
  pending: { label: 'قيد التنفيذ', tone: 'text-amber-300' },
  unknown: { label: 'بلا رد من جوال باي، تحقّق', tone: 'text-rose-400 font-bold' },
  charged_not_credited: { label: 'خُصم ولم تُضف النقاط، أضفها يدوياً', tone: 'text-rose-400 font-bold' },
};

export const JawwalPaymentsCard: React.FC = () => {
  const [data, setData] = useState<{ mode: 'test' | 'live'; enabled: boolean; payments: Payment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = usePaged(data?.payments);

  useEffect(() => {
    api<{ mode: 'test' | 'live'; enabled: boolean; payments: Payment[] }>('/api/jawwal/payments').then(setData).catch(e => setError(e.message));
  }, []);

  const problems = data?.payments.filter(p => p.status === 'unknown' || p.status === 'charged_not_credited').length ?? 0;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Smartphone className="w-4 h-4 text-emerald-400" /> مدفوعات جوال باي</h3>
        {data && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${data.mode === 'live' ? 'border-emerald-500/60 text-emerald-300' : 'border-sky-500/60 text-sky-300'}`}>
            {!data.enabled ? 'غير مفعّلة' : data.mode === 'live' ? 'دفع حقيقي' : 'بيئة الاختبار'}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {problems > 0 && <p className="text-xs text-rose-300 mb-2">⚠️ {problems} عملية تحتاج تحقّق</p>}
      {data && data.payments.length === 0 && <p className="text-xs text-slate-500">لا توجد عمليات دفع بعد.</p>}
      {data && data.payments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={th}>#</th><th className={th}>الوقت</th><th className={th}>الحساب</th><th className={th}>الباقة</th>
                <th className={th}>المبلغ</th><th className={th}>الجوال</th><th className={th}>الحالة</th><th className={th}>رقم العملية</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map(p => (
                <tr key={p.id} className="border-b border-slate-800/50 text-slate-200" title={p.error ?? ''}>
                  <td className={td}>{p.id}</td>
                  <td className={`${td} text-slate-400`}>{p.created_at}</td>
                  <td className={td}>{p.email}</td>
                  <td className={td}>{p.package_id}</td>
                  <td className={td}>₪{p.amount_ils}</td>
                  <td className={td} dir="ltr">…{p.phone_last4}</td>
                  <td className={`${td} ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</td>
                  <td className={`${td} font-mono text-slate-400`}>{p.tx_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {page.pager}
        </div>
      )}
    </div>
  );
};
