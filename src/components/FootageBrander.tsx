import React, { useEffect, useRef, useState } from 'react';
import { AudioTagBar } from './AudioTagBar';
import { Clapperboard, Download, Loader2, Mic, Upload, Wand2 } from 'lucide-react';
import type { BrandKit } from './BrandKitPanel';
import { VOICES } from '../data/presets';
import { waitForJob } from '../utils/waitForJob';

// "Brand your own footage": upload a real video, pick the output shape and layout, the font and text size,
// an optional anchor hand-over before it, and when each on-air graphic shows — with a live preview that
// mirrors server/press-overlay.ts — then render it with the outlet's identity.

interface Range { from: number; to: number }
interface Uploaded { id: string; url: string; duration: number; width: number; height: number }
type Canvas = 'original' | 'vertical' | 'square' | 'landscape';
type Layout = 'full' | 'box';
type Fit = 'crop' | 'blur';
type Font = 'sans' | 'kufi' | 'naskh';

const MAX_BYTES = 95 * 1024 * 1024;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const CANVASES: { id: Canvas; label: string }[] = [
  { id: 'original', label: 'كما هو' },
  { id: 'vertical', label: 'عمودي 9:16' },
  { id: 'square', label: 'مربع 1:1' },
  { id: 'landscape', label: 'عرضي 16:9' },
];
const FONTS: { id: Font; label: string; family: string }[] = [
  { id: 'sans', label: 'عصري', family: 'Noto Sans Arabic' },
  { id: 'kufi', label: 'كوفي', family: 'Noto Kufi Arabic' },
  { id: 'naskh', label: 'نسخ', family: 'Noto Naskh Arabic' },
];
const ANCHOR_VOICES = VOICES.filter(v => v.avatar && !v.tags.includes('أطفال'));

const canvasSize = (c: Canvas, w: number, h: number) =>
  c === 'vertical' ? { W: 720, H: 1280 } : c === 'square' ? { W: 720, H: 720 } : c === 'landscape' ? { W: 1280, H: 720 } : { W: w, H: h };

// Same rule as boxPlacement() on the server (fractions of the frame)
function boxPlacement(W: number, H: number, vw: number, vh: number) {
  const area = H > W * 1.2 ? { x: W * 0.06, y: H * 0.17, w: W * 0.88, h: H * 0.5 }
    : Math.abs(W - H) < 10 ? { x: W * 0.08, y: H * 0.16, w: W * 0.84, h: H * 0.56 }
    : { x: W * 0.1, y: H * 0.15, w: W * 0.8, h: H * 0.6 };
  const ar = vw / vh;
  let fw = area.w;
  let fh = fw / ar;
  if (fh > area.h) { fh = area.h; fw = fh * ar; }
  return { x: (area.x + (area.w - fw) / 2) / W, y: area.y / H, w: fw / W, h: fh / H };
}

