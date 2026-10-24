import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Download, Loader2, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { VOICES } from '../data/presets';
import { estimateDuration } from '../utils/audio';
import { AudioTagBar } from './AudioTagBar';
import { api, card } from './adminShared';

// Admin-only motion-graphics studio: idea / curriculum excerpt -> script (with expression tags) -> voice -> job for the
// motion worker, which plans the scenes with AI and renders the videos (vertical for phones, landscape for YouTube).

type Format = 'vertical' | 'landscape';

interface JobStatus {
  id: string;
  state: 'queued' | 'transcribing' | 'planning' | 'rendering' | 'done' | 'error';
  progress: number;
  step?: string;
  error?: string;
  outputs: Partial<Record<Format, string>>;
  plan?: { attempts: number; costUsd: number | null; scenes: number; theme: string };
  renderedOn?: 'local' | 'lambda';
  updatedAt: number;
}

interface JobRow {
  id: string;
  title: string;
  formats: Format[];
  createdAt: number;
  style?: 'library' | 'free';
  look?: 'classic' | 'notebook';
  status: JobStatus | null;
}

const DIALECTS = [
  { id: 'levantine', label: 'شامي' },
  { id: 'msa', label: 'فصحى' },
  { id: 'egyptian', label: 'مصري' },
  { id: 'gulf', label: 'خليجي' },
];
const AUDIENCES = [
  { id: 'students', label: 'طلاب مدارس' },
  { id: 'general', label: 'جمهور عام' },
  { id: 'developers', label: 'مطوّرين' },
];
const TONES = [
  { id: 'educational_tutor', label: 'شرح تعليمي' },
  { id: 'energetic_promo', label: 'حماسي' },
  { id: 'conversational_warm', label: 'ودّي' },
  { id: 'professional_news', label: 'رسمي' },
];
const THEMES = [
  { id: '', label: 'تلقائي حسب الموضوع' },
  { id: 'orange', label: 'برتقالي' },
  { id: 'blue', label: 'أزرق' },
  { id: 'violet', label: 'بنفسجي' },
  { id: 'red', label: 'أحمر' },
  { id: 'green', label: 'أخضر' },
  { id: 'pink', label: 'وردي' },
  { id: 'teal', label: 'فيروزي' },
  { id: 'gold', label: 'ذهبي' },
];
const STATE_LABEL: Record<JobStatus['state'], string> = {
  queued: 'في الانتظار', transcribing: 'توقيت الكلمات', planning: 'خطة المشاهد', rendering: 'الرندر', done: 'جاهز', error: 'خطأ',
};
const running = (s?: JobStatus | null) => !!s && ['queued', 'transcribing', 'planning', 'rendering'].includes(s.state);

