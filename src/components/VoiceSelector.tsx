import React, { useEffect, useRef, useState } from 'react';
import { Voice } from '../types/tts';
import { Play, Square, Check, User, Loader2, Copy, X, Star } from 'lucide-react';

interface VoiceSelectorProps {
  voices: Voice[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  selectedLanguage: string;
  // Optional "clone this sample" action (single-voice mode only)
  cloneVoiceId?: string | null;
  onToggleClone?: (voiceId: string) => void;
  // Hide the title and gender filter (used when showing a single locked card)
  compact?: boolean;
  // Starred voices: a "favourites" tab and a star on each card
  favorites?: string[];
  onToggleFavorite?: (voiceId: string) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  selectedLanguage,
  cloneVoiceId,
  onToggleClone,
  compact = false,
  favorites = [],
  onToggleFavorite,
}) => {
  const [filterGender, setFilterGender] = useState<'fav' | 'all' | 'female' | 'male'>(favorites.length ? 'fav' : 'all');
  // Favourites arrive with the account a moment after the page opens: switch to them unless the user already
  // chose a tab or starred something (starring from "all" must not yank the list away)
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current && favorites.length && filterGender === 'all') setFilterGender('fav');
  }, [favorites.length]);
  const chooseFilter = (f: 'fav' | 'all' | 'female' | 'male') => {
    touched.current = true;
    setFilterGender(f);
  };
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const filteredVoices = voices.filter(v => {
    if (filterGender === 'all') return true;
    if (filterGender === 'fav') return favorites.includes(v.id);
    return v.gender === filterGender;
  });

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewingVoiceId(null);
    setLoadingVoiceId(null);
  };

  const handlePreview = (e: React.MouseEvent, voice: Voice) => {
    e.stopPropagation();
    const wasActive = previewingVoiceId === voice.id || loadingVoiceId === voice.id;
    stopPreview();
    if (wasActive) return;

    // Real Gemini-generated showcase sample (cached on the server after the first request)
    const audio = new Audio(`/api/tts/preview/${voice.id}`);
    audioRef.current = audio;
    setLoadingVoiceId(voice.id);

    audio.onplaying = () => {
      setLoadingVoiceId(null);
      setPreviewingVoiceId(voice.id);
    };
    audio.onended = () => {
      if (audioRef.current === audio) stopPreview();
    };
    audio.onerror = () => {
      if (audioRef.current === audio) stopPreview();
    };
    audio.play().catch(() => {
      if (audioRef.current === audio) stopPreview();
    });
  };

  return (
    <div className="space-y-3">
      {/* Header and Gender Filter */}
      {!compact && (
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-white">اختر الصوت (المؤدي الصوتي)</h2>
          <span className="text-xs text-slate-500">· {voices.length} صوت استوديو</span>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => chooseFilter('fav')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                filterGender === 'fav' ? 'bg-slate-800 text-yellow-300 font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Star className={`w-3 h-3 ${filterGender === 'fav' ? 'fill-current' : ''}`} />
              المفضلة{favorites.length ? ` (${favorites.length})` : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => chooseFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filterGender === 'all'
                ? 'bg-slate-800 text-white font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            الكل
          </button>
          <button
            type="button"
            onClick={() => chooseFilter('female')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filterGender === 'female'
                ? 'bg-slate-800 text-amber-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            نسائي
          </button>
          <button
            type="button"
            onClick={() => chooseFilter('male')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filterGender === 'male'
                ? 'bg-slate-800 text-blue-300 font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            رجالي
          </button>
        </div>
      </div>
      )}

      {filterGender === 'fav' && filteredVoices.length === 0 && (
        <div className="text-xs text-slate-400 bg-slate-900/60 border border-dashed border-slate-700 rounded-xl px-4 py-6 text-center leading-relaxed">
          لا توجد أصوات مفضلة بعد. اضغط النجمة <Star className="w-3.5 h-3.5 inline text-yellow-400" /> على أي صوت في «الكل» لتجده هنا مباشرة.
        </div>
      )}

      {/* Voice Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {filteredVoices.map((voice) => {
          const isSelected = selectedVoiceId === voice.id;
          const isPreviewing = previewingVoiceId === voice.id;
          const isLoading = loadingVoiceId === voice.id;

          return (
            <div
              key={voice.id}
              onClick={() => onSelectVoice(voice.id)}
              className={`group relative p-3 rounded-xl border text-right cursor-pointer transition-all duration-200 ${
                isSelected
                  ? 'bg-gradient-to-b from-amber-500/10 via-slate-900 to-slate-900/90 border-amber-500/80 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30'
                  : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700/80'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                {/* Avatar & Voice Info */}
                <div className="flex items-center gap-2.5">
                  {voice.avatar ? (
                    <img
                      src={voice.avatar}
                      alt={voice.name}
                      loading="lazy"
                      className="w-11 h-11 rounded-xl object-cover shadow-inner shrink-0 ring-1 ring-slate-700/60"
                    />
                  ) : (
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${voice.avatarColor} flex items-center justify-center text-white font-bold text-base shadow-inner shrink-0`}>
                      {voice.name[0]}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className={`text-xs sm:text-sm font-bold tracking-tight ${isSelected ? 'text-amber-300' : 'text-slate-200'}`}>
                        {voice.name}
                      </h3>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-amber-400 stroke-[3]" />
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {voice.gender === 'female' ? 'مؤدية صوتية' : 'مؤدٍ صوتي'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                {onToggleFavorite && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); touched.current = true; onToggleFavorite(voice.id); }}
                    className={`p-1.5 rounded-lg transition-colors ${favorites.includes(voice.id) ? 'text-yellow-400' : 'text-slate-500 hover:text-yellow-300'}`}
                    title={favorites.includes(voice.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                    aria-label={favorites.includes(voice.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                    aria-pressed={favorites.includes(voice.id)}
                  >
                    <Star className={`w-4 h-4 ${favorites.includes(voice.id) ? 'fill-current' : ''}`} />
                  </button>
                )}
                {onToggleClone && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleClone(voice.id); }}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                      cloneVoiceId === voice.id
                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                    title={cloneVoiceId === voice.id ? 'إلغاء الاستنساخ والعودة لإعداداتك' : 'اكتب نصك وسيُقرأ بنفس أداء هذه العينة تماماً'}
                  >
                    {cloneVoiceId === voice.id ? <X className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{cloneVoiceId === voice.id ? 'إلغاء' : 'انسخ الأسلوب'}</span>
                  </button>
                )}
                {/* Quick Sample Audio Button */}
                <button
                  type="button"
                  onClick={(e) => handlePreview(e, voice)}
                  className={`p-1.5 rounded-lg border text-xs transition-colors shrink-0 ${
                    isPreviewing
                      ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse'
                      : isLoading
                        ? 'bg-slate-800 text-amber-300 border-amber-500/40'
                        : 'bg-slate-800/90 text-slate-300 border-slate-700/70 hover:bg-slate-700 hover:text-white'
                  }`}
                  title="استماع لعيّنة صوتية سريعة"
                  aria-label={`استماع لعيّنة ${voice.name}`}
                >
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isPreviewing ? (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                </button>
                </div>
              </div>

              {/* Description */}
              <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-2">
                {voice.toneAr}
              </p>

              {/* Tags (clean unboxed inline text separated by subtle middots) */}
              <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center gap-1.5 text-[11px] text-slate-500">
                {voice.tags.map((tag, idx) => (
                  <React.Fragment key={tag}>
                    <span>{tag}</span>
                    {idx < voice.tags.length - 1 && <span aria-hidden="true">·</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
