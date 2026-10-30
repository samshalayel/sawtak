import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Download, Loader2, Mic, Square, Trash2, Upload, Wand2, X } from 'lucide-react';
import { api, card, date } from './adminShared';
import { base64ToBlobUrl } from '../utils/audio';

// Admin-only trial of voice replication: a voice avatar from reference clips, either at Google (Gemini, with a consent
// recording) or through OpenRouter's cloning models (the clip goes with every request, so a model can be swapped).

interface CustomVoice {
  id: number;
  voice_id: string;
  name: string;
  model: string;
  reference_seconds: number;
  reference_text: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  created_by_email: string | null;
  key_label: string | null;
}

interface VoicesData {
  voices: CustomVoice[];
  limit: number;
  consentStatement: string;
  minSeconds: number;
  maxSeconds: number;
  openRouter: { enabled: boolean; models: { id: string; label: string }[] };
}

const isOpenRouter = (voice: CustomVoice) => voice.voice_id.startsWith('openrouter-');

interface Clip {
  id: string;
  label: string;
  blob: Blob;
  url: string;
  seconds: number | null;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const audioDuration = (url: string) =>
  new Promise<number | null>(resolve => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      // MediaRecorder webm reports Infinity until fully scanned; treat it as unknown
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => resolve(null);
    audio.src = url;
  });

const makeClip = async (blob: Blob, label: string): Promise<Clip> => {
  const url = URL.createObjectURL(blob);
  return { id: crypto.randomUUID(), label, blob, url, seconds: await audioDuration(url) };
};

