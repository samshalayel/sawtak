// Visual themes for voice greeting videos. The client keeps a matching list (src/data/greetings.ts) for
// texts and previews; only the ids, colours and decoration live here.

export type GreetingMotif = 'confetti' | 'crescent' | 'snow' | 'hearts' | 'sparkles' | 'balloons';
export type GreetingEmblem = 'cake' | 'crescent' | 'star' | 'rings' | 'cap' | 'heart' | 'balloons' | 'tree';

export interface GreetingTheme {
  from: string;      // gradient start (top)
  to: string;        // gradient end (bottom)
  accent: string;    // decoration, photo ring, waveform
  title: string;     // headline colour
  motif: GreetingMotif;
  emblem: GreetingEmblem; // drawn in the circle when there is no photo
}

export const GREETING_THEMES: Record<string, GreetingTheme> = {
  birthday:     { from: '#7c3aed', to: '#db2777', accent: '#fde047', title: '#ffffff', motif: 'confetti', emblem: 'cake' },
  ramadan:      { from: '#0f172a', to: '#1e3a8a', accent: '#facc15', title: '#fde68a', motif: 'crescent', emblem: 'crescent' },
  eid_fitr:     { from: '#065f46', to: '#0e7490', accent: '#fcd34d', title: '#ffffff', motif: 'sparkles', emblem: 'crescent' },
  eid_adha:     { from: '#0c4a6e', to: '#047857', accent: '#fbbf24', title: '#ffffff', motif: 'sparkles', emblem: 'crescent' },
  christmas:    { from: '#b91c1c', to: '#450a0a', accent: '#fde68a', title: '#ffffff', motif: 'snow', emblem: 'tree' },
  new_year:     { from: '#020617', to: '#4c1d95', accent: '#fbbf24', title: '#ffffff', motif: 'sparkles', emblem: 'star' },
  wedding:      { from: '#be185d', to: '#f472b6', accent: '#fff1f2', title: '#ffffff', motif: 'hearts', emblem: 'rings' },
  graduation:   { from: '#1e3a8a', to: '#0891b2', accent: '#fde047', title: '#ffffff', motif: 'confetti', emblem: 'cap' },
  newborn:      { from: '#0ea5e9', to: '#f9a8d4', accent: '#ffffff', title: '#ffffff', motif: 'balloons', emblem: 'balloons' },
  get_well:     { from: '#0f766e', to: '#22c55e', accent: '#ecfccb', title: '#ffffff', motif: 'hearts', emblem: 'heart' },
  mothers_day:  { from: '#9d174d', to: '#f97316', accent: '#ffe4e6', title: '#ffffff', motif: 'hearts', emblem: 'heart' },
  congrats:     { from: '#0e7490', to: '#7c3aed', accent: '#fde047', title: '#ffffff', motif: 'confetti', emblem: 'star' },
};

export const isGreetingTheme = (id: unknown): id is string => typeof id === 'string' && id in GREETING_THEMES;
