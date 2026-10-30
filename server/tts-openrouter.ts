// Gemini TTS through OpenRouter, for when Google's own billing is not an option: the same model the site calls
// directly (google/gemini-3.8-flash-lite-tts), the same voice names and the same style directive (OpenRouter sends
// `instructions` to Gemini as speech_metadata.style), paid from an OpenRouter balance. Switched on in .env with
// TTS_PROVIDER=openrouter and OPENROUTER_API_KEY; the optional OPENROUTER_TTS_MODEL, OPENROUTER_CONCURRENCY (requests
// at once, default 5) and OPENROUTER_PCM_RATE (the sample rate of the raw audio, default 24000) tune it.
import { wavFromPcm } from './tts-elevenlabs.ts';

const RETRY_MS = [1500, 3000, 6000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const apiKey = () => process.env.OPENROUTER_API_KEY || '';
export const openRouterEnabled = () => process.env.TTS_PROVIDER === 'openrouter' && Boolean(apiKey());

// A few requests at once; the rest wait here instead of failing
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= Math.max(1, Number(process.env.OPENROUTER_CONCURRENCY) || 5)) await new Promise<void>(r => waiting.push(r));
  else active++;
  try {
    return await fn();
  } finally {
    // The slot passes straight to the next one in line
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

/** One speech request (a single voice or several turns); the raw PCM comes back as a 24 kHz mono WAV, or null when empty. */
async function requestSpeech(payload: Record<string, unknown>): Promise<Buffer | null> {
  const url = `${process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1'}/audio/speech`;
  const body = JSON.stringify({
    model: process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.8-flash-lite-tts',
    ...payload, response_format: 'pcm', // Gemini TTS only returns raw PCM
  });
  const pcm = await withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(180_000),
      });
      // Errors come back as JSON, audio as raw bytes
      if (res.ok && !/json/i.test(res.headers.get('content-type') || '')) return Buffer.from(await res.arrayBuffer());
      if ([429, 502, 503].includes(res.status) && attempt < RETRY_MS.length) { await sleep(RETRY_MS[attempt]); continue; }
      throw Object.assign(new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`), { status: res.status });
    }
  });
  return pcm.length > 0 ? wavFromPcm(pcm, Number(process.env.OPENROUTER_PCM_RATE) || 24000) : null;
}

/** The text spoken by Gemini TTS through OpenRouter in `voice` with the style directive; a 24 kHz mono WAV, or null when empty. */
export function synthesizeOpenRouter(text: string, voice: string, style: string): Promise<Buffer | null> {
  return requestSpeech({ input: text, voice, instructions: style });
}

export interface DialogueTurn { text: string; voice: string }

/** A conversation: each turn in its own voice, in one request (Gemini multi-speaker). One voice for every turn is read as plain text. */
export function synthesizeOpenRouterDialogue(turns: DialogueTurn[], style: string): Promise<Buffer | null> {
  if (new Set(turns.map(t => t.voice)).size === 1) return requestSpeech({ input: turns.map(t => t.text).join('\n'), voice: turns[0].voice, instructions: style });
  return requestSpeech({ input: turns.map(t => ({ text: t.text, voice: t.voice })), instructions: style });
}

/** Voice-cloning models on OpenRouter (stateless: the reference clip goes with every request). */
export const CLONE_MODELS = [
  { id: 'fish-audio/s2.1-pro', label: 'Fish Audio S2.1 Pro' },
  { id: 'heygen/heygen-voice-1', label: 'HeyGen Voice 1' },
  { id: 'bytedance-seed/seed-audio-1-0', label: 'Seed Audio 1.0' },
  { id: 'mistralai/voxtral-mini-tts-2603', label: 'Voxtral Mini TTS' },
  // Not listed by OpenRouter as a cloning model: kept to see whether it takes a reference clip at all
  { id: 'google/gemini-3.8-flash-lite-tts', label: 'Gemini Flash TTS (تجريبي)' },
];

/**
 * `text` spoken in the voice of `referenceWav` (optionally with its `transcript`) by a cloning model. Returns the audio as the provider sent it:
 * MP3 when it accepts that format, otherwise raw 24 kHz PCM.
 */
export async function cloneSpeech(model: string, text: string, referenceWav: Buffer, style: string, transcript = ''): Promise<{ audio: Buffer; format: 'mp3' | 'pcm' }> {
  if (!apiKey()) throw Object.assign(new Error('OPENROUTER_API_KEY is not set'), { status: 400 });
  const url = `${process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1'}/audio/speech`;
  const request = (format: 'mp3' | 'pcm') => withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, input: text, response_format: format,
          ...(style.trim() ? { instructions: style.trim() } : {}),
          input_references: [
            { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${referenceWav.toString('base64')}` } },
            // What is said in the clip, word for word: Fish Audio matches the voice much more closely with it
            ...(transcript.trim() ? [{ type: 'text', text: transcript.trim() }] : []),
          ],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok && !/json/i.test(res.headers.get('content-type') || '')) return Buffer.from(await res.arrayBuffer());
      if ([429, 502, 503].includes(res.status) && attempt < RETRY_MS.length) { await sleep(RETRY_MS[attempt]); continue; }
      throw Object.assign(new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`), { status: res.status });
    }
  });
  try {
    return { audio: await request('mp3'), format: 'mp3' };
  } catch (err: any) {
    // Some providers only return raw PCM
    if (err?.status === 400 && /format|mp3|pcm/i.test(err.message)) return { audio: await request('pcm'), format: 'pcm' };
    throw err;
  }
}
