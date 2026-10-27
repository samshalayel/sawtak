import React, { useEffect, useRef, useState } from 'react';
import { AudioTagBar } from './AudioTagBar';
import { Book, Download, Leaf, Loader2, Pause, Play, Share2, Wand2 } from 'lucide-react';
import { VOICES } from '../data/presets';
import { AuthUser, ServicePrices } from '../types/auth';
import { estimateDuration } from '../utils/audio';
import { stripAudioTags } from '../utils/audioTags';
import { CALM_FONTS, CalmFont, calmFont } from '../data/calmFonts';
import { DAY_ART, DECOR_GRADIENT, STICKER_ICONS, STICKER_LOOKS, STICKER_THEMES, stickerLayout, vowelled } from '../data/calmStickers';
import { DEFAULT_RECITER, QURAN_RECITERS } from '../data/quran';
import { QuranChoice, QuranPicker } from './QuranPicker';

// "Calm reels": gentle vertical videos — real nature scenes, a slow calm voice and large captions — for people
// going through hard times. Texts stay modest (a quiet moment, not a treatment); scenes are filtered on the server.
// The same page in `quranMode` is the Quran service: whole verses in a real reciter's voice instead of the text and
// the AI voice (its own route, price and switch).

const TEMPLATES: { id: string; label: string; title: string; text: string }[] = [
  {
    id: 'breathe', label: 'تنفّس معي', title: 'تنفّس معي',
    text: 'خذ نفساً عميقاً... ببطء... شهيق... اثنان، ثلاثة، أربعة... احبسه قليلاً... والآن ازفر على مهل... اثنان، ثلاثة، أربعة، خمسة، ستة... مرة أخرى... شهيق... وزفير... أنت هنا الآن، وهذه اللحظة لك.',
  },
  {
    id: 'grounding', label: 'هنا والآن', title: 'لحظة هدوء',
    text: 'توقّف لحظة... انظر حولك، وسمِّ خمسة أشياء تراها... أربعة أشياء تستطيع لمسها... ثلاثة أصوات تسمعها... شيئين تشمّ رائحتهما... وشيئاً واحداً تشعر بالامتنان له... وعُد إلى هذه اللحظة بهدوء.',
  },
  {
    id: 'hope', label: 'رسالة أمل', title: 'سيأتي الصباح',
    text: 'مهما طال الليل، يأتي الصباح... لست وحدك، وما تشعر به اليوم ليس نهاية الطريق... خذ وقتك، واسترح قليلاً... فالأيام القادمة تحمل لك نوراً جديداً.',
  },
  {
    id: 'faith', label: 'آية ودعاء', title: 'سكينة',
    text: 'ألا بذكر الله تطمئن القلوب... اللهم أنزل على قلوبنا السكينة، واربط عليها بالصبر، وأبدلنا بعد الخوف أمناً، وبعد التعب راحة.',
  },
  {
    id: 'sleep', label: 'قبل النوم', title: 'وقت الراحة',
    text: 'أرخِ كتفيك... أطلق التوتر من جبينك... دع أنفاسك تهدأ شيئاً فشيئاً... كل شيء يمكن أن ينتظر حتى الصباح... الآن وقت الراحة.',
  },
];

const SCENES: { id: string; label: string }[] = [
  { id: 'forest', label: 'غابة' }, { id: 'sea', label: 'بحر' }, { id: 'rain', label: 'مطر' }, { id: 'clouds', label: 'غيوم' },
  { id: 'sunrise', label: 'شروق' }, { id: 'countryside', label: 'طريق ريفي' }, { id: 'mountains', label: 'جبال' },
  { id: 'europe', label: 'قرى أوروبية' }, { id: 'river', label: 'نهر' }, { id: 'snow', label: 'ثلج' },
  { id: 'flowers', label: 'زهور' }, { id: 'stars', label: 'سماء الليل' },
];

const CALM_VOICES = VOICES.filter(v => v.avatar && !v.tags.includes('أطفال') && !v.tags.includes('غضب'));
const DEFAULT_SUPPORT = 'إذا كنت تمرّ بوقت صعب، لا تتردد في الحديث مع مختص أو شخص تثق به.';

interface Clip { id: number; duration: number; thumb: string; preview: string }
/** A chosen scene keeps its category, so it stays chosen (and counted on its category) while browsing others. */
type ChosenClip = Clip & { scene: string };

