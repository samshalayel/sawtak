// "Voice video": turns generated speech into a shareable MP4 (image + animated waveform + synced Arabic captions).
// Rendered locally with ffmpeg (libass + fribidi/harfbuzz for Arabic shaping), so it costs no API quota.
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

export type VideoFormat = 'square' | 'vertical' | 'landscape';

interface Layout {
  width: number;
  height: number;
  card: number;      // image card size (px)
  cardTop: number;
  waveTop: number;
  waveHeight: number;
  captionMarginV: number; // distance of captions from the bottom
  fontSize: number;
}

const LAYOUTS: Record<VideoFormat, Layout> = {
  square:    { width: 1080, height: 1080, card: 460, cardTop: 110, waveTop: 680, waveHeight: 150, captionMarginV: 90,  fontSize: 58 },
  vertical:  { width: 1080, height: 1920, card: 620, cardTop: 300, waveTop: 1090, waveHeight: 200, captionMarginV: 420, fontSize: 66 },
  landscape: { width: 1920, height: 1080, card: 420, cardTop: 110, waveTop: 650, waveHeight: 150, captionMarginV: 90,  fontSize: 58 },
};

// Speed vs quality. Layouts are designed at 1080p; "fast" renders at 720p, fewer frames and a quicker x264 preset.
const RENDER_PROFILES = {
  fast: { scale: 2 / 3, fps: Number(process.env.VIDEO_FPS) || 24, preset: process.env.VIDEO_PRESET || 'superfast' },
  hd: { scale: 1, fps: 30, preset: 'veryfast' },
} as const;

function scaleLayout(layout: Layout, scale: number): Layout {
  const even = (n: number) => Math.round((n * scale) / 2) * 2; // x264 needs even dimensions
  return {
    width: even(layout.width),
    height: even(layout.height),
    card: even(layout.card),
    cardTop: Math.round(layout.cardTop * scale),
    waveTop: Math.round(layout.waveTop * scale),
    waveHeight: even(layout.waveHeight),
    captionMarginV: Math.round(layout.captionMarginV * scale),
    fontSize: Math.round(layout.fontSize * scale),
  };
}

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const ARABIC_FONT = process.env.VIDEO_FONT || 'Noto Sans Arabic';
const watermarkFor = (domain: string) => `صُنع بواسطة صوتك الذكي · ${domain}`;
// Long clips get proportionally more time (rendering runs at roughly 2–6x real time)
const renderTimeoutMs = (duration: number) => Math.max(3 * 60_000, duration * 1500 + 60_000);

// ---------- Audio timing: find where speech happens so captions follow the voice ----------

function readPcm(wav: Buffer): { samples: Int16Array; rate: number } {
  let offset = 12;
  let rate = 24000;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') rate = wav.readUInt32LE(offset + 12);
    if (id === 'data') {
      const data = wav.subarray(offset + 8, offset + 8 + size);
      return { samples: new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2)), rate };
    }
    offset += 8 + size;
  }
  throw new Error('Invalid WAV file');
}

/** Speech intervals in seconds (silences shorter than 250 ms are bridged). */
function speechIntervals(wav: Buffer): { intervals: [number, number][]; duration: number } {
  const { samples, rate } = readPcm(wav);
  const frame = Math.round(rate * 0.02);
  const levels: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j++) sum += (samples[i + j] / 32768) ** 2;
    levels.push(10 * Math.log10(sum / frame + 1e-12));
  }
  const threshold = Math.max(...levels) - 35;
  const intervals: [number, number][] = [];
  let start = -1;
  let silentRun = 0;
  levels.forEach((level, i) => {
    if (level > threshold) {
      if (start < 0) start = i;
      silentRun = 0;
    } else if (start >= 0 && ++silentRun * 20 >= 250) {
      intervals.push([start * 0.02, (i - silentRun + 1) * 0.02]);
      start = -1;
      silentRun = 0;
    }
  });
  if (start >= 0) intervals.push([start * 0.02, levels.length * 0.02]);
  return { intervals, duration: samples.length / rate };
}

