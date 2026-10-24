import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { Voice } from '../types/tts';
import { VoiceSelector } from './VoiceSelector';

export interface DialogueSpeaker {
  name: string;
  voiceId: string;
}

interface DialogueVoicePickerProps {
  voices: Voice[];
  speakers: [DialogueSpeaker, DialogueSpeaker];
  onChange: (speakers: [DialogueSpeaker, DialogueSpeaker]) => void;
  selectedLanguage: string;
}

const SPEAKER_COLORS = [
  'border-amber-500/70 bg-amber-500/10 ring-amber-500/30',
  'border-sky-500/70 bg-sky-500/10 ring-sky-500/30',
];

export const DialogueVoicePicker: React.FC<DialogueVoicePickerProps> = ({ voices, speakers, onChange, selectedLanguage }) => {
  const [active, setActive] = useState<0 | 1>(0);

  const update = (index: 0 | 1, patch: Partial<DialogueSpeaker>) => {
    const next: [DialogueSpeaker, DialogueSpeaker] = [{ ...speakers[0] }, { ...speakers[1] }];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const sameName = speakers[0].name.trim() !== '' && speakers[0].name.trim() === speakers[1].name.trim();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-white">المتحدثان في الحوار</h2>
        <span className="text-xs text-slate-500">· اختر اسماً وصوتاً لكل متحدث</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {speakers.map((speaker, i) => {
          const index = i as 0 | 1;
          const voice = voices.find(v => v.id === speaker.voiceId);
          const isActive = active === index;
          return (
            <div
              key={index}
              onClick={() => setActive(index)}
              className={`rounded-xl border p-3 cursor-pointer transition-all ${
                isActive ? `${SPEAKER_COLORS[index]} ring-1` : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="text-[11px] text-slate-400 mb-1.5">المتحدث {index + 1}</div>
              <input
                value={speaker.name}
                onChange={e => update(index, { name: e.target.value.replace(/[:：]/g, '').slice(0, 30) })}
                onFocus={() => setActive(index)}
                placeholder="الاسم"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                {voice?.avatar && <img src={voice.avatar} alt={voice.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                <span>
                  الصوت: <b className="text-white">{voice?.name ?? '—'}</b>
                  <span className="text-slate-500"> · {voice?.gender === 'female' ? 'نسائي' : 'رجالي'}</span>
                </span>
              </div>
              {isActive && <div className="mt-1 text-[11px] text-amber-300">↓ اختر صوت {speaker.name || `المتحدث ${index + 1}`} من القائمة</div>}
            </div>
          );
        })}
      </div>

      {sameName && <p className="text-xs text-rose-300">يجب أن يكون لكل متحدث اسم مختلف.</p>}
      {speakers[0].voiceId === speakers[1].voiceId && (
        <p className="text-xs text-amber-300">تنبيه: المتحدثان بنفس الصوت. اختر صوتين مختلفين ليكون الحوار أوضح.</p>
      )}

      <VoiceSelector
        voices={voices}
        selectedVoiceId={speakers[active].voiceId}
        onSelectVoice={voiceId => update(active, { voiceId })}
        selectedLanguage={selectedLanguage}
      />
    </div>
  );
};