/** Microphone recorder: press to start, press again to stop. */
const RecordButton: React.FC<{ onRecorded: (blob: Blob) => void; label: string }> = ({ onRecorded, label }) => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (timer.current) window.clearInterval(timer.current);
        setRecording(false);
        onRecorded(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      setElapsed(0);
      setRecording(true);
      const startedAt = Date.now();
      timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    } catch {
      setError('تعذّر الوصول إلى المايكروفون. اسمح للمتصفح باستخدامه ثم أعد المحاولة.');
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={recording ? stop : start}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
          recording
            ? 'bg-rose-500/15 border-rose-500/50 text-rose-200 animate-pulse'
            : 'bg-slate-800 border-slate-700 text-slate-200 hover:border-amber-500/50'
        }`}
      >
        {recording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        {recording ? `إيقاف التسجيل (${elapsed} ث)` : label}
      </button>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
    </div>
  );
};

const ClipRow: React.FC<{ clip: Clip; onRemove: () => void }> = ({ clip, onRemove }) => (
  <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-2 py-1.5">
    <button type="button" onClick={onRemove} className="text-slate-500 hover:text-rose-300" title="إزالة">
      <X className="w-4 h-4" />
    </button>
    <span className="text-xs text-slate-300 truncate flex-1" title={clip.label}>{clip.label}</span>
    <span className="text-[11px] text-slate-500 whitespace-nowrap">{clip.seconds != null ? `${clip.seconds.toFixed(1)} ث` : ''}</span>
    <audio src={clip.url} controls className="h-8 w-48" />
  </div>
);

const CreateVoiceForm: React.FC<{ data: VoicesData; onCreated: () => void }> = ({ data, onCreated }) => {
  const [name, setName] = useState('');
  const [sources, setSources] = useState<Clip[]>([]);
  const [consent, setConsent] = useState<Clip | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [provider, setProvider] = useState<'openrouter' | 'google'>(data.openRouter.enabled ? 'openrouter' : 'google');
  const [model, setModel] = useState(data.openRouter.models[0]?.id ?? '');
  const viaOpenRouter = provider === 'openrouter';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);

  const totalSeconds = sources.reduce((sum, c) => sum + (c.seconds ?? 0), 0);
  const totalBytes = sources.reduce((sum, c) => sum + c.blob.size, 0) + (consent?.blob.size ?? 0);
  const full = data.voices.length >= data.limit;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const clips = await Promise.all([...files].map(f => makeClip(f, f.name)));
    setSources(prev => [...prev, ...clips].slice(0, 10));
  };

  const submit = async () => {
    setMessage(null);
    if (!name.trim()) return setMessage({ ok: false, text: 'اكتب اسماً للصوت' });
    if (sources.length === 0) return setMessage({ ok: false, text: 'أضف تسجيلاً مرجعياً واحداً على الأقل' });
    if (!consent && !viaOpenRouter) return setMessage({ ok: false, text: 'سجّل جملة الموافقة بصوت نفس الشخص' });
    if (!confirmed) return setMessage({ ok: false, text: 'أكّد أن صاحب الصوت موافق على نسخه' });
    if (totalBytes > MAX_UPLOAD_BYTES) return setMessage({ ok: false, text: 'حجم الملفات كبير، يكفي 30 ثانية من الكلام الواضح' });

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        sources: await Promise.all(sources.map(c => blobToBase64(c.blob))),
        consent: consent && !viaOpenRouter ? await blobToBase64(consent.blob) : undefined,
        provider, model,
        confirmOwnership: true,
      };
      const res = await api<{ referenceSeconds: number }>('/api/admin/custom-voices', { method: 'POST', body: JSON.stringify(body) });
      setMessage({ ok: true, text: `تم إنشاء الصوت «${name.trim()}» من ${res.referenceSeconds.toFixed(1)} ثانية من الكلام. جرّبه من القائمة.` });
      setName('');
      setSources([]);
      setConsent(null);
      setConfirmed(false);
      onCreated();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} space-y-4`}>
      <div className="flex items-center gap-2 text-white font-bold text-sm">
        <AudioLines className="w-4 h-4 text-amber-400" /> بصمة صوتية جديدة
      </div>

      <div className="text-[11px] leading-relaxed text-slate-400 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
        للحصول على أفضل شبه: سجّل في غرفة هادئة بدون موسيقى أو صدى، بكلام طبيعي متواصل بالأسلوب الذي تريده لاحقاً.
        المطلوب {data.minSeconds}–{data.maxSeconds} ثانية من الكلام الصافي (نأخذ أول {data.maxSeconds} ثانية بعد إزالة فترات الصمت).
        {viaOpenRouter
          ? 'مع OpenRouter يُرسل هذا التسجيل مع كل طلب توليد، فتستطيع تجربة نفس البصمة بأكثر من نموذج.'
          : 'سجّل جملة الموافقة بنفس المايكروفون وفي نفس المكان، لأن Google تتحقق أنها بصوت نفس الشخص.'}
      </div>

      {data.openRouter.enabled && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-300">طريقة النسخ:</span>
          {(['openrouter', 'google'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border ${provider === p ? 'bg-amber-500/15 border-amber-500/60 text-amber-200' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
            >
              {p === 'openrouter' ? 'OpenRouter (بدون جملة موافقة)' : 'Google Gemini'}
            </button>
          ))}
          {viaOpenRouter && (
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-100"
            >
              {data.openRouter.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-xs text-slate-300">اسم الصوت (يظهر في القائمة)</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          placeholder="مثال: صوت سامر"
          className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
        />
      </label>

      <div className="space-y-2">
        <div className="text-xs font-bold text-white">1. التسجيلات المرجعية</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/50"
          >
            <Upload className="w-3.5 h-3.5" /> رفع ملفات صوتية
          </button>
          <RecordButton label="تسجيل من المايكروفون" onRecorded={async blob => {
            const clip = await makeClip(blob, `تسجيل ${sources.length + 1}`);
            setSources(prev => [...prev, clip].slice(0, 10));
          }} />
          <input ref={fileInput} type="file" accept="audio/*,video/mp4,video/webm" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        {sources.length > 0 && (
          <div className="space-y-1.5">
            {sources.map(c => (
              <ClipRow key={c.id} clip={c} onRemove={() => setSources(prev => prev.filter(x => x.id !== c.id))} />
            ))}
            <div className={`text-[11px] ${totalSeconds && totalSeconds < data.minSeconds ? 'text-rose-300' : 'text-slate-500'}`}>
              المجموع تقريباً {totalSeconds.toFixed(1)} ثانية (قبل إزالة الصمت)
            </div>
          </div>
        )}
      </div>

      {!viaOpenRouter && <div className="space-y-2">
        <div className="text-xs font-bold text-white">2. جملة الموافقة (بصوت نفس الشخص)</div>
        <div className="text-base leading-loose text-amber-200 bg-amber-500/5 border border-amber-500/30 rounded-lg px-3 py-2">
          «{data.consentStatement}»
        </div>
        <div className="flex flex-wrap gap-2 items-start">
          <RecordButton label="سجّل الجملة الآن" onRecorded={async blob => setConsent(await makeClip(blob, 'تسجيل الموافقة'))} />
          <button
            type="button"
            onClick={() => consentInput.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/50"
          >
            <Upload className="w-3.5 h-3.5" /> أو ارفع ملفاً
          </button>
          <input ref={consentInput} type="file" accept="audio/*" hidden onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setConsent(await makeClip(file, file.name));
          }} />
        </div>
        {consent && <ClipRow clip={consent} onRemove={() => setConsent(null)} />}
      </div>}

      <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 accent-amber-500" />
        <span>أؤكد أن صاحب هذا الصوت شخص بالغ ووافق صراحةً على نسخ صوته واستخدامه في صوتك الذكي.</span>
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={busy || full}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {busy ? 'جارٍ إنشاء البصمة…' : 'إنشاء الصوت'}
        </button>
        {full && <span className="text-xs text-rose-300">وصلت للحد الأقصى ({data.limit} صوت). احذف صوتاً قديماً أولاً.</span>}
      </div>
      {message && (
        <div className={`text-xs leading-relaxed rounded-lg px-3 py-2 border ${message.ok ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30' : 'text-rose-200 bg-rose-500/10 border-rose-500/30'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
};

const VoiceCard: React.FC<{ voice: CustomVoice; models: VoicesData['openRouter']['models']; onDeleted: () => void }> = ({ voice, models, onDeleted }) => {
  const [model, setModel] = useState(voice.model);
  const [transcript, setTranscript] = useState(voice.reference_text ?? '');
  const [text, setText] = useState('مرحباً، هذه تجربة لصوتي المنسوخ في استوديو صوتك الذكي. كيف يبدو لكم؟');
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState<'speak' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; seconds: number; model?: string } | null>(null);

  const speak = async () => {
    setBusy('speak');
    setError(null);
    try {
      const res = await api<{ audioBase64: string; durationSeconds: number; model?: string }>(`/api/admin/custom-voices/${voice.id}/speak`, {
        method: 'POST',
        body: JSON.stringify({ text, style, model, ...(isOpenRouter(voice) ? { transcript } : {}) }),
      });
      setResult({ url: base64ToBlobUrl(res.audioBase64, 'audio/wav'), seconds: res.durationSeconds, model: res.model });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`حذف الصوت «${voice.name}» نهائياً${isOpenRouter(voice) ? '' : ' من Google ومن النظام'}؟`)) return;
    setBusy('delete');
    try {
      await api(`/api/admin/custom-voices/${voice.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  };

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-white font-bold">{voice.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {voice.reference_seconds} ث مرجع · استُخدم {voice.use_count} مرة · أُنشئ {date(voice.created_at)}
            {isOpenRouter(voice) ? ' · OpenRouter' : voice.key_label ? ` · المفتاح: ${voice.key_label}` : ' · المفتاح محذوف!'}
          </div>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-rose-300 border border-rose-500/30 hover:bg-rose-500/10 disabled:opacity-50"
        >
          {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} حذف
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="whitespace-nowrap">التسجيل الأصلي (بعد التنظيف):</span>
        <audio src={`/api/admin/custom-voices/${voice.id}/reference`} controls preload="none" className="h-8 w-56" />
      </div>

      {isOpenRouter(voice) && (
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">نص التسجيل الأصلي حرفياً (اختياري، يحسّن الشبه كثيراً مع Fish Audio؛ يُحفظ مع البصمة)</span>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={2}
            placeholder="اكتب بالضبط ما يُقال في التسجيل الأصلي أعلاه"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </label>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
      />
      <input
        value={style}
        onChange={e => setStyle(e.target.value)}
        placeholder="توجيه الأداء (اختياري)، مثال: بنبرة حماسية وسرعة متوسطة"
        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
      />
      <div className="flex items-center gap-3 flex-wrap">
        {isOpenRouter(voice) && (
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            title="جرّب نفس البصمة بنموذج آخر"
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-100"
          >
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <button
          type="button"
          onClick={speak}
          disabled={busy !== null || !text.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/50 text-amber-200 text-xs font-bold hover:bg-amber-500/25 disabled:opacity-50"
        >
          {busy === 'speak' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} ولّد بهذا الصوت
        </button>
        {result && (
          <>
            <audio src={result.url} controls autoPlay className="h-8" />
            <a
              href={result.url}
              download={`${voice.name}.wav`}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-amber-300"
            >
              <Download className="w-3.5 h-3.5" /> تحميل ({result.seconds.toFixed(1)} ث{result.model ? ` · ${models.find(m => m.id === result.model)?.label ?? result.model}` : ''})
            </a>
          </>
        )}
      </div>
      {error && <div className="text-xs text-rose-300 leading-relaxed">{error}</div>}
    </div>
  );
};

export const CustomVoicesTab: React.FC = () => {
  const [data, setData] = useState<VoicesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<VoicesData>('/api/admin/custom-voices').then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="text-sm text-rose-300">{error}</div>;
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
          نسخ بصمة صوتية (أفاتار صوتي مخصص) عبر Gemini أو OpenRouter. هذه الصفحة للتجربة وخاصة بالإدارة فقط ولا تظهر للعملاء.
          التوليد هنا لا يخصم من رصيدك لكنه يُحسب في سجل الاستهلاك والتكلفة.
        </p>
        <span className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1">
          {data.voices.length} / {data.limit} صوت في المشروع
        </span>
      </div>

      <CreateVoiceForm data={data} onCreated={load} />

      {data.voices.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-bold text-white">الأصوات المنسوخة</div>
          {data.voices.map(v => <VoiceCard key={v.id} voice={v} models={data.openRouter.models} onDeleted={load} />)}
        </div>
      )}
    </div>
  );
};
