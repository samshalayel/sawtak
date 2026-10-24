import React, { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, ChevronUp, ImagePlus, Loader2, Save, Trash2 } from 'lucide-react';

// The outlet's brand kit (server/brand.ts): set once, used on every episode's audio and video.

export interface BrandKit {
  outletName: string;
  showName: string;
  color: string;
  hasLogo: boolean;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

interface Props {
  brand: BrandKit | null;
  onSaved: (brand: BrandKit) => void;
}

export const BrandKitPanel: React.FC<Props> = ({ brand, onSaved }) => {
  const [open, setOpen] = useState(!brand);
  const [outletName, setOutletName] = useState(brand?.outletName ?? '');
  const [showName, setShowName] = useState(brand?.showName ?? '');
  const [color, setColor] = useState(brand?.color ?? '#0e7490');
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [version, setVersion] = useState(0);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOutletName(brand?.outletName ?? '');
    setShowName(brand?.showName ?? '');
    setColor(brand?.color ?? '#0e7490');
  }, [brand]);

  const pick = async (file: File | undefined, set: (v: string) => void) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setMessage({ ok: false, text: 'الملف أكبر من 8 ميغابايت' });
    set(await readAsDataUrl(file));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outletName, showName, color, logo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.brand) throw new Error(data.error || 'تعذّر الحفظ');
      onSaved(data.brand);
      setLogo(undefined);
      setVersion(v => v + 1);
      setMessage({ ok: true, text: 'تم حفظ هوية المؤسسة، وستظهر في كل حلقة.' });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const hasLogo = logo === undefined ? brand?.hasLogo : logo !== null;
  const logoSrc = typeof logo === 'string' ? logo : `/api/brand/logo?v=${version}`;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2 text-sm font-bold text-white">
          {brand?.hasLogo
            ? <img src={`/api/brand/logo?v=${version}`} alt="" className="h-7 w-auto max-w-[80px] object-contain" />
            : <Building2 className="w-5 h-5 text-amber-400" />}
          هوية المؤسسة {brand?.outletName ? `· ${brand.outletName}` : ''}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          {brand ? 'تعديل' : 'أعدّها مرة واحدة'}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-800 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-slate-300">اسم المؤسسة</span>
              <input value={outletName} onChange={e => setOutletName(e.target.value.slice(0, 50))} placeholder="مثال: وكالة الأنباء" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-300">اسم البرنامج / البودكاست</span>
              <input value={showName} onChange={e => setShowName(e.target.value.slice(0, 50))} placeholder="مثال: نشرة الصباح" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500" />
            </label>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              لون المؤسسة
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-9 h-9 rounded-lg bg-transparent cursor-pointer" />
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300">الشعار</span>
              {hasLogo && <img src={logoSrc} alt="" className="h-10 w-auto max-w-[120px] object-contain bg-slate-800 rounded p-1" />}
              <button type="button" onClick={() => logoInput.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/50">
                <ImagePlus className="w-3.5 h-3.5" /> {hasLogo ? 'تغيير' : 'رفع شعار'}
              </button>
              {hasLogo && <button type="button" onClick={() => setLogo(null)} className="text-slate-500 hover:text-rose-300" title="إزالة"><Trash2 className="w-4 h-4" /></button>}
              <input ref={logoInput} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files?.[0], setLogo); e.target.value = ''; }} />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">الأفضل شعار PNG بخلفية شفافة.</p>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={save} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ الهوية
            </button>
            {message && <span className={`text-xs ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
};
