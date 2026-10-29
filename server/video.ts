// "Voice video": turns generated speech into a shareable MP4 (image + animated waveform + synced Arabic captions).
// Rendered locally with ffmpeg (libass + fribidi/harfbuzz for Arabic shaping), so it costs no API quota.
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { GREETING_THEMES, GreetingTheme } from './greeting-themes.ts';
import { stripAudioTags } from '../src/utils/audioTags.ts';
import {
  GREETING_DESIGN, DEFAULT_PHOTO_BOX, PhotoBox, buildGreetingBackground, waveColorFor,
  GREETING_FONTS, DEFAULT_TEXT_STYLE, TextStyle, isDarkColor,
} from './greeting-art.ts';

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
export const RENDER_PROFILES = {
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
export const ARABIC_FONT = process.env.VIDEO_FONT || 'Noto Sans Arabic';
export const watermarkFor = (domain: string) => `صُنع بواسطة صوتك الذكي · ${domain}`;
// Long clips get proportionally more time (rendering runs at roughly 2–6x real time)
export const renderTimeoutMs = (duration: number) => Math.max(3 * 60_000, duration * 1500 + 60_000);

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
export function speechIntervals(wav: Buffer): { intervals: [number, number][]; duration: number } {
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
export function captionChunks(text: string): string[] {
  const chunks: string[] = [];
  // Performance tags ([excited], [short pause]…) are for the voice only, never shown on screen
  for (const sentence of stripAudioTags(text).replace(/\s+/g, ' ').split(/(?<=[.!؟?،,…:;])\s+/)) {
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

export const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Escape ASS override characters and force right-to-left so edge punctuation lands on the correct side
export const assText = (t: string) => '\u202B' + t.replace(/[{}\\]/g, '').replace(/\s+/g, ' ') + '\u202C';

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

// ---------- Greeting videos (occasion artwork, big headline, sender line) ----------

/** "#rrggbb" -> ASS colour "&H00BBGGRR" */
const assColor = (hex: string, alpha = '00') => {
  const h = hex.replace('#', '');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};

// Positions on the 1080×1920 design (see greeting-art.ts), scaled with the render size
const GREETING_TEXT = { titleTop: 140, titleSize: 112, waveTop: 1225, waveHeight: 170, captionsBottom: 330, captionSize: 60, fromBottom: 200, fromSize: 50 };

/**
 * Vertical layout of a greeting below the photo. On customer templates the photo can be anywhere, so the wave
 * takes the space left between the photo and the captions; when that is too tight the captions (and the sender
 * line) move lower, and if there is still no room the wave is left out — the photo matters more.
 * The client preview (src/components/PhotoAdjuster.tsx) mirrors this rule.
 */
const TEMPLATE_WAVE_HEIGHT = 96;

/** Height of the caption box for a font size (text line + box padding). */
const captionBoxHeight = (captionSize: number) => Math.round(captionSize * 1.4 + 32);
/** The sender line sits below the captions; it follows them when they move. */
const fromBottomFor = (captionsBottom: number) =>
  captionsBottom === GREETING_TEXT.captionsBottom ? GREETING_TEXT.fromBottom : captionsBottom === 200 ? 100 : Math.max(40, captionsBottom - 130);

export function greetingLayout(
  greeting: { template?: Buffer | null; photoBox?: PhotoBox; textStyle?: TextStyle }, hasPhoto: boolean
) {
  const t = GREETING_TEXT;
  const style = greeting.textStyle ?? DEFAULT_TEXT_STYLE;
  const custom = style.captionsBottom;
  if (!greeting.template || !hasPhoto) {
    const captionsBottom = custom ?? t.captionsBottom;
    return { waveTop: t.waveTop, waveHeight: t.waveHeight, captionsBottom, fromBottom: fromBottomFor(captionsBottom) };
  }
  const box = greeting.photoBox ?? DEFAULT_PHOTO_BOX;
  const waveTop = Math.round(box.cy + box.size / 2 + 30);
  const room = (captionsBottom: number) => 1920 - captionsBottom - captionBoxHeight(style.captionSize) - 20 - waveTop;
  // Placed by the customer: keep it; automatic: move the captions lower when the photo leaves no room
  const captionsBottom = custom ?? (room(t.captionsBottom) < 90 ? 200 : t.captionsBottom);
  // Thinner wave on customer designs, so it decorates instead of covering the template
  const space = box.wave ? Math.min(TEMPLATE_WAVE_HEIGHT, room(captionsBottom)) : 0;
  const waveHeight = space >= 50 ? Math.floor(space / 2) * 2 : 0;
  return { waveTop, waveHeight, captionsBottom, fromBottom: fromBottomFor(captionsBottom) };
}

function buildGreetingAss(
  scale: number, width: number, height: number, theme: GreetingTheme,
  captions: { start: number; end: number; text: string }[], duration: number, title: string, from: string, domain: string,
  place: { captionsBottom: number; fromBottom: number }, style: TextStyle, fromColor: string,
  only?: 'static' | 'captions' // the fixed layers (watermark, title, sender line) or just the captions
): string {
  const t = { ...GREETING_TEXT, ...place, titleTop: style.titleTop, titleSize: style.titleSize, captionSize: style.captionSize };
  const px = (n: number) => Math.round(n * scale);
  const font = GREETING_FONTS[style.font];
  const titleColor = style.titleColor ?? theme.title;
  // Light headline: dark outline; dark headline (chosen for light templates): soft white outline
  const titleOutline = isDarkColor(titleColor) ? '&H40FFFFFF' : '&H60000000';
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,${font},${px(t.titleSize)},${assColor(titleColor)},&H00FFFFFF,${titleOutline},&H80000000,1,0,0,0,100,100,0,0,1,${px(4)},${px(3)},8,${px(70)},${px(70)},${px(t.titleTop)},-1`,
    `Style: Caption,${font},${px(t.captionSize)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H70000000,1,0,0,0,100,100,0,0,3,${px(16)},0,2,${px(80)},${px(80)},${px(t.captionsBottom)},-1`,
    `Style: From,${font},${px(t.fromSize)},${assColor(fromColor)},&H00FFFFFF,${isDarkColor(fromColor) ? '&H40FFFFFF' : '&H60000000'},&H80000000,1,0,0,0,100,100,0,0,1,${px(3)},${px(2)},2,${px(60)},${px(60)},${px(t.fromBottom)},-1`,
    `Style: Mark,${ARABIC_FONT},${px(30)},&H99FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,${px(40)},${px(40)},${px(60)},-1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (only !== 'captions') {
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Mark,,0,0,0,,${assText(watermarkFor(domain))}`);
    if (title) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Title,,0,0,0,,${assText(title)}`);
    if (from) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},From,,0,0,0,,${assText(from)}`);
  }
  if (only !== 'static') {
    for (const c of captions) lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);
  }
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

// ---------- Render queue ----------
// One render uses nearly all of a 6-core server, so renders run RENDER_SLOTS at a time (1 by default; ~1 per 4 cores
// on a bigger machine). Up to RENDER_QUEUE jobs (running + waiting) are accepted; customers see their place in line.

export const RENDER_SLOTS = Math.max(1, Math.floor(Number(process.env.RENDER_SLOTS)) || 1);
const MAX_WAITING = Math.max(RENDER_SLOTS, Math.floor(Number(process.env.RENDER_QUEUE)) || 15);
let running = 0;
let waiting = 0;   // running + waiting to start
const nextUp: (() => void)[] = [];

/** True when a new render would be refused; checked before charging so a full line costs the customer nothing. */
export const renderQueueFull = () => waiting >= MAX_WAITING;
/** True when a new render would have to wait (every slot taken): reels then go to AWS Lambda when it is on. */
export const localRenderBusy = () => running >= RENDER_SLOTS;

export class RenderBusyError extends Error {}

export function runFfmpeg(
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
  image: Buffer | null;                  // required for normal videos; optional photo for greetings
  format: VideoFormat;
  greeting?: { themeId: string; from?: string; template?: Buffer | null; photoBox?: PhotoBox; textStyle?: TextStyle }; // occasion greeting design (always vertical)
  title?: string;
  captions?: boolean;
  hd?: boolean;                          // 1080p/30fps instead of the faster 720p/24fps
  domain?: string;                       // shown in the watermark (the site the customer is using)
  onProgress?: (fraction: number) => void;
  onStart?: () => void;                  // called when the job leaves the queue
}

export async function renderVoiceVideo(opts: RenderOptions): Promise<Buffer> {
  return enqueueRender(() => renderNow(opts), opts.onStart);
}

/** Runs a render through the shared queue: first come, first served, RENDER_SLOTS at a time. */
export function enqueueRender<T>(task: () => Promise<T>, onStart?: () => void): Promise<T> {
  if (renderQueueFull()) return Promise.reject(new RenderBusyError('Render queue is full'));
  waiting++;
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      Promise.resolve()
        .then(() => { onStart?.(); return task(); })
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting--;
          nextUp.shift()?.();
        });
    };
    if (running < RENDER_SLOTS) start();
    else nextUp.push(start);
  });
}

async function renderNow({ wav, text, image, format, greeting, title = '', captions = true, hd = false, domain = 'tts.smartcloud.ps', onProgress }: RenderOptions): Promise<Buffer> {
  const profile = hd ? RENDER_PROFILES.hd : RENDER_PROFILES.fast;
  const theme = greeting ? GREETING_THEMES[greeting.themeId] : undefined;
  const placement = greeting ? greetingLayout(greeting, Boolean(image)) : undefined;
  const showWave = !placement || placement.waveHeight > 0;
  // Sender line on customer templates: same contrast rule as the wave (deep theme colour on light designs)
  const fromColor = !theme ? '#ffffff'
    : greeting?.template ? await waveColorFor(greeting.template, Math.max(0, 1920 - placement!.fromBottom - 70), 60, theme)
    : theme.accent;
  const layout = theme
    ? scaleLayout({ ...LAYOUTS.vertical, waveTop: placement!.waveTop, waveHeight: placement!.waveHeight || 2 }, profile.scale)
    : scaleLayout(LAYOUTS[format], profile.scale);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sawtik-video-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    const { duration } = speechIntervals(wav);
    const timed = captions ? timeCaptions(text, wav) : [];
    await Promise.all([
      fs.writeFile(path.join(dir, 'audio.wav'), wav),
      fs.writeFile(path.join(dir, 'bg.png'), theme
        ? await buildGreetingBackground(layout.width, layout.height, theme, greeting!.themeId, image, greeting!.template ?? null, greeting!.photoBox)
        : await buildBackground(layout, image!)),
      fs.writeFile(path.join(dir, 'subs.ass'), theme
        ? buildGreetingAss(layout.width / GREETING_DESIGN.width, layout.width, layout.height, theme, timed, duration, title.slice(0, 60), (greeting!.from || '').slice(0, 40), domain, placement!, greeting!.textStyle ?? DEFAULT_TEXT_STYLE, fromColor)
        : buildAss(layout, timed, duration, title.slice(0, 60), domain)),
    ]);

    const waveWidth = Math.round(layout.width * 0.8);
    // On customer templates the wave colour adapts to the background so it never disappears
    const waveColor = !theme ? '#F59E0B'
      : greeting?.template && showWave ? await waveColorFor(greeting.template, placement!.waveTop, placement!.waveHeight, theme)
      : theme.accent;
    const filter = [
      // Waveform in brand amber (showwaves output is already transparent). The volume boost only affects
      // the drawing — the audio track is mapped straight from the input.
      // Everything is composited in yuv420p (the output format) so frames aren't converted back and forth.
      // The backdrop is decoded once and repeated in memory (image2 "-loop 1" would re-decode the PNG every frame)
      `[0:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps=${profile.fps}[bg]`,
      ...(showWave ? [
        // On customer templates the wave is softer (less boost, see-through) so it never turns into a solid block
        `[1:a]volume=${greeting?.template ? 1.6 : 4},showwaves=s=${waveWidth}x${layout.waveHeight}:mode=cline:rate=${profile.fps}:colors=${greeting?.template ? `${waveColor}@0.6` : waveColor}:scale=sqrt:draw=full,format=yuva420p[waves]`,
        `[bg][waves]overlay=x=(W-w)/2:y=${layout.waveTop}:format=yuv420:shortest=1[v1]`,
        `[v1]subtitles=subs.ass[vout]`,
      ] : [
        // No room for a wave under a large photo: the video simply ends with the audio (-shortest)
        `[bg]subtitles=subs.ass[vout]`,
      ]),
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

// ---------- Greeting video put together by the customer's browser ----------

export interface GreetingPlan {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Background, artwork, headline, sender line and watermark: the video before any wave or caption (PNG, base64). */
  frame: string;
  /** Where and how the sound wave is drawn (null: this design has no wave). */
  wave: { x: number; y: number; w: number; h: number; color: string; alpha: number; boost: number } | null;
  /** Each caption as a full-frame transparent PNG (base64), shown from `start` to `end` seconds. */
  captions: { start: number; end: number; png: string }[];
  /** The voice as AAC in an MP4 file (base64): the browser copies it into the video without encoding it again. */
  audio: string;
}

/**
 * A caption as a transparent PNG from two renders of it, one over black and one over white (libass only paints colour,
 * never opacity): the opacity is how much of the white shows through, and the colour is the black render undone of it.
 */
async function transparentCaption(onBlack: Buffer, onWhite: Buffer): Promise<Buffer> {
  const [b, w] = await Promise.all([onBlack, onWhite].map(png => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width, height } = b.info;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < width * height * 3; i += 3, o += 4) {
    const a = Math.min(1, Math.max(0, 1 - (w.data[i] - b.data[i] + w.data[i + 1] - b.data[i + 1] + w.data[i + 2] - b.data[i + 2]) / (3 * 255)));
    if (a < 0.004) continue;
    out[o] = Math.min(255, Math.round(b.data[i] / a));
    out[o + 1] = Math.min(255, Math.round(b.data[i + 1] / a));
    out[o + 2] = Math.min(255, Math.round(b.data[i + 2] / a));
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Everything a browser needs to build a greeting video itself (see src/utils/clientRender.ts): the fixed picture, the
 * captions and the sound wave placement. The artwork, fonts and caption boxes come from the same code and the same
 * libass as the server render, so the two look alike; only the wave is left for the browser to draw. Mirrors the
 * set-up of renderNow.
 */
export async function planGreetingVideo({ wav, text, image, greeting, title = '', captions = true, domain = 'tts.smartcloud.ps' }: RenderOptions): Promise<GreetingPlan> {
  if (!greeting) throw new Error('Only greeting videos can be planned');
  const profile = RENDER_PROFILES.fast;
  const theme = GREETING_THEMES[greeting.themeId];
  const placement = greetingLayout(greeting, Boolean(image));
  const showWave = placement.waveHeight > 0;
  const fromColor = greeting.template
    ? await waveColorFor(greeting.template, Math.max(0, 1920 - placement.fromBottom - 70), 60, theme)
    : theme.accent;
  const layout = scaleLayout({ ...LAYOUTS.vertical, waveTop: placement.waveTop, waveHeight: placement.waveHeight || 2 }, profile.scale);
  const waveColor = greeting.template && showWave ? await waveColorFor(greeting.template, placement.waveTop, placement.waveHeight, theme) : theme.accent;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sawtik-plan-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    const { duration } = speechIntervals(wav);
    const timed = captions ? timeCaptions(text, wav) : [];
    const ass = (only: 'static' | 'captions') => buildGreetingAss(
      layout.width / GREETING_DESIGN.width, layout.width, layout.height, theme, timed, duration, title.slice(0, 60),
      (greeting.from || '').slice(0, 40), domain, placement, greeting.textStyle ?? DEFAULT_TEXT_STYLE, fromColor, only);
    await Promise.all([
      fs.writeFile(path.join(dir, 'audio.wav'), wav),
      fs.writeFile(path.join(dir, 'bg.png'), await buildGreetingBackground(layout.width, layout.height, theme, greeting.themeId, image, greeting.template ?? null, greeting.photoBox)),
      fs.writeFile(path.join(dir, 'static.ass'), ass('static')),
      fs.writeFile(path.join(dir, 'caps.ass'), ass('captions')),
    ]);

    // One still frame of each caption, over black and over white, run through libass at the middle of that caption
    const frames: number[] = [];
    for (const c of timed) {
      const n = Math.round(((c.start + c.end) / 2) * profile.fps);
      frames.push(frames.length && n <= frames[frames.length - 1] ? frames[frames.length - 1] + 1 : n);
    }
    const lastFrame = (frames[frames.length - 1] ?? 0) + 1;
    const opts = (extra: object) => ({ timeoutMs: renderTimeoutMs(duration), duration: 1, ...extra });
    const captionFrames = (color: 'black' | 'white', prefix: string) => fs.writeFile(path.join(dir, `caps-${color}.txt`), `subtitles=caps.ass,select='${frames.map(n => `eq(n\\,${n})`).join('+')}'`).then(() =>
      runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${layout.width}x${layout.height}:r=${profile.fps}:d=${((lastFrame + 1) / profile.fps).toFixed(3)}`,
        '-filter_script:v', `caps-${color}.txt`, '-fps_mode', 'passthrough', '-frames:v', String(frames.length), `${prefix}%04d.png`], dir, opts({})));
    await Promise.all([
      runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', 'bg.png', '-vf', 'subtitles=static.ass', '-frames:v', '1', 'frame.png'], dir, opts({})),
      runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', 'audio.wav', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', 'audio.m4a'], dir, opts({})),
      ...(frames.length ? [captionFrames('black', 'capB'), captionFrames('white', 'capW')] : []),
    ]);

    const b64 = async (file: string) => (await fs.readFile(path.join(dir, file))).toString('base64');
    return {
      width: layout.width, height: layout.height, fps: profile.fps, duration,
      frame: await b64('frame.png'),
      wave: showWave ? {
        x: Math.round((layout.width - Math.round(layout.width * 0.8)) / 2), y: layout.waveTop, w: Math.round(layout.width * 0.8), h: layout.waveHeight,
        color: waveColor, alpha: greeting.template ? 0.6 : 1, boost: greeting.template ? 1.6 : 4,
      } : null,
      captions: await Promise.all(timed.map(async (c, i) => {
        const n = String(i + 1).padStart(4, '0');
        const png = await transparentCaption(await fs.readFile(path.join(dir, `capB${n}.png`)), await fs.readFile(path.join(dir, `capW${n}.png`)));
        return { start: c.start, end: c.end, png: png.toString('base64') };
      })),
      audio: await b64('audio.m4a'),
    };
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

/** A customer's 9:16 greeting template, decoded and fitted to the 1080×1920 design (cropping any excess). */
export async function normalizeTemplate(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('Unsupported image');
  return sharp(input).rotate().resize(1080, 1920, { fit: 'cover', position: 'centre' }).png().toBuffer();
}
