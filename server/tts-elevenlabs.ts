// Speech from ElevenLabs, a drop-in for the Gemini call in server.ts (synthesizeSpeech): the same inputs (the text,
// the site's voice id and the style directive buildStyleDirective wrote) and the same output (a 24 kHz mono WAV), so
// every service that makes a voice (generate, greetings, reels, motion) uses it unchanged. Switched on in .env with
// TTS_PROVIDER=elevenlabs; ELEVENLABS_API_KEY, ELEVENLABS_VOICE_FEMALE and ELEVENLABS_VOICE_MALE are the voice ids to use
// for the site's female / male voices (ELEVENLABS_VOICE_MAP = {"Kore":"<id>",...} picks one per site voice), and the
// optional ELEVENLABS_MODEL (default eleven_multilingual_v2) and ELEVENLABS_CONCURRENCY (requests at once, default 3;
// ElevenLabs limits this by plan) tune it.
import { spawn } from 'child_process';
import { VOICES } from '../src/data/presets.ts';

const RATE = 24000;
const MAX_CHARS = 2500; // a request's text limit is 3000-5000 characters depending on the model
const RETRY_MS = [1500, 3000, 6000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const apiKey = () => process.env.ELEVENLABS_API_KEY || '';
export const elevenLabsEnabled = () => process.env.TTS_PROVIDER === 'elevenlabs' && Boolean(apiKey());

// ElevenLabs allows only a few requests at once (by plan); the rest wait here instead of failing
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= Math.max(1, Number(process.env.ELEVENLABS_CONCURRENCY) || 3)) await new Promise<void>(r => waiting.push(r));
  else active++;
  try {
    return await fn();
  } finally {
    // The slot passes straight to the next one in line
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

function voiceIdFor(voice: string): string {
  let map: Record<string, string> = {};
  try { map = JSON.parse(process.env.ELEVENLABS_VOICE_MAP || '{}'); } catch { /* an invalid map is ignored */ }
  const female = process.env.ELEVENLABS_VOICE_FEMALE;
  const male = process.env.ELEVENLABS_VOICE_MALE;
  const id = map[voice] || (VOICES.find(v => v.id === voice)?.gender === 'male' ? male || female : female || male);
  if (!id) throw new Error('No ElevenLabs voice is set (ELEVENLABS_VOICE_FEMALE / ELEVENLABS_VOICE_MALE)');
  return id;
}

/** The pace and mood buildStyleDirective put in words, as ElevenLabs voice settings. */
function deliveryFrom(style: string) {
  const speed = /slow/i.test(style) ? 0.85 : /brisk|swift/i.test(style) ? 1.15 : 1;
  const calm = /whisper|calming|soothing/i.test(style);
  const lively = /energetic|enthusiastic|upbeat/i.test(style);
  return { speed, stability: calm ? 0.75 : lively ? 0.35 : 0.5, style: lively ? 0.4 : 0.1 };
}

/** Text in pieces of at most MAX_CHARS, cut after the last sentence end (or space) that fits. */
export function chunkText(text: string, max = MAX_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const part = rest.slice(0, max);
    const stop = Math.max(part.search(/[.!?؟۔\n][^.!?؟۔\n]*$/), -1);
    const cut = stop >= max * 0.5 ? stop + 1 : part.lastIndexOf(' ') >= max * 0.5 ? part.lastIndexOf(' ') : max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** One request's speech as MP3 (the format every plan can have). */
async function speak(text: string, voiceId: string, style: string): Promise<Buffer> {
  const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  const d = deliveryFrom(style);
  // Eleven v3 only takes a stability of 0, 0.5 or 1 and has no pace setting
  const settings = /v3/.test(model)
    ? { stability: d.stability < 0.25 ? 0 : d.stability < 0.75 ? 0.5 : 1 }
    : { stability: d.stability, similarity_boost: 0.75, style: d.style, use_speaker_boost: true, speed: d.speed };
  const url = `${process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io/v1'}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if ((res.status === 429 || res.status === 503) && attempt < RETRY_MS.length) { await sleep(RETRY_MS[attempt]); continue; }
    throw Object.assign(new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`), { status: res.status });
  }
}

/** Decodes an MP3 to 16-bit mono PCM at RATE. */
function decodePcm(mp3: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), 'pipe:1']);
    const out: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', d => out.push(d));
    proc.stderr.on('data', d => { err = (err + d).slice(-500); });
    proc.stdin.on('error', () => { /* ffmpeg quit early: its exit code tells why */ });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err}`))));
    proc.stdin.end(mp3);
  });
}

function wavFromPcm(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** The text spoken by the ElevenLabs voice that stands for the site's `voice`; a 24 kHz mono WAV, or null when empty. */
export async function synthesizeElevenLabs(text: string, voice: string, style: string): Promise<Buffer | null> {
  const voiceId = voiceIdFor(voice);
  const parts = await Promise.all(chunkText(text).map(piece => withSlot(async () => decodePcm(await speak(piece, voiceId, style)))));
  const pcm = Buffer.concat(parts);
  return pcm.length > 0 ? wavFromPcm(pcm) : null;
}
