import React, { useRef, useState } from 'react';
import { SAMPLE_SCRIPTS } from '../data/presets';
import { estimateDuration } from '../utils/audio';
import { stripAudioTags } from '../utils/audioTags';
import { AudioTagBar } from './AudioTagBar';
import {
  FileText,
  Sparkles,
  BookOpen,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Loader2,
  Wand2
} from 'lucide-react';

interface ScriptEditorProps {
  text: string;
  onChangeText: (text: string) => void;
  speed: number;
  onApplyTemplate: (script: typeof SAMPLE_SCRIPTS[0]) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  text,
  onChangeText,
  speed,
  onApplyTemplate
}) => {
  const [isTashkeeling, setIsTashkeeling] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const textArea = useRef<HTMLTextAreaElement | null>(null);
  // Expression tags ([laughing]…) are not spoken words, so they are left out of the counters
  const spoken = stripAudioTags(text).trim();
  const wordCount = spoken ? spoken.split(/\s+/).length : 0;
  const charCount = stripAudioTags(text).length;
  const duration = estimateDuration(text, speed);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Tashkeel handler
  const handleTashkeel = async () => {
    if (!text.trim()) {
      showStatus('يرجى كتابة نص لتشكيله أولاً');
      return;
    }

    try {
      setIsTashkeeling(true);
      showStatus('جاري تشكيل النص وضبط الحركات الإعرابية...');
      const res = await fetch('/api/tts/tashkeel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.success && data.tashkeelText) {
        onChangeText(data.tashkeelText);
        showStatus('تم تشكيل النص بالحركات بدقة تامة بنجاح');
      } else {
        showStatus(data.error || 'تعذر تشكيل النص تلقائياً');
      }
    } catch (err: any) {
      console.error(err);
      showStatus('حدث خطأ في الاتصال بالخادم للتشكيل');
    } finally {
      setIsTashkeeling(false);
    }
  };

  // Script Polish handler
  const handleOptimizeScript = async () => {
    if (!text.trim()) {
      showStatus('يرجى كتابة نص لتحسينه أولاً');
      return;
    }

    try {
      setIsOptimizing(true);
      showStatus('جاري توزيع علامات الوقف والتنفس الصوتي...');
      const res = await fetch('/api/tts/optimize-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.success && data.optimizedText) {
        onChangeText(data.optimizedText);
        showStatus('تم تحسين النص وموازنة الوقفات للإلقاء');
      } else {
        showStatus(data.error || 'تعذر تحسين النص');
      }
    } catch (err: any) {
      console.error(err);
      showStatus('حدث خطأ أثناء تحسين النص');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
      {/* Editor Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white">نص الإلقاء الصوتي (Script)</h2>
          <span className="text-xs text-slate-500">
            · الوقت التقديري: {duration.formatted}
          </span>
        </div>

        {/* Ready Templates Selector */}
        <div className="relative">
          <select
            defaultValue=""
            onChange={(e) => {
              const selected = SAMPLE_SCRIPTS.find(s => s.id === e.target.value);
              if (selected) {
                onApplyTemplate(selected);
              }
              e.target.value = '';
            }}
            className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
          >
            <option value="" disabled>
              نماذج نصوص احترافية جاهزة...
            </option>
            {SAMPLE_SCRIPTS.map((script) => (
              <option key={script.id} value={script.id}>
                [{script.categoryAr}] {script.titleAr}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AudioTagBar target={textArea} value={text} onChange={onChangeText} />

      {/* Text Area */}
      <div className="relative">
        <textarea
          ref={textArea}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="اكتب أو الصق النص هنا لتحويله إلى صوت... يمكنك كتابة نصوص عربية بفصحى أو لهجات عامية، أو نصوص بلغات أجنبية أخرى."
          rows={6}
          className="w-full bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 text-sm sm:text-base text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 leading-relaxed resize-y min-h-[140px]"
        />

        {/* Floating Quick Action Badge */}
        {statusMessage && (
          <div className="absolute bottom-3 right-3 bg-slate-900/95 border border-amber-500/40 text-amber-300 text-xs px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 animate-fadeIn z-10 backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Editor Controls & Metadata */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        {/* Smart AI Text Tools */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Tashkeel Button */}
          <button
            type="button"
            onClick={handleTashkeel}
            disabled={isTashkeeling || !text.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="تشكيل النص تلقائياً بالحركات للحصول على نطق فصيح ودقيق"
          >
            {isTashkeeling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            <span>تشكيل الحركات (Tashkeel)</span>
          </button>

          {/* Script Polish Button */}
          <button
            type="button"
            onClick={handleOptimizeScript}
            disabled={isOptimizing || !text.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="ضبط علامات الترقيم وتنظيم الوقفات والتنفس للأداء الصوتي"
          >
            {isOptimizing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>تحسين وقفات الإلقاء</span>
          </button>

          {/* Clear Button */}
          {text.trim() && (
            <button
              type="button"
              onClick={() => onChangeText('')}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
              title="مسح النص"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Copy Button */}
          {text.trim() && (
            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="نسخ النص"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Word and Char Counters */}
        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
          <span>{wordCount} كلمة</span>
          <span aria-hidden="true">·</span>
          <span>{charCount} حرف</span>
        </div>
      </div>
    </div>
  );
};
