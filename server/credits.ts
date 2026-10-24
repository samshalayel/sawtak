import { db, getSettings, transaction } from './db.ts';

// Google meters Gemini TTS output at ~25 audio tokens per second; we bill users 1 credit per started second.
export const AUDIO_TOKENS_PER_SECOND = 25;

// Calibrated against real Gemini TTS output (49–116 wpm depending on tone); keep in sync with src/utils/audio.ts
const WORDS_PER_MINUTE = 80;

// Rough pre-generation estimate used only to reserve credits; the final charge uses the real audio length.
export function estimateSeconds(text: string, speed = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.ceil((words / (WORDS_PER_MINUTE * Math.max(0.5, speed))) * 60));
}

export function pcmSeconds(wav: Buffer): number {
  // 44-byte WAV header, then 16-bit PCM; sample rate lives at byte offset 24
  const sampleRate = wav.readUInt32LE(24) || 24000;
  const channels = wav.readUInt16LE(22) || 1;
  return (wav.length - 44) / (sampleRate * channels * 2);
}

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public balance: number) {
    super('INSUFFICIENT_CREDITS');
  }
}

/**
 * Atomically holds credits for an upcoming generation. Throws if the balance can't cover the estimate.
 * Returns the amount actually held (may be less than the padded estimate when the balance is tight).
 */
export function reserveCredits(userId: number, estimate: number): number {
  return transaction(() => {
    const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (credits < estimate) throw new InsufficientCreditsError(estimate, credits);
    const hold = Math.min(credits, Math.ceil(estimate * 1.6) + 2);
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(hold, userId);
    return hold;
  });
}

export function releaseCredits(userId: number, held: number) {
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(held, userId);
}

interface UsageInput {
  userId: number;
  feature: 'tts' | 'dialogue' | 'tashkeel' | 'optimize' | 'script';
  model: string;
  voice?: string;
  chars: number;
  promptTokens: number;
  outputTokens: number;
  audioSeconds?: number;
  status?: 'ok' | 'failed';
  apiKeyId?: number;
}

function costUsd(feature: UsageInput['feature'], promptTokens: number, outputTokens: number): number {
  const s = getSettings();
  const [inPrice, outPrice] = feature === 'tts' || feature === 'dialogue'
    ? [s.ttsInputPricePerM, s.ttsOutputPricePerM]
    : [s.textInputPricePerM, s.textOutputPricePerM];
  return (promptTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

export function logUsage(input: UsageInput, creditsCharged = 0): number {
  const result = db.prepare(`
    INSERT INTO usage_events (user_id, feature, model, voice, chars, prompt_tokens, output_tokens, audio_seconds, credits_charged, cost_usd, status, api_key_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.userId,
    input.feature,
    input.model,
    input.voice ?? null,
    input.chars,
    input.promptTokens,
    input.outputTokens,
    input.audioSeconds ?? 0,
    creditsCharged,
    costUsd(input.feature, input.promptTokens, input.outputTokens),
    input.status ?? 'ok',
    input.apiKeyId ?? null
  );
  return Number(result.lastInsertRowid);
}

/**
 * Converts a hold into the final charge: 1 credit per started second of generated audio.
 * If the audio ran longer than the hold, the extra is taken from the remaining balance (never below zero).
 */
export function settleTtsCharge(usage: UsageInput & { audioSeconds: number }, held: number) {
  const charge = Math.max(1, Math.ceil(usage.audioSeconds));
  return transaction(() => {
    db.prepare('UPDATE users SET credits = MAX(credits + ? - ?, 0) WHERE id = ?').run(held, charge, usage.userId);
    const usageId = logUsage(usage, charge);
    const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(usage.userId) as { credits: number };
    db.prepare("INSERT INTO credit_transactions (user_id, delta, balance_after, type, note, usage_id) VALUES (?, ?, ?, 'charge', ?, ?)")
      .run(usage.userId, -charge, credits, `توليد صوت (${usage.voice ?? ''})`, usageId);
    return { charged: charge, balance: credits };
  });
}

export function grantCredits(userId: number, amount: number, adminId: number, note: string) {
  return transaction(() => {
    db.prepare('UPDATE users SET credits = MAX(credits + ?, 0) WHERE id = ?').run(amount, userId);
    const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    db.prepare("INSERT INTO credit_transactions (user_id, delta, balance_after, type, note, admin_id) VALUES (?, ?, ?, 'admin_grant', ?, ?)")
      .run(userId, amount, credits, note, adminId);
    return credits;
  });
}
