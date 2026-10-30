import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Wallet } from 'lucide-react';
import { api, card, td, th } from './adminShared';
import { JawwalPaymentsCard } from './JawwalPaymentsCard';
import { usePaged } from './Pager';

// Admin "Jawwal Pay" tab: the merchant wallet balance and the gateway's own transaction list (matched to our
// payment log), so every shekel received can be traced to an account and a package. The merchant account is shared
// with a partner's platform that keeps its own books: its transactions are hidden unless asked for, and the totals
// are this site's only.

interface Account { account: string; type: string; category: string; balance: number }
interface Tx {
  reference: string; date: string; amount: number; fee: number; flag: string; status: number; reversed: boolean;
  currency: string; operation: string; counterparty: string;
  payment: { id: number; email: string; packageId: string; status: string } | null;
  /** One of our attempts with no known outcome and the same amount and time (when nothing matched). */
  attempt: { id: number; email: string; packageId: string; status: string } | null;
  source: 'ours' | 'check' | 'other';
}
interface TxReport {
  mode: 'test' | 'live'; days: number; failedDays: string[]; txs: Tx[];
  totals: { count: number; amount: number; fees: number };     // this site's payments only
  others: { count: number; amount: number };                   // the other platform on the same account
  toCheck: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: number) => `₪${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const JawwalTab: React.FC = () => {
  const [balance, setBalance] = useState<{ mode: string; name: string; accounts: Account[] } | null>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [report, setReport] = useState<TxReport | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const shown = useMemo(() => report?.txs.filter(t => showOthers || t.source !== 'other'), [report, showOthers]);
  const txPage = usePaged(shown);
  const [loadingTx, setLoadingTx] = useState(false);

  const loadBalance = () => {
    setLoadingBalance(true);
    setBalanceErr(null);
    api<{ mode: string; name: string; accounts: Account[] }>('/api/jawwal/balance')
      .then(setBalance).catch(e => setBalanceErr(e.message)).finally(() => setLoadingBalance(false));
  };
  const loadTx = () => {
    setLoadingTx(true);
    setTxErr(null);
    api<TxReport>(`/api/jawwal/transactions?from=${from}&to=${to}`)
      .then(setReport).catch(e => setTxErr(e.message)).finally(() => setLoadingTx(false));
  };
  useEffect(() => { loadBalance(); loadTx(); }, []);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Wallet className="w-4 h-4 text-emerald-400" /> رصيد محفظة التاجر</h3>
          <button type="button" onClick={loadBalance} disabled={loadingBalance} className="text-xs text-slate-300 hover:text-white flex items-center gap-1 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingBalance ? 'animate-spin' : ''}`} /> تحديث
          </button>
        </div>
        {balanceErr && <p className="text-xs text-rose-300">{balanceErr}</p>}
        {balance && (
          <>
            <p className="text-xs text-slate-400 mb-2">
              {balance.name} · {balance.mode === 'live' ? 'دفع حقيقي' : 'بيئة الاختبار'} · الرصيد مشترك مع المنصة الأخرى على نفس الحساب
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {balance.accounts.map(a => (
                <div key={`${a.account}-${a.type}`} className="bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="text-[11px] text-slate-400">{a.type} · {a.category} · {a.account}</div>
                  <div className="text-2xl font-extrabold text-emerald-300 mt-1" dir="ltr" style={{ textAlign: 'right' }}>{money(a.balance)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold text-white">مدفوعات صوتك الذكي عبر جوال باي</h3>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="text-slate-400">من <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="block bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-100" /></label>
            <label className="text-slate-400">إلى <input type="date" value={to} min={from} max={iso(new Date())} onChange={e => setTo(e.target.value)} className="block bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-100" /></label>
            <button type="button" onClick={loadTx} disabled={loadingTx} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50 flex items-center gap-1">
              {loadingTx && <Loader2 className="w-3.5 h-3.5 animate-spin" />} عرض
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">جوال باي تعطي حركات يوم واحد في كل طلب، فالفترة الطويلة تأخذ ثواني أكثر (الحد 31 يوماً).</p>
        {txErr && <p className="text-xs text-rose-300">{txErr}</p>}
        {report && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2"><div className="text-[11px] text-slate-400">دفعات صوتك الذكي</div><div className="text-lg font-bold text-white">{report.totals.count}</div></div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2"><div className="text-[11px] text-slate-400">المجموع</div><div className="text-lg font-bold text-emerald-300">{money(report.totals.amount)}</div></div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2"><div className="text-[11px] text-slate-400">رسوم جوال باي</div><div className="text-lg font-bold text-amber-300">{money(report.totals.fees)}</div></div>
            </div>
            {report.failedDays.length > 0 && <p className="text-xs text-rose-300 mb-2">⚠️ تعذّر جلب أيام: {report.failedDays.join('، ')}</p>}
            {report.toCheck > 0 && (
              <p className="text-xs text-rose-300 font-semibold mb-2">⚠️ {report.toCheck} دفعة قد تكون لزبون عندنا لم تُضف نقاطه: راجع السطور الحمراء.</p>
            )}
            {(report.others.count > 0 || showOthers) && (
              <p className="text-[11px] text-slate-500 mb-2 flex flex-wrap items-center gap-2">
                <span>{report.others.count} دفعة للمنصة الأخرى على نفس الحساب ({money(report.others.amount)})، غير محسوبة أعلاه.</span>
                <button type="button" onClick={() => setShowOthers(v => !v)} className="text-slate-300 underline hover:text-white">
                  {showOthers ? 'إخفاؤها' : 'إظهارها'}
                </button>
              </p>
            )}
            {!shown?.length ? (
              <p className="text-xs text-slate-500">لا دفعات لصوتك الذكي في هذه الفترة.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className={th}>الوقت</th><th className={th}>المرجع</th><th className={th}>العملية</th><th className={th}>المبلغ</th>
                      <th className={th}>الرسوم</th><th className={th}>الطرف الآخر</th><th className={th}>في سجلّنا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txPage.rows.map(t => (
                      <tr key={t.reference} className={`border-b border-slate-800/50 text-slate-200 ${t.reversed ? 'opacity-50 line-through' : ''}`}>
                        <td className={`${td} text-slate-400`} dir="ltr">{t.date}</td>
                        <td className={`${td} font-mono`}>{t.reference}</td>
                        <td className={td}>{t.operation}{t.reversed ? ' (مُلغاة)' : ''}</td>
                        <td className={`${td} font-bold ${t.flag === 'CREDIT' ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">{t.flag === 'CREDIT' ? '+' : '−'}{money(t.amount)}</td>
                        <td className={`${td} text-amber-300`} dir="ltr">{money(t.fee)}</td>
                        <td className={td} dir="ltr">{t.counterparty || '—'}</td>
                        <td className={td}>
                          {t.payment ? (
                            <span className={t.payment.status === 'credited' ? 'text-emerald-400' : 'text-amber-300 font-bold'}>
                              #{t.payment.id} · {t.payment.email} · {t.payment.packageId}{t.payment.status === 'credited' ? '' : ' · لم تُضف النقاط'}
                            </span>
                          ) : t.attempt ? (
                            <span className="text-rose-400 font-bold">تحقّق: محاولة #{t.attempt.id} · {t.attempt.email} · {t.attempt.packageId} (بلا نتيجة)</span>
                          ) : (
                            <span className="text-slate-500">{t.flag === 'CREDIT' ? 'المنصة الأخرى' : 'حركة على المحفظة'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {txPage.pager}
              </div>
            )}
          </>
        )}
      </div>

      <JawwalPaymentsCard />
    </div>
  );
};
