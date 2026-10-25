import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Image as ImageIcon, Loader2, Pause, Play, Share2, ShieldCheck, Sparkles, Stethoscope, Video, Wand2 } from 'lucide-react';
import { VOICES } from '../data/presets';
import { AuthUser, ServicePrices } from '../types/auth';
import { DoctorProfile, MEDICAL_DISCLAIMER, MEDICAL_LIMITS, MEDICAL_SCENES, MEDICAL_THEMES, ReviewNote, ReviewResult } from '../data/medical';

// Medical cards and reels: a doctor writes a piece of health information, an AI review flags doubtful or overstated
// sentences and offers a simpler wording (the doctor decides), then it becomes an image card or a short reel with
// the doctor's identity and a fixed disclaimer.

interface Props {
  user: AuthUser | null;
  prices: ServicePrices;
  onLoginRequired: (reason: string) => void;
  onBalance: (b: number) => void;
  onOpenPackages: () => void;
}

interface Clip { id: number; duration: number; thumb: string; preview: string }
interface Photo { id: number; thumb: string }

const REEL_VOICES = VOICES.filter(v => v.avatar && !v.tags.includes('أطفال') && !v.tags.includes('غضب'));
const DIALECTS = [
  { id: 'msa', label: 'فصحى' },
  { id: 'levantine', label: 'شامي' },
  { id: 'egyptian', label: 'مصري' },
  { id: 'gulf', label: 'خليجي' },
];
const SEVERITY: Record<ReviewNote['severity'], { label: string; tone: string }> = {
  high: { label: 'مهم: قد يضر', tone: 'border-rose-500/60 bg-rose-500/10 text-rose-200' },
  medium: { label: 'قد يضلّل', tone: 'border-amber-500/60 bg-amber-500/10 text-amber-200' },
  low: { label: 'صياغة', tone: 'border-slate-600 bg-slate-800/40 text-slate-300' },
};

const toBase64 = (f: File) => new Promise<string>((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = bad;
  r.readAsDataURL(f);
});

