import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { api, card, usd } from './adminShared';
import { AddToGalleryButton } from './GalleryShare';

interface ImageModel {
  id: string;
  name: string;
  editsImages: boolean;
  aspectRatios: string[];
  resolutions: string[];
  inputPerM: number | null;
  outputPerM: number | null;
  imageInputUsd: number | null;
  lastCostUsd: number | null;
}

interface Job {
  id: string;
  model: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  edit: boolean;
  createdAt: string;
  status: 'working' | 'completed' | 'failed';
  error?: string;
  note?: string;
  costUsd?: number;
  files: number;
}

const IDEAS = [
  'خلفية لبطاقة تهنئة بعيد ميلاد، بالونات ذهبية وأضواء ناعمة، مساحة فارغة في المنتصف للكتابة، بدون نصوص',
  'مسجد عند الغروب بإضاءة دافئة، سماء برتقالية وبنفسجية، أسلوب سينمائي واقعي، بدون أشخاص',
  'ميكروفون استوديو احترافي على خلفية داكنة مع موجات صوتية مضيئة، صورة إعلانية عالية الجودة',
];

/** A token price per million, without needless zeros. */
const perM = (n: number | null) => (n === null ? '?' : `$${+n.toFixed(2)}`);

/** What a model costs: the real average per picture once one was made, otherwise its token prices. */
const priceOf = (m: ImageModel) =>
  m.lastCostUsd !== null ? `≈ ${usd(m.lastCostUsd)} للصورة` : `الصورة ${perM(m.outputPerM)} لكل مليون توكن`;