/** Splits text into short caption phrases (punctuation first, then at most ~6 words). */
function captionChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const sentence of text.replace(/\s+/g, ' ').split(/(?<=[.!؟?،,…:;])\s+/)) {
    const words = sentence.trim().split(' ').filter(Boolean);
    let i = 0;
    while (i < words.length) {
      // Take up to 6 words, but absorb a single leftover word instead of showing it alone
      const take = words.length - i === 7 ? 7 : 6;
      chunks.push(words.slice(i, i + take).join(' '));
      i += take;
    }
  }
  return chunks.filter(Boolean);
}

/** Maps caption phrases onto the speech timeline proportionally to their length (silences are skipped). */
function timeCaptions(text: string, wav: Buffer): { start: number; end: number; text: string }[] {
  const chunks = captionChunks(text);
  const { intervals, duration } = speechIntervals(wav);
  const speech = intervals.length ? intervals : [[0, duration] as [number, number]];
  const speechTotal = speech.reduce((sum, [a, b]) => sum + (b - a), 0);
  const weights = chunks.map(c => c.replace(/\s/g, '').length || 1);
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  // Convert "seconds of speech so far" into a real timestamp
  const at = (speechSeconds: number) => {
    let remaining = speechSeconds;
    for (const [a, b] of speech) {
      if (remaining <= b - a) return a + remaining;
      remaining -= b - a;
    }
    return speech[speech.length - 1][1];
  };

  let consumed = 0;
  return chunks.map((chunk, i) => {
    const start = at((consumed / weightTotal) * speechTotal);
    consumed += weights[i];
    const end = at((consumed / weightTotal) * speechTotal);
    return { start, end: Math.max(end, start + 0.6), text: chunk };
  });
}

// ---------- ASS subtitle file ----------

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Escape ASS override characters and force right-to-left so edge punctuation lands on the correct side
const assText = (t: string) => '\u202B' + t.replace(/[{}\\]/g, '').replace(/\s+/g, ' ') + '\u202C';

