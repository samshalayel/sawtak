// Content moderation: an admin-managed list of banned words checked before any text reaches Gemini.
// Matching works on a normalised form so diacritics, letter variants, stretched letters and
// separators ("ك.ل.ب", "ك ل ب", "كلللب") don't slip through.
import { db } from './db.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS moderation_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    feature TEXT NOT NULL,
    matched TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('blocked', 'flagged')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_moderation_events_time ON moderation_events(created_at);
`);

// Starter list (common profanity across dialects). Animal words alone are NOT listed because they
// appear in normal content (kids stories); only their insulting forms are.
const STARTER_WORDS = [
  // Sexual / vulgar
  'شرموطة', 'شرموط', 'شراميط', 'قحبة', 'قحاب', 'عاهرة', 'عاهر', 'منيوك', 'منيوكة', 'منيك', 'نيك', 'ينيك', 'انيك', 'نياكة',
  'متناك', 'متناكة', 'كس', 'كسمك', 'كس امك', 'كس اختك', 'كسختك', 'كس اخت', 'زب', 'زبي', 'طيز', 'طيزك', 'لوطي', 'كسك',
  'عرص', 'معرص', 'ديوث', 'زانية', 'زاني', 'مومس', 'فاجرة', 'سكس', 'بورن',
  // Insults
  'ابن الكلب', 'بنت الكلب', 'يا كلب', 'يا كلبة', 'ابن الحرام', 'بنت الحرام', 'ابن القحبة', 'ابن الشرموطة', 'يا حمار',
  'يا حيوان', 'يا خنزير', 'يا جحش', 'يا وسخ', 'يا وسخة', 'يا حقير', 'يا زبالة', 'تفو عليك', 'ابن الزانية',
  // Blasphemous curses
  'يلعن دينك', 'يلعن ربك', 'يلعن ابوك', 'يلعن امك', 'يلعن شرفك', 'كس دينك', 'نعل دينك',
  // Common Latin transliterations
  'sharmouta', 'sharmota', 'kosomak', 'kos omak', 'ahbe',
];

if ((db.prepare('SELECT COUNT(*) AS n FROM moderation_words').get() as { n: number }).n === 0) {
  const insert = db.prepare('INSERT OR IGNORE INTO moderation_words (word) VALUES (?)');
  for (const w of STARTER_WORDS) insert.run(w);
}

// ---------- Normalisation ----------

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const SEPARATORS = /[.\-_*~`'"|/\\+•·،,؛;:!?؟()[\]{}<>=#@$%^&0-9٠-٩]/g;

export function normalizeForModeration(text: string): string {
  return text
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(SEPARATORS, ' ')
    .replace(/(.)\1{1,}/g, '$1') // stretched letters: "كلللب" -> "كلب"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Re-joins letters spelled out one by one ("ك ل ب" -> "كلب"). */
function joinSpelledOut(tokens: string[]): string[] {
  const out: string[] = [];
  let run = '';
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else {
      if (run) out.push(run);
      run = '';
      out.push(t);
    }
  }
  if (run) out.push(run);
  return out;
}

const PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل'];
const SUFFIXES = ['هم', 'كم', 'ات', 'ين', 'ون', 'ها', 'ه', 'ك', 'ي'];

function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  for (const p of PREFIXES) if (token.startsWith(p) && token.length - p.length >= 3) variants.add(token.slice(p.length));
  for (const v of [...variants]) {
    for (const suffix of SUFFIXES) if (v.endsWith(suffix) && v.length - suffix.length >= 3) variants.add(v.slice(0, -suffix.length));
  }
  return [...variants];
}

// ---------- Matching ----------

let cache: { singles: Map<string, string>; phrases: [string, string][] } | null = null;

function bannedTerms() {
  if (cache) return cache;
  const words = (db.prepare('SELECT word FROM moderation_words').all() as { word: string }[]).map(r => r.word);
  const singles = new Map<string, string>();
  const phrases: [string, string][] = [];
  for (const word of words) {
    const norm = normalizeForModeration(word);
    if (!norm) continue;
    norm.includes(' ') ? phrases.push([norm, word]) : singles.set(norm, word);
  }
  cache = { singles, phrases };
  return cache;
}

export function invalidateModerationCache() {
  cache = null;
}

/** Returns the banned terms found in the text (as written in the admin list). */
export function findBannedTerms(text: string): string[] {
  const { singles, phrases } = bannedTerms();
  const normalized = normalizeForModeration(text);
  const found = new Set<string>();

  const tokens = joinSpelledOut(normalized.split(' ').filter(Boolean));
  for (const token of tokens) {
    for (const variant of tokenVariants(token)) {
      const hit = singles.get(variant);
      if (hit) found.add(hit);
    }
  }
  // Phrases are matched on whole-word boundaries in the normalised text
  const padded = ` ${tokens.join(' ')} `;
  for (const [norm, original] of phrases) if (padded.includes(` ${norm} `)) found.add(original);

  return [...found];
}

// ---------- Policy ----------

export type ModerationMode = 'block' | 'flag' | 'off';

export interface ModerationVerdict {
  allowed: boolean;
  matched: string[];
}

/** Checks text against the list, logs hits, and says whether the request may proceed. */
export function moderate(text: string, opts: { userId: number; feature: string; mode: ModerationMode }): ModerationVerdict {
  if (opts.mode === 'off' || !text) return { allowed: true, matched: [] };
  const matched = findBannedTerms(text);
  if (matched.length === 0) return { allowed: true, matched };

  const action = opts.mode === 'block' ? 'blocked' : 'flagged';
  db.prepare('INSERT INTO moderation_events (user_id, feature, matched, excerpt, action) VALUES (?, ?, ?, ?, ?)')
    .run(opts.userId, opts.feature, matched.join('، '), text.slice(0, 300), action);
  return { allowed: opts.mode !== 'block', matched };
}

export const BLOCKED_MESSAGE =
  'النص يحتوي على ألفاظ غير مسموح بها وفق شروط الاستخدام. يرجى تعديل النص والمحاولة مجدداً.';
