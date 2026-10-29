import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Pause, Play, RotateCcw, Send, Share2, Wand2, X, LayoutTemplate, Palette, User, Users, FileUp } from 'lucide-react';
import { GreetingBatchView, BatchStatus } from './GreetingBatchView';
import { GreetingDesigner, PhotoBox, DEFAULT_PHOTO_BOX, TextStyle, DEFAULT_TEXT_STYLE } from './GreetingDesigner';
import { VOICES } from '../data/presets';
import {
  OCCASIONS, GENDER_LABELS, GREETING_VOICE_IDS, Gender, Occasion, fillName, occasionTitle, templateText,
} from '../data/greetings';
import { AuthUser, ServicePrices } from '../types/auth';
import { estimateDuration } from '../utils/audio';
import { postRender } from '../utils/postRender';
import { AudioTagBar } from './AudioTagBar';

// Voice greetings: occasion → name → message → voice → (photo / own template) → 9:16 video to share.
// "Bulk" mode sends one message to a whole member list as a background job on the server.

interface GreetingsPageProps {
  user: AuthUser | null;
  prices: ServicePrices;
  onLoginRequired: (reason: string) => void;
  onBalance: (balance: number) => void;
  onOpenPackages: () => void;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DRAFT_KEY = 'sawtik_greeting_draft';

interface Draft {
  occasionId: string;
  gender: Gender;
  name: string;
  from: string;
  templateId: string;
  text: string;
  textEdited: boolean;
  title: string;
  titleEdited: boolean;
  voiceId: string;
}

// Sign-in may leave the page (Google), so the form is parked in this tab until the user is back
const loadDraft = (): Draft | null => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
};

const readImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

type Stage = 'idle' | 'voice' | 'video';

// In bulk texts the name is shown as a visible token the user can move around
const NAME_TOKEN = '[الاسم]';
const toToken = (t: string) => t.split('{name}').join(NAME_TOKEN);
const fromToken = (t: string) => t.split(NAME_TOKEN).join('{name}');

const GENDER_WORDS: Record<string, Gender> = {
  m: 'm', male: 'm', 'ذكر': 'm', 'م': 'm', 'رجل': 'm',
  f: 'f', female: 'f', 'أنثى': 'f', 'انثى': 'f', 'ف': 'f', 'ث': 'f', 'امرأة': 'f',
  p: 'p', 'جمع': 'p', 'عائلة': 'p', 'زوجان': 'p',
};

interface Member { name: string; gender: Gender; phone: string }

/**
 * One member per line: name, then optional gender and phone in any order, separated by tab (pasted from
 * Excel), comma, Arabic comma or semicolon. A header row ("الاسم…" / "name…") is skipped.
 */
function parseMembers(raw: string, fallback: Gender): Member[] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter((line, i) => !(i === 0 && /^(الاسم|name)(\s|\t|,|$)/i.test(line)))
    .map(line => {
      const [name, ...rest] = line.split(/\t|,|،|;/).map(c => c.replace(/^"|"$/g, '').trim());
      let gender = fallback;
      let phone = '';
      for (const cell of rest) {
        const g = GENDER_WORDS[cell.toLowerCase()];
        if (g) gender = g;
        else if (/^\+?[\d\s-]{7,}$/.test(cell)) phone = cell.replace(/[\s-]/g, '');
      }
      return { name: (name || '').slice(0, 30), gender, phone };
    })
    .filter(m => m.name);
}

