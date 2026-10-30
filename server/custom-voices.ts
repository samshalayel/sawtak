import express from 'express';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { db } from './db.ts';
import { ApiKeyRow, withPinnedKey } from './keys.ts';
import { logUsage } from './credits.ts';
import { CLONE_MODELS, cloneSpeech } from './tts-openrouter.ts';
import { wavFromPcm } from './tts-elevenlabs.ts';

// Custom voice avatars ("voice replication"): Gemini clones a speaker from a 10–30 s reference clip plus a
// recording of the same speaker reading Google's consent statement. Admin-only for now (trial phase).
// Alternatively through OpenRouter's cloning models: nothing is created there, the cleaned reference clip kept here
// is sent with every request (those voices have an `openrouter-` id and no API key).

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Model used to speak with custom voices (same one as the rest of the studio)
const VOICE_MODEL = 'gemini-3.8-flash-lite-tts';
const PROJECT_VOICE_LIMIT = 200;
const MIN_REFERENCE_SECONDS = 10;
const MAX_REFERENCE_SECONDS = 30;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const VOICES_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'custom-voices');

/** The exact Arabic statement Google verifies in the consent recording (locale ar-XA). */
export const CONSENT_STATEMENT_AR = 'أنا مالك هذا الصوت وأوافق على أن تستخدم Google هذا الصوت لإنشاء نموذج صوتي اصطناعي.';

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_voices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voice_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    reference_seconds REAL NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface CustomVoiceRow {
  id: number;
  voice_id: string;
  name: string;
  api_key_id: number | null;
  model: string;
  reference_seconds: number;
  created_by: number | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

// ---------- Audio preparation ----------

function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-2000); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

/** Seconds of audio in a 16-bit mono WAV, read from its data chunk. */
export function wavSeconds(wav: Buffer, rate = 24000): number {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return Math.min(size, wav.length - offset - 8) / (rate * 2);
    offset += 8 + size + (size % 2);
  }
  return 0;
}

// Same format Google recommends: 24 kHz, mono, 16-bit PCM, loudness-normalised
const OUTPUT_ARGS = ['-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
// Trims leading silence and shortens long pauses (keeps 0.3 s so speech still sounds natural)
const TRIM_SILENCE = 'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.8:stop_threshold=-45dB:stop_silence=0.3';
const NORMALIZE = 'loudnorm=I=-18:TP=-2:LRA=11';

/**
 * Joins the uploaded clips (any format ffmpeg reads: mp3, m4a, wav, ogg, webm…), removes long silences,
 * normalises loudness and keeps the first `maxSeconds` of speech.
 */
export async function prepareAudio(clips: Buffer[], maxSeconds: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sawtik-voice-'));
  try {
    const inputs: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const file = path.join(dir, `in${i}`);
      await fs.writeFile(file, clips[i]);
      inputs.push('-i', file);
    }
    const perInput = clips.map((_, i) => `[${i}:a]aformat=sample_rates=24000:channel_layouts=mono[a${i}]`).join(';');
    const joined = clips.map((_, i) => `[a${i}]`).join('');
    const filter = `${perInput};${joined}concat=n=${clips.length}:v=0:a=1,${TRIM_SILENCE},${NORMALIZE}[out]`;
    const out = path.join(dir, 'out.wav');
    await runFfmpeg([...inputs, '-filter_complex', filter, '-map', '[out]', '-t', String(maxSeconds), ...OUTPUT_ARGS, out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Gemini Voices API (REST, as documented) ----------

async function geminiRequest(apiKey: string, method: string, endpoint: string, body?: unknown, timeoutMs = 120_000) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // Shape the error like the SDK's so the key pool classifies it the same way
    throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), { status: res.status, details: data?.error });
  }
  return data;
}

/** Pulls the audio out of an Interactions response (output_audio, or the last audio block of the model output). */
function extractAudio(data: any): { data: string; mimeType?: string } | null {
  if (data?.output_audio?.data) return { data: data.output_audio.data, mimeType: data.output_audio.mime_type };
  const blocks = (data?.steps ?? [])
    .filter((s: any) => s?.type === 'model_output')
    .flatMap((s: any) => s?.content ?? [])
    .filter((c: any) => c?.type === 'audio' && c?.data);
  const last = blocks[blocks.length - 1];
  return last ? { data: last.data, mimeType: last.mime_type } : null;
}

const isOpenRouterVoice = (voice: CustomVoiceRow) => voice.voice_id.startsWith('openrouter-');

