import React, { useEffect, useRef, useState } from 'react';
import { Book, Loader2, Pause, Volume2, X } from 'lucide-react';
import { QURAN_MAX_VERSES, QuranReciter, QuranTopic } from '../data/quran';

// Verse picker for calm reels: choose a passage by theme or by surah and verse numbers, listen to the reciter, then
// use it. The reel plays the reciter's own recitation of these whole verses (never the AI voice).

export interface QuranChoice {
  surah: number;
  start: number;
  end: number;
  reciter: string;
  surahName: string;
  verses: { verse: number; text: string }[];
}

interface Surah { number: number; name: string; verses: number }

const chip = (active: boolean) => `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${active ? 'bg-emerald-500/15 border-emerald-500/70 text-emerald-200' : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700'}`;
const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500';

export const QuranPicker: React.FC<{
  reciter: string;
  onReciter: (id: string) => void;
  onPick: (choice: QuranChoice) => void;
  onClose: () => void;
}> = ({ reciter, onReciter, onPick, onClose }) => {
  const [mode, setMode] = useState<'topic' | 'surah'>('topic');
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [reciters, setReciters] = useState<QuranReciter[]>([]);
  const [topics, setTopics] = useState<QuranTopic[]>([]);
  const [topicId, setTopicId] = useState('calm');
  const [surah, setSurah] = useState(1);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [preview, setPreview] = useState<Omit<QuranChoice, 'reciter'> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/quran/options').then(r => r.json()).then(d => {
      if (!d.success) throw new Error(d.error);
      setSurahs(d.surahs);
      setReciters(d.reciters);
      setTopics(d.topics);
    }).catch(e => setError(e?.message || 'تعذّر تحميل قائمة السور'));
    return () => audio.current?.pause();
  }, []);

  const stop = () => { audio.current?.pause(); setPlaying(null); };

  const load = async (s: number, a: number, b: number) => {
    stop();
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const d = await fetch(`/api/quran/verses?surah=${s}&start=${a}&end=${b}`).then(r => r.json());
      if (!d.success) throw new Error(d.error);
      setPreview({ surah: s, start: a, end: b, surahName: d.surahName, verses: d.verses });
    } catch (e: any) {
      setError(e?.message || 'تعذّر جلب الآيات');
    } finally {
      setLoading(false);
    }
  };

  const listen = (verse: number) => {
    if (!preview) return;
    audio.current?.pause();
    if (playing === verse) return setPlaying(null);
    const a = new Audio(`/api/quran/audio/${encodeURIComponent(reciter)}/${preview.surah}/${verse}`);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(verse);
  };

  const count = surahs.find(s => s.number === surah)?.verses ?? 1;
  const topic = topics.find(t => t.id === topicId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Book className="w-5 h-5 text-emerald-400" /> آيات بصوت القارئ</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="إغلاق"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">القارئ</label>
          <select value={reciter} onChange={e => { stop(); onReciter(e.target.value); }} className={input}>
            {reciters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('topic')} className={chip(mode === 'topic')}>حسب الموضوع</button>
          <button type="button" onClick={() => setMode('surah')} className={chip(mode === 'surah')}>من سورة</button>
        </div>

        {mode === 'topic' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {topics.map(t => <button key={t.id} type="button" onClick={() => setTopicId(t.id)} className={chip(topicId === t.id)}>{t.label}</button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {topic?.verses.map(v => (
                <button key={`${v.surah}:${v.start}`} type="button" onClick={() => load(v.surah, v.start, v.end)}
                  className={chip(preview?.surah === v.surah && preview.start === v.start && preview.end === v.end)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="col-span-3 sm:col-span-1">
              <label className="text-xs text-slate-400">السورة</label>
              <select value={surah} onChange={e => { setSurah(+e.target.value); setStart(1); setEnd(1); }} className={input}>
                {surahs.map(s => <option key={s.number} value={s.number}>{s.number}. {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">من آية</label>
              <input type="number" min={1} max={count} value={start} onChange={e => { const v = Math.min(count, Math.max(1, +e.target.value || 1)); setStart(v); setEnd(x => Math.min(Math.max(x, v), v + QURAN_MAX_VERSES - 1, count)); }} className={input} />
            </div>
            <div>
              <label className="text-xs text-slate-400">إلى آية</label>
              <input type="number" min={start} max={Math.min(count, start + QURAN_MAX_VERSES - 1)} value={end} onChange={e => setEnd(Math.min(Math.max(start, +e.target.value || start), start + QURAN_MAX_VERSES - 1, count))} className={input} />
            </div>
            <button type="button" onClick={() => load(surah, start, end)} className="col-span-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 text-sm font-semibold hover:bg-emerald-500/30">
              اعرض الآيات
            </button>
            <p className="col-span-3 text-[11px] text-slate-500">حتى {QURAN_MAX_VERSES} آيات كاملة في الريل الواحد (والتلاوة حتى 3 دقائق).</p>
          </div>
        )}

        {loading && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>}
        {error && <p className="text-rose-300 text-sm">{error}</p>}

        {preview && (
          <div className="space-y-3 pt-3 border-t border-slate-800">
            <p className="text-xs text-slate-400">
              سورة {preview.surahName} • {preview.start === preview.end ? `الآية ${preview.start}` : `الآيات ${preview.start} إلى ${preview.end}`} — اضغط 🔊 لتسمع القارئ
            </p>
            {preview.verses.map(v => (
              <div key={v.verse} className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700">
                <button type="button" onClick={() => listen(v.verse)} className="shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center hover:bg-emerald-500/30" aria-label={`استماع للآية ${v.verse}`}>
                  {playing === v.verse ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <p className="flex-1 text-xl text-white leading-loose" style={{ fontFamily: "'Amiri', serif" }}>
                  {v.text} <span className="text-emerald-300 text-base">﴿{v.verse}﴾</span>
                </p>
              </div>
            ))}
            <button type="button" onClick={() => { stop(); onPick({ ...preview, reciter }); }} className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-sm font-bold hover:bg-emerald-400">
              استخدم {preview.verses.length > 1 ? `هذه الآيات (${preview.verses.length})` : 'هذه الآية'} في الريل
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
