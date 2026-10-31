import React, { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, Star, Trash2, X } from 'lucide-react';
import { api, card } from './adminShared';
import { CATEGORY_LABELS, GalleryCategory, GalleryKind, KIND_LABELS } from './GalleryShare';

// Admin side of the gallery: the review queue (customers' work waits here), what is published, and what was refused.

interface Item {
  id: number;
  kind: GalleryKind;
  title: string;
  description: string;
  category: GalleryCategory;
  tags: string[];
  mime: string;
  poster: boolean;
  featured: boolean;
  views: number;
  author: string;
  email: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  source: string;
  createdAt: string;
}
type Status = Item['status'];

const TABS: { id: Status; label: string }[] = [
  { id: 'pending', label: 'بانتظار المراجعة' },
  { id: 'approved', label: 'منشور' },
  { id: 'rejected', label: 'مرفوض' },
];

const Preview: React.FC<{ item: Item }> = ({ item }) => {
  const src = `/api/gallery/${item.id}/file`;
  if (item.mime.startsWith('audio/')) return <audio src={src} controls preload="none" className="w-full h-9" />;
  if (item.mime.startsWith('image/')) return <img src={src} alt="" loading="lazy" className="w-full rounded-lg aspect-[4/5] object-cover bg-black" />;
  return <video src={src} controls playsInline preload="none" poster={item.poster ? `/api/gallery/${item.id}/poster` : undefined} className="w-full rounded-lg aspect-[4/5] object-cover bg-black" />;
};

const Row: React.FC<{ item: Item; onChanged: () => void }> = ({ item, onChanged }) => {
  const [title, setTitle] = useState(item.title);
  const [kind, setKind] = useState(item.kind);
  const [category, setCategory] = useState(item.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = (extra: Record<string, unknown> = {}) => api(`/api/admin/gallery/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title, kind, category, ...extra }) });
  const approve = () => run(async () => { await save(); await api(`/api/admin/gallery/${item.id}/approve`, { method: 'POST' }); });
  const reject = () => {
    const reason = window.prompt('سبب الرفض (يظهر لصاحب العمل، اختياري):', '');
    if (reason === null) return;
    run(() => api(`/api/admin/gallery/${item.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }));
  };
  const remove = () => window.confirm('حذف العمل وملفه نهائياً؟') && run(() => api(`/api/admin/gallery/${item.id}`, { method: 'DELETE' }));

  const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-amber-500';
  const changed = title !== item.title || kind !== item.kind || category !== item.category;
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-2">
      <Preview item={item} />
      <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} className={field} />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={kind} onChange={e => setKind(e.target.value as GalleryKind)} className={field}>
          {Object.entries(KIND_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value as GalleryCategory)} className={field}>
          {Object.entries(CATEGORY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      </div>
      {item.description && <div className="text-[11px] text-slate-400 line-clamp-3">{item.description}</div>}
      <div className="text-[10px] text-slate-500" dir="ltr">{item.email ?? item.author} · {item.source} · {item.views} views</div>
      {item.rejectReason && <div className="text-[11px] text-rose-300">سبب الرفض: {item.rejectReason}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {item.status !== 'approved' && (
          <button type="button" onClick={approve} disabled={busy} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500 text-slate-950 text-[11px] font-bold disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} انشر
          </button>
        )}
        {item.status === 'pending' && (
          <button type="button" onClick={reject} disabled={busy} className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-500/50 text-rose-300 text-[11px] disabled:opacity-50">
            <X className="w-3 h-3" /> ارفض
          </button>
        )}
        {item.status === 'approved' && (
          <>
            {changed && <button type="button" onClick={() => run(save)} disabled={busy} className="px-2.5 py-1 rounded-md bg-amber-500 text-slate-950 text-[11px] font-bold">احفظ</button>}
            <button type="button" onClick={() => run(() => save({ featured: !item.featured }))} disabled={busy}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] ${item.featured ? 'border-amber-500 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
              <Star className="w-3 h-3" /> {item.featured ? 'مميّز' : 'ميّزه'}
            </button>
            <a href={`#/gallery/${item.id}`} className="text-slate-400 hover:text-white" title="افتح في المعرض"><ExternalLink className="w-3.5 h-3.5" /></a>
          </>
        )}
        <button type="button" onClick={remove} disabled={busy} className="mr-auto text-slate-500 hover:text-rose-300" title="حذف"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
    </div>
  );
};

export const GalleryAdminTab: React.FC = () => {
  const [status, setStatus] = useState<Status>('pending');
  const [items, setItems] = useState<Item[] | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: Item[]; pending: number }>(`/api/admin/gallery?status=${status}`)
      .then(d => { setItems(d.items); setPending(d.pending); })
      .catch(e => setError(e.message));
  }, [status]);
  useEffect(() => { setItems(null); load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className={`${card} text-xs text-slate-400 leading-relaxed flex items-center justify-between gap-3 flex-wrap`}>
        <span>
          أعمال العملاء تنتظر موافقتك هنا قبل أن تظهر في <a href="#/gallery" className="text-amber-300 underline">المعرض العام</a>.
          أعمالك تضيفها من تبويبات الصور والفيديو والريلز والبصمات بزر «أضف للمعرض» وتُنشر فوراً.
        </span>
      </div>
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setStatus(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${status === t.id ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-slate-700 text-slate-300'}`}>
            {t.label}{t.id === 'pending' && pending ? ` (${pending})` : ''}
          </button>
        ))}
      </div>
      {error && <div className="text-sm text-rose-300">{error}</div>}
      {!items ? (
        <div className={card}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
      ) : items.length === 0 ? (
        <div className={`${card} text-xs text-slate-400`}>{status === 'pending' ? 'لا أعمال بانتظار المراجعة.' : 'لا شيء هنا.'}</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map(i => <Row key={i.id} item={i} onChanged={load} />)}
        </div>
      )}
    </div>
  );
};
