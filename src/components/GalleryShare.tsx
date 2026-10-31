import React, { useState } from 'react';
import { Check, Loader2, Share2, X } from 'lucide-react';

// Shared by the gallery page, its admin tab and the admin tools that publish to it (server/gallery.ts)

export const KIND_LABELS = {
  voice: 'أصوات',
  fingerprint: 'بصمات صوت',
  video: 'فيديو',
  reel: 'ريلز',
  image: 'صور',
  motion: 'موشن جرافيك',
  greeting: 'بطاقات تهنئة',
} as const;
export type GalleryKind = keyof typeof KIND_LABELS;
export const AUDIO_KINDS: GalleryKind[] = ['voice', 'fingerprint'];

export const CATEGORY_LABELS = {
  occasions: 'مناسبات',
  religious: 'ديني',
  education: 'تعليمي',
  ads: 'إعلاني',
  stories: 'قصص',
  motivation: 'تحفيزي',
  news: 'أخبار',
  kids: 'أطفال',
  health: 'صحة',
  other: 'أخرى',
} as const;
export type GalleryCategory = keyof typeof CATEGORY_LABELS;

export interface GalleryMeta { kind: GalleryKind; title: string; category: GalleryCategory; description?: string; tags?: string }

/** Uploads a file to the gallery (the body is the file itself); resolves with the server's answer. */
export function uploadToGallery(file: Blob, meta: GalleryMeta, onProgress?: (fraction: number) => void): Promise<any> {
  const query = new URLSearchParams({ ...meta, description: meta.description ?? '', tags: meta.tags ?? '', consent: '1' } as Record<string, string>);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/gallery/submit?${query}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data);
      else reject(new Error(data.error || (xhr.status === 413 ? 'الملف كبير جداً' : `تعذّر الرفع (HTTP ${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
    xhr.send(file);
  });
}

const field = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500';

/**
 * Admin quick publish: a small form under the button. Either `source` + `itemRef` (a file an admin tool already keeps
 * on the server) or `blob` (something only the page has, e.g. a fingerprint sample). Admin work goes up at once.
 */
export const AddToGalleryButton: React.FC<{
  kind: GalleryKind;
  defaultTitle?: string;
  source?: 'ai-image' | 'ai-video' | 'auto-reel' | 'avatar-test';
  itemRef?: string;
  blob?: Blob | (() => Promise<Blob>);
  compact?: boolean;
}> = ({ kind: initialKind, defaultTitle = '', source, itemRef, blob, compact }) => {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GalleryKind>(initialKind);
  const [title, setTitle] = useState(defaultTitle.slice(0, 80));
  const [category, setCategory] = useState<GalleryCategory>('other');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (blob) await uploadToGallery(typeof blob === 'function' ? await blob() : blob, { kind, title, category });
      else {
        const res = await fetch('/api/admin/gallery/from', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, ref: itemRef, kind, title, category }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDone(true);
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) return <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300"><Check className="w-3 h-3" /> بالمعرض</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200">
        <Share2 className="w-3 h-3" /> {compact ? 'للمعرض' : 'أضف للمعرض'}
      </button>
    );
  }
  return (
    <div className="space-y-1.5 bg-slate-950/80 border border-sky-500/30 rounded-lg p-2 w-full">
      <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} placeholder="عنوان العمل" className={field} />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={kind} onChange={e => setKind(e.target.value as GalleryKind)} className={field}>
          {Object.entries(KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value as GalleryCategory)} className={field}>
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={publish} disabled={busy || title.trim().length < 2}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500 text-slate-950 text-[11px] font-bold disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} انشر
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
      </div>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
    </div>
  );
};
