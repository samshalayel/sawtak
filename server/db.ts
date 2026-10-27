import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { normalizeEmail } from './email-checks.ts';
import type { BenchmarkRun, Span } from '../src/types/spans.ts';

// Single SQLite file; mount ./data as a volume in production so accounts and balances survive redeploys.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'sawtik.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    credits INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every balance change (signup bonus, admin top-up, generation charge, refund)
  CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'admin_grant', 'charge', 'purchase')),
    note TEXT NOT NULL DEFAULT '',
    admin_id INTEGER REFERENCES users(id),
    usage_id INTEGER REFERENCES usage_events(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Metering log mirroring what Google bills: prompt tokens in, audio/text tokens out
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL CHECK (feature IN ('tts', 'dialogue', 'tashkeel', 'optimize', 'script')),
    model TEXT NOT NULL,
    voice TEXT,
    chars INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    audio_seconds REAL NOT NULL DEFAULT 0,
    credits_charged INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tx_user ON credit_transactions(user_id, created_at);

  -- One-time links (email verification)
  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email')),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Migrations for columns added after the first release ----------

function hasColumn(table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column);
}

if (!hasColumn('users', 'email_verified')) {
  db.exec(`
    ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN bonus_granted INTEGER NOT NULL DEFAULT 0;
    -- Accounts created before verification existed already received their bonus
    UPDATE users SET email_verified = 1, bonus_granted = 1;
  `);
}
if (!hasColumn('users', 'email_normalized')) {
  db.exec('ALTER TABLE users ADD COLUMN email_normalized TEXT');
  const rows = db.prepare('SELECT id, email FROM users').all() as { id: number; email: string }[];
  const update = db.prepare('UPDATE users SET email_normalized = ? WHERE id = ?');
  for (const r of rows) update.run(normalizeEmail(r.email), r.id);
}
if (!hasColumn('users', 'deleted_at')) {
  db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT');
}
if (!hasColumn('users', 'terms_accepted_at')) {
  db.exec('ALTER TABLE users ADD COLUMN terms_accepted_at TEXT');
}
// Starred voices (a JSON array of voice ids), so the studio opens on the voices the user actually uses
if (!hasColumn('users', 'favorite_voices')) {
  db.exec("ALTER TABLE users ADD COLUMN favorite_voices TEXT NOT NULL DEFAULT '[]'");
}
// Feature permissions an admin grants to a normal account (JSON array, e.g. ["motion"]), so testers can use a tool
// without seeing the admin dashboard (keys, money, moderation lists)
if (!hasColumn('users', 'permissions')) {
  db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'");
}
if (!hasColumn('users', 'google_sub')) {
  db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
}
// usage_events.feature gained 'dialogue' and 'script'. SQLite can't alter a CHECK constraint,
// so rebuild the table from its stored definition (keeps every column, incl. ones added later).
{
  const OLD_FEATURE_CHECK = "CHECK (feature IN ('tts', 'tashkeel', 'optimize'))";
  const NEW_FEATURE_CHECK = "CHECK (feature IN ('tts', 'dialogue', 'tashkeel', 'optimize', 'script'))";
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usage_events'").get() as { sql: string };
  if (row.sql.includes(OLD_FEATURE_CHECK)) {
    const createNew = row.sql
      .replace(OLD_FEATURE_CHECK, NEW_FEATURE_CHECK)
      .replace(/CREATE TABLE\s+"?usage_events"?/, 'CREATE TABLE usage_events_new');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(() => {
        db.exec(createNew);
        db.exec('INSERT INTO usage_events_new SELECT * FROM usage_events');
        db.exec('DROP TABLE usage_events');
        db.exec('ALTER TABLE usage_events_new RENAME TO usage_events');
        db.exec('CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at)');
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
// credit_transactions.type gained 'purchase' (points bought through a payment gateway), rebuilt the same way
{
  const OLD_TYPE_CHECK = "CHECK (type IN ('signup_bonus', 'admin_grant', 'charge'))";
  const NEW_TYPE_CHECK = "CHECK (type IN ('signup_bonus', 'admin_grant', 'charge', 'purchase'))";
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credit_transactions'").get() as { sql: string };
  if (row.sql.includes(OLD_TYPE_CHECK)) {
    const createNew = row.sql
      .replace(OLD_TYPE_CHECK, NEW_TYPE_CHECK)
      .replace(/CREATE TABLE\s+"?credit_transactions"?/, 'CREATE TABLE credit_transactions_new');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(() => {
        db.exec(createNew);
        db.exec('INSERT INTO credit_transactions_new SELECT * FROM credit_transactions');
        db.exec('DROP TABLE credit_transactions');
        db.exec('ALTER TABLE credit_transactions_new RENAME TO credit_transactions');
        db.exec('CREATE INDEX IF NOT EXISTS idx_tx_user ON credit_transactions(user_id, created_at)');
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(email_normalized);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
`);

// ---------- Settings ----------

// 1 point = 6 seconds of audio (10 points per minute).
// The DB stores credits in seconds; multiply points × POINTS_TO_SECONDS to get seconds.
export const POINTS_TO_SECONDS = 6;
export const pointsToSeconds = (pts: number) => Math.round(pts * POINTS_TO_SECONDS);
export const secondsToPoints = (sec: number) => Math.round(sec / POINTS_TO_SECONDS);

export interface AppSettings {
  signupBonusCredits: number;        // seconds of audio granted to new accounts (= points × POINTS_TO_SECONDS)
  maxTextChars: number;              // hard cap per generation request
  // Service costs in points (editable by admin)
  costTtsPerMinute: number;          // default 10 pts/min
  costGreeting: number;              // default 25 pts
  costMotionLibrary: number;         // default 100 pts
  costMotionFree: number;            // default 500 pts
  costCalmReel: number;              // default 30 pts per calm reel (AI voice)
  costQuranReel: number;             // pts per Quran reel (reciter's recitation); until set, the calm reel price
  costMedicalCard: number;           // default 15 pts per medical card image
  costMedicalReel: number;           // default 30 pts per medical reel (voice included)
  // Service switches, 1 = on, 0 = off (see server/services.ts)
  serviceTts: number;
  serviceDialogue: number;
  serviceGreetings: number;
  serviceCalm: number;
  serviceQuran: number;              // until set, follows serviceCalm (Quran reels used to be part of calm reels)
  serviceMotion: number;
  servicePress: number;
  servicePayments: number;
  serviceMedical: number;
  betaRibbon: number;                // 1 = "نسخة تجريبية" ribbon on every page
  generationsPerMinute: number;      // per-user rate limit
  // USD per 1M tokens, copied from https://ai.google.dev/pricing — used only for the admin cost report
  ttsInputPricePerM: number;
  ttsOutputPricePerM: number;
  textInputPricePerM: number;
  textOutputPricePerM: number;
  contactWhatsapp: string;           // international format digits, used by the packages "order" button
  moderationMode: 'block' | 'flag' | 'off'; // banned-words policy (see server/moderation.ts)
  moderationAi: 'on' | 'off';               // meaning check by Gemini after the word list
  // Outgoing email (verification links). Empty values fall back to .env.
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
}

const STRING_SETTINGS: (keyof AppSettings)[] = ['contactWhatsapp', 'moderationMode', 'moderationAi', 'smtpHost', 'smtpUser', 'smtpPass', 'mailFrom'];

const DEFAULT_SETTINGS: AppSettings = {
  costTtsPerMinute: 10,
  costGreeting: 25,
  costMotionLibrary: 100,
  costMotionFree: 500,
  costCalmReel: 30,
  costQuranReel: 30,
  costMedicalCard: 15,
  costMedicalReel: 30,
  serviceTts: 1,
  serviceDialogue: 1,
  serviceGreetings: 1,
  serviceCalm: 1,
  serviceQuran: 1,
  serviceMotion: 1,
  servicePress: 1,
  servicePayments: 1,
  serviceMedical: 1,
  betaRibbon: 1,
  contactWhatsapp: '',
  moderationMode: 'block',
  // Off until a paid key answers fast enough: on free keys the text model can take up to a minute
  moderationAi: 'off',
  smtpHost: '',
  smtpPort: 0,
  smtpUser: '',
  smtpPass: '',
  mailFrom: '',
  signupBonusCredits: 60,
  maxTextChars: 3000,
  generationsPerMinute: 5,
  ttsInputPricePerM: 0,
  ttsOutputPricePerM: 0,
  textInputPricePerM: 0,
  textOutputPricePerM: 0,
};

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored = Object.fromEntries(
    rows.map(r => [r.key, STRING_SETTINGS.includes(r.key as keyof AppSettings) ? r.value : Number(r.value)])
  );
  // Quran reels were split out of calm reels: until the admin sets their own price and switch, they keep the calm ones
  const inherited = { costQuranReel: stored.costCalmReel ?? DEFAULT_SETTINGS.costCalmReel, serviceQuran: stored.serviceCalm ?? DEFAULT_SETTINGS.serviceCalm };
  return { ...DEFAULT_SETTINGS, ...inherited, ...stored } as AppSettings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const value = patch[key];
    if (key === 'contactWhatsapp') {
      // Keep digits only so it works directly in a wa.me link
      if (typeof value === 'string') upsert.run(key, value.replace(/\D/g, '').slice(0, 20));
    } else if (key === 'moderationMode') {
      if (value === 'block' || value === 'flag' || value === 'off') upsert.run(key, value);
    } else if (key === 'moderationAi') {
      if (value === 'on' || value === 'off') upsert.run(key, value);
    } else if (key === 'smtpPass') {
      // Write-only from the admin page: an empty value keeps the stored password
      if (typeof value === 'string' && value.trim()) upsert.run(key, value.trim().slice(0, 200));
    } else if (key === 'smtpHost' || key === 'smtpUser' || key === 'mailFrom') {
      if (typeof value === 'string') upsert.run(key, value.trim().slice(0, 200));
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      upsert.run(key, String(value));
    }
  }
  return getSettings();
}

// ---------- Users ----------

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: 'user' | 'admin';
  credits: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
  email_verified: number;
  bonus_granted: number;
  email_normalized: string | null;
  google_sub: string | null;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    credits: u.credits,
    emailVerified: Boolean(u.email_verified),
    favoriteVoices: parseFavorites((u as { favorite_voices?: string }).favorite_voices),
    permissions: parsePermissions((u as { permissions?: string }).permissions),
  };
}

/** Grantable features (see users.permissions). */
export const PERMISSIONS = ['motion'] as const;
export type Permission = typeof PERMISSIONS[number];

export function parsePermissions(raw: unknown): Permission[] {
  try {
    const list = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(list) ? PERMISSIONS.filter(p => list.includes(p)) : [];
  } catch {
    return [];
  }
}

/** Admins can use everything; other accounts need the feature in their permissions. */
export const hasPermission = (u: UserRow | undefined | null, p: Permission) =>
  !!u && (u.role === 'admin' || parsePermissions((u as { permissions?: string }).permissions).includes(p));

export function parseFavorites(raw: unknown): string[] {
  try {
    const list = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(list) ? list.filter(v => typeof v === 'string' && /^[A-Za-z]{2,24}$/.test(v)).slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function getUserByNormalizedEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email_normalized = ?').get(normalizeEmail(email)) as UserRow | undefined;
}

/** Grants the welcome credits once per account (called on email verification or Google sign-up). */
export function grantSignupBonusOnce(userId: number) {
  const { signupBonusCredits } = getSettings();
  transaction(() => {
    const claimed = db.prepare('UPDATE users SET bonus_granted = 1, credits = credits + ? WHERE id = ? AND bonus_granted = 0')
      .run(signupBonusCredits, userId);
    if (Number(claimed.changes) > 0 && signupBonusCredits > 0) {
      const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
      db.prepare("INSERT INTO credit_transactions (user_id, delta, balance_after, type, note) VALUES (?, ?, ?, 'signup_bonus', 'رصيد ترحيبي')")
        .run(userId, signupBonusCredits, credits);
    }
  });
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- Motion Stats (video rendering analytics) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS motion_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    duration_seconds REAL NOT NULL DEFAULT 0,
    formats TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT 'library',
    look TEXT NOT NULL DEFAULT 'classic',
    rendered_on TEXT NOT NULL DEFAULT 'lambda' CHECK (rendered_on IN ('lambda', 'local')),
    lambda_invocations INTEGER NOT NULL DEFAULT 0,
    lambda_gb_seconds REAL NOT NULL DEFAULT 0,
    lambda_cost_usd REAL NOT NULL DEFAULT 0,
    plan_cost_usd REAL NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    scenes_count INTEGER NOT NULL DEFAULT 0,
    theme TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'error')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_motion_stats_created ON motion_stats(created_at);
`);

export interface MotionStatInput {
  jobId: string;
  title: string;
  durationSeconds: number;
  formats: string[];
  style: 'library' | 'free';
  look: 'classic' | 'notebook';
  renderedOn: 'lambda' | 'local';
  lambdaInvocations: number;
  lambdaGbSeconds: number;
  lambdaCostUsd: number;
  planCostUsd: number;
  scenesCount: number;
  theme: string;
  status: 'done' | 'error';
  errorMessage?: string;
}

export function logMotionStat(input: MotionStatInput): number {
  const totalCost = input.lambdaCostUsd + input.planCostUsd;
  const result = db.prepare(`
    INSERT INTO motion_stats (job_id, title, duration_seconds, formats, style, look, rendered_on,
      lambda_invocations, lambda_gb_seconds, lambda_cost_usd, plan_cost_usd, total_cost_usd,
      scenes_count, theme, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      title = excluded.title,
      duration_seconds = excluded.duration_seconds,
      formats = excluded.formats,
      style = excluded.style,
      look = excluded.look,
      rendered_on = excluded.rendered_on,
      lambda_invocations = excluded.lambda_invocations,
      lambda_gb_seconds = excluded.lambda_gb_seconds,
      lambda_cost_usd = excluded.lambda_cost_usd,
      plan_cost_usd = excluded.plan_cost_usd,
      total_cost_usd = excluded.total_cost_usd,
      scenes_count = excluded.scenes_count,
      theme = excluded.theme,
      status = excluded.status,
      error_message = excluded.error_message
  `).run(
    input.jobId,
    input.title,
    input.durationSeconds,
    input.formats.join(','),
    input.style,
    input.look,
    input.renderedOn,
    input.lambdaInvocations,
    input.lambdaGbSeconds,
    input.lambdaCostUsd,
    input.planCostUsd,
    totalCost,
    input.scenesCount,
    input.theme,
    input.status,
    input.errorMessage ?? null
  );
  return Number(result.lastInsertRowid);
}

export interface MotionStatsReport {
  totalVideos: number;
  totalDurationMinutes: number;
  totalLambdaGbSeconds: number;
  totalLambdaCostUsd: number;
  totalPlanCostUsd: number;
  totalCostUsd: number;
  byRenderer: { renderer: string; count: number; costUsd: number }[];
  byStyle: { style: string; count: number; costUsd: number }[];
  recentJobs: {
    jobId: string;
    title: string;
    durationSeconds: number;
    totalCostUsd: number;
    renderedOn: string;
    createdAt: string;
  }[];
}

export function getMotionStatsReport(days = 30): MotionStatsReport {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const totals = db.prepare(`
    SELECT COUNT(*) as total_videos,
           COALESCE(SUM(duration_seconds), 0) / 60.0 as total_duration_minutes,
           COALESCE(SUM(lambda_gb_seconds), 0) as total_lambda_gb_seconds,
           COALESCE(SUM(lambda_cost_usd), 0) as total_lambda_cost_usd,
           COALESCE(SUM(plan_cost_usd), 0) as total_plan_cost_usd,
           COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
    FROM motion_stats WHERE created_at >= ? AND status = 'done'
  `).get(since) as any;

  const byRenderer = db.prepare(`
    SELECT rendered_on as renderer, COUNT(*) as count, COALESCE(SUM(total_cost_usd), 0) as cost_usd
    FROM motion_stats WHERE created_at >= ? AND status = 'done' GROUP BY rendered_on
  `).all(since) as { renderer: string; count: number; cost_usd: number }[];

  const byStyle = db.prepare(`
    SELECT style, COUNT(*) as count, COALESCE(SUM(total_cost_usd), 0) as cost_usd
    FROM motion_stats WHERE created_at >= ? AND status = 'done' GROUP BY style
  `).all(since) as { style: string; count: number; cost_usd: number }[];

  const recentJobs = db.prepare(`
    SELECT job_id, title, duration_seconds, total_cost_usd, rendered_on, created_at
    FROM motion_stats WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50
  `).all(since) as any[];

  return {
    totalVideos: totals.total_videos,
    totalDurationMinutes: totals.total_duration_minutes,
    totalLambdaGbSeconds: totals.total_lambda_gb_seconds,
    totalLambdaCostUsd: totals.total_lambda_cost_usd,
    totalPlanCostUsd: totals.total_plan_cost_usd,
    totalCostUsd: totals.total_cost_usd,
    byRenderer: byRenderer.map(r => ({ renderer: r.renderer, count: r.count, costUsd: r.cost_usd })),
    byStyle: byStyle.map(s => ({ style: s.style, count: s.count, costUsd: s.cost_usd })),
    recentJobs: recentJobs.map(j => ({
      jobId: j.job_id,
      title: j.title,
      durationSeconds: j.duration_seconds,
      totalCostUsd: j.total_cost_usd,
      renderedOn: j.rendered_on,
      createdAt: j.created_at,
    })),
  };
}

// ---------- Performance test runs (admin "اختبار الأداء" tab) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS benchmark_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea TEXT NOT NULL DEFAULT '',
    job_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('done', 'error')),
    error TEXT,
    total_ms INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    spans TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created ON benchmark_runs(created_at);
`);

export function saveBenchmarkRun(input: { idea: string; jobId: string | null; status: 'done' | 'error'; error: string | null; spans: Span[] }): number {
  const start = Math.min(...input.spans.map(s => s.start));
  const end = Math.max(...input.spans.map(s => s.end));
  const cost = input.spans.reduce((sum, s) => sum + (Number(s.costUsd) || 0), 0);
  const result = db.prepare(`
    INSERT INTO benchmark_runs (idea, job_id, status, error, total_ms, total_cost_usd, spans)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.idea, input.jobId, input.status, input.error, Math.max(0, end - start), cost, JSON.stringify(input.spans));
  return Number(result.lastInsertRowid);
}

export function listBenchmarkRuns(limit = 30): BenchmarkRun[] {
  const rows = db.prepare('SELECT * FROM benchmark_runs ORDER BY id DESC LIMIT ?').all(limit) as any[];
  return rows.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    idea: r.idea,
    jobId: r.job_id,
    status: r.status,
    error: r.error,
    totalMs: r.total_ms,
    totalCostUsd: r.total_cost_usd,
    spans: JSON.parse(r.spans || '[]'),
  }));
}

// ---------- Jawwal Pay payments ----------
// One row per payment attempt, so every charge can be traced and a charge that was not credited is never lost.

db.exec(`
  CREATE TABLE IF NOT EXISTS jawwal_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    package_id TEXT NOT NULL,
    amount_ils REAL NOT NULL,
    credits INTEGER NOT NULL,          -- seconds to add once paid
    phone_last4 TEXT NOT NULL,         -- enough to recognise the payer; the full number is not kept
    msg_id TEXT NOT NULL,
    -- unknown: the gateway did not answer the payment call, so it may or may not have charged (check in Jawwal Pay)
    status TEXT NOT NULL CHECK (status IN ('pending', 'credited', 'failed', 'charged_not_credited', 'unknown')),
    tx_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jawwal_user ON jawwal_payments(user_id, created_at);
`);

export interface JawwalPaymentRow {
  id: number; user_id: number; package_id: string; amount_ils: number; credits: number; phone_last4: string;
  msg_id: string; status: 'pending' | 'credited' | 'failed' | 'charged_not_credited' | 'unknown'; tx_id: string | null; error: string | null;
  created_at: string; updated_at: string;
}

export function startJawwalPayment(p: { userId: number; packageId: string; amountIls: number; credits: number; phone: string; msgId: string }): number {
  const r = db.prepare(`
    INSERT INTO jawwal_payments (user_id, package_id, amount_ils, credits, phone_last4, msg_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(p.userId, p.packageId, p.amountIls, p.credits, p.phone.replace(/\D/g, '').slice(-4), p.msgId);
  return Number(r.lastInsertRowid);
}

export function updateJawwalPayment(id: number, patch: { status: JawwalPaymentRow['status']; txId?: string | null; error?: string | null }) {
  db.prepare("UPDATE jawwal_payments SET status = ?, tx_id = COALESCE(?, tx_id), error = ?, updated_at = datetime('now') WHERE id = ?")
    .run(patch.status, patch.txId ?? null, patch.error ?? null, id);
}

/** A payment of this user still waiting for the gateway (stops a double tap from charging twice). */
export function pendingJawwalPayment(userId: number, withinSeconds = 120): JawwalPaymentRow | undefined {
  return db.prepare(`SELECT * FROM jawwal_payments WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`)
    .get(userId, `-${withinSeconds} seconds`) as unknown as JawwalPaymentRow | undefined;
}

export function listJawwalPayments(limit = 100): (JawwalPaymentRow & { email: string })[] {
  return db.prepare(`
    SELECT p.*, u.email FROM jawwal_payments p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT ?
  `).all(limit) as unknown as (JawwalPaymentRow & { email: string })[];
}
