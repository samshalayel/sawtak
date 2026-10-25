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

/** Service prices in points, set by the admin (the server charges exactly these). */
export interface ServicePrices {
  voicePerMinute: number;
  greeting: number;      // per greeting card, voice included
  calmReel: number;      // per calm reel (AI voice or Quran recitation)
  motionLibrary: number;
  motionFree: number;
  medicalCard: number;
  medicalReel: number;
}
export const DEFAULT_PRICES: ServicePrices = { voicePerMinute: 10, greeting: 25, calmReel: 30, motionLibrary: 100, motionFree: 500, medicalCard: 15, medicalReel: 30 };

export type ServiceId = 'tts' | 'dialogue' | 'greetings' | 'calm' | 'motion' | 'press' | 'payments' | 'medical';

export interface PublicConfig {
  /** Service switches from the admin settings (missing = on). Stopped services are hidden from customers. */
  services?: Partial<Record<ServiceId, boolean>>;
  signupBonusCredits: number;
  maxTextChars: number;
  contactWhatsapp: string;
  googleEnabled: boolean;
  prices: ServicePrices;
}

/** Credits are stored in seconds (1 point = POINTS_TO_SECONDS); shown to people as points: "12 نقطة". */
// 1 point = 6 seconds (10 points per minute)
export const POINTS_TO_SECONDS = 6;
export const secondsToPoints = (sec: number) => Math.round(sec / POINTS_TO_SECONDS);

export function formatCredits(seconds: number): string {
  const pts = secondsToPoints(seconds);
  return `${pts.toLocaleString('en-US')} نقطة`;
}
