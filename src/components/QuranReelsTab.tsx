import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, card, date, num, td, th } from './adminShared';
import { usePaged } from './Pager';

// Admin "ريلز الآيات" tab: how the Quran reels service is used — reels, verses, minutes, points, the reciters and
// surahs people pick, and every reel (from the log written by server/quran-stats.ts).

interface QuranReel {
  id: number; email: string | null; surah: number; surah_name: string; start_verse: number; end_verse: number;
  reciter: string; reel_seconds: number; points: number; status: 'rendering' | 'done' | 'failed';
  render_seconds: number | null; error: string | null; created_at: string;
}
interface QuranStats {
  totals: { reels: number; done: number | null; failed: number | null; users: number; verses: number; reel_seconds: number; points: number; avg_render_seconds: number | null };
  byReciter: { name: string; reels: number }[];
  bySurah: { surah: number; name: string; reels: number }[];
  daily: { day: string; reels: number; points: number }[];
  reels: QuranReel[];
  customers: { users: number; points: number };
}

const PERIODS = [{ days: 7, label: 'آخر 7 أيام' }, { days: 30, label: 'آخر 30 يوم' }, { days: 90, label: 'آخر 90 يوم' }, { days: 0, label: 'الكل' }];
const minutes = (s: number) => (s < 60 ? `${Math.round(s)} ث` : `${(s / 60).toFixed(1)} د`);
const STATUS: Record<QuranReel['status'], { label: string; cls: string }> = {
  done: { label: 'جاهز', cls: 'text-emerald-300' },
  failed: { label: 'فشل', cls: 'text-rose-300' },
  rendering: { label: 'قيد التجهيز', cls: 'text-amber-300' },
};

export const QuranReelsTab: React.FC = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<QuranStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reels = usePaged(data?.reels);
  const daily = usePaged(data?.daily, 10);

  useEffect(() => {
    setData(null);
    api<QuranStats>(`/api/admin/quran?days=${days}`).then(setData).catch(e => setError(e.message));
  }, [days]);

  if (error) return <p className="text-rose-300 text-sm">{error}</p>;

  const t = data?.totals;
  const tiles = t && data ? [
    { label: 'ريلز', value: num(t.reels), hint: `${num(t.done ?? 0)} جاهز · ${num(t.failed ?? 0)} فشل` },
    { label: 'مستخدمون صنعوا ريلز', value: num(t.users), hint: t.users ? `${(t.reels / t.users).toFixed(1)} ريل للمستخدم` : '—' },
    { label: 'آيات', value: num(t.verses), hint: t.reels ? `${(t.verses / t.reels).toFixed(1)} آية للريل` : '—' },
    { label: 'مدة التلاوات', value: minutes(t.reel_seconds), hint: t.reels ? `${minutes(t.reel_seconds / t.reels)} للريل` : '—' },
    { label: 'نقاط مستخدمة', value: num(t.points), hint: 'خُصمت من المستخدمين على ريلز الآيات' },
    { label: 'نقاط متبقية عند المستخدمين', value: num(data.customers.points), hint: `رصيد ${num(data.customers.users)} مستخدم (بدون الأدمن)` },
    { label: 'متوسط وقت التجهيز', value: t.avg_render_seconds != null ? minutes(t.avg_render_seconds) : '—', hint: 'من الضغط على الزر إلى الفيديو' },
  ] : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">الفترة:</span>
        {PERIODS.map(p => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)}
            className={`px-2.5 py-1 rounded-lg border ${days === p.days ? 'border-amber-500/70 text-amber-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {!data ? <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map(tile => (
              <div key={tile.label} className={card}>
                <div className="text-[11px] text-slate-400">{tile.label}</div>
                <div className="text-xl font-extrabold text-white mt-1">{tile.value}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{tile.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-3">
            {[
              { title: 'أكثر القرّاء', rows: data.byReciter.map(r => ({ key: r.name, name: r.name, reels: r.reels })) },
              { title: 'أكثر السور', rows: data.bySurah.map(r => ({ key: String(r.surah), name: `${r.surah}. ${r.name}`, reels: r.reels })) },
            ].map(list => (
              <div key={list.title} className={card}>
                <h3 className="text-sm font-bold text-white mb-2">{list.title}</h3>
                {list.rows.length === 0 ? <p className="text-xs text-slate-500">لا يوجد بعد</p> : (
                  <ul className="space-y-1.5">
                    {list.rows.map(r => (
                      <li key={r.key} className="flex items-center justify-between gap-2 text-xs text-slate-200">
                        <span className="truncate">{r.name}</span>
                        <span className="font-mono text-amber-300">{num(r.reels)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className={`${card} p-0 overflow-x-auto`}>
              <h3 className="text-sm font-bold text-white px-4 pt-4 pb-2">يومياً</h3>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-800"><th className={th}>اليوم</th><th className={th}>ريلز</th><th className={th}>نقاط</th></tr></thead>
                <tbody>
                  {daily.rows.map(d => (
                    <tr key={d.day} className="border-b border-slate-800/50 text-slate-200">
                      <td className={td}>{d.day}</td><td className={td}>{num(d.reels)}</td><td className={td}>{num(d.points)}</td>
                    </tr>
                  ))}
                  {data.daily.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">لا يوجد بعد</td></tr>}
                </tbody>
              </table>
              {daily.pager}
            </div>
          </div>

          <div className={`${card} p-0 overflow-x-auto`}>
            <h3 className="text-sm font-bold text-white px-4 pt-4 pb-2">كل الريلز</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className={th}>الوقت</th><th className={th}>المستخدم</th><th className={th}>السورة والآيات</th><th className={th}>القارئ</th>
                  <th className={th}>المدة</th><th className={th}>نقاط</th><th className={th}>الحالة</th><th className={th}>وقت التجهيز</th>
                </tr>
              </thead>
              <tbody>
                {reels.rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-800/50 text-slate-200">
                    <td className={td}>{date(r.created_at)}</td>
                    <td className={`${td} text-slate-400`} dir="ltr">{r.email ?? '—'}</td>
                    <td className={td}>{r.surah_name} {r.start_verse === r.end_verse ? r.start_verse : `${r.start_verse}–${r.end_verse}`}</td>
                    <td className={td}>{r.reciter}</td>
                    <td className={td}>{minutes(r.reel_seconds)}</td>
                    <td className={td}>{num(r.points)}</td>
                    <td className={`${td} ${STATUS[r.status].cls}`} title={r.error ?? undefined}>{STATUS[r.status].label}</td>
                    <td className={td}>{r.render_seconds != null ? minutes(r.render_seconds) : '—'}</td>
                  </tr>
                ))}
                {data.reels.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">لا توجد ريلز خلال هذه الفترة</td></tr>}
              </tbody>
            </table>
            {reels.pager}
          </div>
        </>
      )}
    </div>
  );
};