/** AI pictures from OpenRouter (admin only): pick a model with its price, describe the picture, keep what is made. */
export const AiImageTab: React.FC = () => {
  const [models, setModels] = useState<ImageModel[] | null>(null);
  const [library, setLibrary] = useState<Job[]>([]);
  const [spent, setSpent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [modelId, setModelId] = useState('');
  const [aspect, setAspect] = useState('');
  const [resolution, setResolution] = useState('');
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Job | null>(null);

  const model = useMemo(() => models?.find(m => m.id === modelId) ?? null, [models, modelId]);

  const loadLibrary = useCallback(() => {
    api<{ jobs: Job[]; spentUsd: number }>('/api/admin/ai-image/library').then(d => { setLibrary(d.jobs); setSpent(d.spentUsd); }).catch(() => {});
  }, []);
  const loadModels = useCallback(() => {
    api<{ models: ImageModel[] }>('/api/admin/ai-image/models')
      .then(d => {
        setModels(d.models);
        setModelId(prev => prev || d.models[0]?.id || '');
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => { loadModels(); loadLibrary(); }, [loadModels, loadLibrary]);
  // A new model: square when it can, its lowest resolution (the cheapest)
  useEffect(() => {
    if (!model) return;
    if (!model.editsImages) setImage(null);
    setAspect(prev => (model.aspectRatios.includes(prev) ? prev : model.aspectRatios.includes('1:1') ? '1:1' : model.aspectRatios[0] ?? ''));
    setResolution(prev => (model.resolutions.includes(prev) ? prev : model.resolutions[0] ?? ''));
  }, [model]);

  // Follow the picture being made until it is finished
  useEffect(() => {
    if (!active || active.status !== 'working') return;
    const timer = setInterval(() => {
      api<{ job: Job }>(`/api/admin/ai-image/jobs/${active.id}`).then(d => {
        setActive(d.job);
        if (d.job.status !== 'working') { loadLibrary(); loadModels(); }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [active, loadLibrary, loadModels]);

  const pickImage = (file: File | undefined) => {
    if (!file) return setImage(null);
    if (file.size > 3 * 1024 * 1024) return setError('الصورة أكبر من 3 ميغابايت');
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ job: Job }>('/api/admin/ai-image/generate', {
        method: 'POST',
        body: JSON.stringify({ model: model.id, prompt, aspectRatio: aspect, resolution, imageDataUrl: image ?? undefined }),
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
    if (!window.confirm('حذف هذه الصورة نهائياً؟')) return;
    await api(`/api/admin/ai-image/jobs/${id}`, { method: 'DELETE' }).catch(e => setError(e.message));
    if (active?.id === id) setActive(null);
    loadLibrary();
  };

  const field = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'text-xs font-semibold text-slate-300';
  const file = (j: Job, i: number) => `/api/admin/ai-image/jobs/${j.id}/file/${i}`;

  if (!models && !error) return <div className={card}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className={`${card} text-xs text-slate-400 leading-relaxed`}>
        صور بالذكاء الاصطناعي عبر OpenRouter، <b className="text-slate-200">لك أنت فقط</b>. كل صورة يُصرف ثمنها من رصيد OpenRouter وتُحفظ في المكتبة أدناه.
        نماذج الصور تُسعَّر بالتوكنز، فيظهر جنب كل نموذج سعر توكناته، وبعد أول صورة منه يظهر ما كلّفته الصورة فعلاً.
        {spent > 0 && <span className="block mt-1 text-slate-300">إجمالي ما صُرف على الصور: <b className="font-mono" dir="ltr">{usd(spent)}</b></span>}
      </div>

      {error && <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error}</div>}

      {model && (
        <div className={`${card} space-y-3`}>
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
            <label className="block">
              <span className={label}>النموذج (السعر جنبه)</span>
              <select value={modelId} onChange={e => setModelId(e.target.value)} className={field}>
                {models!.map(m => <option key={m.id} value={m.id}>{m.name} — {priceOf(m)}{m.editsImages ? ' · يعدّل صور' : ''}</option>)}
              </select>
            </label>
            {model.aspectRatios.length > 0 && (
              <label className="block">
                <span className={label}>الأبعاد</span>
                <select value={aspect} onChange={e => setAspect(e.target.value)} className={field}>
                  {model.aspectRatios.map(a => <option key={a} value={a}>{a === '9:16' ? '9:16 (ستوري)' : a}</option>)}
                </select>
              </label>
            )}
            {model.resolutions.length > 0 && (
              <label className="block">
                <span className={label}>الدقة (الأعلى أغلى)</span>
                <select value={resolution} onChange={e => setResolution(e.target.value)} className={field}>
                  {model.resolutions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            )}
          </div>

          <label className="block">
            <span className={label}>{image ? 'ماذا تريد أن تغيّر في الصورة؟' : 'وصف الصورة'}</span>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value.slice(0, 4000))} rows={3} placeholder="صف الصورة: الموضوع والأسلوب والإضاءة والألوان…" className={field} />
            <span className="mt-1 flex flex-wrap gap-1.5">
              {IDEAS.map((idea, i) => (
                <button key={i} type="button" onClick={() => setPrompt(idea)} className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white">فكرة {i + 1}</button>
              ))}
            </span>
          </label>

          {model.editsImages && (
            <label className="block">
              <span className={label}>صورة للتعديل (اختياري)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pickImage(e.target.files?.[0])} className="mt-1 block text-xs text-slate-300" />
              {image && <img src={image} alt="" className="mt-2 h-20 rounded-lg border border-slate-700" />}
            </label>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={generate}
              disabled={busy || prompt.trim().length < 3 || active?.status === 'working'}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              ولّد الصورة
            </button>
            <span className="text-xs text-slate-400">{model.lastCostUsd !== null ? `آخر صور هذا النموذج كلّفت ${usd(model.lastCostUsd)} للصورة تقريباً` : 'السعر الفعلي يظهر بعد أول صورة'}</span>
          </div>
        </div>
      )}

      {active && (
        <div className={`${card} space-y-2`}>
          <div className="flex items-center gap-2 text-sm text-slate-200">
            {active.status === 'working' && <Loader2 className="w-4 h-4 animate-spin text-amber-300" />}
            <span>{active.status === 'working' ? 'تُولَّد الصورة الآن…' : active.status === 'completed' ? 'جاهزة' : 'فشل التوليد'}</span>
            <span className="text-xs text-slate-500" dir="ltr">{active.modelName} · {active.aspectRatio}{active.resolution ? ` · ${active.resolution}` : ''}{active.costUsd ? ` · ${usd(active.costUsd)}` : ''}</span>
          </div>
          {active.error && <div className="text-xs text-rose-300">{active.error}</div>}
          {active.status === 'completed' && (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: active.files }, (_, i) => <img key={i} src={file(active, i)} alt="" className="max-h-[60vh] rounded-xl bg-black" />)}
            </div>
          )}
          {active.note && <div className="text-xs text-slate-400">{active.note}</div>}
        </div>
      )}

      <div className={`${card} space-y-3`}>
        <div className="text-sm font-bold text-white">مكتبة الصور ({library.filter(j => j.status === 'completed').length})</div>
        {library.length === 0 && <div className="text-xs text-slate-400">ما في صور بعد.</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {library.map(j => (
            <div key={j.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1.5">
              {j.status === 'completed' && j.files > 0 ? (
                <a href={file(j, 0)} target="_blank" rel="noreferrer"><img src={file(j, 0)} alt="" loading="lazy" className="w-full rounded-lg bg-black aspect-square object-cover" /></a>
              ) : (
                <button type="button" onClick={() => setActive(j)} className="w-full aspect-square rounded-lg bg-slate-900 text-xs text-slate-400 flex items-center justify-center text-center px-2">
                  {j.status === 'working' ? 'قيد التوليد…' : `فشل${j.error ? ` — ${j.error}` : ''}`}
                </button>
              )}
              <div className="text-[11px] text-slate-300 line-clamp-2">{j.prompt}</div>
              <div className="text-[10px] text-slate-500" dir="ltr">{j.modelName} · {j.aspectRatio}{j.resolution ? ` · ${j.resolution}` : ''}{j.costUsd ? ` · ${usd(j.costUsd)}` : ''}{j.edit ? ' · edit' : ''}</div>
              <div className="flex gap-3 text-[11px]">
                {j.files > 0 && <a href={`${file(j, 0)}?download=1`} className="flex items-center gap-1 text-slate-300 hover:text-amber-300"><Download className="w-3 h-3" /> تحميل</a>}
                {j.files > 0 && <AddToGalleryButton kind="image" source="ai-image" itemRef={j.id} defaultTitle={j.prompt} compact />}
                <button type="button" onClick={() => remove(j.id)} className="flex items-center gap-1 text-slate-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /> حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
