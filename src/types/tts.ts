export interface Voice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  toneAr: string;
  toneEn: string;
  tags: string[];
  avatarColor: string;
  previewSample?: string;
  avatar?: string; // portrait under public/avatars; falls back to the name's first letter
}

export interface DialectOption {
  id: string;
  nameAr: string;
  nameEn: string;
  flag?: string;
}

export interface LanguageOption {
  code: string;
  nameAr: string;
  nameEn: string;
  flag: string;
  dialects: DialectOption[];
}

export interface ToneStyle {
  id: string;
  nameAr: string;
  nameEn: string;
  iconName: string;
  description: string;
}

export interface GenerationRequest {
  text: string;
  voice: string;
  language: string;
  dialect: string;
  toneStyle: string;
  customStylePrompt?: string;
  speed: number;
  pitch: number;
  engine: 'gemini' | 'browser';
}

export interface HistoryItem {
  id: string;
  text: string;
  title: string;
  audioUrl: string; // Object URL or data URL
  audioBase64?: string;
  voice: string;
  voiceName: string;
  language: string;
  dialect: string;
  toneStyle: string;
  speed: number;
  pitch: number;
  durationSeconds?: number;
  createdAt: string;
  engine: 'gemini' | 'browser';
}

export interface SampleScript {
  id: string;
  categoryAr: string;
  titleAr: string;
  text: string;
  recommendedVoice: string;
  recommendedTone: string;
  recommendedDialect: string;
}
