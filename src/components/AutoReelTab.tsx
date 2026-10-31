import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Play, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { api, card, usd } from './adminShared';

interface VideoOption { id: string; name: string; durations: number[]; firstFrame: boolean; resolutions: string[]; prices: Record<string, number | null> }
interface Options {
  maxUsd: number;
  pictureGuessUsd: number;
  voices: { id: string; name: string; gender: string }[];
  customVoices: { id: string; name: string }[];
  dialects: { id: string; label: string }[];
  videoModels: VideoOption[];
  imageModels: { id: string; name: string; vertical: boolean; outputPerM: number | null }[];
}

interface Scene {
  narration: string;
  imagePrompt: string;
  motionPrompt: string;
  seconds?: number;
  clipSeconds?: number;
  still?: boolean;
  videoId?: string;
  imageCostUsd?: number;
  clipCostUsd?: number;
  error?: string;
}
type Stage = 'planning' | 'voice' | 'images' | 'clips' | 'assembling' | 'done' | 'failed';
interface Reel {
  id: string;
  createdAt: string;
  idea: string;
  videoModelName: string;
  resolution: string;
  targetSeconds: number;
  sceneCount: number;
  estimateUsd: number;
  spentUsd: number;
  stage: Stage;
  error?: string;
  title?: string;
  visualStyle?: string;
  delivery?: string;
  scenes: Scene[];
  duration?: number;
}

const STAGES: { id: Stage; label: string }[] = [
  { id: 'planning', label: 'كتابة الخطة' },
  { id: 'voice', label: 'الصوت' },
  { id: 'images', label: 'الصور' },
  { id: 'clips', label: 'المقاطع' },
  { id: 'assembling', label: 'الدمج' },
  { id: 'done', label: 'جاهز' },
];
const working = (r: Reel) => r.stage !== 'done' && r.stage !== 'failed';

/** Same rule as the server: scenes are planned around the longest clip of up to 10 seconds. */
const baseClip = (durations: number[]) => [...durations].sort((a, b) => a - b).filter(d => d <= 10).pop() ?? Math.min(...durations);

const IDEAS = [
  'ريل تحفيزي عن الاستيقاظ باكراً وبداية يوم جديد بطاقة وهدوء',
  'قصة قصيرة مؤثرة عن أم تنتظر ابنها المسافر، تنتهي بلقاء في المطار',
  'ريل عن جمال فلسطين: الزيتون، البحر، الأسواق القديمة، وغروب الشمس',
];

interface AvatarTest {
  id: string;
  createdAt: string;
  text: string;
  model: string;
  modelName: string;
  prompt: string;
  editPrompt?: string;
  status: 'working' | 'completed' | 'failed';
  stage?: string;
  attempts: { shape: string; result: string }[];
  seconds?: number;
  duration?: number;
  estimateUsd?: number;
  costUsd?: number;
  error?: string;
}
interface PresenterModel { id: string; name: string; durations: number[] | null; usdPerSecond: number | null; audio?: boolean }

const EDIT_IDEAS = [
  'wearing a black tailored suit and white shirt, standing in a modern TV studio with soft lights',
  'wearing a casual beige sweater, sitting on a sofa in a cozy living room, warm daylight',
  'wearing a white doctor coat, standing in a bright clinic, holding a tablet',
];