export const MedicalPage: React.FC<Props> = ({ user, prices, onLoginRequired, onBalance, onOpenPackages }) => {
  // Doctor identity (saved once on the server)
  const [profile, setProfile] = useState<DoctorProfile>({ name: '', specialty: '', clinic: '', contact: '', color: '#0ea5e9', hasLogo: false });
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoData, setLogoData] = useState<string | null | undefined>(undefined); // undefined = keep, null = remove
  const [logoVersion, setLogoVersion] = useState(0);
  const [savingProfile, setSavingProfile] = useState(false);

  // The information and its review
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Output
  const [output, setOutput] = useState<'card' | 'reel'>('card');
  const [bg, setBg] = useState<'theme' | 'photo'>('theme');
  const [themeId, setThemeId] = useState(MEDICAL_THEMES[0].id);
  const [scene, setScene] = useState(MEDICAL_SCENES[0].id);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoId, setPhotoId] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [loadingBg, setLoadingBg] = useState(false);
  const [voiceId, setVoiceId] = useState('Charon');
  const [dialect, setDialect] = useState('msa');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ text: string; credits?: boolean } | null>(null);
  const [cardImage, setCardImage] = useState<string | null>(null);
  const [reel, setReel] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch('/api/medical/profile').then(r => r.json()).then(d => {
      if (d.profile) setProfile(d.profile);
      else setProfileOpen(true);
    }).catch(() => {});
  }, [user?.id]);

  // Backgrounds for the chosen scene: photos for a card, videos for a reel
  const needPhotos = output === 'card' && bg === 'photo';
  const needClips = output === 'reel';
  useEffect(() => {
    if (!user || (!needPhotos && !needClips)) return;
    setLoadingBg(true);
    setError(null);
    fetch(`/api/medical/backgrounds?scene=${scene}&kind=${needClips ? 'video' : 'photo'}`).then(r => r.json()).then(d => {
      if (!d.success) throw new Error(d.error);
      if (needClips) setClips(d.clips);
      else setPhotos(d.photos);
    }).catch(e => setError({ text: e?.message || 'تعذّر جلب الخلفيات' })).finally(() => setLoadingBg(false));
  }, [scene, needPhotos, needClips, user?.id]);

  const login = (reason: string) => onLoginRequired(reason);

  const saveProfile = async () => {
    if (!user) return login('سجّل حساباً لتحفظ هويتك كطبيب.');
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch('/api/medical/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, ...(logoData !== undefined ? { logo: logoData } : {}) }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setProfile(d.profile);
      setLogoData(undefined);
      setLogoVersion(v => v + 1);
      setProfileOpen(false);
    } catch (e: any) {
      setError({ text: e?.message || 'تعذّر حفظ الهوية' });
    } finally {
      setSavingProfile(false);
    }
  };

  const runReview = async () => {
    if (!user) return login('سجّل حساباً لتستخدم المراجعة الذكية.');
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch('/api/medical/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setReview(d.review);
      if (!title.trim() && d.review.title) setTitle(d.review.title);
    } catch (e: any) {
      setError({ text: e?.message || 'تعذّرت المراجعة' });
    } finally {
      setReviewing(false);
    }
  };

  const applySuggestion = (n: ReviewNote) => {
    if (text.includes(n.quote)) setText(t => t.replace(n.quote, n.suggestion));
    else setText(t => `${t}\n${n.suggestion}`);
    setReview(r => (r ? { ...r, notes: r.notes.filter(x => x !== n) } : r));
  };

  const preview = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(`/api/tts/preview/${id}`);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(id);
  };

  const makeCard = async () => {
    if (!user) return login('سجّل حساباً لتصنع بطاقات طبية.');
    setBusy(true);
    setError(null);
    setCardImage(null);
    try {
      const res = await fetch('/api/medical/card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: text, themeId, photoId: bg === 'photo' ? photoId : null }),
      });
      const d = await res.json();
      if (typeof d.balance === 'number') onBalance(d.balance);
      if (!d.success) throw Object.assign(new Error(d.error), { credits: d.code === 'INSUFFICIENT_CREDITS' });
      setCardImage(d.image);
    } catch (e: any) {
      setError({ text: e?.message || 'تعذّر تجهيز البطاقة', credits: e?.credits });
    } finally {
      setBusy(false);
    }
  };

  const makeReel = async () => {
    if (!user) return login('سجّل حساباً لتصنع ريلز طبية.');
    if (chosen.length === 0) return setError({ text: 'اختر مشهداً واحداً على الأقل (حتى ثلاثة)' });
    setBusy(true);
    setProgress(0);
    setError(null);
    if (reel) URL.revokeObjectURL(reel.url);
    setReel(null);
    try {
      const res = await fetch('/api/medical/reel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, text, voiceId, dialect, clipIds: chosen }),
      });
      const job = await res.json().catch(() => ({}));
      if (typeof job.balance === 'number') onBalance(job.balance);
      if (!res.ok || !job.jobId) throw Object.assign(new Error(job.error || 'تعذّر تجهيز الريل'), { credits: job.code === 'INSUFFICIENT_CREDITS' });
      for (;;) {
        await new Promise(r => setTimeout(r, 1500));
        const s = await fetch(`/api/video/jobs/${job.jobId}`).then(r => r.json()).catch(() => ({}));
        if (s.status === 'error' || s.success === false) throw new Error(s.error || 'تعذّر تجهيز الريل');
        setProgress(Math.round((s.progress || 0) * 100));
        if (s.status === 'done') {
          const file = await fetch(`/api/video/jobs/${job.jobId}/file`);
          if (!file.ok) throw new Error('تعذّر تحميل الفيديو');
          const blob = await file.blob();
          setReel({ url: URL.createObjectURL(blob), blob });
          break;
        }
      }
    } catch (e: any) {
      setError({ text: e instanceof TypeError ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً.' : e.message, credits: e?.credits });
    } finally {
      setBusy(false);
    }
  };

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const share = async (blob: Blob, name: string) => {
    try { await navigator.share({ files: [new File([blob], name, { type: blob.type })], title }); } catch { /* closed */ }
  };

  const section = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3';
  const label = 'text-sm font-bold text-white flex items-center gap-2';
  const stepNo = (n: number) => <span className="w-6 h-6 rounded-full bg-sky-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{n}</span>;
  const chip = (active: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${active ? 'bg-sky-500/15 border-sky-500/70 text-sky-300' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'}`;
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500';
  const limit = output === 'card' ? MEDICAL_LIMITS.body : MEDICAL_LIMITS.reelBody;
  const tooLong = text.length > limit;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-extrabold text-white flex items-center justify-center gap-2"><Stethoscope className="w-6 h-6 text-sky-400" /> بطاقات وريلز طبية</h2>
        <p className="text-sm text-slate-400">اكتب معلومتك الطبية، راجعها بمساعدة الذكاء الاصطناعي، وانشرها ببطاقة أو ريل يحمل اسمك.</p>
      </div>

      {/* 1. Identity */}
      <div className={section}>
        <button type="button" onClick={() => setProfileOpen(o => !o)} className={`${label} w-full justify-between`}>
          <span className="flex items-center gap-2">{stepNo(1)} هويتك على البطاقة</span>
          <span className="text-xs font-normal text-slate-400">{profile.name ? `${profile.name}${profile.specialty ? ` · ${profile.specialty}` : ''}` : 'لم تُحفظ بعد'} · {profileOpen ? 'إخفاء' : 'تعديل'}</span>
        </button>
        {profileOpen && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} placeholder="الاسم (مثال: د. سارة أحمد)" className={input} />
              <input value={profile.specialty} onChange={e => setProfile({ ...profile, specialty: e.target.value })} placeholder="التخصص (مثال: أخصائية تغذية)" className={input} />
              <input value={profile.clinic} onChange={e => setProfile({ ...profile, clinic: e.target.value })} placeholder="العيادة أو المركز (اختياري)" className={input} />
              <input value={profile.contact} onChange={e => setProfile({ ...profile, contact: e.target.value })} placeholder="رقم أو حساب للتواصل (اختياري)" className={input} dir="ltr" />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <label className="flex items-center gap-2">اللون <input type="color" value={profile.color} onChange={e => setProfile({ ...profile, color: e.target.value })} className="w-9 h-7 rounded bg-transparent" /></label>
              <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600">
                الشعار أو صورتك
                <input type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) setLogoData(await toBase64(f)); }} />
              </label>
              {(logoData || (profile.hasLogo && logoData !== null)) && (
                <span className="flex items-center gap-2">
                  <img src={logoData || `/api/medical/profile/logo?v=${logoVersion}`} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-700" />
                  <button type="button" onClick={() => setLogoData(null)} className="text-rose-300 hover:underline">إزالة</button>
                </span>
              )}
            </div>
            <button type="button" onClick={saveProfile} disabled={savingProfile} className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-sm font-bold disabled:opacity-60 flex items-center gap-2">
              {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />} حفظ الهوية
            </button>
          </div>
        )}
      </div>

      {/* 2. Information + AI review */}
      <div className={section}>
        <div className={label}>{stepNo(2)} المعلومة الطبية</div>
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, MEDICAL_LIMITS.title))} placeholder="العنوان (مثال: ضغط الدم المرتفع)" className={input} />
        <textarea value={text} onChange={e => setText(e.target.value.slice(0, MEDICAL_LIMITS.reelBody))} rows={6} placeholder="اكتب المعلومة كما تشرحها لمريضك…" className={`${input} leading-loose`} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[11px] ${tooLong ? 'text-rose-300' : 'text-slate-500'}`}>{text.length} / {limit} حرف {tooLong && output === 'card' ? '(طويل للبطاقة، اختصره أو اصنع ريلاً)' : ''}</span>
          <button type="button" onClick={runReview} disabled={reviewing || text.trim().length < 20} className="px-4 py-2 rounded-xl bg-sky-500/10 border border-sky-500/50 text-sky-300 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
            {reviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} مراجعة ذكية (مجانية)
          </button>
        </div>
        {reviewing && <p className="text-xs text-sky-300">نراجع النص… قد يستغرق ذلك نحو 20 ثانية.</p>}
        <p className="text-[11px] text-slate-500">المراجعة الذكية تنبيه مساعد وليست تشخيصاً أو مرجعاً طبياً، والقرار النهائي لك كطبيب.</p>

        {review && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            {review.notes.length === 0 ? (
              <p className="text-sm text-emerald-300 flex items-center gap-2"><Check className="w-4 h-4" /> لم تجد المراجعة ملاحظات على النص.</p>
            ) : review.notes.map((n, i) => (
              <div key={i} className={`rounded-xl border px-3 py-2 text-xs space-y-1.5 ${SEVERITY[n.severity].tone}`}>
                <div className="flex items-center gap-1.5 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> {SEVERITY[n.severity].label}</div>
                <div className="text-slate-200">«{n.quote}»</div>
                <div>{n.problem}</div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-300">المقترح: {n.suggestion}</span>
                  <button type="button" onClick={() => applySuggestion(n)} className="px-2.5 py-1 rounded-lg bg-slate-900/70 border border-slate-600 text-slate-100 hover:border-slate-400">استخدم الاقتراح</button>
                </div>
              </div>
            ))}
            {review.simplified && (
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 px-3 py-2 space-y-2">
                <div className="text-xs font-bold text-sky-300 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> صياغة مبسطة للمرضى</div>
                <p className="text-sm text-slate-100 leading-relaxed">{review.simplified}</p>
                <button type="button" onClick={() => setText(review.simplified)} className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold">استخدمها بدل نصي</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Output */}
      <div className={section}>
        <div className={label}>{stepNo(3)} الشكل</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOutput('card')} className={`${chip(output === 'card')} flex items-center gap-1.5`}><ImageIcon className="w-3.5 h-3.5" /> بطاقة صورة · {prices.medicalCard} نقطة</button>
          <button type="button" onClick={() => setOutput('reel')} className={`${chip(output === 'reel')} flex items-center gap-1.5`}><Video className="w-3.5 h-3.5" /> ريل بصوت · {prices.medicalReel} نقطة</button>
        </div>

        {output === 'card' && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setBg('theme')} className={chip(bg === 'theme')}>قالب طبي</button>
            <button type="button" onClick={() => setBg('photo')} className={chip(bg === 'photo')}>صورة حقيقية</button>
          </div>
        )}

        {output === 'card' && bg === 'theme' && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {MEDICAL_THEMES.map(t => (
              <button key={t.id} type="button" onClick={() => setThemeId(t.id)}
                className={`h-16 rounded-xl text-[#ffffff] text-xs font-bold ${themeId === t.id ? 'ring-2 ring-offset-2 ring-sky-500 ring-offset-slate-900' : 'opacity-80 hover:opacity-100'}`}
                style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {(needPhotos || needClips) && (
          <>
            <div className="flex flex-wrap gap-2">{MEDICAL_SCENES.map(s => <button key={s.id} type="button" onClick={() => { setScene(s.id); setPhotoId(null); setChosen([]); }} className={chip(scene === s.id)}>{s.label}</button>)}</div>
            {!user ? (
              <button type="button" onClick={() => login('سجّل حساباً لتتصفح الخلفيات.')} className="w-full py-6 rounded-xl border-2 border-dashed border-slate-700 text-slate-300 text-sm">سجّل الدخول لتتصفح الخلفيات</button>
            ) : loadingBg ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-sky-400" /></div>
            ) : needPhotos ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photos.map(p => (
                  <button key={p.id} type="button" onClick={() => setPhotoId(p.id)} className={`relative aspect-[4/5] rounded-xl overflow-hidden border-2 ${photoId === p.id ? 'border-sky-400' : 'border-transparent'}`}>
                    <img src={p.thumb} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                    {photoId === p.id && <span className="absolute top-1 right-1 w-6 h-6 rounded-full bg-sky-500 text-slate-950 flex items-center justify-center"><Check className="w-4 h-4" /></span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {clips.map(c => {
                  const order = chosen.indexOf(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setChosen(x => (x.includes(c.id) ? x.filter(y => y !== c.id) : x.length >= 3 ? x : [...x, c.id]))}
                      className={`relative aspect-[9/12] rounded-xl overflow-hidden border-2 ${order >= 0 ? 'border-sky-400' : 'border-transparent'}`}
                      onMouseEnter={e => (e.currentTarget.querySelector('video') as HTMLVideoElement | null)?.play().catch(() => {})}
                      onMouseLeave={e => (e.currentTarget.querySelector('video') as HTMLVideoElement | null)?.pause()}>
                      <video src={c.preview} poster={c.thumb} muted loop playsInline preload="none" className="absolute inset-0 w-full h-full object-cover" />
                      {order >= 0 && <span className="absolute top-1 right-1 w-6 h-6 rounded-full bg-sky-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{order + 1}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-slate-500">الخلفيات من Pixabay، ومُصفّاة من أي مشهد مزعج (دم، عمليات، إبر…).</p>
          </>
        )}

        {output === 'reel' && (
          <div className="space-y-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {REEL_VOICES.map(v => (
                <div key={v.id} role="button" tabIndex={0} onClick={() => setVoiceId(v.id)}
                  className={`relative shrink-0 w-20 rounded-xl border p-1.5 flex flex-col items-center gap-1 cursor-pointer ${voiceId === v.id ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 bg-slate-950/40'}`}>
                  <img src={v.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                  <span className="text-[11px] text-white">{v.name}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); preview(v.id); }} className="absolute top-1 left-1 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center" aria-label={`استماع لعيّنة ${v.name}`}>
                    {playing === v.id ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">{DIALECTS.map(d => <button key={d.id} type="button" onClick={() => setDialect(d.id)} className={chip(dialect === d.id)}>{d.label}</button>)}</div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5 text-sm text-rose-200 flex items-center justify-between gap-2">
          <span>{error.text}</span>
          {error.credits && <button type="button" onClick={onOpenPackages} className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">اشحن رصيدك</button>}
        </div>
      )}
      {busy && output === 'reel' && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-300"><span>{progress === 0 ? 'نسجّل الصوت ونحضّر المشاهد…' : 'نجهّز الريل…'}</span><span className="font-mono text-sky-300">{progress}%</span></div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-sky-500 transition-all duration-700" style={{ width: `${Math.max(3, progress)}%` }} /></div>
        </div>
      )}

      <button type="button" onClick={output === 'card' ? makeCard : makeReel}
        disabled={busy || !title.trim() || text.trim().length < 10 || tooLong || (output === 'card' && bg === 'photo' && photoId == null)}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 text-slate-950 font-extrabold text-base disabled:opacity-60">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />} {output === 'card' ? 'اصنع البطاقة' : 'اصنع الريل'}
      </button>
      <p className="text-[11px] text-slate-500 text-center">يُضاف إلى كل بطاقة وريل: «{MEDICAL_DISCLAIMER}».</p>

      {cardImage && (
        <div className="space-y-3 text-center">
          <img src={cardImage} alt={title} className="mx-auto max-h-[70vh] rounded-2xl shadow-2xl" />
          <div className="flex justify-center gap-2">
            {canShare && <button type="button" onClick={async () => share(await (await fetch(cardImage)).blob(), 'medical-card.jpg')} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm"><Share2 className="w-4 h-4" /> شارك</button>}
            <a href={cardImage} download="medical-card.jpg" className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 text-slate-100 font-bold text-sm"><Download className="w-4 h-4" /> تحميل</a>
          </div>
        </div>
      )}
      {reel && (
        <div className="space-y-3 text-center">
          <video src={reel.url} controls playsInline className="mx-auto max-h-[70vh] rounded-2xl bg-black shadow-2xl" />
          <div className="flex justify-center gap-2">
            {canShare && <button type="button" onClick={() => share(reel.blob, 'medical-reel.mp4')} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-500 text-slate-950 font-bold text-sm"><Share2 className="w-4 h-4" /> شارك</button>}
            <a href={reel.url} download="medical-reel.mp4" className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 text-slate-100 font-bold text-sm"><Download className="w-4 h-4" /> تحميل</a>
          </div>
          <p className="text-[11px] text-slate-500">لا نحتفظ بنسخة، فحمّله قبل مغادرة الصفحة.</p>
        </div>
      )}
    </div>
  );
};
