import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Download, Eye, Link2, Loader2, Play, Plus, Search, Star, Trash2, Upload, Wand2, X } from 'lucide-react';
import { AuthUser } from '../types/auth';
import { AUDIO_KINDS, CATEGORY_LABELS, GalleryCategory, GalleryKind, KIND_LABELS, uploadToGallery } from './GalleryShare';
import { RemixPanel } from './RemixPanel';

// The public gallery ("معرض الأعمال", #/gallery): what was made on the site, searchable by words, kind and category.
// Anyone can browse; signed-in customers share their own work, which waits for an admin's approval (server/gallery.ts).

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
  date: string;
  author: string;
  status?: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
  remix?: boolean;          // can be made again with the customer's own words
}

interface Props {
  user: AuthUser | null;
  onLoginRequired: (reason: string) => void;
  onCredits: (credits: number) => void;
  onOpenPackages: () => void;
}

const file = (id: number) => `/api/gallery/${id}/file`;
const poster = (id: number) => `/api/gallery/${id}/poster`;
const isAudio = (i: Item) => i.mime.startsWith('audio/');
const isImage = (i: Item) => i.mime.startsWith('image/');
const day = (d: string) => new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z')).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });

/** The item an address like #/gallery/12 points at. */
const linkedId = () => Number(window.location.hash.match(/^#\/gallery\/(\d+)/)?.[1]) || null;

const Card: React.FC<{ item: Item; onOpen: () => void }> = ({ item, onOpen }) => (
  <button type="button" onClick={onOpen} className="group text-right bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden hover:border-amber-500/50 transition-colors">
    <div className="relative aspect-[4/5] bg-slate-950">
      {isAudio(item) ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-500/20 via-slate-900 to-sky-500/20">
          <AudioLines className="w-12 h-12 text-amber-400" />
          <span className="text-xs text-slate-300">{KIND_LABELS[item.kind]}</span>
        </div>
      ) : item.poster ? (
        <img src={poster(item.id)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-slate-600"><Play className="w-10 h-10" /></div>
      )}
      {!isImage(item) && (
        <span className="absolute inset-0 flex items-center justify-center opacity-80 group-hover:opacity-100">
          <span className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center"><Play className="w-6 h-6 text-white" /></span>
        </span>
      )}
      <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white">{KIND_LABELS[item.kind]}</span>
      {item.remix && <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-sky-500 text-slate-950 font-bold flex items-center gap-0.5"><Wand2 className="w-3 h-3" /> اصنع مثله</span>}
      {item.featured && <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center gap-0.5"><Star className="w-3 h-3" /> مميّز</span>}
    </div>
    <div className="p-2.5 space-y-0.5">
      <div className="text-sm font-bold text-slate-100 line-clamp-1">{item.title}</div>
      <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
        <span className="truncate">{item.author} · {CATEGORY_LABELS[item.category]}</span>
        <span className="flex items-center gap-0.5 shrink-0"><Eye className="w-3 h-3" />{item.views}</span>
      </div>
    </div>
  </button>
);

const Viewer: React.FC<{ item: Item; onClose: () => void } & Props> = ({ item, onClose, ...remix }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(`/api/gallery/${item.id}/view`, { method: 'POST' }).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item.id, onClose]);
  const copy = async () => {
    await navigator.clipboard?.writeText(`${window.location.origin}/#/gallery/${item.id}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-slate-800">
          <div className="text-sm font-bold text-white truncate">{item.title}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="bg-black flex items-center justify-center">
          {isAudio(item) ? (
            <div className="w-full p-8 flex flex-col items-center gap-4 bg-gradient-to-br from-amber-500/20 via-slate-900 to-sky-500/20">
              <AudioLines className="w-16 h-16 text-amber-400" />
              <audio src={file(item.id)} controls autoPlay className="w-full max-w-md" />
            </div>
          ) : isImage(item) ? (
            <img src={file(item.id)} alt={item.title} className="max-h-[70vh] w-auto" />
          ) : (
            <video src={file(item.id)} controls autoPlay playsInline poster={item.poster ? poster(item.id) : undefined} className="max-h-[70vh] w-auto" />
          )}
        </div>
        <div className="p-4 space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{KIND_LABELS[item.kind]}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{CATEGORY_LABELS[item.category]}</span>
            {item.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400">#{t}</span>)}
          </div>
          {item.description && <p className="text-sm text-slate-300 leading-relaxed">{item.description}</p>}
          <div className="text-[11px] text-slate-500">{item.author} · {day(item.date)} · {item.views} مشاهدة</div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={copy} className="flex items-center gap-1 text-xs text-slate-300 hover:text-amber-300">
              <Link2 className="w-3.5 h-3.5" /> {copied ? 'نُسخ الرابط' : 'نسخ الرابط'}
            </button>
            <a href={`${file(item.id)}?download=1`} className="flex items-center gap-1 text-xs text-slate-300 hover:text-amber-300"><Download className="w-3.5 h-3.5" /> تحميل</a>
            {!item.remix && <a href="#/" className="mr-auto text-xs font-bold text-amber-400 hover:text-amber-300">اصنع مثله على صوتك الذكي ←</a>}
          </div>
          {item.remix && <RemixPanel itemId={item.id} {...remix} />}
        </div>
      </div>
    </div>
  );
};

const CONSENT = 'أؤكد أن هذا العمل من إنتاجي على صوتك الذكي، وأوافق على عرضه للعامة في المعرض، وأن أي شخص يظهر صوته أو صورته فيه وافق على ذلك.';

const ShareForm: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [picked, setPicked] = useState<File | null>(null);
  const [kind, setKind] = useState<GalleryKind>('video');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GalleryCategory>('other');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return setPicked(null);
    if (f.size > 60 * 1024 * 1024) return setError('الملف أكبر من 60 ميغابايت');
    setPicked(f);
    // A sensible kind from the file
    if (f.type.startsWith('audio/') && !AUDIO_KINDS.includes(kind)) setKind('voice');
    else if (f.type.startsWith('image/')) setKind('image');
    else if (f.type.startsWith('video/') && (AUDIO_KINDS.includes(kind) || kind === 'image')) setKind('video');
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 80));
  };

  const send = async () => {
    if (!picked) return;
    setError(null);
    setProgress(0);
    try {
      await uploadToGallery(picked, { kind, title, category, description, tags }, setProgress);
      setSent(true);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProgress(null);
    }
  };

  const field = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'text-xs font-semibold text-slate-300';
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-white">شارك عملك في المعرض</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {sent ? (
          <div className="space-y-3 text-sm text-slate-200">
            <p>وصلنا عملك ✓ سيظهر في المعرض بعد مراجعته، وتتابع حالته من «أعمالي».</p>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold">تمام</button>
          </div>
        ) : (
          <>
            <label className="block">
              <span className={label}>الملف (صوت، فيديو أو صورة، حتى 60 ميغابايت)</span>
              <input type="file" accept="audio/*,video/mp4,video/webm,image/png,image/jpeg,image/webp" onChange={e => pick(e.target.files?.[0])} className="mt-1 block text-xs text-slate-300" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={label}>النوع</span>
                <select value={kind} onChange={e => setKind(e.target.value as GalleryKind)} className={field}>
                  {Object.entries(KIND_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={label}>التصنيف</span>
                <select value={category} onChange={e => setCategory(e.target.value as GalleryCategory)} className={field}>
                  {Object.entries(CATEGORY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={label}>العنوان</span>
              <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} className={field} />
            </label>
            <label className="block">
              <span className={label}>وصف قصير (اختياري)</span>
              <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, 500))} rows={2} className={field} />
            </label>
            <label className="block">
              <span className={label}>كلمات للبحث (اختياري، مفصولة بفواصل)</span>
              <input value={tags} onChange={e => setTags(e.target.value.slice(0, 200))} placeholder="عيد ميلاد، رمضان، إعلان مطعم" className={field} />
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-amber-500" />
              <span>{CONSENT}</span>
            </label>
            {error && <div className="text-xs text-rose-300">{error}</div>}
            <button type="button" onClick={send} disabled={!picked || !consent || title.trim().length < 2 || progress !== null}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50">
              {progress !== null ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الرفع {Math.round(progress * 100)}%</> : <><Upload className="w-4 h-4" /> أرسل للمراجعة</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const STATUS: Record<NonNullable<Item['status']>, { label: string; tone: string }> = {
  pending: { label: 'بانتظار المراجعة', tone: 'text-amber-300' },
  approved: { label: 'منشور', tone: 'text-emerald-300' },
  rejected: { label: 'مرفوض', tone: 'text-rose-300' },
};

export const GalleryPage: React.FC<Props> = ({ user, onLoginRequired, onCredits, onOpenPackages }) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<GalleryKind | ''>('');
  const [category, setCategory] = useState<GalleryCategory | ''>('');
  const [sort, setSort] = useState<'new' | 'popular' | 'featured'>('new');
  const [open, setOpen] = useState<Item | null>(null);
  const [sharing, setSharing] = useState(false);
  const [mine, setMine] = useState<Item[]>([]);
  const [made, setMade] = useState<{ id: string; status: string; error: string | null; points: number; createdAt: string; resultType: string | null; file: string | null; input: Record<string, string> }[]>([]);
  const request = useRef(0);

  // Typing settles for a moment before searching
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback((p: number) => {
    const id = ++request.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), sort });
    if (query) params.set('q', query);
    if (kind) params.set('kind', kind);
    if (category) params.set('category', category);
    fetch(`/api/gallery?${params}`).then(r => r.json()).then(d => {
      if (id !== request.current) return;
      setItems(prev => (p === 0 ? d.items : [...prev, ...d.items]));
      setMore(Boolean(d.more));
      setPage(p);
    }).catch(() => {}).finally(() => id === request.current && setLoading(false));
  }, [query, kind, category, sort]);

  useEffect(() => { load(0); }, [load]);
  useEffect(() => {
    fetch('/api/gallery/meta').then(r => r.json()).then(d => setCounts(d.counts ?? {})).catch(() => {});
  }, []);

  const loadMine = useCallback(() => {
    if (!user) { setMine([]); setMade([]); return; }
    fetch('/api/gallery/mine').then(r => r.json()).then(d => setMine(d.items ?? [])).catch(() => {});
    fetch('/api/remix/mine').then(r => r.json()).then(d => setMade(d.remixes ?? [])).catch(() => {});
  }, [user]);
  useEffect(loadMine, [loadMine]);

  // A shared link (#/gallery/12) opens its item
  useEffect(() => {
    const id = linkedId();
    if (!id) return;
    fetch(`/api/gallery/item/${id}`).then(r => r.json()).then(d => d.item && setOpen(d.item)).catch(() => {});
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    if (linkedId()) window.history.replaceState(null, '', '#/gallery');
  }, []);

  const share = () => (user ? setSharing(true) : onLoginRequired('سجّل دخولك لتشارك أعمالك في المعرض'));
  const removeMine = async (id: number) => {
    if (!window.confirm('حذف هذا العمل من المعرض؟')) return;
    await fetch(`/api/gallery/mine/${id}`, { method: 'DELETE' }).catch(() => {});
    loadMine();
    load(0);
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chip = (active: boolean) => `px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${active ? 'bg-amber-500 border-amber-500 text-slate-950' : 'border-slate-700 text-slate-300 hover:border-amber-500/50'}`;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white">معرض الأعمال</h1>
          <p className="text-sm text-slate-400 mt-1">أصوات وفيديوهات وريلز وصور وبطاقات صُنعت على صوتك الذكي. استمع وشاهد واستلهم.</p>
        </div>
        <button type="button" onClick={share} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold">
          <Plus className="w-4 h-4" /> شارك عملك
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث: عيد ميلاد، رمضان، إعلان…" className="w-full bg-slate-900 border border-slate-800 rounded-xl pr-9 pl-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500" />
        </label>
        <select value={category} onChange={e => setCategory(e.target.value as GalleryCategory | '')} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100">
          <option value="">كل التصنيفات</option>
          {Object.entries(CATEGORY_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100">
          <option value="new">الأحدث</option>
          <option value="popular">الأكثر مشاهدة</option>
          <option value="featured">المميّز أولاً</option>
        </select>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => setKind('')} className={chip(kind === '')}>الكل {total ? `(${total})` : ''}</button>
        {Object.entries(KIND_LABELS).map(([id, l]) => (
          <button key={id} type="button" onClick={() => setKind(id as GalleryKind)} className={chip(kind === id)}>
            {l}{counts[id] ? ` (${counts[id]})` : ''}
          </button>
        ))}
      </div>

      {items.length === 0 && !loading ? (
        <div className="text-center py-16 text-sm text-slate-400">
          {query || kind || category ? 'لا نتائج لهذا البحث.' : 'المعرض في بدايته. كن أول من يشارك عمله!'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map(item => <Card key={item.id} item={item} onOpen={() => setOpen(item)} />)}
        </div>
      )}
      {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-amber-400" /></div>}
      {more && !loading && (
        <div className="flex justify-center">
          <button type="button" onClick={() => load(page + 1)} className="px-5 py-2 rounded-xl border border-slate-700 text-sm text-slate-200 hover:border-amber-500/50">عرض المزيد</button>
        </div>
      )}

      {mine.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="text-sm font-bold text-white">أعمالي في المعرض</div>
          {mine.map(i => (
            <div key={i.id} className="flex items-center gap-3 text-xs bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2">
              <span className="flex-1 truncate text-slate-200">{i.title} <span className="text-slate-500">· {KIND_LABELS[i.kind]}</span></span>
              <span className={STATUS[i.status ?? 'pending'].tone}>{STATUS[i.status ?? 'pending'].label}{i.rejectReason ? `: ${i.rejectReason}` : ''}</span>
              <button type="button" onClick={() => removeMine(i.id)} className="text-slate-500 hover:text-rose-300" title="حذف"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {made.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-white">ما صنعته من المعرض</div>
            <button type="button" onClick={loadMine} className="text-[11px] text-slate-400 hover:text-white">تحديث</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {made.map(m => (
              <div key={m.id} className="bg-slate-950/50 border border-slate-800 rounded-lg p-2 space-y-1">
                {m.status === 'done' && m.file ? (
                  m.resultType?.startsWith('image/')
                    ? <img src={m.file} alt="" loading="lazy" className="w-full aspect-square object-cover rounded" />
                    : <video src={m.file} controls playsInline preload="none" className="w-full aspect-square object-cover rounded bg-black" />
                ) : (
                  <div className="w-full aspect-square rounded bg-slate-900 flex items-center justify-center text-[11px] text-slate-400 text-center px-2">
                    {m.status === 'working' ? 'يُصنع الآن…' : `لم يكتمل، أُعيدت النقاط${m.error ? ` (${m.error})` : ''}`}
                  </div>
                )}
                <div className="text-[11px] text-slate-300 line-clamp-2">{Object.values(m.input)[0]}</div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>{m.points} نقطة</span>
                  {m.file && <a href={`${m.file}?download=1`} className="flex items-center gap-0.5 hover:text-amber-300"><Download className="w-3 h-3" /> تحميل</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && <Viewer item={open} onClose={close} user={user} onLoginRequired={onLoginRequired} onCredits={onCredits} onOpenPackages={onOpenPackages} />}
      {sharing && <ShareForm onClose={() => setSharing(false)} onDone={loadMine} />}
    </div>
  );
};