export const MotionTab: React.FC<{ admin?: boolean }> = ({ admin = false }) => {
  const [mode, setMode] = useState<'idea' | 'curriculum'>('idea');
  const [source, setSource] = useState('');
  const [minutes, setMinutes] = useState(2);
  const [dialect, setDialect] = useState('levantine');
  const [audience, setAudience] = useState('general');
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState('Charon');
  const [tone, setTone] = useState('educational_tutor');
  const [formats, setFormats] = useState<Format[]>(['vertical']);
  const [captions, setCaptions] = useState(true);
  const [theme, setTheme] = useState('');
  const [brief, setBrief] = useState('');
  const [renderer, setRenderer] = useState<'lambda' | 'local'>('lambda');
  const [style, setStyle] = useState<'library' | 'free'>('library');
  const [look, setLook] = useState<'classic' | 'notebook'>('classic');
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const scriptBox = useRef<HTMLTextAreaElement | null>(null);

  const loadJobs = () => api<{ jobs: JobRow[] }>('/api/motion/jobs').then(d => setJobs(d.jobs)).catch(() => {});
  useEffect(() => { loadJobs(); }, []);
  // Follow running jobs every few seconds
  useEffect(() => {
    if (!jobs.some(j => running(j.status))) return;
    const t = setTimeout(loadJobs, 4000);
    return () => clearTimeout(t);
  }, [jobs]);

  const writeScript = async () => {
    setError(null);
    setWriting(true);
    try {
      const d = await api<{ title: string; script: string }>('/api/motion/script', { method: 'POST', body: JSON.stringify({ source, mode, minutes, dialect, audience }) });
      setScript(d.script);
      setTitle(d.title);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWriting(false);
    }
  };

  const make = async () => {
    setError(null);
    setSending(true);
    try {
      await api('/api/motion/jobs', { method: 'POST', body: JSON.stringify({ script, title, voice, dialect, tone, formats, captions, theme: theme || undefined, brief, style, look, renderer: admin ? renderer : undefined }) });
      await loadJobs();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  // Fetch the file and save it under a readable name (a plain link did not download in every browser / the
  // installed app); on phones the share sheet lets it go straight to the gallery or another app
  const [saving, setSaving] = useState<string | null>(null);
  const download = async (j: JobRow, f: Format) => {
    setSaving(`${j.id}-${f}`);
    try {
      const res = await fetch(`/api/motion/jobs/${j.id}/video/${f}`);
      if (!res.ok) throw new Error('تعذّر تحميل الفيديو');
      const blob = await res.blob();
      const name = `${(j.title || 'motion').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)}-${f === 'vertical' ? '9x16' : '16x9'}.mp4`;
      const file = new File([blob], name, { type: 'video/mp4' });
      const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      if (phone && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: j.title }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e: any) {
      alert(e.message || 'تعذّر تحميل الفيديو');
    } finally {
      setSaving(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('حذف هذا الفيديو وملفاته؟')) return;
    await api(`/api/motion/jobs/${id}`, { method: 'DELETE' }).catch(e => alert(e.message));
    loadJobs();
  };

  const toggleFormat = (f: Format) => setFormats(cur => (cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f]));
  const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500';
  const chip = (on: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border ${on ? 'bg-amber-500/15 border-amber-500/70 text-amber-200' : 'bg-slate-950/50 border-slate-800 text-slate-300'}`;
  const step = (n: number, label: string) => (
    <div className="flex items-center gap-2 text-sm font-bold text-white">
      <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 text-xs font-extrabold flex items-center justify-center">{n}</span>
      {label}
    </div>
  );
  const est = estimateDuration(script);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-1`}>
        <h2 className="text-base font-bold text-white flex items-center gap-2"><Clapperboard className="w-5 h-5 text-amber-400" /> موشن جرافيك</h2>
        <p className="text-xs text-slate-400">سكربت، ثم صوت، ثم خطة مشاهد بالذكاء الاصطناعي، ثم رندر بمكتبة مشاهد القناة. التجهيز يأخذ عدة دقائق ويعمل بالخلفية؛ الملفات تُحذف بعد 24 ساعة.</p>
      </div>

      <div className={`${card} space-y-3`}>
        {step(1, 'الفكرة')}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('idea')} className={chip(mode === 'idea')}>فكرة</button>
          <button type="button" onClick={() => { setMode('curriculum'); setAudience('students'); }} className={chip(mode === 'curriculum')}>جزء من منهاج</button>
          <span className="w-px bg-slate-800 mx-1" />
          {[1, 2, 3].map(m => <button key={m} type="button" onClick={() => setMinutes(m)} className={chip(minutes === m)}>{m} {m === 1 ? 'دقيقة' : 'دقائق'}</button>)}
          <span className="w-px bg-slate-800 mx-1" />
          {DIALECTS.map(d => <button key={d.id} type="button" onClick={() => setDialect(d.id)} className={chip(dialect === d.id)}>{d.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">الجمهور:</span>
          {AUDIENCES.map(a => <button key={a.id} type="button" onClick={() => setAudience(a.id)} className={chip(audience === a.id)}>{a.label}</button>)}
        </div>
        <textarea value={source} onChange={e => setSource(e.target.value)} rows={mode === 'idea' ? 3 : 7} className={`${input} leading-relaxed`}
          placeholder={mode === 'idea' ? 'مثلاً: ليش لازم كل مطوّر يفهم الـ Cache؟ مع أمثلة من الحياة' : 'الصق هنا جزء الدرس أو المنهاج…'} />
        <button type="button" onClick={writeScript} disabled={writing || source.trim().length < 10}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold disabled:opacity-50">
          {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} اكتب السكربت
        </button>
      </div>

      <div className={`${card} space-y-3`}>
        {step(2, 'السكربت')}
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 100))} placeholder="عنوان الفيديو (للقائمة)" className={input} />
        <AudioTagBar target={scriptBox} value={script} onChange={setScript} />
        <textarea ref={scriptBox} value={script} onChange={e => setScript(e.target.value.slice(0, 6000))} rows={10} className={`${input} leading-loose`}
          placeholder="اكتب السكربت أو اطلبه من الخطوة 1، وعدّله كما تريد…" />
        <p className="text-[11px] text-slate-500">المدة التقريبية: {est.formatted} · الحد 3 دقائق</p>
      </div>

      <div className={`${card} space-y-3`}>
        {step(3, 'الصوت والفيديو')}
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-xs text-slate-400">الصوت
            <select value={voice} onChange={e => setVoice(e.target.value)} className={input}>
              {VOICES.map(v => <option key={v.id} value={v.id}>{v.name} · {v.gender === 'female' ? 'نسائي' : 'رجالي'}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-400">طريقة الإلقاء
            <select value={tone} onChange={e => setTone(e.target.value)} className={input}>
              {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-200">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formats.includes('vertical')} onChange={() => toggleFormat('vertical')} className="accent-amber-500" /> عمودي للموبايل (9:16)</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formats.includes('landscape')} onChange={() => toggleFormat('landscape')} className="accent-amber-500" /> يوتيوب (16:9)</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} className="accent-amber-500" /> ترجمة أسفل الفيديو</label>
        </div>
        <label className="block space-y-1 text-xs text-slate-400">الألوان
          <select value={theme} onChange={e => setTheme(e.target.value)} className={input}>
            {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">النسق:</span>
            <button type="button" onClick={() => setLook('classic')} className={chip(look === 'classic')}>كلاسيكي</button>
            <button type="button" onClick={() => setLook('notebook')} className={chip(look === 'notebook')}>مدرسي (دفتر)</button>
            <span className="text-[11px] text-slate-500">{look === 'classic' ? 'خلفية داكنة تقنية وبلاطات متوهّجة' : 'ورق دفتر مسطّر، خط رقعة، قلم تمييز وأوراق لاصقة'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">طريقة التصميم:</span>
            <button type="button" onClick={() => setStyle('library')} className={chip(style === 'library')}>من مكتبة المشاهد</button>
            <button type="button" onClick={() => setStyle('free')} className={chip(style === 'free')}>حر ×5</button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {style === 'library'
              ? 'مشاهد القناة الجاهزة يرتبها الذكاء الاصطناعي على صوتك: سريع (دقائق قليلة) وثابت الجودة.'
              : 'الذكاء الاصطناعي يصمّم الفيديو ويكتب كوده من الصفر، فيخرج كل فيديو مختلفاً تماماً. أبطأ (15-40 دقيقة) وكلفته نحو 5 أضعاف، والنتيجة أقل ثباتاً.'}
          </p>
        </div>
        {admin && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">مكان الرندر:</span>
            <button type="button" onClick={() => setRenderer('lambda')} className={chip(renderer === 'lambda')}>سحابة AWS Lambda</button>
            <button type="button" onClick={() => setRenderer('local')} className={chip(renderer === 'local')}>سيرفرنا</button>
            <span className="text-[11px] text-slate-500">{renderer === 'lambda' ? 'حوالي 4.5 سنت لدقيقة الفيديو، ولا يضغط على السيرفر' : 'مجاني، لكنه أبطأ ويضغط على المواقع الأخرى'}</span>
          </div>
        )}
        <textarea value={brief} onChange={e => setBrief(e.target.value.slice(0, 1500))} rows={2} className={input}
          placeholder="ملاحظات للمصمم (اختياري): مثلاً ركّز على المقارنات، استعمل مشهد كود عند الأمثلة…" />
      </div>

      {error && <div className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">{error}</div>}
      <button type="button" onClick={make} disabled={sending || !script.trim() || !formats.length}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-extrabold disabled:opacity-50">
        {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> نسجّل الصوت…</> : <><Wand2 className="w-5 h-5" /> اصنع الفيديو</>}
      </button>

      <div className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">الفيديوهات</h3>
          <button type="button" onClick={loadJobs} className="text-slate-400 hover:text-white" aria-label="تحديث"><RefreshCw className="w-4 h-4" /></button>
        </div>
        {jobs.length === 0 && <p className="text-xs text-slate-500">لا يوجد فيديوهات بعد.</p>}
        {jobs.map(j => {
          const s = j.status;
          return (
            <div key={j.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{j.title}</div>
                  <div className="text-[11px] text-slate-500">{new Date(j.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })} · {s ? STATE_LABEL[s.state] : '—'}{s?.plan ? ` · ${s.plan.scenes} مشهد · ${s.plan.theme}` : ''}{s?.renderedOn ? ` · ${s.renderedOn === 'lambda' ? 'Lambda' : 'سيرفرنا'}` : ''}{j.look === 'notebook' ? ' · مدرسي' : ''}{j.style === 'free' ? ' · تصميم حر' : ''}</div>
                </div>
                {(!running(s) || s?.state === 'queued') && <button type="button" onClick={() => remove(j.id)} className="text-slate-500 hover:text-rose-400" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>}
              </div>
              {running(s) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-300"><span>{s!.step || STATE_LABEL[s!.state]}</span><span className="font-mono">{Math.round(s!.progress * 100)}%</span></div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-amber-500 transition-all duration-700" style={{ width: `${Math.max(3, s!.progress * 100)}%` }} /></div>
                </div>
              )}
              {s?.state === 'error' && <p className="text-xs text-rose-300">{s.error}</p>}
              {s?.state === 'done' && (
                <div className="flex flex-wrap gap-3">
                  {(Object.keys(s.outputs) as Format[]).map(f => (
                    <div key={f} className="space-y-1.5">
                      <video src={`/api/motion/jobs/${j.id}/video/${f}`} controls preload="metadata" className={`rounded-lg bg-black ${f === 'vertical' ? 'h-72' : 'h-44'}`} />
                      <button type="button" onClick={() => download(j, f)} disabled={saving === `${j.id}-${f}`}
                        className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 disabled:opacity-60">
                        {saving === `${j.id}-${f}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        تحميل {f === 'vertical' ? 'العمودي' : 'اليوتيوب'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
