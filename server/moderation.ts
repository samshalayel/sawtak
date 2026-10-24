// Content moderation: an admin-managed list of banned words checked before any text reaches Gemini.
// Matching works on a normalised form so diacritics, letter variants, stretched letters and
// separators ("ك.ل.ب", "ك ل ب", "كلللب") don't slip through.
import crypto from 'crypto';
import { db } from './db.ts';
import { availableKeys } from './keys.ts';

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

// Explicit sexual terms and suggestive phrases (added 2026-10-13). Words that also appear in normal,
// medical or religious content (جماع، نكاح، جنس، قضيب، شهوة…) are deliberately left out.
const SEXUAL_ADDITIONS = [
  'مضاجعة', 'ضاجع', 'ضاجعني', 'يضاجع', 'نيكني', 'نيكها', 'نكتها', 'انيكك', 'انيكها', 'نياك', 'منايك', 'نياكه',
  'زبر', 'زبه', 'زبك', 'ايري', 'ايرك', 'بزاز', 'بزازك', 'بزازها', 'مصيلي', 'لحسلي', 'شبقة', 'هايجة', 'سحاقية',
  'سكسي', 'سكسية', 'بورنو', 'اباحي', 'اباحية', 'افلام سكس', 'صور عارية', 'شلحي', 'اشلحي', 'اشلحيلي', 'اتعري',
  'نمارس الجنس', 'مارسنا الجنس', 'نمارس الحب', 'بدي انام معك', 'بدي انام معكي',
  'تعالي ع السرير', 'تعالي عالسرير', 'تعالي عالتخت', 'بدي اياكي بالسرير',
  'zeb', 'zebi', 'nik', 'neek', 'nayek', 'sex', 'sexy', 'porn', 'xxx', 'nude', 'nudes', 'horny',
  'fuck', 'fucking', 'pussy', 'dick', 'cock', 'boobs', 'tits',
];

