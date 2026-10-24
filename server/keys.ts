import { GoogleGenAI } from '@google/genai';
import { db } from './db.ts';

// Gemini API key pool with automatic failover: when a key is rate-limited, overloaded, slow or invalid,
// it is put on cooldown and the next key (by priority) is tried before the user ever sees "busy".

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    cooldown_until TEXT,
    last_error TEXT,
    last_error_at TEXT,
    last_used_at TEXT,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (!(db.prepare('PRAGMA table_info(usage_events)').all() as { name: string }[]).some(c => c.name === 'api_key_id')) {
  db.exec('ALTER TABLE usage_events ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL');
}

// Seed the pool from .env on first run so existing deployments keep working
const envKey = process.env.GEMINI_API_KEY?.trim().replace(/^"|"$/g, '');
if (envKey && (db.prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n === 0) {
  db.prepare("INSERT INTO api_keys (label, api_key, priority) VALUES ('المفتاح الأساسي (.env)', ?, 1)").run(envKey);
}

export interface ApiKeyRow {
  id: number;
  label: string;
  api_key: string;
  enabled: number;
  priority: number;
  cooldown_until: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_used_at: string | null;
  success_count: number;
  error_count: number;
  created_at: string;
}

export const maskKey = (key: string) => (key.length <= 12 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`);

// Per-attempt timeout: if Google doesn't answer in time, move on to the next key
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60_000;

const clients = new Map<string, GoogleGenAI>();
function clientFor(key: string): GoogleGenAI {
  let client = clients.get(key);
  if (!client) {
    client = new GoogleGenAI({
      apiKey: key,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS, headers: { 'User-Agent': 'aistudio-build' } },
    });
    clients.set(key, client);
  }
  return client;
}

export function hasUsableKeys(): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE enabled = 1').get() as { n: number }).n > 0;
}

function availableKeys(): ApiKeyRow[] {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM api_keys
    WHERE enabled = 1 AND (cooldown_until IS NULL OR cooldown_until <= ?)
    ORDER BY priority ASC, id ASC
  `).all(now) as unknown as ApiKeyRow[];
}

type FailureKind = 'rate_limit' | 'unavailable' | 'invalid_key' | 'fatal';

/** Decides whether another key could succeed, and how long to rest this one. */
export function classifyError(err: any): { kind: FailureKind; cooldownSec: number; summary: string } {
  const status = Number(err?.status ?? err?.code);
  const message = String(err?.message ?? err);

  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    // Google tells us when to retry, e.g. "retryDelay":"56839s" for the daily quota
    const delay = message.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) || message.match(/retry in ([\d.]+)s/i);
    const daily = /PerDay/i.test(message);
    const seconds = delay ? Math.ceil(Number(delay[1])) : daily ? 6 * 3600 : 60;
    return { kind: 'rate_limit', cooldownSec: Math.min(Math.max(seconds, 30), 24 * 3600), summary: daily ? 'انتهت الحصة اليومية' : 'تجاوز حد الطلبات' };
  }
  if (
    status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(message) ||
    status === 401 || status === 403 || /PERMISSION_DENIED|API_KEY_INVALID|billing/i.test(message)
  ) {
    return { kind: 'invalid_key', cooldownSec: 3600, summary: 'المفتاح غير صالح أو بلا صلاحية' };
  }
  if (
    status === 500 || status === 502 || status === 503 || status === 504 ||
    /UNAVAILABLE|overloaded|timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(message) ||
    err?.name === 'AbortError' || err?.name === 'TimeoutError'
  ) {
    return { kind: 'unavailable', cooldownSec: 30, summary: 'لا استجابة / ضغط على الخادم' };
  }
  // Bad request for this content (e.g. safety, invalid voice): another key won't help
  return { kind: 'fatal', cooldownSec: 0, summary: message.slice(0, 200) };
}

function markFailure(keyId: number, cooldownSec: number, summary: string) {
  const until = cooldownSec > 0 ? new Date(Date.now() + cooldownSec * 1000).toISOString() : null;
  db.prepare(`
    UPDATE api_keys
    SET error_count = error_count + 1, last_error = ?, last_error_at = datetime('now'),
        cooldown_until = COALESCE(?, cooldown_until)
    WHERE id = ?
  `).run(summary, until, keyId);
}

function markSuccess(keyId: number) {
  db.prepare("UPDATE api_keys SET success_count = success_count + 1, last_used_at = datetime('now'), cooldown_until = NULL WHERE id = ?")
    .run(keyId);
}

export class NoKeysAvailableError extends Error {
  status = 503;
  constructor(public lastError?: unknown) {
    super('All Gemini API keys are unavailable (RESOURCE_EXHAUSTED/UNAVAILABLE)');
  }
}

/**
 * Runs a Gemini call with the first healthy key, falling through the pool on rate limits,
 * outages, timeouts and invalid keys. Returns the result plus the key id for usage metering.
 */
export async function withGeminiFailover<T>(
  label: string,
  fn: (client: GoogleGenAI) => Promise<T>
): Promise<{ result: T; keyId: number }> {
  const keys = availableKeys();
  let lastError: unknown;

  for (const key of keys) {
    try {
      const result = await fn(clientFor(key.api_key));
      markSuccess(key.id);
      return { result, keyId: key.id };
    } catch (err) {
      const { kind, cooldownSec, summary } = classifyError(err);
      if (kind === 'fatal') throw err;
      lastError = err;
      markFailure(key.id, cooldownSec, summary);
      console.warn(`[keys] ${label}: key #${key.id} (${maskKey(key.api_key)}) failed — ${summary}; cooldown ${cooldownSec}s, trying next key`);
    }
  }

  throw new NoKeysAvailableError(lastError);
}

/** Cheap call that doesn't consume generation quota: fetch the TTS model's metadata. */
export async function testApiKey(key: string, model: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 15_000 } }).models.get({ model });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classifyError(err).summary };
  }
}