// Text look (same units as the server: 720x1280 design pixels)
// Caption fonts: the browser shows each one through the Google Fonts CSS API (the server draws the same faces)
const webFamily = (f: CalmFont) => f.css.split(':')[0].replace(/\+/g, ' ');
const webWeight = (f: CalmFont) => Number(f.css.split('@')[1]) || 400;
function loadFonts(id: string, fonts: CalmFont[]) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${fonts.map(f => `family=${f.css}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

/** Dropdown of caption fonts, each name written in its own font (all faces load only when it opens). */
const FontPicker: React.FC<{ value: string; onChange: (id: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const current = calmFont(value);
  useEffect(() => { loadFonts(`calm-font-${current.id}`, [current]); }, [current.id]);
  useEffect(() => {
    if (!open) return;
    loadFonts('calm-fonts-all', CALM_FONTS);
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 hover:border-slate-700">
        <span className="text-lg leading-snug" style={{ fontFamily: webFamily(current), fontWeight: webWeight(current) }}>{current.label} · صباح الخير</span>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl p-1">
          {CALM_FONTS.map(f => (
            <button key={f.id} type="button" onClick={() => { onChange(f.id); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-right ${f.id === value ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-100 hover:bg-slate-800'}`}>
              <span className="text-lg leading-snug" style={{ fontFamily: webFamily(f), fontWeight: webWeight(f) }}>صباح الخير</span>
              <span className="text-[11px] text-slate-400" style={{ fontFamily: webFamily(f) }}>{f.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
const COLORS = ['#ffffff', '#fff4d6', '#f5d58a', '#c8f2dc', '#cde8ff', '#f9d5e5', '#1e293b'];
// Positions are dragged on the preview: the title's top, then the centres of the line under it and of the dedication
const DEFAULT_STYLE = { font: 'naskh' as string, color: '#ffffff', size: 88, y: 840, titleSize: 58, titleY: 140, infoY: 262, dedicationY: 1120 };
type StyleY = 'y' | 'titleY' | 'infoY' | 'dedicationY';
const PREVIEW_W = 252;
const K = PREVIEW_W / 720;
// "Today" sticker: day and dates are formatted here, in the visitor's own calendar (today, tomorrow or any
// chosen day, so a reel can be prepared ahead of posting)
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localIso(d); };
function stickerTexts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y, m - 1, d, 12);
  const day = new Intl.DateTimeFormat('ar-PS', { weekday: 'long' }).format(at);
  return {
    hijri: new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }).format(at),
    gregorian: new Intl.DateTimeFormat('ar-PS-u-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }).format(at) + ' م',
    labels: [
      { id: 'day', text: day },
      { id: 'morning', text: `صباح ${day}` },
      { id: 'evening', text: `مساء ${day}` },
      ...(at.getDay() === 5 ? [{ id: 'jumuah', text: 'جمعة مباركة' }] : []),
      { id: 'goodmorning', text: 'صباح الخير' },
      { id: 'goodnight', text: 'تصبحون على خير' },
    ],
  };
}
// libass sizes a font by its whole line box; Amiri's is very tall, so its CSS size and offset differ
const fit = (size: number, amiri: boolean) =>
  amiri ? { fontSize: size * K * 0.5, marginTop: size * K * 0.25 } : { fontSize: size * K * 0.85 };
const iconSrc = (id: string) => {
  const icon = STICKER_ICONS.find(i => i.id === id);
  return icon ? `data:image/svg+xml;utf8,${encodeURIComponent(icon.svg)}` : '';
};
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

interface Props {
  user: AuthUser | null;
  prices: ServicePrices;
  onLoginRequired: (reason: string) => void;
  onBalance: (b: number) => void;
  onOpenPackages: () => void;
  /** The Quran service: verses in a reciter's voice instead of the text and the AI voice. */
  quranMode?: boolean;
}