// Word batches are applied once each, so words the admin deletes later don't come back on restart
db.exec('CREATE TABLE IF NOT EXISTS moderation_seeds (batch TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
const SEED_BATCHES: [string, string[]][] = [['starter', STARTER_WORDS], ['sexual-2026-10', SEXUAL_ADDITIONS]];
{
  const insert = db.prepare('INSERT OR IGNORE INTO moderation_words (word) VALUES (?)');
  const applied = db.prepare('SELECT 1 FROM moderation_seeds WHERE batch = ?');
  const mark = db.prepare('INSERT INTO moderation_seeds (batch) VALUES (?)');
  const hasWords = (db.prepare('SELECT COUNT(*) AS n FROM moderation_words').get() as { n: number }).n > 0;
  for (const [batch, words] of SEED_BATCHES) {
    if (applied.get(batch)) continue;
    // Existing installs already have (an admin-edited copy of) the starter list
    if (!(batch === 'starter' && hasWords)) for (const w of words) insert.run(w);
    mark.run(batch);
  }
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
  'النص يحتوي على ألفاظ أو إيحاءات غير مسموح بها وفق شروط الاستخدام. يرجى تعديل النص والمحاولة مجدداً.';

// ---------- Meaning check (AI) ----------
// A word list can't see innuendo, euphemisms or new spellings, so after the list passes, a fast
// Gemini text call judges what the text means. If Google is slow or down the request is allowed
// (the word list still applies) so customers are never blocked by an outage. The check never puts
// keys on cooldown: a slow review must not take generation capacity away from customers.

const AI_MODEL = 'gemini-3.5-flash-lite';
const AI_TIMEOUT_MS = 8_000;

const AI_CATEGORIES: Record<string, string> = {
  sexual: 'محتوى جنسي أو إيحاء',
  harassment: 'إهانة أو تحرّش',
  hate: 'كراهية أو تحريض',
  violence: 'تهديد أو عنف',
  self_harm: 'إيذاء النفس',
  illegal: 'نشاط غير قانوني',
};

const AI_INSTRUCTION = `You are the content-safety reviewer of an Arabic text-to-speech studio. The text will be spoken aloud and published.
Decide if it may be voiced. Read it in any Arabic dialect, English or mixed, including misspellings, letters split by spaces or symbols, Arabizi (3=ع, 7=ح…) and euphemisms.
Reject (allowed=false) when the text contains or clearly implies:
- sexual: explicit sexual content, sexual innuendo or suggestive double meanings, flirting with sexual intent, descriptions of private body parts in a sexual way;
- harassment: insults, swearing or degrading language aimed at a person or group;
- hate: hatred or incitement against a religion, ethnicity, nationality, gender or group;
- violence: threats, glorifying or encouraging violence or terrorism;
- self_harm: encouraging suicide or self-harm;
- illegal: promoting drugs, fraud, scams or other clearly illegal acts.
Allow (allowed=true): ordinary content, ads, news (even about crimes or wars), education including medical and sexual-health education in a clinical tone, non-sexual romance and poetry, religious content, children's stories, mild everyday expressions.
When unsure whether something is innuendo, judge how a typical Arabic-speaking listener would understand it.`;

const AI_SCHEMA = {
  type: 'object',
  properties: {
    allowed: { type: 'boolean' },
    category: { type: 'string', enum: ['none', ...Object.keys(AI_CATEGORIES)] },
    reason: { type: 'string', description: 'Short reason in Arabic (max 12 words)' },
  },
  required: ['allowed', 'category'],
};

// Same text is often regenerated with other settings: remember recent verdicts for 30 minutes
const aiCache = new Map<string, { allowed: boolean; category: string; reason: string; at: number }>();
const AI_CACHE_MS = 30 * 60 * 1000;

async function aiVerdict(text: string): Promise<{ allowed: boolean; category: string; reason: string } | null> {
  const cacheKey = crypto.createHash('sha256').update(text).digest('hex');
  const cached = aiCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AI_CACHE_MS) return cached;

  const apiKey = availableKeys()[0];
  if (!apiKey) return null;
  try {
    // One attempt, one key, no cooldown on failure (see note above)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: AI_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: `TEXT TO REVIEW:\n"""\n${text.slice(0, 6000)}\n"""` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: AI_SCHEMA,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || '{}');
    const verdict = {
      allowed: parsed.allowed !== false,
      category: String(parsed.category || 'none'),
      reason: String(parsed.reason || '').slice(0, 120),
      at: Date.now(),
    };
    if (aiCache.size > 500) aiCache.delete(aiCache.keys().next().value!);
    aiCache.set(cacheKey, verdict);
    return verdict;
  } catch (err: any) {
    console.warn('[moderation] AI check skipped:', String(err?.message || err).slice(0, 160));
    return null;
  }
}

/**
 * Full policy: banned-word list first (instant), then the meaning check when enabled.
 * Logs every hit; in "flag" mode hits are recorded but allowed.
 */
export async function moderateFull(
  text: string,
  opts: { userId: number; feature: string; mode: ModerationMode; ai: boolean }
): Promise<ModerationVerdict> {
  const listed = moderate(text, opts);
  if (!listed.allowed || listed.matched.length > 0 || opts.mode === 'off' || !opts.ai || !text.trim()) return listed;

  const verdict = await aiVerdict(text.trim());
  if (!verdict || verdict.allowed) return { allowed: true, matched: [] };

  const label = `فحص ذكي: ${AI_CATEGORIES[verdict.category] ?? verdict.category}${verdict.reason ? ` (${verdict.reason})` : ''}`;
  const action = opts.mode === 'block' ? 'blocked' : 'flagged';
  db.prepare('INSERT INTO moderation_events (user_id, feature, matched, excerpt, action) VALUES (?, ?, ?, ?, ?)')
    .run(opts.userId, opts.feature, label, text.slice(0, 300), action);
  return { allowed: opts.mode !== 'block', matched: [label] };
}
