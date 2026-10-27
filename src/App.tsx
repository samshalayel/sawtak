import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { VoiceSelector } from './components/VoiceSelector';
import { DeliveryControls } from './components/DeliveryControls';
import { ScriptEditor } from './components/ScriptEditor';
import { AudioStudioPlayer } from './components/AudioStudioPlayer';
import { HistoryDrawer } from './components/HistoryDrawer';
import { AuthModal } from './components/AuthModal';
import { AdminPage } from './components/AdminPage';
import { PackagesModal } from './components/PackagesModal';
import { VideoMakerModal } from './components/VideoMakerModal';
import { TermsPage } from './components/TermsPage';
import { GreetingsPage } from './components/GreetingsPage';
import { PressPage } from './components/PressPage';
import { CalmPage } from './components/CalmPage';
import { MedicalPage } from './components/MedicalPage';
import { QuranShowcase } from './components/QuranShowcase';
import { BetaRibbon } from './components/BetaRibbon';
import { MotionTab } from './components/MotionTab';
import { MobileAppNav } from './components/MobileAppNav';
import { PartyPopper, Newspaper, Leaf, Stethoscope, BookOpen } from 'lucide-react';
import { LandingPage } from './components/LandingPage';
import { DialogueVoicePicker, DialogueSpeaker } from './components/DialogueVoicePicker';
import { DialogueEditor } from './components/DialogueEditor';
import { DIALOGUE_TEMPLATES, DialogueTemplate, parseDialogueScript, renderTemplate } from './data/dialogues';
import { VOICES, LANGUAGES, TONE_STYLES } from './data/presets';
import { HistoryItem, SampleScript } from './types/tts';
import { AuthUser, DEFAULT_PRICES, PublicConfig, ServiceId, formatCredits } from './types/auth';
import { base64ToBlobUrl, estimateDuration } from './utils/audio';
import { showGenerationSuccess, showStudioAlert } from './utils/alerts';
import { saveDraft, loadDraft, clearDraft } from './utils/draft';
import { useFavoriteVoices } from './utils/favorites';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  User,
  FileText,
  Sliders,
  Wand2,
  Clock,
  CheckCircle2,
  RotateCcw,
  MailWarning,
  Mic,
  Users,
  Copy,
  Lock,
  Film
} from 'lucide-react';

// "home" = landing page for visitors (logged-in users land in the studio)
type View = 'home' | 'studio' | 'admin' | 'terms' | 'greetings' | 'press' | 'calm' | 'quran' | 'motion' | 'medical';
const readView = (): View => {
  const hash = window.location.hash;
  if (hash === '#/admin') return 'admin';
  if (hash === '#/terms') return 'terms';
  if (hash === '#/greetings') return 'greetings';
  if (hash === '#/press') return 'press';
  if (hash === '#/calm') return 'calm';
  if (hash === '#/quran') return 'quran';
  if (hash === '#/motion') return 'motion';
  if (hash === '#/medical') return 'medical';
  if (hash === '#/studio') return 'studio';
  const appLike = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(max-width: 639px)').matches;
  return appLike ? 'studio' : 'home';
};

const INITIAL_TEXT = `أهلاً بكم في استوديو صوتك الذكي! هذا الاستوديو يمنحك صوتاً طبيعياً فائق النقاء، مع تحكم دقيق بنبرة الإلقاء وسرعة الصوت ومخارج الحروف. جرّب الآن مختلف الأصوات واللهجات واستمتع بتجربة إلقاء احترافية.`;

const STEPS = [
  { id: 1, title: 'اختر الصوت', hint: 'استمع للعينات واختر المؤدي', icon: User },
  { id: 2, title: 'اكتب النص', hint: 'اكتب نصك أو اختر نموذجاً جاهزاً', icon: FileText },
  { id: 3, title: 'خصّص الأداء', hint: 'اللهجة، النبرة، والسرعة', icon: Sliders },
  { id: 4, title: 'ولّد الصوت', hint: 'راجع واستمع وحمّل', icon: Wand2 },
] as const;