function useFonts() {
  useEffect(() => {
    if (document.getElementById('greeting-fonts')) return;
    const link = document.createElement('link');
    link.id = 'greeting-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Kufi+Arabic:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

const RangePicker: React.FC<{ label: string; range: Range; duration: number; now: number; onChange: (r: Range) => void }> = ({ label, range, duration, now, onChange }) => {
  const clamp = (v: number) => Math.round(Math.min(duration, Math.max(0, v)) * 10) / 10;
  const field = (key: 'from' | 'to', text: string) => (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-400 w-6">{text}</span>
      <input type="number" step={0.5} min={0} max={duration} value={range[key]}
        onChange={e => onChange({ ...range, [key]: clamp(Number(e.target.value)) })}
        className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100" />
      <button type="button" onClick={() => onChange({ ...range, [key]: clamp(now) })} className="px-2 py-1 rounded-lg text-[11px] bg-slate-800 border border-slate-700 text-amber-200 hover:border-amber-500/50">
        الآن ({fmt(now)})
      </button>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-slate-300">{label}</div>
      <div className="flex flex-wrap gap-3">
        {field('from', 'من')}
        {field('to', 'إلى')}
        <button type="button" onClick={() => onChange({ from: 0, to: duration })} className="text-[11px] text-slate-400 hover:text-amber-300">طوال الفيديو</button>
      </div>
      {range.to <= range.from && <div className="text-[11px] text-rose-300">«إلى» يجب أن يكون بعد «من»</div>}
    </div>
  );
};

export const FootageBrander: React.FC<{ brand: BrandKit | null; onBalance?: (b: number) => void; onOpenPackages?: () => void }> = ({ brand, onBalance, onOpenPackages }) => {
  useFonts();
  const [upload, setUpload] = useState<Uploaded | null>(null);
  const introBox = useRef<HTMLTextAreaElement | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [canvas, setCanvas] = useState<Canvas>('original');
  const [layout, setLayout] = useState<Layout>('full');
  const [fit, setFit] = useState<Fit>('blur');
  const [boxTitle, setBoxTitle] = useState('');
  const [font, setFont] = useState<Font>('sans');
  const [textScale, setTextScale] = useState(1);
  const [logoOn, setLogoOn] = useState(true);
  const [showNameOn, setShowNameOn] = useState(true);
  const [tickerOn, setTickerOn] = useState(true);
  const [breaking, setBreaking] = useState(false);
  const [headlines, setHeadlines] = useState('');
  const [tickerRange, setTickerRange] = useState<Range>({ from: 0, to: 0 });
  const [lowerOn, setLowerOn] = useState(true);
  const [lowerName, setLowerName] = useState('');
  const [lowerTitle, setLowerTitle] = useState('');
  const [lowerRange, setLowerRange] = useState<Range>({ from: 1, to: 6 });
  const [introOn, setIntroOn] = useState(false);
  const [anchorName, setAnchorName] = useState('رامي');
  const [anchorVoice, setAnchorVoice] = useState('Orus');
  const [introText, setIntroText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ text: string; credits?: boolean } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);
  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.url); }, [upload]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [upload, canvas, layout]);
  // Suggest a hand-over line that names the correspondent
  useEffect(() => {
    if (!introText || introText.startsWith('ننتقل الآن إلى')) {
      setIntroText(`ننتقل الآن إلى ${lowerName || 'مراسلنا'}${lowerName && lowerTitle ? `، ${lowerTitle}` : ''}، لنتابع التفاصيل من موقع الحدث.`);
    }
  }, [lowerName, lowerTitle]);

  const pickFile = (file?: File) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('video/')) return setError({ text: 'اختر ملف فيديو' });
    if (file.size > MAX_BYTES) return setError({ text: 'الملف أكبر من 95 ميغابايت' });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/press/overlay/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => e.lengthComputable && setUploading(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setUploading(null);
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status !== 200 || !data.uploadId) return setError({ text: data.error || 'تعذّر رفع الفيديو' });
      setUpload({ id: data.uploadId, url: URL.createObjectURL(file), duration: data.duration, width: data.width, height: data.height });
      setTickerRange({ from: 0, to: Math.round(data.duration * 10) / 10 });
      setLowerRange({ from: Math.min(1, data.duration), to: Math.min(6, data.duration) });
      setCanvas(data.height > data.width ? 'vertical' : 'original');
      setResult(null);
    };
    xhr.onerror = () => { setUploading(null); setError({ text: 'تعذّر الاتصال أثناء الرفع' }); };
    setUploading(0);
    xhr.send(file);
  };

  const render = async () => {
    if (!upload) return;
    setError(null);
    if (introOn && (!anchorName.trim() || !introText.trim())) return setError({ text: 'اكتب اسم المذيع ونص التقديم' });
    setBusy(true);
    setProgress(0);
    if (result) URL.revokeObjectURL(result);
    setResult(null);
    try {
      const res = await fetch('/api/press/overlay/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: upload.id, canvas, layout, fit, boxTitle, font, textScale, logoOn, showNameOn,
          ticker: { on: tickerOn, breaking, headlines: headlines.split('\n').map(h => h.trim()).filter(Boolean), range: tickerRange },
          lowerThird: { on: lowerOn, name: lowerName, title: lowerTitle, range: lowerRange },
          intro: { on: introOn, anchorName, voiceId: anchorVoice, text: introText },
        }),
      });
      const job = await res.json().catch(() => ({}));
      if (typeof job.balance === 'number') onBalance?.(job.balance);
      if (!res.ok || !job.jobId) throw Object.assign(new Error(job.error || 'تعذّر تجهيز الفيديو'), { credits: job.code === 'INSUFFICIENT_CREDITS' });
      const ready = await waitForJob(job.jobId, { isCancelled: () => cancelled.current, onUpdate: s => setProgress(Math.round((s.progress || 0) * 100)) });
      if (ready) {
        const file = await fetch(`/api/video/jobs/${job.jobId}/file`);
        if (!file.ok) throw new Error('تعذّر تحميل الفيديو');
        setResult(URL.createObjectURL(await file.blob()));
      }
    } catch (e: any) {
      setError({ text: e instanceof TypeError ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : e.message, credits: e?.credits });
    } finally {
      setBusy(false);
    }
  };

  // Keep the blurred background copy in step with the main preview
  const syncBg = () => {
    const v = videoRef.current;
    const b = bgRef.current;
    if (!v || !b) return;
    if (Math.abs(b.currentTime - v.currentTime) > 0.3) b.currentTime = v.currentTime;
    if (v.paused !== b.paused) (v.paused ? b.pause() : b.play().catch(() => {}));
  };

  const { W, H } = upload ? canvasSize(canvas, upload.width, upload.height) : { W: 16, H: 9 };
  const ratio = W / H;
  const box = upload && layout === 'box' ? boxPlacement(W, H, upload.width, upload.height) : null;
  const unit = Math.min(frame.w, frame.h);
  const s = textScale;
  const family = `'${FONTS.find(f => f.id === font)!.family}', sans-serif`;
  const inRange = (r: Range) => now >= r.from && now <= r.to;
  const lines = headlines.split('\n').map(h => h.trim()).filter(Boolean);
  const showTicker = tickerOn && lines.length > 0 && inRange(tickerRange);
  const tickerH = unit * 0.085 * Math.max(1, s);
  const show = [brand?.showName, brand?.outletName].filter(Boolean).join(' · ');
  const color = brand?.color ?? '#0e7490';
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500';
  const chip = (active: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${active ? 'bg-amber-500/15 border-amber-500/70 text-amber-200' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'}`;
  const toggle = (checked: boolean, set: (v: boolean) => void, label: string) => (
    <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} className="accent-amber-500" /> {label}
    </label>
  );
  const section = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3';
  const fitMode: 'cover' | 'contain' = canvas === 'original' || fit === 'crop' ? 'cover' : 'contain';

  return (
    <div className="space-y-4">
      <div className={section}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Clapperboard className="w-4 h-4 text-amber-400" /> الفيديو</div>
        {!upload ? (
          <div className="space-y-2">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading !== null}
              className="w-full flex flex-col items-center gap-2 py-8 rounded-xl border-2 border-dashed border-slate-700 text-slate-300 hover:border-amber-500 disabled:opacity-60">
              {uploading !== null ? <Loader2 className="w-7 h-7 animate-spin text-amber-400" /> : <Upload className="w-7 h-7" />}
              <span className="text-sm font-bold">{uploading !== null ? `جاري الرفع ${uploading}%` : 'ارفع فيديو (حتى 3 دقائق و95 ميغابايت)'}</span>
              <span className="text-[11px] text-slate-500">MP4 أو MOV من الجوال أو الكاميرا. يبقى على الخادم ساعة واحدة فقط ثم يُحذف.</span>
            </button>
            <input ref={fileInput} type="file" accept="video/*" hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        ) : (
          <>
            {/* Live preview in the chosen frame: the real video plus the graphics where and when they will appear */}
            <div ref={frameRef} className="relative mx-auto overflow-hidden rounded-xl bg-black" dir="rtl"
              style={{ aspectRatio: `${W} / ${H}`, width: '100%', maxWidth: `calc(60vh * ${ratio})` }}>
              {box ? (
                <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${color}, #000000cc)` }} />
              ) : fitMode === 'contain' ? (
                <video ref={bgRef} src={upload.url} muted playsInline className="absolute inset-0 w-full h-full object-cover blur-xl brightness-75 scale-110" />
              ) : null}
              <video
                ref={videoRef} src={upload.url} controls playsInline
                onTimeUpdate={e => { setNow(e.currentTarget.currentTime); syncBg(); }}
                onSeeked={e => { setNow(e.currentTarget.currentTime); syncBg(); }}
                onPlay={syncBg} onPause={syncBg}
                className="absolute"
                style={box
                  ? { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, objectFit: 'fill', outline: '4px solid rgba(255,255,255,.9)', borderRadius: 6 }
                  : { inset: 0, width: '100%', height: '100%', objectFit: fitMode }}
              />
              <div className="absolute inset-0 pointer-events-none" style={{ fontFamily: family }}>
                {logoOn && brand?.hasLogo && (
                  <img src="/api/brand/logo" alt="" className="absolute object-contain" style={{ top: unit * 0.03, left: unit * 0.03, height: unit * 0.1 }} />
                )}
                {showNameOn && show && (
                  <div className="absolute font-bold text-[#ffffff]" style={{ top: unit * 0.03, right: unit * 0.04, fontSize: unit * 0.04 * s, textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{show}</div>
                )}
                {box && boxTitle && (
                  <div className="absolute inset-x-0 text-center font-bold text-[#ffffff] px-3" style={{ top: `calc(${(box.y + box.h) * 100}% + ${unit * 0.05}px)`, fontSize: unit * 0.05 * s, textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>{boxTitle}</div>
                )}
                {lowerOn && lowerName && inRange(lowerRange) && (
                  <div className="absolute flex flex-col items-end" style={{ right: unit * 0.05, bottom: (showTicker ? tickerH : 0) + unit * 0.05 }}>
                    <span className="font-bold text-[#ffffff] leading-tight" style={{ background: color, fontSize: unit * 0.05 * s, padding: `${unit * 0.016 * s}px ${unit * 0.02 * s}px` }}>{lowerName}</span>
                    {lowerTitle && <span className="text-[#000000] bg-[#ffffff] leading-tight" style={{ fontSize: unit * 0.034 * s, padding: `${unit * 0.013 * s}px ${unit * 0.016 * s}px` }}>{lowerTitle}</span>}
                  </div>
                )}
                {showTicker && (
                  <div className="absolute left-0 right-0 bottom-0 flex items-center overflow-hidden" style={{ height: tickerH, background: 'rgba(0,0,0,.65)' }}>
                    <span className="font-bold whitespace-nowrap px-2 text-[#ffffff] flex-1 overflow-hidden" style={{ fontSize: tickerH * 0.48 }}>{lines.join('   ◆   ')}</span>
                    <span className="font-bold shrink-0 h-full flex items-center" style={{ background: breaking ? '#dc2626' : '#fde047', color: breaking ? '#fff' : '#000', fontSize: tickerH * 0.44, padding: `0 ${tickerH * 0.3}px` }}>
                      {breaking ? 'عاجل' : 'أبرز الأخبار'}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 gap-2">
              <span>المدة {fmt(upload.duration)} · الآن {fmt(now)}. أوقف الفيديو عند اللحظة المطلوبة واضغط «الآن».</span>
              <button type="button" onClick={() => { setUpload(null); setResult(null); }} className="text-amber-400 hover:text-amber-300 shrink-0">فيديو آخر</button>
            </div>
            {introOn && <p className="text-[11px] text-amber-300">قبل هذا الفيديو ستظهر بطاقة المذيع «{anchorName}» وهو يقدّم التقرير.</p>}
          </>
        )}
      </div>

      {upload && (
        <>
          {/* Shape, layout, text style */}
          <div className={section}>
            <div className="text-xs font-bold text-white">شكل الفيديو</div>
            <div className="flex flex-wrap gap-2">{CANVASES.map(c => <button key={c.id} type="button" onClick={() => setCanvas(c.id)} className={chip(canvas === c.id)}>{c.label}</button>)}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setLayout('full')} className={chip(layout === 'full')}>ملء الشاشة</button>
              <button type="button" onClick={() => setLayout('box')} className={chip(layout === 'box')}>الفيديو بمربع على خلفية المؤسسة</button>
            </div>
            {layout === 'full' && canvas !== 'original' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setFit('blur')} className={chip(fit === 'blur')}>الفيديو كاملاً مع خلفية ضبابية</button>
                <button type="button" onClick={() => setFit('crop')} className={chip(fit === 'crop')}>قصّ ليملأ الإطار</button>
              </div>
            )}
            {layout === 'box' && (
              <input value={boxTitle} onChange={e => setBoxTitle(e.target.value.slice(0, 80))} placeholder="عنوان التقرير تحت الفيديو (اختياري)" className={input} />
            )}

            <div className="text-xs font-bold text-white pt-2">الخط والحجم</div>
            <div className="grid grid-cols-3 gap-2">
              {FONTS.map(f => (
                <button key={f.id} type="button" onClick={() => setFont(f.id)}
                  className={`rounded-xl border py-1.5 text-center ${font === f.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
                  <div className="text-base text-white font-bold" style={{ fontFamily: `'${f.family}'` }}>عاجل</div>
                  <div className="text-[10px] text-slate-400">{f.label}</div>
                </button>
              ))}
            </div>
            <label className="block space-y-1 text-[11px] text-slate-300">
              <span>حجم النصوص ({Math.round(textScale * 100)}%)</span>
              <input type="range" min={0.7} max={1.5} step={0.05} value={textScale} onChange={e => setTextScale(Number(e.target.value))} className="w-full accent-amber-500" />
            </label>
          </div>

          {/* Graphics and timing */}
          <div className={section}>
            <div className="flex flex-wrap gap-4">
              {toggle(logoOn, setLogoOn, brand?.hasLogo ? 'الشعار' : 'الشعار (أضفه من هوية المؤسسة)')}
              {toggle(showNameOn, setShowNameOn, 'اسم البرنامج والمؤسسة')}
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              {toggle(lowerOn, setLowerOn, 'شريط تعريف المتحدث')}
              {lowerOn && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={lowerName} onChange={e => setLowerName(e.target.value.slice(0, 50))} placeholder="الاسم، مثال: أحمد خليل" className={input} />
                    <input value={lowerTitle} onChange={e => setLowerTitle(e.target.value.slice(0, 70))} placeholder="الصفة، مثال: مراسل الوكالة - رام الله" className={input} />
                  </div>
                  <RangePicker label="يظهر" range={lowerRange} duration={upload.duration} now={now} onChange={setLowerRange} />
                </>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap gap-4">
                {toggle(tickerOn, setTickerOn, 'شريط العناوين')}
                {tickerOn && toggle(breaking, setBreaking, 'عاجل (أحمر)')}
              </div>
              {tickerOn && (
                <>
                  <textarea value={headlines} onChange={e => setHeadlines(e.target.value)} rows={3} placeholder={'عنوان في كل سطر\nمثال: افتتاح محطة الطاقة الشمسية'} className={`${input} leading-relaxed`} />
                  <RangePicker label="يظهر" range={tickerRange} duration={upload.duration} now={now} onChange={setTickerRange} />
                </>
              )}
            </div>
          </div>

          {/* Anchor hand-over before the footage */}
          <div className={section}>
            {toggle(introOn, setIntroOn, 'تقديم من المذيع قبل الفيديو («ننتقل الآن إلى مراسلنا…»)')}
            {introOn && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={anchorName} onChange={e => setAnchorName(e.target.value.slice(0, 40))} placeholder="اسم المذيع" className={input} />
                  <select value={anchorVoice} onChange={e => setAnchorVoice(e.target.value)} className={input}>
                    {ANCHOR_VOICES.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender === 'female' ? 'صوت نسائي' : 'صوت رجالي'})</option>)}
                  </select>
                </div>
                <AudioTagBar target={introBox} value={introText} onChange={v => setIntroText(v.slice(0, 600))} />
                <textarea ref={introBox} value={introText} onChange={e => setIntroText(e.target.value.slice(0, 600))} rows={3} className={`${input} leading-relaxed`} />
                <p className="text-[11px] text-slate-500 flex items-center gap-1"><Mic className="w-3.5 h-3.5" /> صوت المذيع يُخصم من رصيدك حسب مدته، وتجهيز الفيديو مجاني.</p>
              </>
            )}
          </div>

          {error && (
            <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <span>{error.text}</span>
              {error.credits && onOpenPackages && <button type="button" onClick={onOpenPackages} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">اشحن رصيدك</button>}
            </div>
          )}
          {busy && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-300"><span>{introOn && progress === 0 ? 'نسجّل صوت المذيع…' : 'نجهّز الفيديو…'}</span><span className="font-mono text-amber-300">{progress}%</span></div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-gradient-to-l from-amber-400 to-amber-600 transition-all duration-700" style={{ width: `${Math.max(3, progress)}%` }} /></div>
            </div>
          )}
          <button type="button" onClick={render} disabled={busy} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-extrabold disabled:opacity-60">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />} جهّز الفيديو بهوية المؤسسة
          </button>
        </>
      )}

      {error && !upload && <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error.text}</div>}

      {result && (
        <div className={section}>
          <div className="text-sm font-bold text-white">الفيديو جاهز</div>
          <video src={result} controls playsInline className="mx-auto max-h-[60vh] rounded-xl bg-black" />
          <a href={result} download="video-branded.mp4" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold"><Download className="w-4 h-4" /> تحميل الفيديو</a>
          <p className="text-[11px] text-slate-500">لا نحتفظ بنسخة، فحمّله قبل مغادرة الصفحة.</p>
        </div>
      )}
    </div>
  );
};
