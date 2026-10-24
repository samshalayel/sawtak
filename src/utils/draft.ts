// Keeps a visitor's unsaved work across the sign-in round trip (Google sign-in reloads the page,
// which would otherwise reset the studio). Tab storage only: gone when the tab closes, after an hour,
// or as soon as the user is signed in. Settings and text only, never audio.
const KEY = 'sawtik_pending_draft';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface StudioDraft {
  mode: 'single' | 'dialogue';
  text: string;
  voiceId: string;
  cloneVoiceId: string | null;
  language: string;
  dialect: string;
  toneStyle: string;
  customStylePrompt: string;
  speed: number;
  pitch: number;
  speakers: [{ name: string; voiceId: string }, { name: string; voiceId: string }];
  dialogueScript: string;
}

export const saveDraft = (draft: StudioDraft) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    // storage full or disabled: nothing to keep
  }
};

export const loadDraft = (): StudioDraft | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { savedAt, draft } = JSON.parse(raw);
    if (Date.now() - savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return draft as StudioDraft;
  } catch {
    return null;
  }
};

export const clearDraft = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};
