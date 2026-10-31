import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Download, Loader2, Pencil, Wand2 } from 'lucide-react';
import { AuthUser } from '../types/auth';

// "Make one like it" (اصنع مثله) inside the gallery viewer: the same recipe as the item (server/remix.ts), with only
// the boxes it offers open for the customer's own words (framed), and a confirmation of the points before it runs.

interface Box { key: string; label: string; value: string; max: number; hint: string }
interface Info { available: boolean; boxes: Box[]; price: number; summary: string; balance: number | null }
interface Remix { id: string; status: 'working' | 'done' | 'failed'; error: string | null; resultType: string | null; file: string | null }

interface Props {
  itemId: number;
  user: AuthUser | null;
  onLoginRequired: (reason: string) => void;
  onCredits: (credits: number) => void;
  onOpenPackages: () => void;
}

const rtl = { didOpen: (el: HTMLElement) => el.setAttribute('dir', 'rtl') };

export const RemixPanel: React.FC<Props> = ({ itemId, user, onLoginRequired, onCredits, onOpenPackages }) => {
  const [info, setInfo] = useState<Info | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [remix, setRemix] = useState<Remix | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch(`/api/remix/info/${itemId}`).then(r => r.json()).then(d => {
      if (!d.success) return;
      setInfo(d);
      setValues(Object.fromEntries(d.boxes.map((b: Box) => [b.key, b.value])));
    }).catch(() => {});
  }, [itemId, user?.id]);

  // Follow the work until it is done
  useEffect(() => {
    if (!remix || remix.status !== 'working') return;
    const timer = setInterval(() => {
      fetch(`/api/remix/job/${remix.id}`).then(r => r.json()).then(d => {
        if (!d.success) return;
        setRemix(d.remix);
        if (d.remix.status === 'failed') {
          onCredits(d.credits);
          Swal.fire({ ...rtl, icon: 'error', title: 'لم يكتمل العمل', text: `${d.remix.error || ''} · أُعيدت ${info?.price ?? ''} نقطة إلى رصيدك.`, confirmButtonText: 'حسناً' });
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [remix, info?.price, onCredits]);

  if (!info) return null;
  if (!info.available) return <div className="text-xs text-slate-500">«اصنع مثله» متوقفة مؤقتاً.</div>;

  const start = async () => {
    if (!user) return onLoginRequired('سجّل دخولك لتصنع مثله');
    const balance = info.balance ?? 0;
    if (balance < info.price) {
      const go = await Swal.fire({
        ...rtl, icon: 'warning', title: 'رصيدك لا يكفي',
        html: `تحتاج <b>${info.price}</b> نقطة، ورصيدك <b>${balance}</b> نقطة.`,
        showCancelButton: true, confirmButtonText: 'اشحن رصيدك', cancelButtonText: 'إلغاء', confirmButtonColor: '#f59e0b',
      });
      if (go.isConfirmed) onOpenPackages();
      return;
    }
    const ok = await Swal.fire({
      ...rtl, icon: 'question', title: 'تأكيد الخصم من رصيدك',
      html: `
        <div style="text-align:right;line-height:1.9">
          <div>${info.summary}</div>
          <div>سيُخصم: <b style="color:#d97706">${info.price} نقطة</b></div>
          <div>رصيدك الآن: <b>${balance}</b> نقطة ← بعد الخصم: <b>${balance - info.price}</b> نقطة</div>
          <div style="font-size:12px;color:#64748b;margin-top:6px">إذا لم يكتمل العمل تُعاد النقاط إلى رصيدك تلقائياً.</div>
        </div>`,
      showCancelButton: true, confirmButtonText: `نعم، اخصم ${info.price} نقطة واصنعه`, cancelButtonText: 'إلغاء',
      confirmButtonColor: '#f59e0b', reverseButtons: true, focusCancel: true,
    });
    if (!ok.isConfirmed) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/remix/${itemId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, price: info.price }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || `HTTP ${res.status}`);
      onCredits(d.credits);
      setInfo({ ...info, balance: d.balance });
      setRemix({ id: d.id, status: 'working', error: null, resultType: null, file: null });
    } catch (e: any) {
      Swal.fire({ ...rtl, icon: 'error', title: 'تعذّر البدء', text: e.message, confirmButtonText: 'حسناً' });
    } finally {
      setStarting(false);
    }
  };

  const working = remix?.status === 'working';
  return (
    <div className="space-y-3 bg-slate-950/50 border border-amber-500/30 rounded-xl p-3">
      <div className="flex items-center gap-2 text-sm font-bold text-white"><Wand2 className="w-4 h-4 text-amber-400" /> اصنع مثله</div>
      <div className="text-[11px] text-slate-400">بنفس النماذج والإعدادات. عدّل ما في الإطار فقط، ثم اصنعه.</div>
      {info.boxes.map(box => (
        <label key={box.key} className="block rounded-xl border-2 border-dashed border-amber-400/80 bg-amber-500/5 p-2.5">
          <span className="flex items-center gap-1.5 text-xs font-bold text-amber-300"><Pencil className="w-3.5 h-3.5" /> {box.label} <span className="font-normal text-amber-200/70">(قابل للتعديل)</span></span>
          <textarea
            value={values[box.key] ?? ''}
            onChange={e => setValues(v => ({ ...v, [box.key]: e.target.value.slice(0, box.max) }))}
            rows={3}
            disabled={working}
            className="mt-1.5 w-full bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
          />
          <span className="block mt-1 text-[11px] text-slate-500">{box.hint}</span>
        </label>
      ))}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={start}
          disabled={starting || working || info.boxes.some(b => (values[b.key] ?? '').trim().length < 3)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
        >
          {starting || working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {working ? 'يُصنع الآن…' : `اصنعه · ${info.price} نقطة`}
        </button>
        {user && info.balance != null && <span className="text-xs text-slate-400">رصيدك: {info.balance} نقطة</span>}
      </div>
      {working && <div className="text-[11px] text-slate-400">قد يستغرق من دقيقة (صورة) إلى بضع دقائق (فيديو أو ريل). يمكنك متابعته لاحقاً من «ما صنعته من المعرض».</div>}
      {remix?.status === 'done' && remix.file && (
        <div className="space-y-2">
          {remix.resultType?.startsWith('image/')
            ? <img src={remix.file} alt="" className="max-h-[60vh] rounded-xl" />
            : <video src={remix.file} controls autoPlay playsInline className="max-h-[60vh] rounded-xl bg-black" />}
          <a href={`${remix.file}?download=1`} className="inline-flex items-center gap-1 text-xs text-slate-200 hover:text-amber-300"><Download className="w-3.5 h-3.5" /> تحميل</a>
        </div>
      )}
    </div>
  );
};
