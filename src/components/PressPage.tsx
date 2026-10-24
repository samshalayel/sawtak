import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioTagBar } from './AudioTagBar';
import {
  Download, FileText, Film, ImagePlus, Loader2, Mic, Newspaper, Pause, Play, Plus, Radio, RectangleHorizontal,
  RectangleVertical, Square, Trash2, Wand2, X,
} from 'lucide-react';
import { VOICES } from '../data/presets';
import { AuthUser } from '../types/auth';
import { base64ToBlobUrl, estimateDuration } from '../utils/audio';
import { BrandKit, BrandKitPanel } from './BrandKitPanel';
import { FootageBrander } from './FootageBrander';

// Press studio: article -> script (podcast / bulletin / summary) -> voices -> branded audio + video.

type Format = 'podcast' | 'bulletin' | 'summary';
type VideoFormat = 'landscape' | 'vertical' | 'square';
interface Line { speaker: number; text: string }

const FORMATS: { id: Format; label: string; hint: string; icon: React.ElementType; names: string[]; roles: string[]; voices: string[]; tone: string }[] = [
  { id: 'podcast', label: 'بودكاست حواري', hint: 'مذيع وضيف يناقشان المقال', icon: Mic, names: ['سامر', 'ليلى'], roles: ['المذيع', 'الضيف'], voices: ['Charon', 'Kore'], tone: 'conversational_warm' },
  { id: 'bulletin', label: 'نشرة أخبار', hint: 'مذيع ومراسل مع شريط عناوين', icon: Radio, names: ['رامي', 'سلمى'], roles: ['المذيع', 'المراسل'], voices: ['Orus', 'Zephyr'], tone: 'professional_news' },
  { id: 'summary', label: 'ملخص بصوت واحد', hint: 'نسخة مسموعة من المقال', icon: FileText, names: ['الراوي'], roles: ['الراوي'], voices: ['Kore'], tone: 'professional_news' },
];

const DIALECTS = [
  { id: 'msa', label: 'فصحى' },
  { id: 'levantine', label: 'شامي' },
  { id: 'gulf', label: 'خليجي' },
  { id: 'egyptian', label: 'مصري' },
];

const VIDEO_FORMATS: { id: VideoFormat; label: string; icon: React.ElementType }[] = [
  { id: 'landscape', label: '16:9 يوتيوب', icon: RectangleHorizontal },
  { id: 'vertical', label: '9:16 ريلز', icon: RectangleVertical },
  { id: 'square', label: '1:1 منشور', icon: Square },
];

const PRESS_VOICES = VOICES.filter(v => v.avatar && !v.tags.includes('أطفال'));