export const CalmPage: React.FC<Props> = ({ user, prices, onLoginRequired, onBalance, onOpenPackages, quranMode = false }) => {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const textBox = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState(quranMode ? '' : TEMPLATES[0].text);
  const [title, setTitle] = useState(quranMode ? '' : TEMPLATES[0].title);
  const [voiceId, setVoiceId] = useState('Sulafat');
  // Quran reel: chosen whole verses in a reciter's voice (the picker stays open until a passage is chosen)
  const [quran, setQuran] = useState<QuranChoice | null>(null);
  const [quranOpen, setQuranOpen] = useState(true);
  const [reciter, setReciter] = useState(DEFAULT_RECITER);
  const [scene, setScene] = useState('forest');
  const [clips, setClips] = useState<Clip[]>([]);
  const [loadingClips, setLoadingClips] = useState(false);
  const [chosen, setChosen] = useState<ChosenClip[]>([]);
  const [supportOn, setSupportOn] = useState(!quranMode);
  // Shown for the whole reel, e.g. "عن روح المرحوم ..."
  const [dedication, setDedication] = useState('');
  const [showReciter, setShowReciter] = useState(true);
  const [support, setSupport] = useState(DEFAULT_SUPPORT);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ text: string; credits?: boolean } | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  // Amiri draws the Uthmani script and its stop signs well
  const [style, setStyle] = useState(quranMode ? { ...DEFAULT_STYLE, font: 'amiri' } : DEFAULT_STYLE);
  const [stickerOn, setStickerOn] = useState(true);
  const [stickerIcon, setStickerIcon] = useState('none');
  const [stickerTheme, setStickerTheme] = useState('plain');
  const [stickerLabelId, setStickerLabelId] = useState('day');
  const [stickerCustom, setStickerCustom] = useState('');
  const [showHijri, setShowHijri] = useState(true);
  const [showGregorian, setShowGregorian] = useState(true);
  const [stickerLook, setStickerLook] = useState('decor');
  const [stickerPos, setStickerPos] = useState<'top' | 'bottom'>('top');
  const [stickerDate, setStickerDate] = useState(() => addDays(0));
  const { hijri: HIJRI, gregorian: GREGORIAN, labels: STICKER_LABELS } = stickerTexts(stickerDate);
  const stickerLabel = stickerLabelId === 'custom' ? stickerCustom.trim() : STICKER_LABELS.find(l => l.id === stickerLabelId)?.text ?? STICKER_LABELS[0].text;
  // Calligraphy looks: vowelled day name, then a bold numeric date (21.2.2025) and the Hijri date
  const callig = stickerLook !== 'sticker';
  const stickerWeekday = (() => { const [y, m, d] = stickerDate.split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); })();
  const numericDate = stickerDate.split('-').map(Number).reverse().join('.');
  const stickerDates = (callig
    ? [showGregorian && numericDate, showHijri && HIJRI.replace(/\s*هـ$/, '')]
    : [showHijri && HIJRI, showGregorian && GREGORIAN]).filter(Boolean) as string[];
  const sticker = stickerOn
    ? { icon: stickerIcon, theme: stickerTheme, look: stickerLook, day: stickerWeekday, label: callig ? vowelled(stickerLabel) : stickerLabel, dates: stickerDates, position: stickerPos }
    : null;
  const audio = useRef<HTMLAudioElement | null>(null);
  const cancelled = useRef(false);
  const reciterName = QURAN_RECITERS.find(r => r.id === reciter)?.name;
  // An empty title on a Quran reel becomes the surah and verses (written by the server the same way)
  const shownTitle = title || (quranMode && quran ? `سورة ${quran.surahName} • ${quran.start === quran.end ? `الآية ${quran.start}` : `الآيات ${quran.start} إلى ${quran.end}`}` : '');
  const info = quranMode && showReciter && reciterName ? `بصوت الشيخ ${reciterName}` : '';

  useEffect(() => () => { cancelled.current = true; audio.current?.pause(); }, []);
  useEffect(() => {
    if (!document.getElementById('calm-fonts')) {
      const extra = document.createElement('link');
      extra.id = 'calm-fonts';
      extra.rel = 'stylesheet';
      extra.href = 'https://fonts.googleapis.com/css2?family=Amiri:wght@700&display=swap';
      document.head.appendChild(extra);
    }
    if (document.getElementById('greeting-fonts')) return;
    const link = document.createElement('link');
    link.id = 'greeting-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;700&family=Noto+Kufi+Arabic:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap';
    document.head.appendChild(link);
  }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  // Scenes come from our server (it holds the key and filters anything distressing)
  useEffect(() => {
    if (!user) return;
    setLoadingClips(true);
    setError(null);
    fetch(`/api/calm/search?scene=${scene}`).then(r => r.json()).then(d => {
      if (!d.success) throw new Error(d.error);
      setClips(d.clips);
    }).catch(e => setError({ text: e?.message || 'تعذّر جلب المشاهد' })).finally(() => setLoadingClips(false));
  }, [scene, user?.id]);

  const chooseTemplate = (id: string) => {
    const t = TEMPLATES.find(x => x.id === id)!;
    setTemplateId(id);
    setText(t.text);
    setTitle(t.title);
  };

  const toggleClip = (clip: Clip) =>
    setChosen(c => (c.some(x => x.id === clip.id) ? c.filter(x => x.id !== clip.id) : c.length >= 3 ? c : [...c, { ...clip, scene }]));

  const preview = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(`/api/tts/preview/${id}`);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(id);
  };

  const create = async () => {
    setError(null);
    if (!user) return onLoginRequired(quranMode ? 'سجّل حساباً لتصنع ريلز الآيات.' : 'سجّل حساباً لتصنع ريلز السكينة.');
    if (quranMode && !quran) return setError({ text: 'اختر الآيات أولاً' });
    if (!quranMode && !text.trim()) return setError({ text: 'اكتب نص الريل أو اختر قالباً' });
    if (chosen.length === 0) return setError({ text: 'اختر مشهداً واحداً على الأقل (حتى ثلاثة)' });
    setBusy(true);
    setProgress(0);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    try {
      const res = await fetch(quranMode ? '/api/quran/render' : '/api/calm/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(quranMode && quran ? { quran: { surah: quran.surah, start: quran.start, end: quran.end, reciter: quran.reciter } } : { text, voiceId }),
          title, clipIds: chosen.map(c => c.id), supportCard: supportOn ? support : '', dedication: dedication.trim(), style, sticker,
          ...(quranMode ? { showReciter } : {}),
        }),
      });
      const job = await res.json().catch(() => ({}));
      if (typeof job.balance === 'number') onBalance(job.balance);
      if (!res.ok || !job.jobId) throw Object.assign(new Error(job.error || 'تعذّر تجهيز الريل'), { credits: job.code === 'INSUFFICIENT_CREDITS' });
      while (!cancelled.current) {
        await new Promise(r => setTimeout(r, 1500));
        const s = await fetch(`/api/video/jobs/${job.jobId}`).then(r => r.json()).catch(() => ({}));
        if (s.status === 'error' || s.success === false) throw new Error(s.error || 'تعذّر تجهيز الريل');
        setProgress(Math.round((s.progress || 0) * 100));
        if (s.status === 'done') {
          const file = await fetch(`/api/video/jobs/${job.jobId}/file`);
          if (!file.ok) throw new Error('تعذّر تحميل الفيديو');
          const blob = await file.blob();
          setResult({ url: URL.createObjectURL(blob), blob });
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        }
      }
    } catch (e: any) {
      setError({ text: e instanceof TypeError ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : e.message, credits: e?.credits });
    } finally {
      setBusy(false);
    }
  };

  const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) && 'canShare' in navigator;
  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], quranMode ? 'ayat.mp4' : 'sakina.mp4', { type: 'video/mp4' });
    try { await navigator.share({ files: [file], title }); } catch { /* closed */ }
  };

  const section = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3';
  const label = 'text-sm font-bold text-white flex items-center gap-2';
  const stepNo = (n: number) => <span className="w-6 h-6 rounded-full bg-emerald-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{n}</span>;
  const chip = (active: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${active ? 'bg-emerald-500/15 border-emerald-500/70 text-emerald-200' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'}`;
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500';

  if (result) {
    return (
      <div className="max-w-xl mx-auto space-y-4 text-center">
        <h2 className="text-xl font-extrabold text-white">ريلك جاهز</h2>
        <video src={result.url} controls autoPlay playsInline className="mx-auto max-h-[65vh] rounded-2xl bg-black shadow-2xl" />
        <div className="flex flex-wrap justify-center gap-2">
          {isPhone && <button type="button" onClick={share} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm"><Share2 className="w-4 h-4" /> شارك</button>}
          <a href={result.url} download={quranMode ? 'ayat-reel.mp4' : 'sakina-reel.mp4'} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 text-slate-100 font-bold text-sm"><Download className="w-4 h-4" /> تحميل</a>
          <button type="button" onClick={() => setResult(null)} className="px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-sm">ريل جديد</button>
        </div>
        <p className="text-[11px] text-slate-500">لا نحتفظ بنسخة، فحمّله قبل مغادرة الصفحة.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl lg:max-w-none mx-auto space-y-4">
      <div className="text-center space-y-1">
        {quranMode ? (
          <>
            <h2 className="text-2xl font-extrabold text-white flex items-center justify-center gap-2"><Book className="w-6 h-6 text-emerald-400" /> آيات بصوت القارئ</h2>
            <p className="text-sm text-slate-400">آيات كاملة بتلاوة قارئ حقيقي، فوق مشاهد طبيعة هادئة، جاهزة للمشاركة.</p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-extrabold text-white flex items-center justify-center gap-2"><Leaf className="w-6 h-6 text-emerald-400" /> ريلز السكينة</h2>
            <p className="text-sm text-slate-400">لحظة هدوء: مشاهد طبيعة حقيقية، وصوت دافئ هادئ، وكلمات تُريح القلب.</p>
          </>
        )}
      </div>

      {quranMode ? (
      <div className={section}>
        <div className={label}>{stepNo(1)} الآيات</div>
        {!user ? (
          <button type="button" onClick={() => onLoginRequired('سجّل حساباً لتختار آيات بصوت القارئ.')} className="w-full py-6 rounded-xl border-2 border-dashed border-slate-700 text-slate-300 text-sm">سجّل الدخول لتختار الآيات</button>
        ) : quran && !quranOpen ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
            <p className="text-lg text-white leading-loose" style={{ fontFamily: "'Amiri', serif" }}>
              {quran.verses.map(v => <span key={v.verse}>{v.text} <span className="text-emerald-300 text-base">﴿{v.verse}﴾</span> </span>)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>سورة {quran.surahName} • {quran.start === quran.end ? `الآية ${quran.start}` : `الآيات ${quran.start} إلى ${quran.end}`}</span>
              <button type="button" onClick={() => setQuranOpen(true)} className="text-emerald-300 hover:underline">تغيير الآيات</button>
            </div>
          </div>
        ) : (
          <QuranPicker
            reciter={reciter}
            onReciter={id => { setReciter(id); setQuran(q => (q ? { ...q, reciter: id } : q)); }}
            onPick={c => {
              setQuran(c);
              setReciter(c.reciter);
              setQuranOpen(false);
              setTitle('');
            }}
            onCancel={quran ? () => setQuranOpen(false) : undefined}
          />
        )}
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 60))} placeholder="العنوان (اتركه فارغاً ليُكتب اسم السورة والآيات)" className={input} />
      </div>
      ) : (
      <div className={section}>
        <div className={label}>{stepNo(1)} الكلمات</div>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(t => <button key={t.id} type="button" onClick={() => chooseTemplate(t.id)} className={chip(templateId === t.id)}>{t.label}</button>)}
          <button type="button" onClick={() => { setTemplateId('custom'); setText(''); setTitle(''); }} className={chip(templateId === 'custom')}>نص من عندي</button>
        </div>
        <AudioTagBar target={textBox} value={text} onChange={v => setText(v.slice(0, 1200))} />
        <textarea ref={textBox} value={text} onChange={e => setText(e.target.value.slice(0, 1200))} rows={5} placeholder="اكتب كلمات هادئة… النقاط الثلاث (...) تعطي وقفة أطول في الصوت" className={`${input} leading-loose`} />
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 60))} placeholder="عنوان صغير أعلى الفيديو (اختياري)" className={input} />
        <p className="text-[11px] text-slate-500">المدة التقريبية للصوت: {estimateDuration(text, 0.9).formatted}</p>
      </div>
      )}

      <div className={section}>
        <div className={label}>{stepNo(2)} الصوت</div>
        {quranMode ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <span className="text-sm text-white">تلاوة الشيخ {reciterName}</span>
              {!quranOpen && <button type="button" onClick={() => setQuranOpen(true)} className="text-xs text-emerald-300 hover:underline">تغيير القارئ</button>}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input type="checkbox" checked={showReciter} onChange={e => setShowReciter(e.target.checked)} className="accent-emerald-500" />
              اكتب اسم القارئ تحت العنوان
            </label>
          </>
        ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {CALM_VOICES.map(v => (
            <div key={v.id} role="button" tabIndex={0} onClick={() => setVoiceId(v.id)}
              className={`relative shrink-0 w-20 rounded-xl border p-1.5 flex flex-col items-center gap-1 cursor-pointer ${voiceId === v.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
              <img src={v.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
              <span className="text-[11px] text-white">{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); preview(v.id); }} className="absolute top-1 left-1 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center" aria-label={`استماع لعيّنة ${v.name}`}>
                {playing === v.id ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
              </button>
            </div>
          ))}
        </div>
        )}
        <p className="text-[11px] text-slate-500">{quranMode ? 'التلاوة الأصلية للقارئ كما هي، بلا أي تعديل على الصوت.' : 'الصوت يُسجَّل تلقائياً بنبرة هادئة وأبطأ قليلاً.'}</p>
      </div>

      <div className={section}>
        <div className={label}>{stepNo(3)} المشاهد <span className="text-[11px] font-normal text-slate-500">(اختر حتى ثلاثة، تظهر بالترتيب)</span></div>
        <div className="flex flex-wrap gap-2 pt-1">
          {SCENES.map(s => {
            const picked = chosen.filter(c => c.scene === s.id).length;
            return (
              <button key={s.id} type="button" onClick={() => setScene(s.id)} className={`${chip(scene === s.id || picked > 0)} relative`}>
                {s.label}
                {picked > 0 && <span className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-extrabold flex items-center justify-center" aria-label={`${picked} مختار`}>{picked}</span>}
              </button>
            );
          })}
        </div>
        {!user ? (
          <button type="button" onClick={() => onLoginRequired('سجّل حساباً لتتصفح المشاهد.')} className="w-full py-6 rounded-xl border-2 border-dashed border-slate-700 text-slate-300 text-sm">سجّل الدخول لتتصفح المشاهد</button>
        ) : loadingClips ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {clips.map(c => {
              const order = chosen.findIndex(x => x.id === c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggleClip(c)}
                  className={`relative aspect-[9/12] rounded-xl overflow-hidden border-2 ${order >= 0 ? 'border-emerald-400' : 'border-transparent'}`}
                  onMouseEnter={e => (e.currentTarget.querySelector('video') as HTMLVideoElement | null)?.play().catch(() => {})}
                  onMouseLeave={e => (e.currentTarget.querySelector('video') as HTMLVideoElement | null)?.pause()}>
                  <video src={c.preview} poster={c.thumb} muted loop playsInline preload="none" className="absolute inset-0 w-full h-full object-cover" />
                  {order >= 0 && <span className="absolute top-1 right-1 w-6 h-6 rounded-full bg-emerald-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{order + 1}</span>}
                  <span className="absolute bottom-1 left-1 text-[10px] text-[#ffffff] bg-[#000000]/50 rounded px-1">{Math.round(c.duration)} ث</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-slate-500">المشاهد من Pixabay، ومُصفّاة لتبقى هادئة.</p>
      </div>

      <div className={section}>
        <div className={label}>{stepNo(4)} شكل الكتابة <span className="text-[11px] font-normal text-slate-500">(اسحب الكلام والعنوان على المعاينة لتحريكها)</span></div>
        <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
          {(() => {
            const first = chosen[0];
            // Dragging a text moves it up or down (in design pixels); a tap elsewhere on the preview places the captions
            const drag = (key: StyleY, min: number, max: number) => ({
              onPointerDown: (e: React.PointerEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const from = e.clientY;
                const start = style[key];
                const move = (ev: PointerEvent) => setStyle(s => ({ ...s, [key]: Math.round(Math.min(max, Math.max(min, start + (ev.clientY - from) / K))) }));
                const stop = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', stop);
                  window.removeEventListener('pointercancel', stop);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', stop);
                window.addEventListener('pointercancel', stop);
              },
              onClick: (e: React.MouseEvent) => e.stopPropagation(),
            });
            const grab = { touchAction: 'none' as const, cursor: 'grab' };
            const capFont = calmFont(style.font);
            const family = webFamily(capFont);
            const weight = webWeight(capFont);
            const halo = isDark(style.color) ? '0 0 6px rgba(255,255,255,.85), 0 0 2px rgba(255,255,255,.9)' : '0 0 6px rgba(0,0,0,.75), 0 1px 2px rgba(0,0,0,.6)';
            const sample = quranMode ? (quran?.verses[0]?.text.split(/\s+/).slice(0, 6).join(' ') || 'ألا بذكر الله تطمئن القلوب') : (stripAudioTags(text).split(/\.\.\.|…|[.،؟!\n]/).map(s => s.trim()).find(Boolean) || 'خذ نفساً عميقاً').slice(0, 60);
            return (
              <div
                className="relative shrink-0 rounded-2xl overflow-hidden bg-gradient-to-b from-emerald-900 to-slate-900 cursor-crosshair select-none"
                style={{ width: PREVIEW_W, height: PREVIEW_W * 16 / 9 }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setStyle(s => ({ ...s, y: Math.round(Math.min(1120, Math.max(220, (e.clientY - r.top) / K))) }));
                }}
              >
                {first && <video key={first.id} src={first.preview} poster={first.thumb} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover brightness-90" />}
                {shownTitle && (
                  <div {...drag('titleY', 40, 1160)} className="absolute z-10 inset-x-0 text-center font-bold px-3 leading-snug" style={{ ...grab, top: style.titleY * K, fontFamily: family, fontWeight: weight, fontSize: style.titleSize * K * 0.6, color: style.color, textShadow: halo }}>{shownTitle}</div>
                )}
                {info && (
                  <div {...drag('infoY', 60, 1200)} className="absolute z-10 inset-x-0 text-center font-bold px-3 leading-snug -translate-y-1/2" style={{ ...grab, top: style.infoY * K, fontFamily: family, fontWeight: weight, fontSize: style.titleSize * 0.62 * K * 0.6, color: style.color, textShadow: halo }}>{info}</div>
                )}
                <div {...drag('y', 220, 1120)} className="absolute z-10 text-center font-bold leading-snug -translate-y-1/2" style={{ ...grab, top: style.y * K, left: 55 * K, right: 55 * K, fontFamily: family, fontWeight: weight, fontSize: style.size * K * 0.6, color: style.color, textShadow: halo }}>{sample}</div>
                {dedication.trim() && (
                  <div {...drag('dedicationY', 60, 1200)} className="absolute z-10 inset-x-0 text-center font-bold px-3 leading-snug -translate-y-1/2" style={{ ...grab, top: style.dedicationY * K, fontFamily: family, fontWeight: weight, fontSize: style.size * 0.52 * K * 0.6, color: style.color, textShadow: halo }}>{dedication.trim()}</div>
                )}
                {sticker && (() => {
                  const lay = stickerLayout(sticker.position, !!shownTitle, sticker.look, sticker.icon !== 'none', !!info);
                  const lk = STICKER_LOOKS.find(l => l.id === sticker.look)!;
                  const th = STICKER_THEMES.find(t => t.id === sticker.theme)!;
                  return (
                    <>
                      {sticker.icon !== 'none' && <img src={iconSrc(sticker.icon)} alt="" className="absolute" style={{ top: lay.iconY * K, left: (720 - lay.iconSize) / 2 * K, width: lay.iconSize * K, height: lay.iconSize * K }} />}
                      {sticker.look === 'decor' && (
                        <div className="absolute" style={{ top: lay.labelY * K, left: (720 - lay.artW) / 2 * K, width: lay.artW * K, height: lay.artH * K, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.55))' }}>
                          <div className="w-full h-full" style={{
                            background: th.id === 'rose' ? `linear-gradient(45deg, ${DECOR_GRADIENT[0]}, ${DECOR_GRADIENT[1]})` : th.fill,
                            WebkitMaskImage: `url(${DAY_ART[sticker.day]}?v=2)`, maskImage: `url(${DAY_ART[sticker.day]}?v=2)`,
                            WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center bottom', maskPosition: 'center bottom',
                          }} />
                        </div>
                      )}
                      {sticker.label && (
                        <div className="absolute inset-x-0 text-center font-bold leading-none whitespace-nowrap"
                          style={{ top: lay.labelY * K, fontFamily: lk.font, ...fit(lay.labelSize, callig), color: th.fill, ...(callig ? { textShadow: '0 2px 5px rgba(0,0,0,.6)' } : { WebkitTextStroke: `${8 * K}px ${th.edge}`, paintOrder: 'stroke fill', textShadow: '0 1px 2px rgba(0,0,0,.4)' }) }}>{sticker.label}</div>
                      )}
                      {sticker.dates.map((d, i) => (
                        <div key={i} className="absolute inset-x-0 text-center leading-none whitespace-nowrap"
                          style={{ top: (lay.dateY + i * lay.dateGap - (sticker.label || sticker.look === 'decor' ? 0 : 80)) * K, fontFamily: callig ? (i === 0 ? 'Noto Sans Arabic' : lk.font) : 'Noto Kufi Arabic', fontWeight: callig ? 700 : 400, ...fit(i === 0 ? lay.dateSize : lay.dateSize2, callig && i > 0), color: callig ? th.fill : '#ffffff', textShadow: '0 0 4px rgba(0,0,0,.8)' }}>{d}</div>
                      ))}
                    </>
                  );
                })()}
                {!first && <div className="absolute bottom-2 inset-x-0 text-center text-[10px] text-[#ffffff]/60">اختر مشهداً لتراه هنا</div>}
              </div>
            );
          })()}
          <div className="flex-1 w-full space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs text-slate-400">الخط</div>
              <FontPicker value={style.font} onChange={font => setStyle(s => ({ ...s, font }))} />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-slate-400">اللون</div>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setStyle(s => ({ ...s, color: c }))} aria-label={c}
                    className={`w-8 h-8 rounded-full border-2 ${style.color === c ? 'border-emerald-400 scale-110' : 'border-slate-700'} transition-transform`} style={{ background: c }} />
                ))}
                <label className="w-8 h-8 rounded-full border-2 border-dashed border-slate-600 overflow-hidden cursor-pointer relative" title="لون آخر">
                  <input type="color" value={style.color} onChange={e => setStyle(s => ({ ...s, color: e.target.value }))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <span className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">+</span>
                </label>
              </div>
            </div>
            <label className="block space-y-1">
              <div className="flex justify-between text-xs text-slate-400"><span>حجم الكلام</span><span>{Math.round(style.size / 0.88)}%</span></div>
              <input type="range" min={48} max={130} value={style.size} onChange={e => setStyle(s => ({ ...s, size: +e.target.value }))} className="w-full accent-emerald-500" />
            </label>
            {shownTitle && (
              <label className="block space-y-1">
                <div className="flex justify-between text-xs text-slate-400"><span>حجم العنوان</span><span>{Math.round(style.titleSize / 0.58)}%</span></div>
                <input type="range" min={36} max={100} value={style.titleSize} onChange={e => setStyle(s => ({ ...s, titleSize: +e.target.value }))} className="w-full accent-emerald-500" />
              </label>
            )}
            <label className="block space-y-1">
              <div className="flex justify-between text-xs text-slate-400"><span>مكان الكلام</span><span>{style.y < 500 ? 'أعلى' : style.y > 800 ? 'أسفل' : 'الوسط'}</span></div>
              <input type="range" min={220} max={1120} value={style.y} onChange={e => setStyle(s => ({ ...s, y: +e.target.value }))} className="w-full accent-emerald-500" />
            </label>
            <button type="button" onClick={() => setStyle(s => ({ ...DEFAULT_STYLE, font: quranMode ? 'amiri' : DEFAULT_STYLE.font, y: s.y }))} className="text-[11px] text-slate-400 underline">إرجاع الافتراضي</button>

            <div className="pt-3 border-t border-slate-800 space-y-2.5">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
                <input type="checkbox" checked={stickerOn} onChange={e => setStickerOn(e.target.checked)} className="accent-emerald-500" />
                ملصق اليوم والتاريخ
              </label>
              {stickerOn && (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => setStickerDate(addDays(0))} className={chip(stickerDate === addDays(0))}>اليوم</button>
                    <button type="button" onClick={() => setStickerDate(addDays(1))} className={chip(stickerDate === addDays(1))}>بكرة</button>
                    <input type="date" value={stickerDate} onChange={e => e.target.value && setStickerDate(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs text-slate-200 [color-scheme:dark]" aria-label="تاريخ آخر" />
                  </div>
                  {stickerLook !== 'decor' && <div className="flex flex-wrap gap-1.5">
                    {STICKER_LABELS.map(l => <button key={l.id} type="button" onClick={() => setStickerLabelId(l.id)} className={chip(stickerLabelId === l.id)}>{l.text}</button>)}
                    <button type="button" onClick={() => setStickerLabelId('custom')} className={chip(stickerLabelId === 'custom')}>كلمة من عندي</button>
                  </div>}
                  {stickerLook !== 'decor' && stickerLabelId === 'custom' && <input value={stickerCustom} onChange={e => setStickerCustom(e.target.value.slice(0, 24))} placeholder="مثلاً: يوم جميل" className={input} />}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => setStickerIcon('none')} className={`w-9 h-9 rounded-xl border text-[10px] ${stickerIcon === 'none' ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200' : 'border-slate-800 text-slate-400'}`}>بدون</button>
                    {STICKER_ICONS.map(i => (
                      <button key={i.id} type="button" onClick={() => setStickerIcon(i.id)} title={i.label} aria-label={i.label}
                        className={`w-9 h-9 rounded-xl border p-1.5 ${stickerIcon === i.id ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
                        <img src={iconSrc(i.id)} alt="" className="w-full h-full" />
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STICKER_LOOKS.map(l => (
                      <button key={l.id} type="button" onClick={() => setStickerLook(l.id)} className={`${chip(stickerLook === l.id)} text-sm`} style={{ fontFamily: l.font }}>{l.label}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STICKER_THEMES.map(t => (
                      <button key={t.id} type="button" onClick={() => setStickerTheme(t.id)} className={`${chip(stickerTheme === t.id)} flex items-center gap-1.5`}>
                        <span className="w-3 h-3 rounded-full" style={{ background: t.edge, boxShadow: `0 0 0 2px ${t.fill}` }} />{t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showHijri} onChange={e => setShowHijri(e.target.checked)} className="accent-emerald-500" /> هجري</label>
                    <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showGregorian} onChange={e => setShowGregorian(e.target.checked)} className="accent-emerald-500" /> ميلادي</label>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => { setStickerPos('top'); setStyle(s => ({ ...s, y: Math.max(s.y, 840) })); }} className={chip(stickerPos === 'top')}>أعلى</button>
                      <button type="button" onClick={() => { setStickerPos('bottom'); setStyle(s => ({ ...s, y: Math.min(s.y, 520) })); }} className={chip(stickerPos === 'bottom')}>أسفل</button>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={section}>
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-200">نص ثابت طوال الريل <span className="font-normal text-slate-500">(اختياري، تحرّكه على المعاينة)</span></div>
          <input value={dedication} onChange={e => setDedication(e.target.value.slice(0, 80))} placeholder="مثلاً: عن روح المرحوم الحاج أبو ناهض" className={input} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-2 border-t border-slate-800">
          <input type="checkbox" checked={supportOn} onChange={e => setSupportOn(e.target.checked)} className="accent-emerald-500" />
          بطاقة دعم في نهاية الريل
        </label>
        {supportOn && <textarea value={support} onChange={e => setSupport(e.target.value.slice(0, 200))} rows={2} className={`${input} leading-relaxed`} />}
        {!quranMode && <p className="text-[11px] text-slate-500">يمكنك إضافة رقم خط دعم نفسي محلي موثوق، بعد التأكد منه من مصدر رسمي.</p>}
      </div>

      {error && (
        <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span>{error.text}</span>
          {error.credits && <button type="button" onClick={onOpenPackages} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">اشحن رصيدك</button>}
        </div>
      )}
      {busy && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-300"><span>{progress === 0 ? (quranMode ? 'نجهّز التلاوة والمشاهد…' : 'نسجّل الصوت ونحضّر المشاهد…') : 'نجهّز الريل…'}</span><span className="font-mono text-emerald-300">{progress}%</span></div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-gradient-to-l from-emerald-400 to-emerald-600 transition-all duration-700" style={{ width: `${Math.max(3, progress)}%` }} /></div>
        </div>
      )}
      <button type="button" onClick={create} disabled={busy} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-extrabold text-base disabled:opacity-60">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />} اصنع الريل
      </button>
      <p className="text-[11px] text-slate-500 text-center">{quranMode ? `سعر الريل ${prices.quranReel} نقطة، بتلاوة القارئ الأصلية.` : `سعر الريل ${prices.calmReel} نقطة شامل الصوت والفيديو.`}</p>

    </div>
  );
};