export const GreetingsPage: React.FC<GreetingsPageProps> = ({ user, prices, onLoginRequired, onBalance, onOpenPackages }) => {
  const [restored] = useState(loadDraft);
  const messageBox = useRef<HTMLTextAreaElement | null>(null);
  const bulkBoxes = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [occasion, setOccasion] = useState<Occasion>(() => OCCASIONS.find(o => o.id === restored?.occasionId) ?? OCCASIONS[0]);
  const [gender, setGender] = useState<Gender>(restored?.gender ?? occasion.defaultGender);
  const [name, setName] = useState(restored?.name ?? '');
  const [from, setFrom] = useState(restored?.from ?? '');
  const [templateId, setTemplateId] = useState(restored?.templateId ?? occasion.templates[0].id);
  const [text, setText] = useState(restored?.text ?? '');
  const [textEdited, setTextEdited] = useState(restored?.textEdited ?? false);
  const [title, setTitle] = useState(restored?.title ?? '');
  const [titleEdited, setTitleEdited] = useState(restored?.titleEdited ?? false);
  const [voiceId, setVoiceId] = useState(restored?.voiceId ?? 'Kore');
  const [photo, setPhoto] = useState<string | null>(null);
  const [bgMode, setBgMode] = useState<'design' | 'template'>('design');
  const [template, setTemplate] = useState<string | null>(null);
  const [photoBox, setPhotoBox] = useState<PhotoBox>(DEFAULT_PHOTO_BOX);
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);

  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [membersText, setMembersText] = useState('');
  const [bulkTexts, setBulkTexts] = useState<Partial<Record<Gender, string>>>({});
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  // Put the video together on this device instead of the server (browsers that can encode H.264; a trial option)
  const canOnDevice = typeof VideoEncoder !== 'undefined' && typeof createImageBitmap !== 'undefined';
  const [onDevice, setOnDevice] = useState(() => {
    try { return localStorage.getItem('sawtik.onDevice') === '1'; } catch { return false; }
  });
  const toggleOnDevice = (on: boolean) => {
    setOnDevice(on);
    try { localStorage.setItem('sawtik.onDevice', on ? '1' : '0'); } catch { /* storage disabled */ }
  };
  const [error, setError] = useState<{ text: string; needsCredits?: boolean } | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; onDevice?: boolean; seconds?: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);
  const cancelled = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);

  const tpl = occasion.templates.find(t => t.id === templateId) ?? occasion.templates[0];

  // Message and headline follow the choices until the user edits them by hand
  useEffect(() => {
    if (!textEdited) setText(fillName(templateText(tpl, gender), name || '…'));
  }, [tpl, gender, name, textEdited]);
  useEffect(() => {
    if (!titleEdited) setTitle(fillName(occasionTitle(occasion, gender), name || '…'));
  }, [occasion, gender, name, titleEdited]);

  useEffect(() => {
    if (user) sessionStorage.removeItem(DRAFT_KEY);
  }, [user]);
  useEffect(() => () => {
    cancelled.current = true;
    preview.current?.pause();
  }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const chooseOccasion = (o: Occasion) => {
    setOccasion(o);
    setGender(o.genders.includes(gender) ? gender : o.defaultGender);
    setTemplateId(o.templates[0].id);
    setTextEdited(false);
    setTitleEdited(false);
    if (o.templates[0].voice) setVoiceId(o.templates[0].voice);
  };

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    setTextEdited(false);
    const v = occasion.templates.find(t => t.id === id)?.voice;
    if (v) setVoiceId(v);
  };

  const togglePreview = (id: string) => {
    preview.current?.pause();
    if (playing === id) return setPlaying(null);
    const audio = new Audio(`/api/tts/preview/${id}`);
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
    preview.current = audio;
    setPlaying(id);
  };

  const pickImage = async (file: File | undefined, set: (v: string) => void) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError({ text: 'يرجى اختيار ملف صورة' });
    if (file.size > MAX_IMAGE_BYTES) return setError({ text: 'حجم الصورة أكبر من 5 ميغابايت' });
    setError(null);
    set(await readImage(file));
  };

  // ---------- Bulk mode ----------
  // Lists default to the masculine form (the usual Arabic convention for unspecified names), and any gender the
  // occasion has no wording for (e.g. plural on a birthday) falls back to an allowed one
  const members = useMemo(() => {
    const fallback: Gender = occasion.genders.includes('m') ? 'm' : occasion.defaultGender;
    return parseMembers(membersText, fallback).map(m => (occasion.genders.includes(m.gender) ? m : { ...m, gender: fallback }));
  }, [membersText, occasion]);
  const bulkGenders = useMemo(
    () => occasion.genders.filter(g => members.some(m => m.gender === g)),
    [members, occasion]
  );
  // Bulk texts (one per gender) and headline restart from the chosen template whenever it changes
  const [bulkTitle, setBulkTitle] = useState('');
  useEffect(() => {
    const next: Partial<Record<Gender, string>> = {};
    for (const g of occasion.genders) next[g] = toToken(templateText(tpl, g));
    setBulkTexts(next);
    setBulkTitle(toToken(occasionTitle(occasion, occasion.defaultGender)));
  }, [tpl, occasion]);

  // A batch keeps running on the server: show it again after a refresh or a later visit
  useEffect(() => {
    if (!user) return;
    fetch('/api/greetings/batch/latest').then(r => r.json()).then(d => {
      if (d?.batch) {
        setBatch(d.batch);
        setMode('bulk');
      }
    }).catch(() => {});
  }, [user?.id]);

  const refreshBalance = () =>
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d?.user) onBalance(d.user.credits); }).catch(() => {});

  const loadCsv = async (file?: File) => {
    if (!file) return;
    setMembersText((await file.text()).replace(/^﻿/, ''));
  };

  const bulkEstimate = members.reduce((sum, m) => {
    const t = (bulkTexts[m.gender] ?? '').split(NAME_TOKEN).join(m.name);
    return sum + estimateDuration(t).seconds;
  }, 0);

  const createBulk = async () => {
    setError(null);
    if (members.length === 0) return setError({ text: 'أضف قائمة الأسماء أولاً' });
    if (bulkGenders.some(g => !(bulkTexts[g] ?? '').trim())) return setError({ text: 'اكتب نص التهنئة لكل فئة (ذكر / أنثى / جمع)' });
    if (bulkGenders.some(g => !(bulkTexts[g] ?? '').includes(NAME_TOKEN))) {
      if (!window.confirm(`بعض النصوص لا تحتوي ${NAME_TOKEN}، فلن يُذكر اسم العضو فيها. متابعة؟`)) return;
    }
    if (bgMode === 'template' && !template) return setError({ text: 'ارفع صورة القالب 9:16 أو اختر تصميم المناسبة' });
    if (!user) return onLoginRequired('سجّل حساباً لتصنع التهاني الجماعية.');

    setStage('voice');
    try {
      const texts: Partial<Record<Gender, string>> = {};
      for (const g of bulkGenders) texts[g] = fromToken(bulkTexts[g]!);
      const res = await fetch('/api/greetings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occasion: occasion.id, voice: voiceId, dialect: tpl.dialect, tone: tpl.tone, style: occasion.style,
          members, texts,
          title: fromToken(bulkTitle),
          from: from.trim() ? `مع المحبة، ${from.trim()}` : '',
          imageBase64: photo ?? undefined,
          templateBase64: bgMode === 'template' ? template ?? undefined : undefined,
          photoBox: bgMode === 'template' ? photoBox : undefined,
          textStyle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return onLoginRequired('انتهت جلستك، يرجى تسجيل الدخول مجدداً.');
      if (!res.ok || !data.batch) {
        return setError({ text: data.error || 'تعذّر بدء الدفعة، يرجى المحاولة لاحقاً.', needsCredits: data.code === 'INSUFFICIENT_CREDITS' });
      }
      setBatch(data.batch);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError({ text: 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' });
    } finally {
      setStage('idle');
    }
  };

  const voices = useMemo(() => GREETING_VOICE_IDS.map(id => VOICES.find(v => v.id === id)).filter(Boolean) as typeof VOICES, []);
  const estimate = estimateDuration(text);
  const busy = stage !== 'idle';

  const create = async () => {
    setError(null);
    if (!name.trim()) return setError({ text: 'اكتب اسم الشخص الذي تهنّئه' });
    if (!text.trim() || text.includes('…')) return setError({ text: 'راجع نص التهنئة أولاً' });
    if (bgMode === 'template' && !template) return setError({ text: 'ارفع صورة القالب 9:16 أو اختر تصميم المناسبة' });
    if (!user) {
      const draft: Draft = { occasionId: occasion.id, gender, name, from, templateId, text, textEdited, title, titleEdited, voiceId };
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage disabled */ }
      return onLoginRequired('سجّل حساباً مجانياً لتصنع تهنئتك بالصوت.');
    }

    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStage('voice');
    setProgress(0);
    try {
      // 1. The voice: charged as a greeting card (the card price covers the voice and the video)
      const ttsRes = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(), voice: voiceId, language: 'ar', dialect: tpl.dialect, toneStyle: tpl.tone,
          customStylePrompt: occasion.style, speed: 1, pitch: 0, purpose: 'greeting',
        }),
      });
      const tts = await ttsRes.json().catch(() => ({}));
      if (typeof tts.balance === 'number') onBalance(tts.balance);
      if (ttsRes.status === 401) return onLoginRequired('انتهت جلستك، يرجى تسجيل الدخول مجدداً.');
      if (!ttsRes.ok || !tts.success) {
        throw Object.assign(new Error(tts.error || 'تعذّر توليد الصوت، يرجى المحاولة لاحقاً.'), { needsCredits: tts.code === 'INSUFFICIENT_CREDITS' });
      }

      // 2. The video (free), rendered in the background and polled
      setStage('video');
      const videoBody = {
        text: text.trim(),
        voiceId,
        title: title.trim(),
        captions: true,
        greeting: {
          occasion: occasion.id,
          from: from.trim() ? `مع المحبة، ${from.trim()}` : '',
          photoBox: bgMode === 'template' ? photoBox : undefined,
          textStyle,
        },
        imageBase64: photo ?? undefined,
        templateBase64: bgMode === 'template' ? template ?? undefined : undefined,
      };
      const voice = { id: tts.audioId as string | undefined, base64: tts.audioBase64 as string };

      // On this device: the server only sends the picture, the captions and the voice; the browser builds the MP4.
      // If anything is unsupported or fails, the server renders it as usual.
      if (onDevice && canOnDevice) {
        try {
          const planRes = await postRender('/api/video/render', { ...videoBody, plan: true }, voice);
          const data = await planRes.json().catch(() => ({}));
          if (!planRes.ok || !data.plan) {
            // A refusal the server would repeat (blocked text, hourly limit…) is shown as it is
            if (planRes.status < 500) throw Object.assign(new Error(data.error || 'تعذّر تجهيز الفيديو'), { shown: true });
            throw new Error('plan failed');
          }
          const { renderGreetingOnDevice, canRenderOnDevice } = await import('../utils/clientRender');
          if (!(await canRenderOnDevice(data.plan.width, data.plan.height))) throw new Error('H.264 not supported');
          const startedAt = Date.now();
          const blob = await renderGreetingOnDevice(data.plan, voice.base64, f => setProgress(Math.round(f * 100)), () => cancelled.current);
          if (cancelled.current) return;
          setResult({ url: URL.createObjectURL(blob), blob, onDevice: true, seconds: Math.round((Date.now() - startedAt) / 100) / 10 });
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        } catch (err: any) {
          if (err?.shown) throw err;
          console.warn('On-device video failed, using the server:', err);
          setProgress(0);
        }
      }

      const videoRes = await postRender('/api/video/render', videoBody, voice);
      const job = await videoRes.json().catch(() => ({}));
      if (!videoRes.ok || !job.jobId) throw new Error(job.error || 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.');

      while (!cancelled.current) {
        await new Promise(r => setTimeout(r, 1000));
        const statusRes = await fetch(`/api/video/jobs/${job.jobId}`);
        const status = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok || status.status === 'error') throw new Error(status.error || 'تعذّر تجهيز الفيديو');
        setProgress(Math.round((status.progress || 0) * 100));
        if (status.status === 'done') {
          const file = await fetch(`/api/video/jobs/${job.jobId}/file`);
          if (!file.ok) throw new Error('تعذّر تحميل الفيديو');
          const blob = await file.blob();
          setResult({ url: URL.createObjectURL(blob), blob });
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        }
      }
    } catch (err: any) {
      setError({
        text: err instanceof TypeError || !err?.message ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : err.message,
        needsCredits: err?.needsCredits,
      });
    } finally {
      setStage('idle');
    }
  };

  // What the designer preview shows: the real headline and the first words of the message
  const sampleName = members[0]?.name ?? 'الاسم';
  const previewTitle = mode === 'bulk' ? bulkTitle.split(NAME_TOKEN).join(sampleName) : title;
  const previewSource = mode === 'bulk'
    ? (bulkTexts[bulkGenders[0] ?? occasion.defaultGender] ?? '').split(NAME_TOKEN).join(sampleName)
    : text;
  const previewCaption = previewSource.replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ') || 'نص التهنئة';

  const fileName = `tahniah-${occasion.id}-${Date.now()}.mp4`;
  // Sharing files from the browser is only reliable on phones; on desktop (e.g. Windows' share panel)
  // it often opens empty, so computers just get the download button
  const isPhone = typeof navigator !== 'undefined'
    && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    && 'canShare' in navigator;

  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], fileName, { type: 'video/mp4' });
    if (!navigator.canShare?.({ files: [file] })) return download();
    try {
      // Opens the phone's share sheet (WhatsApp, Instagram…) — the file goes straight from the device
      await navigator.share({ files: [file], title: title.trim() });
    } catch (err: any) {
      // Closing the sheet is fine; any real failure falls back to saving the file
      if (err?.name !== 'AbortError') download();
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const section = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3';
  const label = 'text-sm font-bold text-white flex items-center gap-2';
  const stepNo = (n: number) => (
    <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{n}</span>
  );
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
      active ? 'bg-amber-500/15 border-amber-500/70 text-amber-200' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'
    }`;
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500';

  if (batch) {
    return (
      <GreetingBatchView
        batch={batch}
        onUpdate={setBatch}
        onBalanceRefresh={refreshBalance}
        onNew={() => { setBatch(null); setMembersText(''); }}
      />
    );
  }

  if (result) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-extrabold text-white">تهنئتك جاهزة!</h2>
          <p className="text-xs text-slate-400">شاركها الآن أو حمّلها. لا نحتفظ بأي نسخة، فاحفظها قبل مغادرة الصفحة.</p>
        </div>
        <video src={result.url} controls autoPlay playsInline className="mx-auto max-h-[65vh] rounded-2xl bg-black shadow-2xl" />
        <p className={`text-center text-[11px] ${result.onDevice ? 'text-emerald-300' : 'text-slate-500'}`}>
          {result.onDevice ? `⚡ جُهّز على جهازك في ${result.seconds} ثانية` : 'جُهّز على الخادم'}
        </p>
        <div className={`grid grid-cols-1 gap-2 ${isPhone ? 'sm:grid-cols-2' : ''}`}>
          {isPhone && (
            <button type="button" onClick={share} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-extrabold text-sm">
              <Share2 className="w-5 h-5" /> شارك (واتساب وغيره)
            </button>
          )}
          <button type="button" onClick={download} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm">
            <Download className="w-5 h-5" /> تحميل الفيديو
          </button>
        </div>
        {!isPhone && (
          <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1.5">
            <Send className="w-3.5 h-3.5" /> بعد التحميل، أرسله من واتساب على جهازك كأي فيديو.
          </p>
        )}
        <div className="flex justify-center gap-3 text-xs">
          <button type="button" onClick={() => setResult(null)} className="flex items-center gap-1 text-slate-300 hover:text-amber-300">
            <RotateCcw className="w-3.5 h-3.5" /> تعديل التهنئة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl lg:max-w-none mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-extrabold text-white">تهنئة بالصوت</h2>
        <p className="text-sm text-slate-400">اختر المناسبة واكتب الاسم، ونصنع لك فيديو تهنئة بصوت طبيعي جاهزاً للواتساب والحالات.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-1.5 max-w-md mx-auto">
        {([
          { id: 'single', label: 'تهنئة لشخص', icon: User },
          { id: 'bulk', label: 'تهنئة جماعية (قائمة أسماء)', icon: Users },
        ] as const).map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMode(m.id); setError(null); }}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-colors ${
              mode === m.id ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <m.icon className="w-4 h-4" /> {m.label}
          </button>
        ))}
      </div>

      {/* 1. Occasion */}
      <div className={section}>
        <div className={label}>{stepNo(1)} المناسبة</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {OCCASIONS.map(o => {
            const Icon = o.icon;
            const active = o.id === occasion.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => chooseOccasion(o)}
                className={`rounded-2xl p-3 flex flex-col items-center gap-1.5 text-[#ffffff] text-xs font-bold transition-transform ${active ? 'ring-4 ring-amber-400 scale-[1.03]' : 'opacity-85 hover:opacity-100'}`}
                style={{ background: `linear-gradient(160deg, ${o.colors[0]}, ${o.colors[1]})` }}
              >
                <Icon className="w-7 h-7" />
                <span className="text-center leading-tight">{o.nameAr}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Who */}
      {mode === 'bulk' ? (
      <div className={section}>
        <div className={label}>{stepNo(2)} قائمة الأسماء</div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          اسم في كل سطر، ويمكن إضافة الجنس ورقم الجوال بعده مفصولين بفاصلة، مثل: «أحمد خليل، ذكر، 0599123456».
          أو انسخ الأعمدة من Excel والصقها هنا مباشرة، أو ارفع ملف CSV. بدون جنس نستخدم صيغة المذكر.
        </p>
        <textarea
          value={membersText}
          onChange={e => setMembersText(e.target.value)}
          rows={6}
          placeholder={'أحمد خليل، ذكر، 0599123456\nسارة محمود، أنثى\nعائلة أبو سامي، جمع'}
          className={`${input} font-mono leading-relaxed`}
          dir="rtl"
        />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button type="button" onClick={() => csvInput.current?.click()} className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300">
            <FileUp className="w-3.5 h-3.5" /> رفع ملف CSV
          </button>
          <input ref={csvInput} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={e => { loadCsv(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="text-xs text-slate-300">
            {members.length} اسم
            {bulkGenders.length > 0 && ` (${bulkGenders.map(g => `${GENDER_LABELS[g].split(' ')[0]}: ${members.filter(m => m.gender === g).length}`).join('، ')})`}
          </span>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-slate-300">من (اسم الجهة، يظهر أسفل كل فيديو)</span>
          <input value={from} onChange={e => setFrom(e.target.value.slice(0, 25))} placeholder="مثال: نقابة الصحفيين" className={input} />
        </label>
      </div>
      ) : (
      <div className={section}>
        <div className={label}>{stepNo(2)} لمن التهنئة؟</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-slate-300">الاسم</span>
            <input value={name} onChange={e => setName(e.target.value.slice(0, 30))} placeholder={occasion.namePlaceholder} className={input} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-300">منك أنت (اختياري، يظهر أسفل الفيديو)</span>
            <input value={from} onChange={e => setFrom(e.target.value.slice(0, 25))} placeholder="مثال: عائلة أبو خالد" className={input} />
          </label>
        </div>
        {occasion.genders.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {occasion.genders.map(g => (
              <button key={g} type="button" onClick={() => setGender(g)} className={chip(gender === g)}>{GENDER_LABELS[g]}</button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* 3. Message */}
      <div className={section}>
        <div className={label}>{stepNo(3)} نص التهنئة</div>
        <div className="flex flex-wrap gap-2">
          {occasion.templates.map(t => (
            <button key={t.id} type="button" onClick={() => chooseTemplate(t.id)} className={chip(t.id === tpl.id && !textEdited)}>{t.label}</button>
          ))}
        </div>
        {mode === 'bulk' ? (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-400">
              يُستبدل {NAME_TOKEN} باسم كل عضو. {bulkGenders.length > 1 ? 'لكل فئة نصها حتى تكون الصياغة صحيحة.' : ''}
            </p>
            {(bulkGenders.length ? bulkGenders : [occasion.defaultGender]).map(g => (
              <label key={g} className="block space-y-1">
                {bulkGenders.length > 1 && <span className="text-xs font-semibold text-amber-300">{GENDER_LABELS[g]}</span>}
                <AudioTagBar target={{ get current() { return bulkBoxes.current[g] ?? null; } }} value={bulkTexts[g] ?? ''} onChange={v => setBulkTexts(prev => ({ ...prev, [g]: v }))} />
                <textarea
                  ref={el => { bulkBoxes.current[g] = el; }}
                  value={bulkTexts[g] ?? ''}
                  onChange={e => setBulkTexts(prev => ({ ...prev, [g]: e.target.value }))}
                  rows={3}
                  className={`${input} leading-relaxed`}
                />
              </label>
            ))}
            <label className="block space-y-1">
              <span className="text-xs text-slate-300">العنوان الكبير أعلى الفيديو</span>
              <input value={bulkTitle} onChange={e => setBulkTitle(e.target.value.slice(0, 60))} className={input} />
            </label>
          </div>
        ) : (
        <>
        <AudioTagBar target={messageBox} value={text} onChange={v => { setText(v); setTextEdited(true); }} />
        <textarea
          ref={messageBox}
          value={text}
          onChange={e => { setText(e.target.value); setTextEdited(true); }}
          rows={4}
          className={`${input} leading-relaxed`}
        />
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>عدّل النص كما تحب. المدة التقريبية: {estimate.formatted}</span>
          {textEdited && (
            <button type="button" onClick={() => setTextEdited(false)} className="text-amber-400 hover:text-amber-300">استرجاع النص الجاهز</button>
          )}
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-slate-300">العنوان الكبير أعلى الفيديو (امسحه إن كان قالبك يحتوي على عنوان)</span>
          <input value={title} onChange={e => { setTitle(e.target.value.slice(0, 60)); setTitleEdited(true); }} className={input} />
        </label>
        </>
        )}
      </div>

      {/* 4. Voice */}
      <div className={section}>
        <div className={label}>{stepNo(4)} الصوت</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
          {voices.map(v => (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => setVoiceId(v.id)}
              onKeyDown={e => e.key === 'Enter' && setVoiceId(v.id)}
              className={`relative rounded-xl border p-2 flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                voiceId === v.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              {v.avatar ? <img src={v.avatar} alt="" className="w-12 h-12 rounded-full object-cover" /> : <div className="w-12 h-12 rounded-full bg-slate-800" />}
              <span className="text-xs font-bold text-white">{v.name}</span>
              {v.tags.includes('أطفال') && <span className="text-[10px] text-amber-300">صوت طفل</span>}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); togglePreview(v.id); }}
                className="absolute top-1 left-1 w-6 h-6 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center hover:bg-amber-500 hover:text-slate-950"
                aria-label={`استماع لعيّنة ${v.name}`}
              >
                {playing === v.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Look */}
      <div className={section}>
        <div className={label}>{stepNo(5)} شكل الفيديو</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => setBgMode('design')} className={`rounded-xl border p-3 text-right ${bgMode === 'design' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
            <div className="flex items-center gap-2 text-sm font-bold text-white"><Palette className="w-4 h-4 text-amber-400" /> تصميم المناسبة</div>
            <div className="mt-2 h-14 rounded-lg" style={{ background: `linear-gradient(160deg, ${occasion.colors[0]}, ${occasion.colors[1]})` }} />
          </button>
          <button
            type="button"
            onClick={() => (template ? setBgMode('template') : templateInput.current?.click())}
            className={`rounded-xl border p-3 text-right ${bgMode === 'template' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40'}`}
          >
            <div className="flex items-center gap-2 text-sm font-bold text-white"><LayoutTemplate className="w-4 h-4 text-amber-400" /> قالبك الخاص 9:16</div>
            {template
              ? <img src={template} alt="" className="mt-2 h-14 w-8 object-cover rounded" />
              : <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">ارفع تصميمك بمقاس 1080×1920. نضع عليه الموجة الصوتية والنص المكتوب.</div>}
          </button>
        </div>
        {template && (
          <button type="button" onClick={() => templateInput.current?.click()} className="text-[11px] text-amber-400 hover:text-amber-300">تغيير القالب</button>
        )}
        <input ref={templateInput} type="file" accept="image/*" hidden onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          await pickImage(file, v => { setTemplate(v); setBgMode('template'); });
        }} />

        <div className="flex items-center gap-3 pt-1">
          {photo ? (
            <div className="relative">
              <img src={photo} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-amber-400" />
              <button type="button" onClick={() => setPhoto(null)} className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center" aria-label="إزالة الصورة">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => photoInput.current?.click()} className="w-14 h-14 rounded-full border-2 border-dashed border-slate-700 text-slate-400 flex items-center justify-center hover:border-amber-500">
              <ImagePlus className="w-5 h-5" />
            </button>
          )}
          <div className="text-xs text-slate-400 leading-relaxed">
            صورة الشخص (اختياري): تظهر داخل دائرة في وسط الفيديو.
            {bgMode === 'design' && !photo && ' بدونها نضع رمز المناسبة.'}
          </div>
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            await pickImage(file, setPhoto);
          }} />
        </div>

        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="text-xs font-bold text-white">معاينة وتخصيص</div>
          <GreetingDesigner
            template={bgMode === 'template' ? template : null}
            colors={occasion.colors}
            photo={photo}
            ringColor={occasion.accent}
            defaultTitleColor={occasion.titleColor ?? '#ffffff'}
            title={previewTitle}
            captionSample={previewCaption}
            fromLine={from.trim() ? `مع المحبة، ${from.trim()}` : ''}
            box={photoBox}
            onBox={setPhotoBox}
            text={textStyle}
            onText={setTextStyle}
          />
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span>{error.text}</span>
          {error.needsCredits && (
            <button type="button" onClick={onOpenPackages} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">اشحن رصيدك</button>
          )}
        </div>
      )}

      {canOnDevice && mode === 'single' && (
        <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={onDevice} disabled={busy} onChange={e => toggleOnDevice(e.target.checked)} className="mt-0.5 accent-amber-500" />
          <span>جهّز الفيديو على جهازي <span className="text-amber-300">(تجربة)</span>
            <span className="block text-[11px] text-slate-500">لا انتظار في الدور، ويستهلك معالج جهازك. إن لم يعمل يُجهَّز على الخادم تلقائياً.</span>
          </span>
        </label>
      )}

      {busy && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-300">
            <span>{stage === 'voice' ? 'نسجّل التهنئة بالصوت…' : onDevice && canOnDevice ? 'نجهّز الفيديو على جهازك…' : 'نجهّز الفيديو…'}</span>
            {stage === 'video' && <span className="font-mono text-amber-300">{progress}%</span>}
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-amber-400 to-amber-600 transition-all duration-700"
              style={{ width: stage === 'voice' ? '25%' : `${25 + progress * 0.75}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={mode === 'bulk' ? createBulk : create}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-base disabled:opacity-60 shadow-lg"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
        {mode === 'bulk'
          ? busy ? 'جارٍ إرسال القائمة…' : `اصنع ${members.length || ''} تهنئة`
          : busy ? 'جارٍ صنع التهنئة…' : user ? 'اصنع التهنئة' : 'سجّل مجاناً واصنع التهنئة'}
      </button>
      <p className="text-[11px] text-slate-500 text-center">
        {mode === 'bulk'
          ? `سعر البطاقة ${prices.greeting} نقطة شاملة الصوت والفيديو${members.length ? `، أي حوالي ${(members.length * prices.greeting).toLocaleString('en-US')} نقطة لكل القائمة` : ''}. تُجهَّز على الخادم حتى لو أغلقت الصفحة.`
          : `سعر البطاقة ${prices.greeting} نقطة شاملة الصوت والفيديو.`}
      </p>
    </div>
  );
};
