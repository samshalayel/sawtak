import React, { useMemo, useRef, useState } from 'react';
import { AudioTagBar } from './AudioTagBar';
import { MessagesSquare, Sparkles, Loader2, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { DIALOGUE_TEMPLATES, DialogueTemplate, parseDialogueScript, renderTemplate } from '../data/dialogues';
import { estimateDuration } from '../utils/audio';

interface DialogueEditorProps {
  script: string;
  onChangeScript: (script: string) => void;
  names: [string, string];
  dialect: string;
  speed: number;
  onApplyTemplate: (template: DialogueTemplate) => void;
}

const FORMATS = [
  { id: 'podcast', label: 'بودكاست' },
  { id: 'interview', label: 'مقابلة' },
  { id: 'ad', label: 'إعلان حواري' },
  { id: 'support', label: 'خدمة عملاء' },
  { id: 'story', label: 'مشهد قصصي' },
];

const SPEAKER_TEXT = ['text-amber-300', 'text-sky-300'];

export const DialogueEditor: React.FC<DialogueEditorProps> = ({ script, onChangeScript, names, dialect, speed, onApplyTemplate }) => {
  const [showWriter, setShowWriter] = useState(!script.trim());
  const scriptBox = useRef<HTMLTextAreaElement | null>(null);
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState('podcast');
  const [turns, setTurns] = useState(8);
  const [isWriting, setIsWriting] = useState(false);
  const [writerError, setWriterError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDialogueScript(script, names), [script, names]);
  const duration = estimateDuration(parsed.lines.map(l => l.text).join(' '), speed);
  const turnsBySpeaker = names.map(n => parsed.lines.filter(l => l.speaker === n).length);

  const writeForMe = async () => {
    setIsWriting(true);
    setWriterError(null);
    try {
      const res = await fetch('/api/tts/write-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, speakers: names, format, turns, dialect }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      onChangeScript(data.script);
      setShowWriter(false);
    } catch (err: any) {
      setWriterError(err instanceof TypeError || !err?.message ? 'تعذّر الاتصال حالياً، يرجى المحاولة لاحقاً' : err.message);
    } finally {
      setIsWriting(false);
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white">نص الحوار</h2>
          <span className="text-xs text-slate-500">· الوقت التقديري: {duration.formatted}</span>
        </div>
        <select
          defaultValue=""
          onChange={e => {
            const t = DIALOGUE_TEMPLATES.find(x => x.id === e.target.value);
            if (t) {
              onChangeScript(renderTemplate(t, names));
              onApplyTemplate(t);
              setShowWriter(false);
            }
            e.target.value = '';
          }}
          className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
        >
          <option value="" disabled>حوارات جاهزة...</option>
          {DIALOGUE_TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>[{t.categoryAr}] {t.titleAr}</option>
          ))}
        </select>
      </div>

      {/* AI script writer */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5">
        <button
          type="button"
          onClick={() => setShowWriter(!showWriter)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-emerald-300"
        >
          <span className="flex items-center gap-2"><Wand2 className="w-4 h-4" /> اكتب الحوار عني بالذكاء الاصطناعي</span>
          {showWriter ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showWriter && (
          <div className="px-3.5 pb-3.5 space-y-2.5">
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="موضوع الحوار، مثال: فوائد الذكاء الاصطناعي للمشاريع الصغيرة"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={format}
                onChange={e => setFormat(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
              >
                {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <select
                value={turns}
                onChange={e => setTurns(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value={4}>قصير (4 مداخلات)</option>
                <option value={8}>متوسط (8 مداخلات)</option>
                <option value={12}>طويل (12 مداخلة)</option>
              </select>
              <button
                type="button"
                onClick={writeForMe}
                disabled={isWriting || topic.trim().length < 3}
                className="mr-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-50"
              >
                {isWriting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {isWriting ? 'جاري الكتابة... (قد تستغرق حتى دقيقة)' : 'اكتب الحوار'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              مجاني ولا يُخصم من رصيدك · يُكتب باللهجة المختارة في خطوة الأداء · يمكنك تعديل النص بعدها
            </p>
            {writerError && <p className="text-xs text-rose-300">{writerError}</p>}
          </div>
        )}
      </div>

      <AudioTagBar target={scriptBox} value={script} onChange={onChangeScript} />

      <textarea
        ref={scriptBox}
        value={script}
        onChange={e => onChangeScript(e.target.value)}
        rows={10}
        dir="rtl"
        placeholder={`${names[0]}: أهلاً بكم في حلقة جديدة...\n${names[1]}: وأهلاً بك، موضوعنا اليوم مميز!`}
        className="w-full bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 text-sm sm:text-base text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 leading-loose resize-y min-h-[200px]"
      />

      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
        <span className="text-slate-500">
          اكتب كل مداخلة في سطر: <b className="text-slate-300">الاسم: النص</b>
        </span>
        <span className="flex items-center gap-3 font-mono">
          {names.map((n, i) => (
            <span key={i} className={SPEAKER_TEXT[i]}>{n || `المتحدث ${i + 1}`}: {turnsBySpeaker[i]} مداخلة</span>
          ))}
        </span>
      </div>

      {parsed.unknownSpeakers.length > 0 && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          أسماء غير معروفة في النص: <b>{parsed.unknownSpeakers.join('، ')}</b>. استخدم فقط: {names.join(' أو ')}
        </p>
      )}
    </div>
  );
};
