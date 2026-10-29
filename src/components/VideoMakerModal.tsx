import React, { useEffect, useRef, useState } from 'react';
import { X, Film, Loader2, Download, ImagePlus, UserRound, Square, RectangleVertical, RectangleHorizontal } from 'lucide-react';
import { postRender } from '../utils/postRender';

type VideoFormat = 'square' | 'vertical' | 'landscape';

interface VideoMakerModalProps {
  audioBase64: string;
  audioId?: string;        // the server still has this clip: the request names it instead of uploading it again
  text: string;            // spoken text, used for the synced captions
  voiceId: string;         // e.g. "Puck" or "Puck+Kore" for dialogues; picks the default portrait
  voiceAvatar?: string;
  onClose: () => void;
}

const FORMATS: { id: VideoFormat; label: string; hint: string; icon: React.ElementType }[] = [
  { id: 'vertical', label: 'طولي 9:16', hint: 'ريلز · تيك توك · حالة واتساب', icon: RectangleVertical },
  { id: 'square', label: 'مربّع 1:1', hint: 'منشور إنستغرام وفيسبوك', icon: Square },
  { id: 'landscape', label: 'عرضي 16:9', hint: 'يوتيوب · عروض تقديمية', icon: RectangleHorizontal },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const VideoMakerModal: React.FC<VideoMakerModalProps> = ({ audioBase64, audioId, text, voiceId, voiceAvatar, onClose }) => {
  const [format, setFormat] = useState<VideoFormat>('vertical');
  const [imageSource, setImageSource] = useState<'voice' | 'upload'>('voice');
  const [uploaded, setUploaded] = useState<{ dataUrl: string; name: string } | null>(null);
  const [title, setTitle] = useState('');
  const [captions, setCaptions] = useState(true);
  const [hd, setHd] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; ahead: number; status: string } | null>(null);
  const cancelled = useRef(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { cancelled.current = true; }, []);

  const handleFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('يرجى اختيار ملف صورة');
    if (file.size > MAX_IMAGE_BYTES) return setError('حجم الصورة أكبر من 5 ميغابايت');
    const reader = new FileReader();
    reader.onload = () => {
      setUploaded({ dataUrl: String(reader.result), name: file.name });
      setImageSource('upload');
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const render = async () => {
    setIsRendering(true);
    setError(null);
    setProgress({ percent: 0, ahead: 0, status: 'queued' });
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    try {
      const res = await postRender('/api/video/render', {
        text,
        format,
        voiceId,
        imageBase64: imageSource === 'upload' ? uploaded?.dataUrl : undefined,
        title,
        captions,
        hd,
      }, { id: audioId, base64: audioBase64 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) throw new Error(data.error || 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.');

      // Poll the background job until the MP4 is ready
      while (!cancelled.current) {
        await new Promise(r => setTimeout(r, 1000));
        const statusRes = await fetch(`/api/video/jobs/${data.jobId}`);
        const job = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok) throw new Error(job.error || 'تعذّر متابعة تجهيز الفيديو');
        if (job.status === 'error') throw new Error(job.error);
        setProgress({ percent: Math.round((job.progress || 0) * 100), ahead: job.ahead || 0, status: job.status });
        if (job.status === 'done') {
          const fileRes = await fetch(`/api/video/jobs/${data.jobId}/file`);
          if (!fileRes.ok) throw new Error('تعذّر تحميل الفيديو');
          setVideoUrl(URL.createObjectURL(await fileRes.blob()));
          break;
        }
      }
    } catch (err: any) {
      setError(err instanceof TypeError || !err?.message ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : err.message);
    } finally {
      setIsRendering(false);
      setProgress(null);
    }
  };

  const download = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `sawtik_video_${format}_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const optionClass = (active: boolean) =>
    `flex-1 rounded-xl border p-3 text-right transition-colors ${
      active ? 'border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/30' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl relative text-right max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button type="button" onClick={onClose} className="absolute left-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800" aria-label="إغلاق">
          <X className="w-5 h-5" />
        </button>

        <h3 className="font-bold text-white text-lg flex items-center gap-2">
          <Film className="w-5 h-5 text-amber-400" />
          حوّل الصوت إلى فيديو
        </h3>
        <p className="text-xs text-slate-400 mt-1">فيديو جاهز للنشر: صورة + موجات صوتية متحركة + نص مكتوب متزامن مع الكلام</p>

        {videoUrl ? (
          <div className="mt-5 space-y-4">
            <video
              src={videoUrl}
              controls
              autoPlay
              className={`mx-auto rounded-xl bg-black ${format === 'vertical' ? 'max-h-[60vh]' : 'w-full'}`}
            />
            <div className="flex gap-2">
              <button type="button" onClick={download} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm">
                <Download className="w-4 h-4" /> تحميل الفيديو MP4
              </button>
              <button type="button" onClick={() => setVideoUrl(null)} className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-sm">
                تعديل
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* Format */}
            <div>
              <div className="text-xs font-semibold text-slate-300 mb-2">شكل الفيديو</div>
              <div className="flex flex-col sm:flex-row gap-2">
                {FORMATS.map(f => {
                  const Icon = f.icon;
                  return (
                    <button key={f.id} type="button" onClick={() => setFormat(f.id)} className={optionClass(format === f.id)}>
                      <div className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="w-4 h-4 text-amber-400" />{f.label}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{f.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Picture */}
            <div>
              <div className="text-xs font-semibold text-slate-300 mb-2">الصورة</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={() => setImageSource('voice')} className={optionClass(imageSource === 'voice')}>
                  <div className="flex items-center gap-2.5">
                    {voiceAvatar ? <img src={voiceAvatar} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <UserRound className="w-6 h-6 text-slate-400" />}
                    <div>
                      <div className="text-sm font-bold text-white">صورة المؤدي الصوتي</div>
                      <div className="text-[11px] text-slate-500">بدون أي إعداد</div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => (uploaded ? setImageSource('upload') : fileInput.current?.click())}
                  className={optionClass(imageSource === 'upload')}
                >
                  <div className="flex items-center gap-2.5">
                    {uploaded ? <img src={uploaded.dataUrl} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <ImagePlus className="w-6 h-6 text-slate-400" />}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white">صورتك أو شعارك</div>
                      <div className="text-[11px] text-slate-500 truncate">{uploaded ? uploaded.name : 'JPG أو PNG حتى 5 ميغابايت'}</div>
                    </div>
                  </div>
                </button>
              </div>
              {uploaded && (
                <button type="button" onClick={() => fileInput.current?.click()} className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300">
                  تغيير الصورة
                </button>
              )}
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            </div>

            {/* Title + captions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-300">عنوان تحت الصورة (اختياري)</span>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value.slice(0, 60))}
                  placeholder="مثال: مطعم البيت الشامي"
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                />
              </label>
              <label className="flex items-center gap-2.5 sm:mt-5 cursor-pointer select-none">
                <input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-slate-200">إظهار النص مكتوباً مع الصوت</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer select-none sm:col-start-2">
                <input type="checkbox" checked={hd} onChange={e => setHd(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-slate-200">جودة عالية 1080p <span className="text-slate-500 text-xs">(أبطأ بثلاث مرات)</span></span>
              </label>
            </div>

            {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{error}</p>}

            {progress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>
                    {progress.status === 'queued'
                      ? progress.ahead > 0 ? `في الانتظار… أمامك ${progress.ahead} فيديو` : 'يبدأ التجهيز الآن…'
                      : 'جاري تجهيز الفيديو…'}
                  </span>
                  <span className="font-mono text-amber-300">{progress.percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-l from-amber-400 to-amber-600 transition-all duration-700" style={{ width: `${Math.max(3, progress.percent)}%` }} />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={render}
              disabled={isRendering}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-extrabold text-sm disabled:opacity-60"
            >
              {isRendering ? <Loader2 className="w-5 h-5 animate-spin" /> : <Film className="w-5 h-5" />}
              {isRendering ? 'جاري التجهيز…' : 'أنشئ الفيديو'}
            </button>
            <p className="text-[11px] text-slate-500 text-center">مجاني ولا يُخصم من رصيدك</p>
          </div>
        )}
      </div>
    </div>
  );
};
