export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  credits: number; // seconds of generated audio
  emailVerified: boolean;
  favoriteVoices?: string[]; // starred voices (ids)
  permissions?: string[]; // features granted without admin rights, e.g. ['motion']
}

export interface PublicConfig {
  signupBonusCredits: number;
  maxTextChars: number;
  contactWhatsapp: string;
  googleEnabled: boolean;
}

/** 1 credit = 1 second of audio. Shows "45 ثانية" or "12:30 دقيقة". */
// 1 point = 6 seconds (10 points per minute)
export const POINTS_TO_SECONDS = 6;
export const secondsToPoints = (sec: number) => Math.round(sec / POINTS_TO_SECONDS);

export function formatCredits(seconds: number): string {
  const pts = secondsToPoints(seconds);
  return `${pts.toLocaleString('en-US')} نقطة`;
}