function buildAss(layout: Layout, captions: { start: number; end: number; text: string }[], duration: number, title: string, domain: string): string {
  const { width, height, fontSize, captionMarginV } = layout;
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Captions: white bold text in a translucent dark box, bottom-centre
    `Style: Caption,${ARABIC_FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,1,0,0,0,100,100,0,0,3,18,0,2,80,80,${captionMarginV},-1`,
    `Style: Title,${ARABIC_FONT},${Math.round(fontSize * 0.62)},&H0000BFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,60,60,${Math.round(layout.cardTop + layout.card + 24)},-1`,
    `Style: Mark,${ARABIC_FONT},${Math.round(fontSize * 0.42)},&H99FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,9,40,40,36,-1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Mark,,0,0,0,,${assText(watermarkFor(domain))}`,
  ];
  if (title) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Title,,0,0,0,,${assText(title)}`);
  for (const c of captions) lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);
  return lines.join('\n') + '\n';
}

// ---------- Background frame (blurred backdrop + rounded image card) ----------

async function buildBackground(layout: Layout, image: Buffer): Promise<Buffer> {
  const { width, height, card, cardTop } = layout;
  const backdrop = await sharp(image)
    .resize(width, height, { fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.45, saturation: 1.1 })
    .toBuffer();

  const radius = Math.round(card * 0.12);
  const mask = Buffer.from(`<svg width="${card}" height="${card}"><rect width="${card}" height="${card}" rx="${radius}" ry="${radius}"/></svg>`);
  const cardImage = await sharp(image)
    .resize(card, card, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const glow = Buffer.from(
    `<svg width="${card + 40}" height="${card + 40}"><rect x="20" y="20" width="${card}" height="${card}" rx="${radius}" ry="${radius}" fill="none" stroke="#f59e0b" stroke-width="6" opacity="0.9"/></svg>`
  );

  return sharp(backdrop)
    .composite([
      { input: glow, left: Math.round((width - card) / 2) - 20, top: cardTop - 20 },
      { input: cardImage, left: Math.round((width - card) / 2), top: cardTop },
    ])
    .png()
    .toBuffer();
}

// ---------- Render queue (one ffmpeg at a time: the server is shared) ----------

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
const MAX_WAITING = 4;

export class RenderBusyError extends Error {}

function runFfmpeg(
  args: string[],
  cwd: string,
  { timeoutMs, duration, onProgress }: { timeoutMs: number; duration: number; onProgress?: (fraction: number) => void }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-progress', 'pipe:1', '-nostats', ...args], { cwd });
    let stderr = '';
    proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4000); });
    // "-progress" prints key=value lines; out_time_us tells how much of the video is encoded
    proc.stdout.on('data', d => {
      const match = /out_time_us=(\d+)/g;
      let last: RegExpExecArray | null = null;
      for (let m; (m = match.exec(d.toString())); ) last = m;
      if (last && duration > 0) onProgress?.(Math.min(0.99, Number(last[1]) / 1e6 / duration));
    });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export interface RenderOptions {
  wav: Buffer;
  text: string;
  image: Buffer;
  format: VideoFormat;
  title?: string;
  captions?: boolean;
  hd?: boolean;                          // 1080p/30fps instead of the faster 720p/24fps
  domain?: string;                       // shown in the watermark (the site the customer is using)
  onProgress?: (fraction: number) => void;
  onStart?: () => void;                  // called when the job leaves the queue
}

export async function renderVoiceVideo(opts: RenderOptions): Promise<Buffer> {
  if (waiting >= MAX_WAITING) throw new RenderBusyError('Render queue is full');
  waiting++;
  const job = queue.then(() => { opts.onStart?.(); return renderNow(opts); });
  queue = job.catch(() => {}).finally(() => { waiting--; });
  return job;
}

async function renderNow({ wav, text, image, format, title = '', captions = true, hd = false, domain = 'tts.sillar.us', onProgress }: RenderOptions): Promise<Buffer> {
  const profile = hd ? RENDER_PROFILES.hd : RENDER_PROFILES.fast;
  const layout = scaleLayout(LAYOUTS[format], profile.scale);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sawtik-video-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    const { duration } = speechIntervals(wav);
    const timed = captions ? timeCaptions(text, wav) : [];
    await Promise.all([
      fs.writeFile(path.join(dir, 'audio.wav'), wav),
      fs.writeFile(path.join(dir, 'bg.png'), await buildBackground(layout, image)),
      fs.writeFile(path.join(dir, 'subs.ass'), buildAss(layout, timed, duration, title.slice(0, 60), domain)),
    ]);

    const waveWidth = Math.round(layout.width * 0.8);
    const filter = [
      // Waveform in brand amber (showwaves output is already transparent). The volume boost only affects
      // the drawing — the audio track is mapped straight from the input.
      // Everything is composited in yuv420p (the output format) so frames aren't converted back and forth.
      // The backdrop is decoded once and repeated in memory (image2 "-loop 1" would re-decode the PNG every frame)
      `[0:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps=${profile.fps}[bg]`,
      `[1:a]volume=4,showwaves=s=${waveWidth}x${layout.waveHeight}:mode=cline:rate=${profile.fps}:colors=#F59E0B:scale=sqrt:draw=full,format=yuva420p[waves]`,
      `[bg][waves]overlay=x=(W-w)/2:y=${layout.waveTop}:format=yuv420:shortest=1[v1]`,
      `[v1]subtitles=subs.ass[vout]`,
    ].join(';');

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '4',
      '-i', 'bg.png',
      '-i', 'audio.wav',
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', profile.preset, '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', String(profile.fps), '-shortest', '-movflags', '+faststart',
      'out.mp4',
    ], dir, { timeoutMs: renderTimeoutMs(duration), duration, onProgress });

    return await fs.readFile(path.join(dir, 'out.mp4'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Decodes and sanity-checks an uploaded image (any common format) into a PNG buffer. */
export async function normalizeImage(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('Unsupported image');
  return sharp(input).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}