/** Trial of a talking presenter: a photo (optionally redrawn first) and one sentence, lip-synced by the chosen model. */
const AvatarTrial: React.FC<{ voices: Options['voices']; customVoices: Options['customVoices'] }> = ({ voices, customVoices }) => {
  const [models, setModels] = useState<PresenterModel[]>([]);
  const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState('heygen/avatar-iv');
  const [photo, setPhoto] = useState<string | null>(null);
  const [text, setText] = useState('أهلاً بكم، اليوم رح نشرح لكم فكرة بسيطة بدقيقة وحدة.');
  const [voice, setVoice] = useState(customVoices[0]?.id ?? voices[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [tests, setTests] = useState<AvatarTest[]>([]);
  const [active, setActive] = useState<AvatarTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(() => {
    api<{ models: PresenterModel[]; imageModels: { id: string; name: string }[]; defaultPrompt: string }>('/api/admin/auto-reel/avatar-models/all')
      .then(d => {
        setModels(d.models);
        setImageModels(d.imageModels);
        setPrompt(prev => prev || d.defaultPrompt);
        setImageModel(prev => prev || (d.imageModels.find(m => /gemini.*image|nano/i.test(m.id + m.name))?.id ?? d.imageModels[0]?.id ?? ''));
      })
      .catch(e => setError(e.message));
  }, []);
  const loadTests = useCallback(() => {
    api<{ tests: AvatarTest[] }>('/api/admin/auto-reel/avatar-tests/all').then(d => setTests(d.tests)).catch(() => {});
  }, []);
  useEffect(() => { loadModels(); loadTests(); }, [loadModels, loadTests]);

  useEffect(() => {
    if (!active || active.status !== 'working') return;
    const timer = setInterval(() => {
      api<{ test: AvatarTest }>(`/api/admin/auto-reel/avatar-test/${active.id}`).then(d => {
        setActive(d.test);
        // A finished trial teaches whether the model takes a voice: the list shows it
        if (d.test.status !== 'working') { loadTests(); loadModels(); }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [active, loadTests, loadModels]);

  // Sent as a JPEG of at most 1080 px on its longer side: enough for the avatar, and small enough to upload
  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return setPhoto(null);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setPhoto(canvas.toDataURL('image/jpeg', 0.9));
    } catch {
      setError('تعذّرت قراءة الصورة');
    }
  };

  const chosen = models.find(m => m.id === model);
  const start = async () => {
    const price = chosen?.usdPerSecond != null ? ` (حوالي $${+chosen.usdPerSecond.toFixed(3)} للثانية)` : '';
    if (!window.confirm(`تجربة بنموذج ${chosen?.name ?? model}${price}${editPrompt.trim() ? ' مع تعديل الصورة أولاً' : ''}. نبدأ؟`)) return;
    setError(null);
    try {
      const d = await api<{ test: AvatarTest }>('/api/admin/auto-reel/avatar-test', {
        method: 'POST',
        body: JSON.stringify({ imageDataUrl: photo, text, voice, model, prompt, editPrompt: editPrompt.trim() || undefined, imageModel }),
      });
      setActive(d.test);
      loadTests();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('حذف هذه التجربة؟')) return;
    await api(`/api/admin/auto-reel/avatar-test/${id}`, { method: 'DELETE' }).catch(e => setError(e.message));
    if (active?.id === id) setActive(null);
    loadTests();
  };

  const field = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'text-xs font-semibold text-slate-300';
  const file = (t: AvatarTest, name: string) => `/api/admin/auto-reel/avatar-test/${t.id}/${name}`;
  return (
    <div className={`${card} space-y-3`}>
      <div className="text-sm font-bold text-white">تجربة المقدّم المتحدث</div>
      <div className="text-[11px] text-slate-400">
        صورة شخص (بموافقته)، تُعدَّل أولاً إن أردت (اللبس، الوقفة، المكان) ثم يحرّكها النموذج الذي تختاره ويُنطقها بالصوت. النموذج الذي لا يقبل صوتاً يرفض الطلب بدون تكلفة.
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-2">
        <label className="block">
          <span className={label}>نموذج الفيديو (سعر الثانية)</span>
          <select value={model} onChange={e => setModel(e.target.value)} className={field}>
            {models.map(m => (
              <option key={m.id} value={m.id} disabled={m.audio === false}>
                {m.audio === true ? '✓ ' : ''}{m.name}{m.usdPerSecond != null ? ` — $${+m.usdPerSecond.toFixed(3)}/ث` : ''}{m.durations ? '' : ' · بطول الصوت'}{m.audio === false ? ' · لا يقبل صوت' : m.audio === true ? ' · يقبل صوت' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>الصوت</span>
          <select value={voice} onChange={e => setVoice(e.target.value)} className={field}>
            {customVoices.length > 0 && (
              <optgroup label="أصواتي (البصمة الصوتية)">
                {customVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
            <optgroup label="أصوات الاستوديو">
              {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={label}>ما يقوله (قصير)</span>
        <input value={text} onChange={e => setText(e.target.value.slice(0, 300))} className={field} />
      </label>

      <label className="block">
        <span className={label}>الحركة والمشهد (بالإنجليزي أفضل)</span>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value.slice(0, 1500))} rows={2} className={field} dir="ltr" />
      </label>

      <div className="space-y-1">
        <span className={label}>الصورة</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => pick(e.target.files?.[0])} className="block text-xs text-slate-300" />
        {photo && <img src={photo} alt="" className="h-28 rounded-lg border border-slate-700" />}
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-2">
        <label className="block">
          <span className={label}>تعديل الصورة قبل التحريك (اختياري): اللبس، الوقفة، المكان</span>
          <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value.slice(0, 600))} rows={2} placeholder="wearing a black suit, standing in a TV studio…" className={field} dir="ltr" />
          <span className="mt-1 flex flex-wrap gap-1.5">
            {EDIT_IDEAS.map((idea, i) => (
              <button key={i} type="button" onClick={() => setEditPrompt(idea)} className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white">
                {['بدلة واستوديو', 'كاجوال بالبيت', 'طبيب'][i]}
              </button>
            ))}
          </span>
        </label>
        {editPrompt.trim() && (
          <label className="block">
            <span className={label}>نموذج تعديل الصورة</span>
            <select value={imageModel} onChange={e => setImageModel(e.target.value)} className={field}>
              {imageModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={start}
        disabled={!photo || text.trim().length < 5 || active?.status === 'working'}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
      >
        {active?.status === 'working' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} جرّب المقدّم
      </button>
      {error && <div className="text-xs text-rose-300">{error}</div>}

      {active && (
        <div className="space-y-2 bg-slate-950/50 border border-slate-800 rounded-xl p-3">
          <div className="text-xs text-slate-300">
            {active.status === 'working' ? `قيد العمل: ${active.stage ?? '…'}` : active.status === 'completed' ? 'جاهز' : 'فشل'}
            {' · '}{active.modelName}{active.seconds ? ` · ${active.seconds} ث` : ''}{active.costUsd ? ` · ${usd(active.costUsd)}` : ''}
          </div>
          {active.error && <div className="text-xs text-rose-300">{active.error}</div>}
          {active.status === 'completed' && <video src={file(active, 'video.mp4')} controls autoPlay playsInline className="max-h-[60vh] rounded-xl bg-black" />}
          {active.attempts.length > 0 && (
            <div className="text-[11px] text-slate-400 space-y-1" dir="ltr">
              {active.attempts.map((a, i) => <div key={i}><b className="text-slate-300">{a.shape}</b> → {a.result}</div>)}
            </div>
          )}
        </div>
      )}

      {tests.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-white">التجارب السابقة (للمقارنة)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {tests.map(t => (
              <div key={t.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1">
                {t.status === 'completed' ? (
                  <video src={file(t, 'video.mp4')} controls playsInline preload="none" poster={file(t, 'photo.jpg')} className="w-full rounded-lg bg-black aspect-[9/16] object-cover" />
                ) : (
                  <button type="button" onClick={() => setActive(t)} className="w-full aspect-[9/16] rounded-lg bg-slate-900 text-[11px] text-slate-400 px-2">
                    {t.status === 'working' ? 'قيد العمل…' : `فشل: ${t.error ?? ''}`}
                  </button>
                )}
                <div className="text-[11px] text-slate-200">{t.modelName}{t.costUsd ? ` · ${usd(t.costUsd)}` : ''}</div>
                <div className="text-[10px] text-slate-500 line-clamp-2" dir="ltr">{t.editPrompt ? `[${t.editPrompt}] ` : ''}{t.prompt}</div>
                <button type="button" onClick={() => remove(t.id)} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-300"><Trash2 className="w-3 h-3" /> حذف</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** Automatic reels (admin trial): one idea → a plan, voice, pictures and clips by AI → one video of about a minute. */
export const AutoReelTab: React.FC = () => {
  const [options, setOptions] = useState<Options | null>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [idea, setIdea] = useState('');
  const [dialect, setDialect] = useState('msa');
  const [voice, setVoice] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [imageModel, setImageModel] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [resolution, setResolution] = useState('');
  const [videoScenes, setVideoScenes] = useState<number | 'all'>('all');
  const [busy, setBusy] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ reel: Reel; files: string[] } | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const openCard = useRef<HTMLDivElement>(null);

  const video = useMemo(() => options?.videoModels.find(m => m.id === videoModel) ?? null, [options, videoModel]);

  const loadReels = useCallback(() => {
    api<{ reels: Reel[] }>('/api/admin/auto-reel').then(d => setReels(d.reels)).catch(() => {});
  }, []);

  useEffect(() => {
    api<Options>('/api/admin/auto-reel/options')
      .then(d => {
        setOptions(d);
        setVoice(d.voices[0]?.id ?? '');
        // Cheapest vertical picture model, and the cheapest clip model that starts from a picture
        const pic = [...d.imageModels].filter(m => m.vertical).sort((a, b) => (a.outputPerM ?? Infinity) - (b.outputPerM ?? Infinity))[0] ?? d.imageModels[0];
        setImageModel(pic?.id ?? '');
        const cheapest = (m: VideoOption) => Math.min(...m.resolutions.map(r => m.prices[r] ?? Infinity));
        const vid = [...d.videoModels].sort((a, b) => Number(b.firstFrame) - Number(a.firstFrame) || cheapest(a) - cheapest(b))[0];
        setVideoModel(vid?.id ?? '');
      })
      .catch(e => setError(e.message));
    loadReels();
  }, [loadReels]);

  useEffect(() => { if (video) setResolution(video.resolutions[0] ?? ''); }, [video]);

  // The open reel follows its progress
  const loadOpen = useCallback(() => {
    if (!openId) return;
    api<{ reel: Reel; files: string[] }>(`/api/admin/auto-reel/${openId}`).then(d => {
      setOpen(d);
      if (!working(d.reel)) loadReels();
    }).catch(() => {});
  }, [openId, loadReels]);
  useEffect(() => {
    setOpen(null);
    loadOpen();
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // An opened reel comes into view (it sits above the list)
  useEffect(() => {
    if (open?.reel.id === openId) openCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [open?.reel.id, openId]);
  useEffect(() => {
    if (!open || !working(open.reel)) return;
    const timer = setInterval(loadOpen, 5000);
    return () => clearInterval(timer);
  }, [open, loadOpen]);

  const clip = video ? baseClip(video.durations) : 0;
  const scenes = clip ? Math.min(12, Math.max(2, Math.round(seconds / clip))) : 0;
  const rate = video?.prices[resolution] ?? null;
  const animated = videoScenes === 'all' || videoScenes >= scenes ? scenes : videoScenes;
  const estimate = options && rate != null ? animated * rate * clip + scenes * options.pictureGuessUsd + 0.01 : null;

  const start = async () => {
    if (estimate === null) return;
    if (!window.confirm(`${scenes} مشاهد × ${clip} ثوانٍ (${animated} منها فيديو). التكلفة التقريبية ${usd(estimate)} من رصيد OpenRouter. نبدأ؟`)) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ reel: Reel }>('/api/admin/auto-reel', {
        method: 'POST',
        body: JSON.stringify({ idea, dialect, voice, seconds, imageModel, videoModel, resolution, videoScenes: animated < scenes ? animated : undefined }),
      });
      loadReels();
      setOpenId(d.reel.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    setError(null);
    await api(`/api/admin/auto-reel/${id}/resume`, { method: 'POST' }).catch(e => setError(e.message));
    loadOpen();
    loadReels();
  };

  const remove = async (id: string) => {
    if (!window.confirm('حذف هذا الريل وكل ملفاته نهائياً؟')) return;
    await api(`/api/admin/auto-reel/${id}`, { method: 'DELETE' }).catch(e => setError(e.message));
    if (openId === id) setOpenId(null);
    loadReels();
  };

  const field = 'mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'text-xs font-semibold text-slate-300';
  const file = (id: string, name: string) => `/api/admin/auto-reel/${id}/file/${name}`;

  if (!options && !error) return <div className={card}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <div className={`${card} text-xs text-slate-400 leading-relaxed`}>
        ريلز تلقائي بالكامل، <b className="text-slate-200">لك أنت فقط للتجربة</b>: تكتب الفكرة، فيكتب الذكاء الاصطناعي خطة المشاهد (الكلام، وصف الصورة، والحركة)،
        ثم يولّد صوت كل مشهد، وصورته، ومقطع فيديو يحرّكها، ويدمج الكل في فيديو واحد مع الترجمة. كل ما يُصنع يُحفظ، وإذا توقف ريل تكمله من حيث وقف بدون دفع مرة ثانية.
      </div>

      {error && <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error}</div>}

      {options && (
        <div className={`${card} space-y-3`}>
          <label className="block">
            <span className={label}>فكرة الريل</span>
            <textarea value={idea} onChange={e => setIdea(e.target.value.slice(0, 2000))} rows={3} placeholder="عن ماذا الريل؟ القصة أو الرسالة أو المناسبة…" className={field} />
            <span className="mt-1 flex flex-wrap gap-1.5">
              {IDEAS.map((text, i) => (
                <button key={i} type="button" onClick={() => setIdea(text)} className="text-[11px] px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white">فكرة {i + 1}</button>
              ))}
            </span>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className={label}>اللهجة</span>
              <select value={dialect} onChange={e => setDialect(e.target.value)} className={field}>
                {options.dialects.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label}>الصوت</span>
              <select value={voice} onChange={e => setVoice(e.target.value)} className={field}>
                {options.customVoices.length > 0 && (
                  <optgroup label="أصواتي (البصمة الصوتية)">
                    {options.customVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </optgroup>
                )}
                <optgroup label="أصوات الاستوديو">
                  {options.voices.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender === 'female' ? 'أنثى' : 'ذكر'})</option>)}
                </optgroup>
              </select>
            </label>
            <label className="block">
              <span className={label}>المدة</span>
              <select value={seconds} onChange={e => setSeconds(Number(e.target.value))} className={field}>
                {[30, 45, 60, 90].map(s => <option key={s} value={s}>{s} ثانية تقريباً</option>)}
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
            <label className="block">
              <span className={label}>نموذج الصور</span>
              <select value={imageModel} onChange={e => setImageModel(e.target.value)} className={field}>
                {options.imageModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}{m.outputPerM != null ? ` — $${+m.outputPerM.toFixed(2)}/M` : ''}{m.vertical ? '' : ' · بدون 9:16'}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>نموذج الفيديو (سعر الثانية)</span>
              <select value={videoModel} onChange={e => setVideoModel(e.target.value)} className={field}>
                {options.videoModels.map(m => {
                  const low = Math.min(...m.resolutions.map(r => m.prices[r] ?? Infinity));
                  return <option key={m.id} value={m.id}>{m.name} — من ${+low.toFixed(4)}/ث{m.firstFrame ? ' · يحرّك الصورة' : ' · من النص فقط'}</option>;
                })}
              </select>
            </label>
            {video && (
              <label className="block">
                <span className={label}>الدقة</span>
                <select value={resolution} onChange={e => setResolution(e.target.value)} className={field}>
                  {video.resolutions.map(r => <option key={r} value={r}>{r} — ${+(video.prices[r] ?? 0).toFixed(4)}/ث</option>)}
                </select>
              </label>
            )}
          </div>
          {scenes > 1 && (
            <label className="block max-w-sm">
              <span className={label}>مشاهد الفيديو الحقيقي (الباقي صورة بزوم بطيء مجاناً)</span>
              <select value={videoScenes} onChange={e => setVideoScenes(e.target.value === 'all' ? 'all' : Number(e.target.value))} className={field}>
                <option value="all">كل المشاهد فيديو ({scenes})</option>
                {Array.from({ length: scenes }, (_, n) => n).reverse().slice(1).map(n => (
                  <option key={n} value={n}>{n === 0 ? 'ولا مشهد: كلها صور بزوم (الأرخص)' : `${n} من ${scenes}${n >= 2 ? ' (الأول والأخير وبينهما)' : ' (الأول)'}`}</option>
                ))}
              </select>
            </label>
          )}

          {video && !video.firstFrame && (
            <div className="text-[11px] text-amber-300">هذا النموذج لا يبدأ من صورة: المقاطع تُصنع من الوصف فقط، والصور تبقى للمعاينة.</div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={start}
              disabled={busy || idea.trim().length < 5 || estimate === null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              اصنع الريل
            </button>
            {estimate !== null && (
              <span className="text-sm text-slate-200">
                {scenes} مشاهد × {clip} ث ({animated} فيديو) · التكلفة التقريبية <b className="font-mono text-amber-300" dir="ltr">{usd(estimate)}</b>
                <span className="text-xs text-slate-500"> (الحد {usd(options.maxUsd)})</span>
              </span>
            )}
          </div>
        </div>
      )}

      {open && (
        <div ref={openCard} className={`${card} space-y-4 scroll-mt-4`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-white font-bold">{open.reel.title || open.reel.idea.slice(0, 80)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5" dir="ltr">
                {open.reel.videoModelName} · {open.reel.resolution} · spent {usd(open.reel.spentUsd)} / est. {usd(open.reel.estimateUsd)}
              </div>
            </div>
            <div className="flex gap-2">
              {open.reel.stage === 'failed' && (
                <button type="button" onClick={() => resume(open.reel.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 border border-amber-500/50 text-amber-200">
                  <RotateCcw className="w-3.5 h-3.5" /> أكمل
                </button>
              )}
              <button type="button" onClick={() => setOpenId(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 border border-slate-700">إغلاق</button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STAGES.map(s => {
              const at = STAGES.findIndex(x => x.id === open.reel.stage);
              const index = STAGES.findIndex(x => x.id === s.id);
              const current = s.id === open.reel.stage;
              return (
                <span key={s.id} className={`text-[11px] px-2 py-1 rounded-lg border ${current ? 'border-amber-500/60 text-amber-200 bg-amber-500/10' : index < at || open.reel.stage === 'done' ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
                  {current && working(open.reel) && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}{s.label}
                </span>
              );
            })}
          </div>
          {open.reel.error && <div className="text-xs text-rose-300 leading-relaxed">{open.reel.error}</div>}

          {open.files.includes('final.mp4') && (
            <div className="space-y-2">
              <video src={file(open.reel.id, 'final.mp4')} controls playsInline autoPlay={autoPlay} className="max-h-[70vh] rounded-xl bg-black" />
              <a href={`${file(open.reel.id, 'final.mp4')}?download=1`} className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-amber-300">
                <Download className="w-3.5 h-3.5" /> تحميل الريل ({open.reel.duration} ث)
              </a>
            </div>
          )}

          {(open.reel.visualStyle || open.reel.delivery) && (
            <div className="text-[11px] text-slate-400 bg-slate-950/50 border border-slate-800 rounded-lg p-3 space-y-1" dir="ltr">
              {open.reel.visualStyle && <div><b className="text-slate-300">Visual style:</b> {open.reel.visualStyle}</div>}
              {open.reel.delivery && <div><b className="text-slate-300">Voice direction:</b> {open.reel.delivery}</div>}
            </div>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {open.reel.scenes.map((s, i) => {
              const has = (ext: string) => open.files.includes(`scene-${i}.${ext}`);
              return (
                <div key={i} className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-2">
                  <div className="text-[11px] text-slate-500">مشهد {i + 1}{s.seconds ? ` · ${s.seconds} ث صوت` : ''}{s.still ? ' · صورة بزوم' : s.clipSeconds ? ` · مقطع ${s.clipSeconds} ث` : ''}</div>
                  {has('mp4') ? (
                    <video src={file(open.reel.id, `scene-${i}.mp4`)} controls muted loop playsInline poster={has('jpg') ? file(open.reel.id, `scene-${i}.jpg`) : undefined} className="w-full rounded-lg bg-black aspect-[9/16] object-cover" />
                  ) : has('jpg') ? (
                    <img src={file(open.reel.id, `scene-${i}.jpg`)} alt="" className="w-full rounded-lg aspect-[9/16] object-cover" />
                  ) : (
                    <div className="w-full aspect-[9/16] rounded-lg bg-slate-900 flex items-center justify-center text-[11px] text-slate-500">لم تُصنع بعد</div>
                  )}
                  <div className="text-sm text-slate-100 leading-relaxed">{s.narration}</div>
                  {has('wav') && <audio src={file(open.reel.id, `scene-${i}.wav`)} controls preload="none" className="h-8 w-full" />}
                  <details className="text-[11px] text-slate-400" dir="ltr">
                    <summary className="cursor-pointer text-slate-300" dir="rtl">تعليمات الصورة والحركة</summary>
                    <div className="mt-1"><b>Image:</b> {s.imagePrompt}</div>
                    <div className="mt-1"><b>Motion:</b> {s.motionPrompt}</div>
                  </details>
                  {s.error && <div className="text-[11px] text-rose-300">{s.error}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {options && <AvatarTrial voices={options.voices} customVoices={options.customVoices} />}

      <div className={`${card} space-y-2`}>
        <div className="text-sm font-bold text-white">الريلز ({reels.length})</div>
        {reels.length === 0 && <div className="text-xs text-slate-400">ما في ريلز بعد.</div>}
        {reels.map(r => (
          <div key={r.id} className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
            <button type="button" onClick={() => { setAutoPlay(false); setOpenId(r.id); }} className="flex-1 text-right min-w-0">
              <div className="text-sm text-slate-100 truncate">{r.title || r.idea}</div>
              <div className="text-[11px] text-slate-500">
                {r.stage === 'done' ? 'جاهز' : r.stage === 'failed' ? 'متوقف' : `قيد العمل: ${STAGES.find(s => s.id === r.stage)?.label}`}
                {' · '}<span dir="ltr">{r.videoModelName} · {usd(r.spentUsd)}</span>
              </div>
            </button>
            {r.stage === 'done' && (
              <button type="button" onClick={() => { setAutoPlay(true); setOpenId(r.id); }} className="text-emerald-400 hover:text-emerald-300" title="تشغيل">
                <Play className="w-4 h-4" />
              </button>
            )}
            <button type="button" onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300" title="حذف"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
};
