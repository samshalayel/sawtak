import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Film, Loader2, Trash2 } from 'lucide-react';
import { api, card, usd } from './adminShared';
import { AddToGalleryButton } from './GalleryShare';

interface VideoModel {
  id: string;
  name: string;
  resolutions: string[];
  aspectRatios: string[];
  durations: number[];
  audio: boolean;
  firstFrame: boolean;
  needsImage: boolean;
  prices: Record<string, { silent: number | null; sound: number | null }>;
  imageUsd: number;
}

interface Job {
  id: string;
  model: string;
  modelName: string;
  prompt: string;
  resolution: string;
  aspectRatio: string;
  duration: number;
  sound: boolean;
  image: boolean;
  estimateUsd: number;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  error?: string;
  costUsd?: number;
  file?: boolean;
}

const STATUS: Record<Job['status'], string> = {
  pending: 'بانتظار الدور عند OpenRouter…', in_progress: 'يُولَّد المقطع الآن…', completed: 'جاهز', failed: 'فشل التوليد', cancelled: 'أُلغي', expired: 'انتهت صلاحيته',
};
const done = (j: Job) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled' || j.status === 'expired';
const IDEAS = [
  'غابة هادئة عند الفجر، ضباب خفيف بين الأشجار، أشعة الشمس تتسلل، كاميرا ثابتة بحركة بطيئة جداً، بدون أشخاص',
  'أمواج بحر هادئة عند الغروب، سماء برتقالية، حركة بطيئة وسلسة، بدون أشخاص',
  'سماء ليلية صافية مليئة بالنجوم فوق جبال، سحب خفيفة تمرّ ببطء، بدون أشخاص',
];

/** A price per second without needless zeros: $0.03, $0.036. */
const perSec = (n: number) => `$${+n.toFixed(4)}`;

/** The cheapest per-second price of a model, shown beside its name. */
const fromPrice = (m: VideoModel) => {
  const cheapest = Math.min(Infinity, ...Object.values(m.prices).map(p => p.silent ?? Infinity));
  return Number.isFinite(cheapest) ? `من ${perSec(cheapest)}/ث` : 'بالتوكنز';
};

