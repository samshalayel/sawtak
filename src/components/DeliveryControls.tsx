import React from 'react';
import { LANGUAGES, TONE_STYLES } from '../data/presets';
import { Sliders, Globe, Radio, Gauge, Music, Sparkles } from 'lucide-react';

interface DeliveryControlsProps {
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  selectedDialect: string;
  onDialectChange: (dialect: string) => void;
  selectedTone: string;
  onToneChange: (tone: string) => void;
  customStylePrompt: string;
  onCustomStylePromptChange: (val: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
}

export const DeliveryControls: React.FC<DeliveryControlsProps> = ({
  selectedLanguage,
  onLanguageChange,
  selectedDialect,
  onDialectChange,
  selectedTone,
  onToneChange,
  customStylePrompt,
  onCustomStylePromptChange,
  speed,
  onSpeedChange,
  pitch,
  onPitchChange,
}) => {
  const currentLang = LANGUAGES.find(l => l.code === selectedLanguage) || LANGUAGES[0];

  const handleLanguageChange = (code: string) => {
    onLanguageChange(code);
    const lang = LANGUAGES.find(l => l.code === code);
    if (lang && lang.dialects.length > 0) {
      onDialectChange(lang.dialects[0].id);
    }
  };

  const getPitchLabel = (val: number) => {
    if (val <= -1) return 'نبرة عميقة ورخيمة (Bass / Low)';
    if (val === 0) return 'نبرة طبيعية متوازنة (Normal)';
    return 'نبرة مشرقة ومرتفعة (Bright / High)';
  };

  const getSpeedLabel = (val: number) => {
    if (val < 0.9) return 'هادئ وبطيء (Slow)';
    if (val <= 1.1) return 'معتدل وطبيعي (Standard)';
    return 'سريع وحيوي (Fast)';
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-5">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white">تخصيص الإلقاء والنبرة واللهجة</h2>
        </div>
        <span className="text-xs text-slate-500 font-mono">Audio Pacing & Tone</span>
      </div>

      {/* Row 1: Language & Dialect */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Language Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span>اللغة الرئيسية</span>
          </label>
          <div className="relative">
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500 appearance-none cursor-pointer"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.nameAr} ({lang.nameEn})
                </option>
              ))}
            </select>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
              ▼
            </div>
          </div>
        </div>

        {/* Dialect / Accent Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-amber-400" />
            <span>اللهجة واللكنة المحلية</span>
          </label>
          <div className="relative">
            <select
              value={selectedDialect}
              onChange={(e) => onDialectChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500 appearance-none cursor-pointer"
            >
              {currentLang.dialects.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.flag ? `${d.flag} ` : ''}{d.nameAr}
                </option>
              ))}
            </select>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-xs">
              ▼
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Tone & Delivery Style */}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>أسلوب الإلقاء والنبرة (Tone & Mood)</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TONE_STYLES.map((tone) => {
            const isSelected = selectedTone === tone.id;
            return (
              <button
                key={tone.id}
                type="button"
                onClick={() => onToneChange(tone.id)}
                className={`p-2.5 rounded-xl border text-right transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500/80 text-amber-300 ring-1 ring-amber-500/20'
                    : 'bg-slate-950/70 border-slate-800/80 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                }`}
                title={tone.description}
              >
                <div className="text-xs font-bold mb-1">{tone.nameAr}</div>
                <div className="text-[10px] text-slate-500 line-clamp-1">{tone.description}</div>
              </button>
            );
          })}
        </div>

        {/* Optional Custom Style Prompt */}
        {selectedTone === 'custom' && (
          <div className="mt-3">
            <input
              type="text"
              value={customStylePrompt}
              onChange={(e) => onCustomStylePromptChange(e.target.value)}
              placeholder="اكتب توجيه النبرة، مثال: بصوت دافئ كراوي حكايات للأطفال مع نبرة حماسية خفيفة..."
              className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
        )}
      </div>

      {/* Row 3: Speed & Pitch Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-slate-800/60">
        {/* Speed / Pacing */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              <span>سرعة الإلقاء</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">{getSpeedLabel(speed)}</span>
              <span className="font-mono font-bold text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                {speed.toFixed(2)}x
              </span>
            </div>
          </div>

          <input
            type="range"
            min="0.6"
            max="1.75"
            step="0.05"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
          />

          {/* Speed Presets */}
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <button
              type="button"
              onClick={() => onSpeedChange(0.8)}
              className="hover:text-amber-300"
            >
              0.8x هادئ
            </button>
            <button
              type="button"
              onClick={() => onSpeedChange(1.0)}
              className="hover:text-amber-300 font-bold text-slate-300"
            >
              1.0x قياسي
            </button>
            <button
              type="button"
              onClick={() => onSpeedChange(1.25)}
              className="hover:text-amber-300"
            >
              1.25x نشط
            </button>
            <button
              type="button"
              onClick={() => onSpeedChange(1.5)}
              className="hover:text-amber-300"
            >
              1.5x سريع
            </button>
          </div>
        </div>

        {/* Pitch / Vocal Timbre */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-amber-400" />
              <span>نبرة وارتفاع الصوت (Pitch)</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">{getPitchLabel(pitch)}</span>
              <span className="font-mono font-bold text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                {pitch > 0 ? `+${pitch}` : pitch}
              </span>
            </div>
          </div>

          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={pitch}
            onChange={(e) => onPitchChange(parseInt(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
          />

          {/* Pitch Presets */}
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <button
              type="button"
              onClick={() => onPitchChange(-1)}
              className="hover:text-amber-300"
            >
              -1 رخيم
            </button>
            <button
              type="button"
              onClick={() => onPitchChange(0)}
              className="hover:text-amber-300 font-bold text-slate-300"
            >
              0 متوازن
            </button>
            <button
              type="button"
              onClick={() => onPitchChange(1)}
              className="hover:text-amber-300"
            >
              +1 مشرق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