interface Props {
  user: AuthUser | null;
  onLoginRequired: (reason: string) => void;
  onBalance: (balance: number) => void;
  onOpenPackages: () => void;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const PressPage: React.FC<Props> = ({ user, onLoginRequired, onBalance, onOpenPackages }) => {
  const [brand, setBrand] = useState<BrandKit | null>(null);
  // Expression bar acts on the script line last focused
  const [activeLine, setActiveLine] = useState(0);
  const lineBoxes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [tab, setTab] = useState<'article' | 'footage'>('article');
  const [format, setFormat] = useState<Format>('podcast');
  const spec = FORMATS.find(f => f.id === format)!;
  const [article, setArticle] = useState('');
  const [length, setLength] = useState<'short' | 'medium'>('short');
  const [dialect, setDialect] = useState('msa');
  const [names, setNames] = useState<string[]>(spec.names);
  const [voices, setVoices] = useState<string[]>(spec.voices);
  const [photos, setPhotos] = useState<(string | null)[]>([null, null]);
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('landscape');
  const [stage, setStage] = useState<'idle' | 'script' | 'voice' | 'master' | 'video'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ text: string; needsCredits?: boolean } | null>(null);
  const [audio, setAudio] = useState<{ url: string; base64: string } | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);
  const cancelled = useRef(false);
  const photoInputs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  useEffect(() => {
    if (!user) return;
    fetch('/api/brand').then(r => r.json()).then(d => setBrand(d?.brand ?? null)).catch(() => {});
  }, [user?.id]);
  useEffect(() => () => { cancelled.current = true; preview.current?.pause(); }, []);
  useEffect(() => () => { if (video) URL.revokeObjectURL(video); }, [video]);

  const chooseFormat = (f: Format) => {
    const next = FORMATS.find(x => x.id === f)!;
    setFormat(f);
    setNames(next.names);
    setVoices(next.voices);
    setLines([]);
    setHeadlines([]);
    setTitle('');
    setError(null);
  };

  const speakerCount = format === 'summary' ? 1 : 2;
  const spokenText = lines.map(l => l.text).join(' ');
  const estimate = estimateDuration(spokenText);
  const busy = stage !== 'idle';

  const needUser = (reason: string) => {
    if (user) return false;
    onLoginRequired(reason);
    return true;
  };

  const togglePreview = (id: string) => {
    preview.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(`/api/tts/preview/${id}`);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    preview.current = a;
    setPlaying(id);
  };

  const writeScript = async () => {
    setError(null);
    if (needUser('سجّل حساباً لتستخدم استوديو الصحفيين.')) return;
    if (article.trim().length < 80) return setError({ text: 'الصق نص المقال كاملاً أولاً' });
    setStage('script');
    try {
      const res = await fetch('/api/press/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, article, length, dialect, names: names.slice(0, speakerCount) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'تعذّر تحويل المقال');
      setLines(data.lines);
      setHeadlines(data.headlines ?? []);
      setTitle(data.title ?? '');
    } catch (e: any) {
      setError({ text: e instanceof TypeError ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : e.message });
    } finally {
      setStage('idle');
    }
  };

  const produce = async () => {
    setError(null);
    if (needUser('سجّل حساباً لتنتج الحلقة.')) return;
    if (lines.length === 0) return setError({ text: 'حوّل المقال إلى سكربت أولاً، أو اكتب السكربت بنفسك' });
    if (speakerCount === 2 && (!names[0].trim() || !names[1].trim() || names[0].trim() === names[1].trim())) {
      return setError({ text: 'اكتب اسمين مختلفين للمتحدثَين' });
    }
    setAudio(null);
    if (video) URL.revokeObjectURL(video);
    setVideo(null);
    setStage('voice');
    setProgress(0);
    try {
      // 1. Voices (charged by real audio length)
      const speakerNames = names.slice(0, speakerCount).map(n => n.trim());
      const ttsRes = speakerCount === 2
        ? await fetch('/api/tts/dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              speakers: speakerNames.map((name, i) => ({ name, voice: voices[i] })),
              lines: lines.map(l => ({ speaker: speakerNames[l.speaker], text: l.text })),
              dialect, toneStyle: spec.tone, customStylePrompt: '', speed: 1,
            }),
          })
        : await fetch('/api/tts/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: lines.map(l => l.text).join('\n'), voice: voices[0], language: 'ar', dialect, toneStyle: spec.tone, speed: 1, pitch: 0 }),
          });
      const tts = await ttsRes.json().catch(() => ({}));
      if (typeof tts.balance === 'number') onBalance(tts.balance);
      if (ttsRes.status === 401) return onLoginRequired('انتهت جلستك، يرجى تسجيل الدخول مجدداً.');
      if (!ttsRes.ok || !tts.success) {
        throw Object.assign(new Error(tts.error || 'تعذّر توليد الصوت'), { needsCredits: tts.code === 'INSUFFICIENT_CREDITS' });
      }

      // 2. Episode audio with the outlet's intro/outro (free)
      setStage('master');
      const episode = tts.audioBase64 as string;
      setAudio({ url: base64ToBlobUrl(episode, 'audio/wav'), base64: episode });

      // 3. Branded video (free), rendered in the background
      setStage('video');
      const vRes = await fetch('/api/press/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speechBase64: tts.audioBase64, format: videoFormat,
          episodeTitle: title.trim(), lines, headlines: format === 'bulletin' ? headlines : [],
          speakers: speakerNames.map((name, i) => ({ name, voiceId: voices[i], imageBase64: photos[i] ?? undefined })),
        }),
      });
      const job = await vRes.json().catch(() => ({}));
      if (!vRes.ok || !job.jobId) throw new Error(job.error || 'تعذّر تجهيز الفيديو');
      while (!cancelled.current) {
        await new Promise(r => setTimeout(r, 1500));
        const s = await fetch(`/api/video/jobs/${job.jobId}`).then(r => r.json()).catch(() => ({}));
        if (s.status === 'error' || s.success === false) throw new Error(s.error || 'تعذّر تجهيز الفيديو');
        setProgress(Math.round((s.progress || 0) * 100));
        if (s.status === 'done') {
          const file = await fetch(`/api/video/jobs/${job.jobId}/file`);
          if (!file.ok) throw new Error('تعذّر تحميل الفيديو');
          setVideo(URL.createObjectURL(await file.blob()));
          break;
        }
      }
    } catch (e: any) {
      setError({ text: e instanceof TypeError || !e?.message ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : e.message, needsCredits: e?.needsCredits });
    } finally {
      setStage('idle');
    }
  };

  const save = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const section = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3';
  const label = 'text-sm font-bold text-white flex items-center gap-2';
  const stepNo = (n: number) => <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{n}</span>;
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500';
  const chip = (active: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${active ? 'bg-amber-500/15 border-amber-500/70 text-amber-200' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'}`;
  const fileBase = useMemo(() => `${(title || spec.label).replace(/[\\/:*?"<>|]+/g, '').slice(0, 40)}`, [title, spec.label]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-extrabold text-white flex items-center justify-center gap-2"><Newspaper className="w-6 h-6 text-amber-400" /> استوديو الصحفيين</h2>
        <p className="text-sm text-slate-400">الصق مقالك، ونحوّله إلى بودكاست أو نشرة أو ملخص مسموع، بصوت طبيعي وفيديو بهوية مؤسستك.</p>
      </div>

      {user && <BrandKitPanel brand={brand} onSaved={setBrand} />}

      <div className="grid grid-cols-2 gap-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-1.5">
        {([
          { id: 'article', label: 'حلقة من مقال', icon: FileText },
          { id: 'footage', label: 'فيديو جاهز بهوية المؤسسة', icon: Film },
        ] as const).map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-colors ${tab === t.id ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'footage' && (user ? <FootageBrander brand={brand} onBalance={onBalance} onOpenPackages={onOpenPackages} /> : (
        <button type="button" onClick={() => onLoginRequired('سجّل حساباً لترفع فيديوهاتك.')} className="w-full py-3 rounded-2xl bg-amber-500 text-slate-950 font-bold">
          سجّل الدخول لرفع فيديو
        </button>
      ))}

      {tab === 'article' && (<>
      {/* 1. Format */}
      <div className={section}>
        <div className={label}>{stepNo(1)} نوع الحلقة</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {FORMATS.map(f => (
            <button key={f.id} type="button" onClick={() => chooseFormat(f.id)} className={`rounded-xl border p-3 text-right transition-colors ${format === f.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}>
              <div className="flex items-center gap-2 text-sm font-bold text-white"><f.icon className="w-4 h-4 text-amber-400" /> {f.label}</div>
              <div className="text-[11px] text-slate-500 mt-1">{f.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Article -> script */}
      <div className={section}>
        <div className={label}>{stepNo(2)} المقال</div>
        <textarea value={article} onChange={e => setArticle(e.target.value)} rows={7} placeholder="الصق نص المقال أو الخبر هنا…" className={`${input} leading-relaxed`} />
        <p className="text-[11px] text-slate-500">بعد التحويل يظهر السكربت سطراً سطراً، ومعه شريط «أضف تعبيراً للصوت» (ضحكة، وقفة، حماس…) لتضيفه حيث تريد.</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">المدة:</span>
          <button type="button" onClick={() => setLength('short')} className={chip(length === 'short')}>قصيرة (دقيقة)</button>
          <button type="button" onClick={() => setLength('medium')} className={chip(length === 'medium')}>متوسطة (2-3 دقائق)</button>
          <span className="text-xs text-slate-400 mr-2">اللهجة:</span>
          {DIALECTS.map(d => <button key={d.id} type="button" onClick={() => setDialect(d.id)} className={chip(dialect === d.id)}>{d.label}</button>)}
        </div>
        {speakerCount === 2 && (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map(i => (
              <label key={i} className="space-y-1">
                <span className="text-xs text-slate-300">اسم {spec.roles[i]}</span>
                <input value={names[i]} onChange={e => setNames(n => n.map((x, j) => (j === i ? e.target.value.slice(0, 30) : x)))} className={input} />
              </label>
            ))}
          </div>
        )}
        <button type="button" onClick={writeScript} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/50 text-amber-200 text-sm font-bold hover:bg-amber-500/25 disabled:opacity-60">
          {stage === 'script' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {stage === 'script' ? 'نكتب السكربت…' : lines.length ? 'إعادة كتابة السكربت' : 'حوّل المقال إلى سكربت'}
        </button>
        {/* Before a script exists the output section (and its error box) is hidden, so errors show here */}
        {error && lines.length === 0 && (
          <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error.text}</div>
        )}
      </div>

      {/* 3. Script editor */}
      {lines.length > 0 && (
        <div className={section}>
          <div className={label}>{stepNo(3)} السكربت <span className="text-[11px] font-normal text-slate-500">(راجعه وعدّله، فأنت المسؤول عن دقته)</span></div>
          <label className="block space-y-1">
            <span className="text-xs text-slate-300">عنوان الحلقة</span>
            <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} className={input} />
          </label>
          <AudioTagBar target={{ get current() { return lineBoxes.current[activeLine] ?? null; } }} value={lines[activeLine]?.text ?? ''}
            onChange={v => setLines(ls => ls.map((x, j) => (j === activeLine ? { ...x, text: v } : x)))} />
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-start">
                {speakerCount === 2 ? (
                  <select value={l.speaker} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, speaker: Number(e.target.value) } : x)))} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-200 shrink-0 w-24">
                    {[0, 1].map(s => <option key={s} value={s}>{names[s] || spec.roles[s]}</option>)}
                  </select>
                ) : null}
                <textarea ref={el => { lineBoxes.current[i] = el; }} onFocus={() => setActiveLine(i)} value={l.text} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} rows={2} className={`${input} leading-relaxed`} />
                <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300 pt-2" title="حذف السطر"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setLines(ls => [...ls, { speaker: ls.length ? 1 - ls[ls.length - 1].speaker : 0, text: '' }].map(x => (speakerCount === 1 ? { ...x, speaker: 0 } : x)))} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
              <Plus className="w-3.5 h-3.5" /> سطر جديد
            </button>
          </div>
          {format === 'bulletin' && (
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="text-xs font-bold text-white">عناوين الشريط الإخباري</div>
              {headlines.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <input value={h} onChange={e => setHeadlines(hs => hs.map((x, j) => (j === i ? e.target.value.slice(0, 120) : x)))} className={input} />
                  <button type="button" onClick={() => setHeadlines(hs => hs.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300"><X className="w-4 h-4" /></button>
                </div>
              ))}
              {headlines.length < 8 && (
                <button type="button" onClick={() => setHeadlines(hs => [...hs, ''])} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"><Plus className="w-3.5 h-3.5" /> عنوان</button>
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-500">المدة التقريبية: {estimate.formatted}</p>
        </div>
      )}

      {/* 4. Voices + photos */}
      {lines.length > 0 && (
        <div className={section}>
          <div className={label}>{stepNo(4)} الأصوات والصور</div>
          {Array.from({ length: speakerCount }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-amber-300">{names[i] || spec.roles[i]}</span>
                <div className="flex items-center gap-2">
                  {photos[i] && <img src={photos[i]!} alt="" className="w-8 h-8 rounded-full object-cover" />}
                  <button type="button" onClick={() => photoInputs[i].current?.click()} className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-amber-300">
                    <ImagePlus className="w-3.5 h-3.5" /> {photos[i] ? 'تغيير الصورة' : 'صورة حقيقية (اختياري)'}
                  </button>
                  {photos[i] && <button type="button" onClick={() => setPhotos(p => p.map((x, j) => (j === i ? null : x)))} className="text-slate-500 hover:text-rose-300"><X className="w-3.5 h-3.5" /></button>}
                  <input ref={photoInputs[i]} type="file" accept="image/*" hidden onChange={async e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) { const d = await readAsDataUrl(f); setPhotos(p => p.map((x, j) => (j === i ? d : x))); }
                  }} />
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {PRESS_VOICES.map(v => (
                  <div key={v.id} role="button" tabIndex={0} onClick={() => setVoices(vs => vs.map((x, j) => (j === i ? v.id : x)))}
                    className={`relative shrink-0 w-20 rounded-xl border p-1.5 flex flex-col items-center gap-1 cursor-pointer ${voices[i] === v.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
                    <img src={v.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                    <span className="text-[11px] text-white">{v.name}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); togglePreview(v.id); }} className="absolute top-1 left-1 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center" aria-label={`استماع لعيّنة ${v.name}`}>
                      {playing === v.id ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 5. Output */}
      {lines.length > 0 && (
        <div className={section}>
          <div className={label}>{stepNo(5)} الإخراج</div>
          <div className="flex flex-wrap gap-2">
            {VIDEO_FORMATS.map(f => (
              <button key={f.id} type="button" onClick={() => setVideoFormat(f.id)} className={`${chip(videoFormat === f.id)} flex items-center gap-1.5`}><f.icon className="w-3.5 h-3.5" /> {f.label}</button>
            ))}
          </div>
          {error && (
            <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <span>{error.text}</span>
              {error.needsCredits && <button type="button" onClick={onOpenPackages} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">اشحن رصيدك</button>}
            </div>
          )}

          {busy && stage !== 'script' && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-300">
                <span>{stage === 'voice' ? 'نسجّل الأصوات…' : stage === 'master' ? 'نجهّز الصوت…' : 'نجهّز الفيديو…'}</span>
                {stage === 'video' && <span className="font-mono text-amber-300">{progress}%</span>}
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-gradient-to-l from-amber-400 to-amber-600 transition-all duration-700" style={{ width: stage === 'video' ? `${30 + progress * 0.7}%` : stage === 'master' ? '28%' : '15%' }} />
              </div>
            </div>
          )}

          <button type="button" onClick={produce} disabled={busy} className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-base disabled:opacity-60 shadow-lg">
            {busy && stage !== 'script' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Film className="w-5 h-5" />}
            أنتج الحلقة (صوت + فيديو)
          </button>
          <p className="text-[11px] text-slate-500 text-center">يُخصم من رصيدك مدة الصوت فقط (حوالي {estimate.seconds} ثانية). كتابة السكربت والفيديو مجانيان.</p>
        </div>
      )}

      {/* Results */}
      {(audio || video) && (
        <div className={section}>
          <div className={label}>الحلقة جاهزة</div>
          <p className="text-[11px] text-slate-400">لا نحتفظ بأي نسخة، فحمّل الملفات قبل مغادرة الصفحة.</p>
          {audio && (
            <div className="flex items-center gap-2 flex-wrap">
              <audio src={audio.url} controls className="h-9" />
              <button type="button" onClick={() => save(audio.url, `${fileBase}.wav`)} className="flex items-center gap-1 text-xs text-slate-200 hover:text-amber-300"><Download className="w-4 h-4" /> تحميل الصوت</button>
            </div>
          )}
          {video && (
            <div className="space-y-2">
              <video src={video} controls playsInline className={`rounded-xl bg-black ${videoFormat === 'vertical' ? 'max-h-[60vh] mx-auto' : 'w-full'}`} />
              <button type="button" onClick={() => save(video, `${fileBase}.mp4`)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold"><Download className="w-4 h-4" /> تحميل الفيديو</button>
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  );
};