/** AI video clips from OpenRouter (admin only): pick a model with its price, describe the scene, keep what is made. */
export const AiVideoTab: React.FC = () => {
  const [models, setModels] = useState<VideoModel[] | null>(null);
  const [library, setLibrary] = useState<Job[]>([]);
  const [spent, setSpent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [modelId, setModelId] = useState('');
  const [resolution, setResolution] = useState('');
  const [aspect, setAspect] = useState('');
  const [duration, setDuration] = useState(0);
  const [sound, setSound] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Job | null>(null);

  const model = useMemo(() => models?.find(m => m.id === modelId) ?? null, [models, modelId]);

  const loadLibrary = useCallback(() => {
    api<{ jobs: Job[]; spentUsd: number }>('/api/admin/ai-video/library').then(d => { setLibrary(d.jobs); setSpent(d.spentUsd); }).catch(() => {});
  }, []);

  useEffect(() => {
    api<{ models: VideoModel[] }>('/api/admin/ai-video/models')
      .then(d => {
        setModels(d.models);
        // Start from the cheapest model that is priced per second
        const first = d.models.find(m => Number.isFinite(Math.min(...Object.values(m.prices).map(p => p.silent ?? Infinity)))) ?? d.models[0];
        if (first) setModelId(first.id);
      })
      .catch(e => setError(e.message));
    loadLibrary();
  }, [loadLibrary]);

  // Settings to bring back with the model ("try again" on a clip): applied instead of the model's defaults
  const retrying = useRef<Job | null>(null);

  // A new model: its own lowest resolution, vertical when possible, and a short clip
  useEffect(() => {
    if (!model) return;
    const back = retrying.current?.model === model.id ? retrying.current : null;
    retrying.current = null;
    setResolution(back && model.resolutions.includes(back.resolution) ? back.resolution : model.resolutions[0]);
    setAspect(back && model.aspectRatios.includes(back.aspectRatio) ? back.aspectRatio : model.aspectRatios.includes('9:16') ? '9:16' : model.aspectRatios[0]);
    setDuration(back && model.durations.includes(back.duration) ? back.duration : model.durations.find(d => d >= 5) ?? model.durations[0]);
    setSound(Boolean(back?.sound && model.audio));
    if (!model.firstFrame) setImage(null);
  }, [model]);

  /** The form filled with a clip's settings, to change the words and ask again. */
  const retry = (j: Job) => {
    if (!models?.some(m => m.id === j.model)) return setError('النموذج لم يعد في القائمة');
    retrying.current = j;
    setPrompt(j.prompt);
    if (j.model === modelId) {
      // Same model: the effect will not run again, so apply here
      const m = model!;
      setResolution(m.resolutions.includes(j.resolution) ? j.resolution : m.resolutions[0]);
      setAspect(m.aspectRatios.includes(j.aspectRatio) ? j.aspectRatio : m.aspectRatios[0]);
      setDuration(m.durations.includes(j.duration) ? j.duration : m.durations[0]);
      setSound(Boolean(j.sound && m.audio));
      retrying.current = null;
    } else setModelId(j.model);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Follow the clip being made until it is finished
  useEffect(() => {
    if (!active || done(active)) return;
    const timer = setInterval(() => {
      api<{ job: Job }>(`/api/admin/ai-video/jobs/${active.id}`).then(d => {
        setActive(d.job);
        if (done(d.job)) loadLibrary();
      }).catch(() => {});
    }, 6000);
    return () => clearInterval(timer);
  }, [active, loadLibrary]);

  const rate = model && resolution ? model.prices[resolution]?.[sound ? 'sound' : 'silent'] ?? null : null;
  const estimate = rate === null || !model ? null : rate * duration + (image ? model.imageUsd : 0);

  const pickImage = (file: File | undefined) => {
    if (!file) return setImage(null);
    if (file.size > 3 * 1024 * 1024) return setError('الصورة أكبر من 3 ميغابايت');
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!model || estimate === null) return;
    if (!window.confirm(`سيُصرف حوالي ${usd(estimate)} من رصيد OpenRouter. المتابعة؟`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ job: Job }>('/api/admin/ai-video/generate', {
        method: 'POST',
        body: JSON.stringify({ model: model.id, prompt, resolution, aspectRatio: aspect, duration, sound, imageDataUrl: image ?? undefined }),
      });
      setActive(d.job);
      loadLibrary();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('حذف هذا المقطع نهائياً؟')) return;
    await api(`/api/admin/ai-video/jobs/${id}`, { method: 'DELETE' }).catch(e => setError(e.message));
    if (active?.id === id) setActive(null);
    loadLibrary();
  };

  const field = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'text-xs font-semibold text-slate-300';

  if (!models && !error) return <div className={card}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className={`${card} text-xs text-slate-400 leading-relaxed`}>
        مقاطع فيديو بالذكاء الاصطناعي عبر OpenRouter، <b className="text-slate-200">لك أنت فقط</b>. كل مقطع يُصرف ثمنه من رصيد OpenRouter ويُحفظ في المكتبة أدناه لإعادة استخدامه كمشهد.
        الأسعار بالدولار للثانية من قائمة OpenRouter. يستغرق التوليد من 30 ثانية إلى بضع دقائق.
        {spent > 0 && <span className="block mt-1 text-slate-300">إجمالي ما صُرف على المقاطع المحفوظة: <b className="font-mono" dir="ltr">{usd(spent)}</b></span>}
      </div>

      {error && <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error}</div>}

      {model && (
        <div className={`${card} space-y-3`}>
          <label className="block">
            <span className={label}>النموذج (السعر جنبه)</span>
            <select value={modelId} onChange={e => setModelId(e.target.value)} className={field}>
              {models!.map(m => (
                <option key={m.id} value={m.id} disabled={!Number.isFinite(Math.min(...Object.values(m.prices).map(p => p.silent ?? Infinity)))}>
                  {m.name} — {fromPrice(m)}{m.needsImage ? ' · من صورة فقط' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="block">
              <span className={label}>الدقة</span>
              <select value={resolution} onChange={e => setResolution(e.target.value)} className={field}>
                {model.resolutions.map(r => {
                  const p = model.prices[r]?.[sound ? 'sound' : 'silent'];
                  return <option key={r} value={r}>{r}{p != null ? ` — ${perSec(p)}/ث` : ''}</option>;
                })}
              </select>
            </label>
            <label className="block">
              <span className={label}>الأبعاد</span>
              <select value={aspect} onChange={e => setAspect(e.target.value)} className={field}>
                {model.aspectRatios.map(a => <option key={a} value={a}>{a === '9:16' ? '9:16 (ريلز)' : a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label}>المدة</span>
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} className={field}>
                {model.durations.map(d => <option key={d} value={d}>{d} ثانية</option>)}
              </select>
            </label>
            {model.audio && (
              <label className="flex items-center gap-2 mt-6 text-xs text-slate-300">
                <input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} className="accent-amber-500" />
                مع صوت (أغلى)
              </label>
            )}
          </div>

          <label className="block">
            <span className={label}>وصف المشهد</span>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value.slice(0, 2000))} rows={3} placeholder="صف المشهد: المكان والإضاءة وحركة الكاميرا…" className={field} />
            <span className="mt-1 flex flex-wrap gap-1.5">
              {IDEAS.map((idea, i) => (
                <button key={i} type="button" onClick={() => setPrompt(idea)} className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white">فكرة {i + 1}</button>
              ))}
            </span>
          </label>

          {model.firstFrame && (
            <label className="block">
              <span className={label}>{model.needsImage ? 'صورة البداية (مطلوبة: هذا النموذج يحرّك صورة فقط)' : 'صورة البداية (اختياري، لتحريك صورة)'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pickImage(e.target.files?.[0])} className="mt-1 block text-xs text-slate-300" />
              {image && <img src={image} alt="" className="mt-2 h-20 rounded-lg border border-slate-700" />}
            </label>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={generate}
              disabled={busy || estimate === null || prompt.trim().length < 5 || (model.needsImage && !image) || Boolean(active && !done(active))}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
              ولّد المقطع
            </button>
            <span className="text-sm text-slate-200">
              {estimate === null
                ? 'السعر غير متاح لهذه الخيارات'
                : <>التكلفة المقدّرة: <b className="font-mono text-amber-300" dir="ltr">{usd(estimate)}</b> <span className="text-xs text-slate-400" dir="ltr">({duration}s × {perSec(rate!)}/s)</span></>}
            </span>
          </div>
        </div>
      )}

      {active && (
        <div className={`${card} space-y-2`}>
          <div className="flex items-center gap-2 text-sm text-slate-200">
            {!done(active) && <Loader2 className="w-4 h-4 animate-spin text-amber-300" />}
            <span>{STATUS[active.status]}</span>
            <span className="text-xs text-slate-500">{active.modelName} · {active.resolution} · {active.duration}ث</span>
          </div>
          {active.error && <div className="text-xs text-rose-300">{active.error}</div>}
          {active.status === 'completed' && active.file && (
            <video src={`/api/admin/ai-video/jobs/${active.id}/file`} controls autoPlay muted loop playsInline className="max-h-[60vh] rounded-xl bg-black" />
          )}
        </div>
      )}

      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-white">مكتبة المقاطع ({library.filter(j => j.status === 'completed').length})</div>
        {library.length === 0 && <div className="text-xs text-slate-400">ما في مقاطع بعد.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {library.map(j => (
            <div key={j.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1.5">
              {j.status === 'completed' && j.file ? (
                <video src={`/api/admin/ai-video/jobs/${j.id}/file`} controls muted loop playsInline preload="metadata" className="w-full rounded-lg bg-black aspect-[9/16] object-cover" />
              ) : (
                <button type="button" onClick={() => setActive(j)} className="w-full aspect-[9/16] rounded-lg bg-slate-900 text-xs text-slate-400 flex items-center justify-center text-center px-2">
                  {STATUS[j.status]}{j.error ? ` — ${j.error}` : ''}
                </button>
              )}
              <div className="text-[11px] text-slate-300 line-clamp-2">{j.prompt}</div>
              <div className="text-[10px] text-slate-500" dir="ltr">{j.modelName} · {j.resolution} · {j.duration}s · {usd(j.costUsd ?? j.estimateUsd)}</div>
              <div className="flex gap-3 text-[11px]">
                {j.file && <a href={`/api/admin/ai-video/jobs/${j.id}/file?download=1`} className="flex items-center gap-1 text-slate-300 hover:text-amber-300"><Download className="w-3 h-3" /> تحميل</a>}
                {j.file && <AddToGalleryButton kind="video" source="ai-video" itemRef={j.id} defaultTitle={j.prompt} compact />}
                {j.status !== 'completed' && done(j) && <button type="button" onClick={() => retry(j)} className="text-amber-300 hover:text-amber-200">أعد المحاولة</button>}
                <button type="button" onClick={() => remove(j.id)} className="flex items-center gap-1 text-slate-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /> حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