/** Speaks `text` with an OpenRouter voice: its stored reference clip and a cloning model (its own unless `model` is given). */
async function speakWithOpenRouter(voice: CustomVoiceRow, text: string, style: string, model?: string) {
  const reference = await fs.readFile(referencePath(voice.id));
  const useModel = CLONE_MODELS.some(m => m.id === model) ? model! : voice.model;
  const { audio, format } = await cloneSpeech(useModel, text, reference, style);
  let wav: Buffer;
  if (format === 'pcm') wav = wavFromPcm(audio, 24000);
  else {
    // Same WAV as the rest of the studio (24 kHz mono)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sawtik-voice-'));
    try {
      await fs.writeFile(path.join(dir, 'in'), audio);
      await runFfmpeg(['-i', path.join(dir, 'in'), ...OUTPUT_ARGS, path.join(dir, 'out.wav')]);
      wav = await fs.readFile(path.join(dir, 'out.wav'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  db.prepare("UPDATE custom_voices SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?").run(voice.id);
  return { wav, seconds: wavSeconds(wav), model: useModel };
}

function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Speaks `text` with a stored custom voice, through the key of the project that owns it. */
export async function speakWithCustomVoice(voice: CustomVoiceRow, text: string, style: string) {
  if (!voice.api_key_id) throw Object.assign(new Error('Voice has no owning API key'), { code: 'VOICE_KEY_MISSING' });
  const content: any = { type: 'text', text };
  if (style.trim()) content.annotations = [{ type: 'speech_metadata', style: style.trim() }];

  const data = await withPinnedKey(voice.api_key_id, 'custom-voice', key =>
    geminiRequest(key.api_key, 'POST', '/interactions', {
      model: voice.model,
      input: [{ type: 'user_input', content: [content] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: voice.voice_id }] },
    })
  );

  const audio = extractAudio(data);
  if (!audio) throw new Error('No audio returned');
  const raw = Buffer.from(audio.data, 'base64');
  const rate = Number(audio.mimeType?.match(/rate=(\d+)/)?.[1]) || 24000;
  const wav = raw.subarray(0, 4).toString('ascii') === 'RIFF' ? raw : pcmToWav(raw, rate);

  db.prepare("UPDATE custom_voices SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?").run(voice.id);
  const usage = data?.usage ?? {};
  return {
    wav,
    seconds: wavSeconds(wav),
    promptTokens: Number(usage.total_input_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.total_output_tokens ?? usage.output_tokens ?? 0),
    keyId: voice.api_key_id,
  };
}

/**
 * Voice creation tries each enabled key in turn, but never puts keys on cooldown: its refusals
 * (free tier, consent check) say nothing about the key's health for normal generation.
 */
async function createOnFirstEligibleKey(fn: (key: ApiKeyRow) => Promise<any>): Promise<{ result: any; keyId: number }> {
  const keys = db.prepare('SELECT * FROM api_keys WHERE enabled = 1 ORDER BY priority ASC, id ASC').all() as unknown as ApiKeyRow[];
  let lastError: any = new Error('No API keys configured');
  let freeTierOnly = keys.length > 0;
  for (const key of keys) {
    try {
      return { result: await fn(key), keyId: key.id };
    } catch (err: any) {
      lastError = err;
      const message = String(err?.message || '');
      const tierBlocked = /Paid Quota Tier|requires .*Tier/i.test(message);
      if (!tierBlocked) freeTierOnly = false;
      // Only quota/tier/outage problems are worth another key; a rejected recording would fail everywhere
      if (!tierBlocked && Number(err?.status) !== 429 && Number(err?.status) < 500) throw err;
      console.warn(`[custom-voices] key #${key.id} cannot create voices: ${message.slice(0, 160)}`);
    }
  }
  if (freeTierOnly) throw Object.assign(new Error(lastError?.message), { code: 'PAID_TIER_REQUIRED' });
  throw lastError;
}

// ---------- Admin routes (mounted under /api/admin, so already admin-only) ----------

export const customVoicesRouter = express.Router();

const getVoice = (id: number) => db.prepare('SELECT * FROM custom_voices WHERE id = ?').get(id) as unknown as CustomVoiceRow | undefined;
const referencePath = (id: number) => path.join(VOICES_DIR, `${id}-reference.wav`);

// Shown to the admin as-is: Google's reason is what tells them what to fix (consent mismatch, noisy clip…)
const adminError = (res: express.Response, err: any, fallback: string) => {
  console.error(`[custom-voices] ${fallback}:`, err?.details ?? err);
  if (err?.code === 'VOICE_KEY_MISSING') {
    return res.status(409).json({ success: false, error: 'مفتاح API الذي أُنشئ به هذا الصوت محذوف أو معطّل. الأصوات المخصصة تعمل فقط بمفتاح من نفس مشروع Google.' });
  }
  if (err?.code === 'PAID_TIER_REQUIRED') {
    return res.status(400).json({
      success: false,
      error: 'نسخ الصوت يتطلب مفتاح API من مشروع Google مدفوع (Paid Tier 1 أو أعلى). كل المفاتيح الحالية على الخطة المجانية. فعّل الفوترة على مشروع المفتاح في Google AI Studio ثم أعد المحاولة.',
    });
  }
  if (err?.code === 'ENOENT') return res.status(500).json({ success: false, error: 'برنامج ffmpeg غير متوفر على الخادم' });
  const detail = String(err?.message || '').slice(0, 400);
  res.status(Number(err?.status) >= 400 && Number(err?.status) < 500 ? 400 : 500).json({ success: false, error: detail ? `${fallback}: ${detail}` : fallback });
};

customVoicesRouter.get('/', (_req, res) => {
  const voices = db.prepare(`
    SELECT v.*, u.email AS created_by_email, k.label AS key_label
    FROM custom_voices v
    LEFT JOIN users u ON u.id = v.created_by
    LEFT JOIN api_keys k ON k.id = v.api_key_id
    ORDER BY v.id DESC
  `).all();
  res.json({
    success: true,
    voices,
    limit: PROJECT_VOICE_LIMIT,
    consentStatement: CONSENT_STATEMENT_AR,
    minSeconds: MIN_REFERENCE_SECONDS,
    maxSeconds: MAX_REFERENCE_SECONDS,
    openRouter: { enabled: Boolean(process.env.OPENROUTER_API_KEY), models: CLONE_MODELS },
  });
});

const decodeClip = (value: unknown): Buffer | null => {
  if (typeof value !== 'string' || !value) return null;
  const buf = Buffer.from(value.replace(/^data:[^,]*,/, ''), 'base64');
  return buf.length > 1000 ? buf : null;
};

customVoicesRouter.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const sources = (Array.isArray(req.body?.sources) ? req.body.sources : []).slice(0, 10).map(decodeClip).filter(Boolean) as Buffer[];
  const consent = decodeClip(req.body?.consent);
  const viaOpenRouter = req.body?.provider === 'openrouter';
  const cloneModel = String(req.body?.model || '');

  if (!name) return res.status(400).json({ success: false, error: 'اكتب اسماً للصوت' });
  if (sources.length === 0) return res.status(400).json({ success: false, error: 'ارفع ملفاً صوتياً واحداً على الأقل للمرجع' });
  if (viaOpenRouter && !process.env.OPENROUTER_API_KEY) return res.status(400).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط في .env' });
  if (viaOpenRouter && !CLONE_MODELS.some(m => m.id === cloneModel)) return res.status(400).json({ success: false, error: 'اختر نموذج النسخ' });
  if (!consent && !viaOpenRouter) return res.status(400).json({ success: false, error: 'سجّل أو ارفع تسجيل جملة الموافقة' });
  if (req.body?.confirmOwnership !== true) {
    return res.status(400).json({ success: false, error: 'يجب التأكيد أن صاحب الصوت وافق على نسخه' });
  }

  let reference: Buffer;
  let consentWav: Buffer | null = null;
  try {
    reference = await prepareAudio(sources, MAX_REFERENCE_SECONDS);
    if (!viaOpenRouter) consentWav = await prepareAudio([consent!], 20);
  } catch (err) {
    return adminError(res, err, 'تعذّرت معالجة الملفات الصوتية');
  }

  const referenceSeconds = wavSeconds(reference);
  if (referenceSeconds < MIN_REFERENCE_SECONDS) {
    return res.status(400).json({
      success: false,
      error: `مدة الكلام الصافي في الملفات ${referenceSeconds.toFixed(1)} ثانية فقط بعد إزالة الصمت، والمطلوب ${MIN_REFERENCE_SECONDS} ثوانٍ على الأقل (الأفضل 30).`,
    });
  }
  if (consentWav && wavSeconds(consentWav) < 2) {
    return res.status(400).json({ success: false, error: 'تسجيل الموافقة قصير جداً أو صامت' });
  }

  if (viaOpenRouter) {
    const row = db.prepare(`
      INSERT INTO custom_voices (voice_id, name, api_key_id, model, reference_seconds, created_by)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(`openrouter-${crypto.randomBytes(6).toString('hex')}`, name, cloneModel, Math.round(referenceSeconds * 10) / 10, req.user!.id);
    const id = Number(row.lastInsertRowid);
    await fs.mkdir(VOICES_DIR, { recursive: true });
    await fs.writeFile(referencePath(id), reference);
    return res.json({ success: true, voice: getVoice(id), referenceSeconds });
  }

  try {
    const { result, keyId } = await createOnFirstEligibleKey(key =>
      geminiRequest(key.api_key, 'POST', '/voices', {
        store: true,
        // No `model` here: Google creates replicated voices with its default model, and the voice
        // then works with any TTS model (naming the Lite TTS model is rejected)
        voice: {
          type: 'replicated',
          display_name: `sawtik-${crypto.randomBytes(3).toString('hex')}`,
          replicated: {
            source_audio: { mime_type: 'audio/wav', data: reference.toString('base64') },
            consent_audio: { mime_type: 'audio/wav', data: consentWav!.toString('base64') },
          },
        },
      }, 180_000)
    );
    const voiceId = String(result?.id || result?.voice?.id || '');
    if (!voiceId) throw new Error('Google did not return a voice id');

    const row = db.prepare(`
      INSERT INTO custom_voices (voice_id, name, api_key_id, model, reference_seconds, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(voiceId, name, keyId, VOICE_MODEL, Math.round(referenceSeconds * 10) / 10, req.user!.id);
    const id = Number(row.lastInsertRowid);

    // Keep the cleaned reference so the admin can compare the clone against the original
    await fs.mkdir(VOICES_DIR, { recursive: true });
    await fs.writeFile(referencePath(id), reference);

    res.json({ success: true, voice: getVoice(id), referenceSeconds });
  } catch (err) {
    adminError(res, err, 'رفضت Google إنشاء الصوت');
  }
});

customVoicesRouter.get('/:id/reference', async (req, res) => {
  const file = await fs.readFile(referencePath(Number(req.params.id))).catch(() => null);
  if (!file) return res.status(404).json({ success: false, error: 'الملف المرجعي غير موجود' });
  res.type('audio/wav').send(file);
});

customVoicesRouter.post('/:id/speak', async (req, res) => {
  const voice = getVoice(Number(req.params.id));
  if (!voice) return res.status(404).json({ success: false, error: 'الصوت غير موجود' });
  const text = String(req.body?.text || '').trim();
  const style = String(req.body?.style || '').slice(0, 500);
  if (!text) return res.status(400).json({ success: false, error: 'اكتب نصاً للتجربة' });
  if (text.length > 3000) return res.status(400).json({ success: false, error: 'النص أطول من 3000 حرف' });

  if (isOpenRouterVoice(voice)) {
    try {
      const result = await speakWithOpenRouter(voice, text, style, req.body?.model);
      logUsage({ userId: req.user!.id, feature: 'tts', model: result.model, voice: voice.voice_id, chars: text.length,
        // Priced by OpenRouter, not in Gemini tokens: the real cost shows in the OpenRouter card
        promptTokens: 0, outputTokens: 0, audioSeconds: result.seconds });
      return res.json({ success: true, audioBase64: result.wav.toString('base64'), durationSeconds: result.seconds, model: result.model });
    } catch (err) {
      return adminError(res, err, 'تعذّر التوليد عبر OpenRouter');
    }
  }

  try {
    const result = await speakWithCustomVoice(voice, text, style);
    // Admin trials are logged for cost tracking but not charged
    logUsage({
      userId: req.user!.id, feature: 'tts', model: voice.model, voice: voice.voice_id, chars: text.length,
      promptTokens: result.promptTokens, outputTokens: result.outputTokens || Math.round(result.seconds * 25),
      audioSeconds: result.seconds, apiKeyId: result.keyId,
    });
    res.json({ success: true, audioBase64: result.wav.toString('base64'), durationSeconds: result.seconds });
  } catch (err) {
    adminError(res, err, 'تعذّر التوليد بهذا الصوت');
  }
});

customVoicesRouter.delete('/:id', async (req, res) => {
  const voice = getVoice(Number(req.params.id));
  if (!voice) return res.status(404).json({ success: false, error: 'الصوت غير موجود' });
  try {
    if (voice.api_key_id) {
      await withPinnedKey(voice.api_key_id, 'voice-delete', key =>
        geminiRequest(key.api_key, 'DELETE', `/voices/${encodeURIComponent(voice.voice_id)}`)
      ).catch(err => {
        // Already gone at Google (expired or deleted elsewhere): just forget it locally
        if (Number(err?.status) !== 404) throw err;
      });
    }
  } catch (err) {
    return adminError(res, err, 'تعذّر حذف الصوت من Google');
  }
  db.prepare('DELETE FROM custom_voices WHERE id = ?').run(voice.id);
  await fs.rm(referencePath(voice.id), { force: true }).catch(() => {});
  res.json({ success: true });
});
