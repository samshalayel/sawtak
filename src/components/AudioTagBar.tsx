import React, { useState } from 'react';
import { ChevronDown, Smile } from 'lucide-react';
import { AUDIO_TAG_GROUPS } from '../utils/audioTags';

// "Add an expression" bar: Arabic buttons that drop the voice model's performance tags ([laughing], [short pause]…)
// at the cursor, so nobody has to remember them. The tags are acted on by the voice, never read aloud, and are
// stripped from captions and counts (src/utils/audioTags.ts).

interface Props {
  target: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
}

export const AudioTagBar: React.FC<Props> = ({ target, value, onChange }) => {
  const [open, setOpen] = useState(false);

  const insert = (tag: string) => {
    const el = target.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const piece = `${before && !/\s$/.test(before) ? ' ' : ''}[${tag}]${after && !/^\s/.test(after) ? ' ' : ''}`;
    onChange(before + piece + after);
    // Put the cursor right after the inserted tag
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + piece.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-300 hover:text-white">
        <span className="flex items-center gap-1.5 font-semibold"><Smile className="w-3.5 h-3.5 text-amber-400" /> أضف تعبيراً للصوت: ضحكة، وقفة، همس، حماس…</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {AUDIO_TAG_GROUPS.map(g => (
            <div key={g.title} className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 w-12 shrink-0">{g.title}</span>
              {g.tags.map(t => (
                <button key={t.tag} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insert(t.tag)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs hover:border-amber-500/60 hover:text-amber-200">
                  {t.label}
                </button>
              ))}
            </div>
          ))}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            ضع المؤشر قبل الجملة ثم اختر التعبير. يظهر في النص بالإنجليزية بين قوسين مثل [laughing]، فيؤديه الصوت ولا يقرؤه،
            ولا يظهر في ترجمة الفيديو.
          </p>
        </div>
      )}
    </div>
  );
};