/** A home-page entry to one service: a white card framed in the service's colour. */
const HomeEntry: React.FC<{ href: string; icon: React.ElementType; color: string; title: string; text: string; cta: string }> = ({ href, icon: Icon, color, title, text, cta }) => (
  <a href={href} className="group flex items-center gap-3 rounded-2xl px-4 py-3 bg-slate-900 border-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition" style={{ borderColor: color }}>
    <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}1a`, color }}>
      <Icon className="w-6 h-6" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="font-extrabold text-sm" style={{ color }}>{title}</div>
      <div className="text-xs text-slate-400">{text}</div>
    </div>
    <span className="text-xs font-bold text-[#ffffff] rounded-lg px-2.5 py-1 whitespace-nowrap group-hover:brightness-110" style={{ backgroundColor: color }}>{cta}</span>
  </a>
);

export default function App() {
  // Auth
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [config, setConfig] = useState<PublicConfig>({ signupBonusCredits: 0, maxTextChars: 3000, contactWhatsapp: '', googleEnabled: false, prices: DEFAULT_PRICES });
  // Admins can browse as a customer: stopped services then hide for them too (kept per browser)
  const [viewAsCustomer, setViewAsCustomer] = useState(() => localStorage.getItem('sawtik_view_as_customer') === '1');
  const toggleViewAsCustomer = () => setViewAsCustomer(v => {
    localStorage.setItem('sawtik_view_as_customer', v ? '0' : '1');
    return !v;
  });
  // A stopped service is hidden from customers; admins keep using it to test (the server enforces the same rule)
  const serviceOn = (id: ServiceId) => (user?.role === 'admin' && !viewAsCustomer) || config.services?.[id] !== false;
  // The voice studio (editor and generate button) shows while single voice or dialogue is on
  const studioOn = serviceOn('tts') || serviceOn('dialogue');
  // Without the studio, Quran reels lead the home page (a large showcase with a real reel instead of a small card)
  const quranShowcase = !studioOn && serviceOn('quran');
  const [showPackages, setShowPackages] = useState(false);
  const [showVideoMaker, setShowVideoMaker] = useState(false);
  const [authPrompt, setAuthPrompt] = useState<{ mode: 'login' | 'register'; reason?: string } | null>(null);
  const [view, setView] = useState<View>(readView);
  // A page whose service an admin has stopped goes back to the home page (once the account and settings are known)
  const viewStopped = (['press', 'greetings', 'calm', 'quran', 'motion', 'medical'] as const).some(v => view === v && !serviceOn(v));
  useEffect(() => {
    if (authLoaded && viewStopped) window.location.hash = '#/';
  }, [authLoaded, viewStopped]);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const { favorites, toggle: toggleFavorite } = useFavoriteVoices(user, setUser);

  const refreshMe = () =>
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        setUser(d.user ?? null);
        if (d.config) setConfig(d.config);
        return d.user as AuthUser | null;
      })
      .catch(() => null);

  useEffect(() => {
    // Server redirects land on these hashes (verification link, Google sign-in)
    const handleAuthRedirect = async () => {
      const hash = window.location.hash;
      const outcomes: Record<string, () => Promise<unknown>> = {
        '#/email-verified': async () => {
          const u = await refreshMe();
          return showStudioAlert('success', 'تم تأكيد بريدك بنجاح', u && u.credits > 0
            ? `تم تفعيل حسابك وإضافة رصيدك: ${formatCredits(u.credits)}. استمتع بتوليد الأصوات!`
            : 'تم تفعيل حسابك، يمكنك الآن توليد الأصوات.');
        },
        '#/verify-failed': () => showStudioAlert('error', 'رابط غير صالح', 'رابط التأكيد غير صالح أو منتهي الصلاحية. سجّل الدخول واطلب رابطاً جديداً من الشريط أعلى الصفحة.'),
        '#/google-error': () => showStudioAlert('error', 'تعذّر الدخول بحساب Google', 'حدث خطأ أثناء تسجيل الدخول بحساب Google، يرجى المحاولة مرة أخرى.'),
        '#/account-disabled': () => showStudioAlert('error', 'الحساب موقوف', 'تم إيقاف هذا الحساب، يرجى التواصل مع الدعم.'),
      };
      const outcome = outcomes[hash];
      if (outcome) {
        window.history.replaceState(null, '', '#/');
        await outcome();
      }
    };

    refreshMe().finally(() => {
      setAuthLoaded(true);
      handleAuthRedirect();
    });

    const onHashChange = () => {
      setView(readView());
      handleAuthRedirect();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleResendVerification = async () => {
    setResendState('sending');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setResendState('sent');
    } catch (err: any) {
      setResendState('idle');
      setErrorMessage(err instanceof TypeError || !err?.message ? 'تعذّر الإرسال حالياً، يرجى المحاولة لاحقاً' : err.message);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    window.location.hash = '#/';
  };

  // Work saved before a sign-in redirect comes back exactly as it was, on the generate step
  const [restoredDraft] = useState(loadDraft);
  const [step, setStep] = useState<number>(restoredDraft ? 4 : 1);
  const [maxReachedStep, setMaxReachedStep] = useState<number>(restoredDraft ? 4 : 1);

  const [text, setText] = useState<string>(restoredDraft?.text ?? INITIAL_TEXT);
  const [voiceId, setVoiceId] = useState<string>(restoredDraft?.voiceId ?? 'Kore');
  const [language, setLanguage] = useState<string>(restoredDraft?.language ?? 'ar');
  const [dialect, setDialect] = useState<string>(restoredDraft?.dialect ?? 'msa');
  const [toneStyle, setToneStyle] = useState<string>(restoredDraft?.toneStyle ?? 'professional_news');
  const [customStylePrompt, setCustomStylePrompt] = useState<string>(restoredDraft?.customStylePrompt ?? '');
  const [speed, setSpeed] = useState<number>(restoredDraft?.speed ?? 1.0);
  const [pitch, setPitch] = useState<number>(restoredDraft?.pitch ?? 0);

  // "Clone sample style": locks every setting to a voice's showcase sample; only the text is editable.
  // The user's own settings are never touched, so they are back as soon as clone mode ends.
  const [cloneVoiceId, setCloneVoiceId] = useState<string | null>(restoredDraft?.cloneVoiceId ?? null);
  const cloneVoice = cloneVoiceId ? VOICES.find(v => v.id === cloneVoiceId) ?? null : null;
  const toggleClone = (voiceId: string) => {
    setCloneVoiceId(prev => (prev === voiceId ? null : voiceId));
    setErrorMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Two-speaker dialogue mode (podcast / interview)
  const [mode, setMode] = useState<'single' | 'dialogue'>(restoredDraft?.mode ?? 'single');
  // A stopped mode switches to the other one when it is still on
  useEffect(() => {
    if (mode === 'single' && !serviceOn('tts') && serviceOn('dialogue')) setMode('dialogue');
    else if (mode === 'dialogue' && !serviceOn('dialogue') && serviceOn('tts')) setMode('single');
  }, [mode, config.services, user?.role]);
  const [speakers, setSpeakers] = useState<[DialogueSpeaker, DialogueSpeaker]>(restoredDraft?.speakers ?? [
    { name: 'أحمد', voiceId: 'Puck' },
    { name: 'سارة', voiceId: 'Kore' },
  ]);
  const [dialogueScript, setDialogueScript] = useState<string>(() => restoredDraft?.dialogueScript ?? renderTemplate(DIALOGUE_TEMPLATES[0], ['أحمد', 'سارة']));

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  // Settings fingerprint of the audio currently in the player, to tell "done" apart from "ready to generate"
  const [lastGeneratedKey, setLastGeneratedKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio Player State
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentAudioBase64, setCurrentAudioBase64] = useState<string | undefined>(undefined);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // History State
  // History lives in memory only: generated texts and audio are never stored, not even in the browser,
  // so a refresh or closing the page clears everything
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    // Remove what earlier versions kept in this browser (history and sign-in drafts)
    try {
      localStorage.removeItem('sawtik_tts_history');
      localStorage.removeItem('sawtik_pending_draft');
    } catch {
      // storage disabled: nothing to remove
    }
  }, []);

  const selectedVoice = VOICES.find(v => v.id === voiceId) || VOICES[0];
  const selectedTone = TONE_STYLES.find(t => t.id === toneStyle) || TONE_STYLES[0];
  const currentLang = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];
  const currentDialect = currentLang.dialects.find(d => d.id === dialect) || currentLang.dialects[0];
  const speakerNames: [string, string] = [speakers[0].name.trim(), speakers[1].name.trim()];
  const dialogue = parseDialogueScript(dialogueScript, speakerNames);
  const speakersValid = Boolean(speakerNames[0] && speakerNames[1] && speakerNames[0] !== speakerNames[1]);
  const dialogueValid = speakersValid && dialogue.lines.length > 0 && dialogue.unknownSpeakers.length === 0;
  // The text that will actually be spoken (used for estimates and history)
  const spokenText = mode === 'single' ? text.trim() : dialogue.lines.map(l => l.text).join(' ');

  const generationKey = JSON.stringify(
    mode === 'single'
      ? [mode, cloneVoiceId, text.trim(), voiceId, dialect, toneStyle, customStylePrompt, speed, pitch]
      : [mode, dialogueScript.trim(), speakers, dialect, toneStyle, customStylePrompt, speed]
  );

  const canAdvance =
    step === 1 ? (mode === 'single' || speakersValid) :
    step === 2 ? (mode === 'single' ? text.trim().length > 0 : dialogueValid) :
    true;

  const handleModeChange = (next: 'single' | 'dialogue') => {
    if (next === mode) return;
    setMode(next);
    setStep(1);
    setMaxReachedStep(1);
    if (next === 'dialogue' && toneStyle === 'professional_news') setToneStyle('conversational_warm');
  };

  // Renaming a speaker also renames their lines in the script. The last non-empty name is
  // remembered so clearing the field and typing a new name still updates the right lines.
  const lastSpeakerNames = useRef<[string, string]>(
    restoredDraft ? [restoredDraft.speakers[0].name.trim(), restoredDraft.speakers[1].name.trim()] : ['أحمد', 'سارة']
  );
  const handleSpeakersChange = (next: [DialogueSpeaker, DialogueSpeaker]) => {
    let script = dialogueScript;
    next.forEach((s, i) => {
      const oldName = lastSpeakerNames.current[i];
      const newName = s.name.trim();
      if (!newName) return;
      if (oldName && oldName !== newName) {
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        script = script.replace(new RegExp(`^(\\s*)${escaped}(\\s*[:：])`, 'gm'), `$1${newName}$2`);
      }
      lastSpeakerNames.current[i] = newName;
    });
    setDialogueScript(script);
    setSpeakers(next);
  };

  const handleApplyDialogueTemplate = (template: DialogueTemplate) => {
    setToneStyle(template.recommendedTone);
    const lang = LANGUAGES.find(l => l.dialects.some(d => d.id === template.recommendedDialect));
    if (lang) setLanguage(lang.code);
    setDialect(template.recommendedDialect);
  };

  const goToStep = (target: number) => {
    if (target < 1 || target > STEPS.length) return;
    if (target > maxReachedStep + 1) return;
    if (target > step && !canAdvance) return;
    setStep(target);
    setMaxReachedStep(prev => Math.max(prev, target));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Templates fill the text and suggest tone/dialect, but keep the voice the user already picked in step 1
  const handleApplyTemplate = (script: SampleScript) => {
    setText(script.text);
    if (script.recommendedTone) setToneStyle(script.recommendedTone);
    if (script.recommendedDialect) {
      const lang = LANGUAGES.find(l => l.dialects.some(d => d.id === script.recommendedDialect));
      if (lang) setLanguage(lang.code);
      setDialect(script.recommendedDialect);
    }
  };

  // Sign-in may leave the page (Google, e-mail link), so park the current work until the user is back
  const keepDraftForSignIn = () =>
    saveDraft({ mode, text, voiceId, cloneVoiceId, language, dialect, toneStyle, customStylePrompt, speed, pitch, speakers, dialogueScript });

  // Once signed in, the parked work has been restored into the studio
  useEffect(() => {
    if (user) clearDraft();
  }, [user]);

  const handleGenerate = async () => {
    if (mode === 'single' && !text.trim()) {
      setErrorMessage('يرجى كتابة نص في مربع الإلقاء أولاً');
      setStep(2);
      return;
    }
    if (mode === 'dialogue' && !dialogueValid) {
      setErrorMessage('يرجى مراجعة نص الحوار وأسماء المتحدثين أولاً');
      setStep(2);
      return;
    }

    if (!user) {
      keepDraftForSignIn();
      setAuthPrompt({ mode: 'register', reason: 'سجّل حساباً مجانياً لتوليد الصوت وتحميله.' });
      return;
    }

    setErrorMessage(null);
    setIsGenerating(true);

    try {
      const response = mode === 'single'
        ? await fetch('/api/tts/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: text.trim(),
              voice: cloneVoiceId ?? voiceId,
              cloneSample: Boolean(cloneVoiceId),
              language,
              dialect,
              toneStyle,
              customStylePrompt,
              speed,
              pitch
            }),
          })
        : await fetch('/api/tts/dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              speakers: speakers.map(s => ({ name: s.name.trim(), voice: s.voiceId })),
              lines: dialogue.lines,
              dialect,
              toneStyle,
              customStylePrompt,
              speed,
            }),
          });

      const data = await response.json();

      if (response.status === 401) {
        setUser(null);
        keepDraftForSignIn();
        setAuthPrompt({ mode: 'login', reason: 'انتهت جلستك، يرجى تسجيل الدخول مجدداً.' });
        return;
      }
      if (typeof data.balance === 'number') {
        setUser(prev => (prev ? { ...prev, credits: data.balance } : prev));
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل توليد الصوت من نموذج الذكاء الاصطناعي');
      }

      const blobUrl = base64ToBlobUrl(data.audioBase64, 'audio/wav');
      setCurrentAudioUrl(blobUrl);
      setCurrentAudioBase64(data.audioBase64);

      const speakerVoices = speakers.map(s => VOICES.find(v => v.id === s.voiceId)?.name ?? s.voiceId);
      const newItem: HistoryItem = {
        id: Date.now().toString(),
        text: mode === 'single' ? text.trim() : dialogueScript.trim(),
        title: (mode === 'dialogue' ? `حوار ${speakerNames.join(' و ')}: ` : '') + spokenText.slice(0, 32) + (spokenText.length > 32 ? '...' : ''),
        audioUrl: blobUrl,
        audioBase64: data.audioBase64,
        voice: cloneVoice ? cloneVoice.id : mode === 'single' ? selectedVoice.id : speakers.map(s => s.voiceId).join('+'),
        voiceName: cloneVoice ? `${cloneVoice.name} (نسخة أسلوب العينة)` : mode === 'single' ? selectedVoice.name : speakerVoices.join(' و '),
        language: currentLang.nameAr,
        // Clone-mode clips describe the sample's delivery, not the user's settings
        dialect: cloneVoice ? 'مطابقة للعينة' : currentDialect.nameAr,
        toneStyle: cloneVoice ? 'نفس أداء العينة' : selectedTone.nameAr,
        speed: speed,
        pitch: pitch,
        durationSeconds: data.durationSeconds,
        createdAt: new Date().toLocaleTimeString('ar-EG'),
        engine: 'gemini'
      };

      setHistory(prev => [newItem, ...prev]);
      setActiveHistoryId(newItem.id);
      setLastGeneratedKey(generationKey);
      if (cloneVoiceId) {
        // Clone mode is one-shot: restore the user's own settings and show the result in the player
        setCloneVoiceId(null);
        setLastGeneratedKey(null);
        setStep(4);
        setMaxReachedStep(4);
      }

      showGenerationSuccess({
        durationSeconds: data.durationSeconds ?? 0,
        charged: data.creditsCharged ?? 0,
        balance: data.balance ?? 0,
      }).then(() => {
        const player = document.getElementById('studio-player');
        player?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        player?.querySelector('audio')?.play().catch(() => {});
      });
    } catch (err: any) {
      console.error('Speech generation failed:', err);
      // Network/parse failures carry browser-generated English text; only show our own server messages
      const isServerMessage = !(err instanceof TypeError || err instanceof SyntaxError) && err?.message;
      setErrorMessage(isServerMessage ? err.message : 'تعذّر إتمام الطلب حالياً، يرجى المحاولة لاحقاً. شكراً لتفهمكم.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectHistoryItem = (item: HistoryItem) => {
    setActiveHistoryId(item.id);
    if (item.audioUrl) {
      setCurrentAudioUrl(item.audioUrl);
      setCurrentAudioBase64(item.audioBase64);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    setActiveHistoryId(null);
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(i => i.id !== id));
    if (activeHistoryId === id) setActiveHistoryId(null);
  };

  const handleResetSession = () => {
    setText(INITIAL_TEXT);
    setVoiceId('Kore');
    setLanguage('ar');
    setDialect('msa');
    setToneStyle('professional_news');
    setSpeed(1.0);
    setPitch(0);
    setCurrentAudioUrl(null);
    setStep(1);
    setMaxReachedStep(1);
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter generates on the last step
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && step === 4 && studioOn) {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, user, mode, text, dialogueScript, speakers, voiceId, language, dialect, toneStyle, customStylePrompt, speed, pitch, studioOn]);

  const isAdminView = view === 'admin' && user?.role === 'admin';
  // Mirrors the server's reservation: dialogues get ~10% extra for turn-taking pauses
  const estimatedSeconds = Math.ceil(estimateDuration(spokenText, cloneVoice ? 1 : speed).seconds * (mode === 'dialogue' ? 1.1 : 1));
  const hasEnoughCredits = !user || user.credits >= estimatedSeconds;
  const isAlreadyGenerated = lastGeneratedKey === generationKey && Boolean(currentAudioUrl);

  const wordCount = spokenText.split(/\s+/).filter(Boolean).length;
  const summary = [
    ...(mode === 'single'
      ? [
          { label: 'الصوت', value: selectedVoice.name, step: 1 },
          { label: 'النص', value: `${wordCount} كلمة`, step: 2 },
        ]
      : [
          ...speakers.map(s => ({
            label: s.name.trim(),
            value: VOICES.find(v => v.id === s.voiceId)?.name ?? s.voiceId,
            step: 1,
          })),
          { label: 'الحوار', value: `${dialogue.lines.length} مداخلة · ${wordCount} كلمة`, step: 2 },
        ]),
    { label: 'اللهجة', value: currentDialect.nameAr, step: 3 },
    { label: 'النبرة', value: selectedTone.nameAr, step: 3 },
    { label: 'السرعة', value: `${speed.toFixed(2)}x`, step: 3 },
  ];

  // The player describes the clip it is playing (from history), falling back to the current settings
  const playingItem = history.find(h => h.id === activeHistoryId);

  // What the "turn into video" button converts: the clip in the player
  const videoSource = playingItem?.audioBase64
    ? {
        audioBase64: playingItem.audioBase64,
        voiceId: playingItem.voice,
        // Dialogue scripts carry "Name: line" prefixes; captions show only what is spoken
        text: playingItem.voice.includes('+')
          ? playingItem.text.split('\n').map(l => l.replace(/^[^:：]{1,30}[:：]\s*/, '')).join(' ')
          : playingItem.text,
      }
    : null;

  // Shared by the wizard's last step and the "clone sample style" view
  const generatePanel = (
    <>
    {/* Status / credit box: 1 credit = 1 second of audio */}
    {user && !user.emailVerified ? (
      <div className="flex items-center gap-2 rounded-xl border px-4 py-3 text-xs bg-amber-500/10 border-amber-500/30 text-amber-200">
        <MailWarning className="w-4 h-4 shrink-0" />
        <span>أكّد بريدك الإلكتروني أولاً من الرابط المرسل إليك، وبعدها يمكنك توليد الصوت مباشرة.</span>
      </div>
    ) : isAlreadyGenerated ? (
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-xl border px-4 py-3 text-xs bg-emerald-500/10 border-emerald-500/30">
        <div className="flex items-center gap-2 text-emerald-300 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>تم توليد هذا الصوت بنجاح — استمع له وحمّله من المشغّل أدناه</span>
        </div>
        {user && <span className="text-slate-300">رصيدك المتبقي: {formatCredits(user.credits)}</span>}
      </div>
    ) : (
      <div
        className={`flex items-center justify-between flex-wrap gap-2 rounded-xl border px-4 py-3 text-xs ${
          hasEnoughCredits ? 'bg-slate-900/60 border-slate-800' : 'bg-rose-500/10 border-rose-500/30'
        }`}
      >
        <div className="flex items-center gap-2 text-slate-300">
          <Clock className="w-4 h-4 text-amber-400" />
          <span>
            التكلفة التقديرية: <b className="text-white">~{formatCredits(estimatedSeconds)}</b>
            <span className="text-slate-500"> · يُخصم حسب المدة الفعلية للصوت</span>
          </span>
        </div>
        {user ? (
          hasEnoughCredits ? (
            <span className="text-slate-400">رصيدك: {formatCredits(user.credits)}</span>
          ) : (
            <span className="text-rose-300 font-semibold flex items-center gap-2">
              رصيدك ({formatCredits(user.credits)}) لا يكفي لهذا النص.
              <button
                type="button"
                onClick={() => setShowPackages(true)}
                className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
              >
                اشحن رصيدك
              </button>
            </span>
          )
        ) : (
          config.signupBonusCredits > 0 && (
            <span className="text-emerald-300">
              سجّل مجاناً واحصل على {formatCredits(config.signupBonusCredits)}
            </span>
          )
        )}
      </div>
    )}

    <button
      type="button"
      onClick={handleGenerate}
      disabled={isGenerating || !text.trim() || !hasEnoughCredits || !authLoaded || (user !== null && !user.emailVerified)}
      className={`w-full py-3.5 px-6 rounded-xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-2.5 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
        isAlreadyGenerated
          ? 'bg-slate-900 border border-slate-700 text-slate-200 hover:border-amber-500/50 hover:text-white'
          : 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 shadow-lg shadow-amber-500/20'
      }`}
    >
      {isGenerating ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>جاري توليد الصوت ونقاء مخارج الحروف...</span>
        </>
      ) : isAlreadyGenerated ? (
        <>
          <RotateCcw className="w-4 h-4" />
          <span>إعادة التوليد بنفس الإعدادات</span>
          <span className="text-[11px] font-normal text-slate-400">(يُخصم رصيد جديد)</span>
        </>
      ) : (
        <>
          <Sparkles className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          <span>{user ? 'توليد الصوت الآن (Studio Generate)' : 'سجّل مجاناً وولّد الصوت'}</span>
          <span className="text-[11px] font-mono opacity-60 hidden sm:inline mr-2">⌘ + Enter</span>
        </>
      )}
    </button>

    <div id="studio-player">
      <AudioStudioPlayer
        audioUrl={currentAudioUrl}
        audioBase64={currentAudioBase64}
        voiceName={playingItem?.voiceName ?? (mode === 'single' ? selectedVoice.name : speakerNames.join(' و '))}
        toneName={playingItem?.toneStyle ?? selectedTone.nameAr}
        dialectName={playingItem?.dialect ?? currentDialect.nameAr}
        textExcerpt={spokenText}
        speed={speed}
      />
    </div>

    {videoSource && (
      <button
        type="button"
        onClick={() => setShowVideoMaker(true)}
        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold text-sm transition-colors"
      >
        <Film className="w-5 h-5" />
        <span>حوّله لفيديو جاهز للنشر</span>
        <span className="text-[10px] font-extrabold bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded-full">جديد</span>
      </button>
    )}

    <HistoryDrawer
      items={history}
      activeItemId={activeHistoryId}
      onSelectItem={handleSelectHistoryItem}
      onClearHistory={handleClearHistory}
      onDeleteItem={handleDeleteHistoryItem}
    />
    </>
  );

  const errorBanner = (
    <>
    {/* Error Banner */}
    {errorMessage && (
      <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-xl flex items-center justify-between gap-3 text-xs sm:text-sm animate-fadeIn">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
        <button
          onClick={() => setErrorMessage(null)}
          className="text-rose-400 hover:text-white px-2 py-1 rounded"
        >
          إغلاق
        </button>
      </div>
    )}
    </>
  );

  // Phones (and the installed app): wait the split second until the account is known, so the page opens
  // straight in its final state instead of drawing a logged-out page and then jumping
  if (!authLoaded && window.matchMedia('(max-width: 639px)').matches) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <img src="/icons/icon-192.png" alt="" className="w-20 h-20 rounded-2xl animate-pulse" />
        <div className="text-sm font-bold text-slate-300">صوتك الذكي</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      <Header
        cornerRibbon={!!config.betaRibbon}
        onReset={handleResetSession}
        user={user}
        view={isAdminView ? 'admin' : view === 'motion' ? 'motion' : 'studio'}
        motionOn={serviceOn('motion')}
        viewAsCustomer={user?.role === 'admin' && viewAsCustomer}
        onToggleViewAsCustomer={toggleViewAsCustomer}
        onLoginClick={() => setAuthPrompt({ mode: 'login' })}
        onLogout={handleLogout}
        onPackagesClick={() => setShowPackages(true)}
      />

      {/* Admin browsing as a customer */}
      {user?.role === 'admin' && viewAsCustomer && (
        <div className="bg-sky-500/10 border-b border-sky-500/30 px-4 py-2">
          <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-2 text-xs sm:text-sm text-sky-200">
            <span>👁️ تشاهد الموقع كما يراه الزبون: الخدمات الموقفة مخفية عنك الآن.</span>
            <button type="button" onClick={toggleViewAsCustomer} className="px-3 py-1 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold">إنهاء عرض الزبون</button>
          </div>
        </div>
      )}

      {/* Unverified email banner */}
      {user && !user.emailVerified && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5">
          <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-2 text-xs sm:text-sm">
            <span className="flex items-center gap-2 text-amber-200">
              <MailWarning className="w-4 h-4 shrink-0" />
              <span>
                أكّد بريدك <b dir="ltr">{user.email}</b> من الرابط المرسل إليك لتفعيل حسابك
                {config.signupBonusCredits > 0 && <> والحصول على <b className="text-emerald-300">{formatCredits(config.signupBonusCredits)} مجاناً</b></>}.
              </span>
            </span>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendState !== 'idle'}
              className="px-3 py-1 rounded-lg border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 text-xs font-semibold disabled:opacity-70"
            >
              {resendState === 'sending' ? 'جاري الإرسال...' : resendState === 'sent' ? '✓ تم الإرسال، تفقد بريدك' : 'إعادة إرسال الرابط'}
            </button>
          </div>
        </div>
      )}

      {isAdminView ? (
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        <AdminPage
          currentUser={user!}
          onCurrentUserCreditsChange={(credits) => setUser(prev => (prev ? { ...prev, credits } : prev))}
        />
      </main>
      ) : viewStopped ? (
      <main className="flex-1" />
      ) : view === 'press' ? (
      <main className="flex-1 max-w-4xl lg:max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <PressPage
          user={user}
          onLoginRequired={reason => setAuthPrompt({ mode: 'register', reason })}
          onBalance={balance => setUser(prev => (prev ? { ...prev, credits: balance } : prev))}
          onOpenPackages={() => setShowPackages(true)}
        />
      </main>
      ) : view === 'motion' ? (
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
        {user && (user.role === 'admin' || user.permissions?.includes('motion')) ? (
          <MotionTab admin={user.role === 'admin'} />
        ) : (
          <div className="text-center text-sm text-slate-400 py-16">هذه الميزة غير مفعّلة لحسابك.</div>
        )}
      </main>
      ) : view === 'calm' || view === 'quran' ? (
      <main className="flex-1 max-w-4xl lg:max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <CalmPage
          key={view}
          quranMode={view === 'quran'}
          user={user}
          prices={config.prices ?? DEFAULT_PRICES}
          onLoginRequired={reason => setAuthPrompt({ mode: 'register', reason })}
          onBalance={balance => setUser(prev => (prev ? { ...prev, credits: balance } : prev))}
          onOpenPackages={() => setShowPackages(true)}
        />
      </main>
      ) : view === 'medical' ? (
      <main className="flex-1 max-w-4xl lg:max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <MedicalPage
          user={user}
          prices={config.prices ?? DEFAULT_PRICES}
          onLoginRequired={reason => setAuthPrompt({ mode: 'register', reason })}
          onBalance={balance => setUser(prev => (prev ? { ...prev, credits: balance } : prev))}
          onOpenPackages={() => setShowPackages(true)}
        />
      </main>
      ) : view === 'greetings' ? (
      <main className="flex-1 max-w-4xl lg:max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <GreetingsPage
          user={user}
          prices={config.prices ?? DEFAULT_PRICES}
          onLoginRequired={reason => setAuthPrompt({ mode: 'register', reason })}
          onBalance={balance => setUser(prev => (prev ? { ...prev, credits: balance } : prev))}
          onOpenPackages={() => setShowPackages(true)}
        />
      </main>
      ) : view === 'terms' ? (
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
        <TermsPage />
      </main>
      ) : view === 'home' && !user && studioOn ? (
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        <LandingPage
          isLoggedIn={Boolean(user)}
          signupBonusCredits={config.signupBonusCredits}
          greetingsOn={serviceOn('greetings')}
          onStart={() => { window.location.hash = '#/studio'; window.scrollTo({ top: 0 }); }}
          onOpenPackages={() => setShowPackages(true)}
        />
      </main>
      ) : (
      <main className="flex-1 max-w-4xl lg:max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {quranShowcase && <QuranShowcase price={(config.prices ?? DEFAULT_PRICES).quranReel} />}
        {/* Entries to the other services (white cards, each framed in its own colour) */}
        <div className="grid lg:grid-cols-2 gap-3">
          {serviceOn('greetings') && <HomeEntry href="#/greetings" icon={PartyPopper} color="#c026d3" cta="جرّبها"
            title="جديد: تهنئة بالصوت والفيديو" text="عيد ميلاد، أعياد، زواج، تخرّج… فيديو تهنئة جاهز للواتساب خلال دقيقة" />}
          {serviceOn('press') && <HomeEntry href="#/press" icon={Newspaper} color="#0e7490" cta="ابدأ"
            title="استوديو الصحفيين" text="حوّل مقالك إلى بودكاست أو نشرة أخبار أو ملخص مسموع، بفيديو بهوية مؤسستك" />}
          {serviceOn('calm') && <HomeEntry href="#/calm" icon={Leaf} color="#059669" cta="جرّبها"
            title="ريلز السكينة" text="مشاهد طبيعة هادئة، وصوت دافئ، وكلمات تريح القلب، جاهزة للمشاركة" />}
          {serviceOn('quran') && !quranShowcase && <HomeEntry href="#/quran" icon={BookOpen} color="#047857" cta="جرّبها"
            title="آيات بصوت القارئ" text="اختر آيات كاملة بتلاوة قارئ حقيقي، فوق مشاهد طبيعة هادئة، جاهزة للمشاركة" />}
          {serviceOn('medical') && <HomeEntry href="#/medical" icon={Stethoscope} color="#0284c7" cta="ابدأ"
            title="بطاقات وريلز طبية" text="اكتب معلومتك الطبية، نراجعها ونبسّطها، وتنشرها ببطاقة أو ريل يحمل اسمك" />}
        </div>

        {studioOn && (<>
        {/* Mode: single voice vs two-speaker dialogue */}
        <div className="grid grid-cols-2 gap-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-1.5">
          {([
            { id: 'single', label: 'صوت واحد', hint: 'تعليق صوتي، إعلان، شرح', icon: Mic },
            { id: 'dialogue', label: 'حوار بين صوتين', hint: 'بودكاست، مقابلة، إعلان حواري', icon: Users },
          ] as const).filter(m => serviceOn(m.id === 'single' ? 'tts' : 'dialogue')).map(m => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleModeChange(m.id)}
                disabled={Boolean(cloneVoice)}
                className={`flex items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 transition-all ${
                  active ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-300 hover:bg-slate-800/60'
                } ${cloneVoice ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-right">
                  <span className="block text-sm font-bold">{m.label}</span>
                  <span className={`block text-[11px] ${active ? 'opacity-70' : 'text-slate-500'}`}>{m.hint}</span>
                </span>
                {m.id === 'dialogue' && !active && (
                  <span className="text-[9px] font-extrabold bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded-full">جديد</span>
                )}
              </button>
            );
          })}
        </div>

        {cloneVoice ? (
          <div className="space-y-5 animate-fadeIn">
            {errorBanner}
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 sm:p-5 space-y-3">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <Copy className="w-4 h-4" />
                <span>وضع نسخ الأسلوب: سيُقرأ نصك بنفس أداء عينة {cloneVoice.name} تماماً</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {['الصوت: ' + cloneVoice.name, 'أسلوب الأداء: مطابق للعينة', 'اللهجة: مطابقة للعينة', 'السرعة: مطابقة للعينة'].map(item => (
                  <span key={item} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400">
                    <Lock className="w-3 h-3" /> {item}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                الإعدادات مقفلة في هذا الوضع. بعد التوليد تعود إعداداتك كما كانت، ويمكنك الإلغاء قبل التوليد من زر «إلغاء» على بطاقة الصوت.
              </p>
              <VoiceSelector
                compact
                voices={[cloneVoice]}
                selectedVoiceId={cloneVoice.id}
                onSelectVoice={() => {}}
                selectedLanguage={language}
                cloneVoiceId={cloneVoiceId}
                onToggleClone={toggleClone}
              />
            </div>
            <ScriptEditor
              text={text}
              onChangeText={setText}
              speed={1}
              onApplyTemplate={script => setText(script.text)}
            />
            {generatePanel}
          </div>
        ) : (
        <>
        {/* Stepper */}
        <nav aria-label="خطوات التوليد">
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const isActive = step === s.id;
              const isDone = s.id <= maxReachedStep && !isActive;
              const isReachable = s.id <= maxReachedStep + 1 && (s.id <= step || canAdvance);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => goToStep(s.id)}
                    disabled={!isReachable}
                    aria-current={isActive ? 'step' : undefined}
                    className={`w-full text-right p-2.5 sm:p-3 rounded-xl border transition-all ${
                      isActive
                        ? 'bg-amber-500/10 border-amber-500/80 ring-1 ring-amber-500/30'
                        : isDone
                          ? 'bg-slate-900/80 border-slate-700 hover:border-slate-600'
                          : 'bg-slate-900/40 border-slate-800/80 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          isActive
                            ? 'bg-amber-500 text-slate-950'
                            : isDone
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.id}
                      </span>
                      <span className={`text-xs sm:text-sm font-bold ${isActive ? 'text-amber-300' : 'text-slate-200'}`}>
                        {s.title}
                      </span>
                      <Icon className="w-3.5 h-3.5 text-slate-500 hidden sm:block mr-auto" />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 hidden sm:block">{s.hint}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {errorBanner}

        {/* Step Content */}
        <section className="animate-fadeIn" key={step}>
          {step === 1 && mode === 'single' && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
              <p className="text-xs text-slate-400">
                اضغط ▶ لسماع عينة حقيقية من كل صوت، ثم اختر الصوت الأنسب لمحتواك.
              </p>
              <VoiceSelector
                voices={VOICES}
                selectedVoiceId={voiceId}
                onSelectVoice={setVoiceId}
                selectedLanguage={language}
                cloneVoiceId={cloneVoiceId}
                onToggleClone={toggleClone}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          )}

          {step === 1 && mode === 'dialogue' && (
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
              <DialogueVoicePicker
                voices={VOICES}
                speakers={speakers}
                onChange={handleSpeakersChange}
                selectedLanguage={language}
              />
            </div>
          )}

          {step === 2 && mode === 'dialogue' && (
            <DialogueEditor
              script={dialogueScript}
              onChangeScript={setDialogueScript}
              names={speakerNames}
              dialect={dialect}
              speed={speed}
              onApplyTemplate={handleApplyDialogueTemplate}
            />
          )}

          {step === 2 && mode === 'single' && (
            <ScriptEditor
              text={text}
              onChangeText={setText}
              speed={speed}
              onApplyTemplate={handleApplyTemplate}
            />
          )}

          {step === 3 && (
            <DeliveryControls
              selectedLanguage={language}
              onLanguageChange={setLanguage}
              selectedDialect={dialect}
              onDialectChange={setDialect}
              selectedTone={toneStyle}
              onToneChange={setToneStyle}
              customStylePrompt={customStylePrompt}
              onCustomStylePromptChange={setCustomStylePrompt}
              speed={speed}
              onSpeedChange={setSpeed}
              pitch={pitch}
              onPitchChange={setPitch}
            />
          )}

          {step === 4 && (
            <div className="space-y-5">
              {/* Summary of choices; each chip jumps back to its step */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                <h2 className="text-sm font-bold text-white">مراجعة الإعدادات</h2>
                <div className="flex flex-wrap gap-2">
                  {summary.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => goToStep(item.step)}
                      className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-500/50 text-xs text-right transition-colors"
                      title="تعديل"
                    >
                      <span className="text-slate-500">{item.label}: </span>
                      <span className="text-slate-200 font-medium">{item.value}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 border-t border-slate-800/60 pt-3">
                  {text}
                </p>
              </div>

              {generatePanel}
            </div>
          )}
        </section>

        {/* Step Navigation */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => goToStep(step - 1)}
            disabled={step === 1}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700 text-sm font-medium transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
            <span>السابق</span>
          </button>

          {step < STEPS.length && (
            <button
              type="button"
              onClick={() => goToStep(step + 1)}
              disabled={!canAdvance}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>التالي: {STEPS[step].title}</span>
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
        </>
        )}
        </>)}
      </main>
      )}

      {showVideoMaker && videoSource && (
        <VideoMakerModal
          audioBase64={videoSource.audioBase64}
          text={videoSource.text}
          voiceId={videoSource.voiceId}
          voiceAvatar={VOICES.find(v => v.id === videoSource.voiceId.split('+')[0])?.avatar}
          onClose={() => setShowVideoMaker(false)}
        />
      )}

      {showPackages && (
        <PackagesModal
          user={user}
          prices={config.prices ?? DEFAULT_PRICES}
          paymentsOn={serviceOn('payments')}
          onClose={() => setShowPackages(false)}
          onLoginRequired={() => {
            setShowPackages(false);
            setAuthPrompt({ mode: 'register', reason: 'سجّل حسابك أولاً لتطلب الباقة.' });
          }}
        />
      )}

      {authPrompt && (
        <AuthModal
          initialMode={authPrompt.mode}
          reason={authPrompt.reason}
          signupBonusCredits={config.signupBonusCredits}
          googleEnabled={config.googleEnabled}
          onClose={() => setAuthPrompt(null)}
          onAuthenticated={(u, mode) => {
            setUser(u);
            // After sign-up the modal stays open to show the "check your inbox" screen
            if (!(mode === 'register' && !u.emailVerified)) setAuthPrompt(null);
          }}
        />
      )}

      <footer className="border-t border-slate-900 bg-slate-950 py-4 px-6 text-center text-xs text-slate-500">
        <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <span>استوديو صوتك الذكي © 2026 · محرك Gemini 3.8 Flash TTS عالي الدقة</span>
          <div className="flex items-center gap-3">
            <span>24kHz Studio Audio</span>
            <span aria-hidden="true">·</span>
            <span>دعم التشكيل التلقائي</span>
            <span aria-hidden="true">·</span>
            <span>تصدير ملفات WAV</span>
            <span aria-hidden="true">·</span>
            <a href="#/terms" className="text-amber-400 hover:text-amber-300">شروط الاستخدام</a>
          </div>
        </div>
      </footer>

      {/* Phones only: app-style bottom bar and "install the app" suggestion */}
      {config.betaRibbon && <BetaRibbon />}
      <MobileAppNav view={view} studioHash="#/studio" onPackages={() => setShowPackages(true)} isOn={id => serviceOn(id)} studioOn={studioOn} />
    </div>
  );
}
