// "Brand your own footage": a journalist's real video keeps its picture and sound, and gets the outlet's
// on-air graphics on top — logo, show name, a speaker lower-third and a headline ticker (optionally "breaking"),
// each shown only during the time range the journalist picked.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import sharp, { OverlayOptions as SharpOverlay } from 'sharp';
import { assTime, assText, runFfmpeg, enqueueRender, renderTimeoutMs, watermarkFor, speechIntervals, captionChunks } from './video.ts';

export const OVERLAY_MAX_SECONDS = 180;
// Cloudflare (in front of both domains) rejects request bodies over 100 MB
export const OVERLAY_MAX_BYTES = 95 * 1024 * 1024;
const UPLOAD_DIR = path.join(os.tmpdir(), 'sawtik-overlay');
const UPLOAD_TTL_MS = 60 * 60 * 1000;

// ---------- Temporary uploads (deleted after an hour, or when rendered) ----------

export async function newUploadPath() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex');
  return { id, file: path.join(UPLOAD_DIR, `${id}.src`) };
}

export const uploadPath = (id: string) => (/^[a-f0-9]{24}$/.test(id) ? path.join(UPLOAD_DIR, `${id}.src`) : null);

setInterval(async () => {
  const files = await fs.readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const f of files) {
    const stat = await fs.stat(path.join(UPLOAD_DIR, f)).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > UPLOAD_TTL_MS) await fs.rm(path.join(UPLOAD_DIR, f), { force: true }).catch(() => {});
  }
}, 15 * 60_000).unref();

/** Size, length and whether the file has sound, via ffprobe. Null when it is not a readable video. */
export function probeVideo(file: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean } | null> {
  return new Promise(resolve => {
    const proc = spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const video = (data.streams || []).find((s: any) => s.codec_type === 'video');
        const duration = Number(data.format?.duration);
        if (!video?.width || !video?.height || !Number.isFinite(duration)) return resolve(null);
        resolve({ width: video.width, height: video.height, duration, hasAudio: (data.streams || []).some((s: any) => s.codec_type === 'audio') });
      } catch {
        resolve(null);
      }
    });
  });
}

// ---------- Overlay options ----------

export interface TimeRange { from: number; to: number }
export type OverlayCanvas = 'original' | 'vertical' | 'square' | 'landscape';
export type OverlayLayout = 'full' | 'box';
export type OverlayFit = 'crop' | 'blur';

/** Fonts the journalist can pick; installed in the container (see Dockerfile). */
const FONTS = { sans: 'Noto Sans Arabic', kufi: 'Noto Kufi Arabic', naskh: 'Noto Naskh Arabic' } as const;
export type OverlayFont = keyof typeof FONTS;
export const isOverlayFont = (v: unknown): v is OverlayFont => typeof v === 'string' && v in FONTS;

export interface OverlayIntro {
  wav: Buffer;          // the anchor's generated voice
  text: string;         // what the anchor says (shown as captions)
  anchorName: string;
  anchorImage: Buffer;
}

export interface OverlayOptions {
  uploadId: string;
  color: string;
  logo: Buffer | null;
  showName: string;
  outletName: string;
  domain: string;
  canvas: OverlayCanvas;
  layout: OverlayLayout;  // footage full screen, or in a box on a branded background
  fit: OverlayFit;        // full screen: crop to fill, or fit over a blurred copy
  boxTitle: string;       // box layout: report title under the footage
  font: OverlayFont;
  textScale: number;      // 0.7 – 1.5
  logoOn: boolean;
  showNameOn: boolean;
  ticker: { on: boolean; breaking: boolean; headlines: string[]; range: TimeRange };
  lowerThird: { on: boolean; name: string; title: string; range: TimeRange };
  intro: OverlayIntro | null; // anchor hand-over played before the footage
  onProgress?: (fraction: number) => void;
  onStart?: () => void;
}

const assColor = (hex: string, alpha = '00') => {
  const h = hex.replace('#', '');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const shade = (hex: string, factor: number) => {
  const h = hex.replace('#', '');
  return '#' + [0, 2, 4].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * factor).toString(16).padStart(2, '0')).join('');
};
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size: fixed 720p frames for the social formats, or the footage's own shape (max 1280 px). */
function canvasSize(canvas: OverlayCanvas, w: number, h: number) {
  if (canvas === 'vertical') return { W: 720, H: 1280 };
  if (canvas === 'square') return { W: 720, H: 720 };
  if (canvas === 'landscape') return { W: 1280, H: 720 };
  const scale = Math.min(1, 1280 / Math.max(w, h));
  return { W: even(w * scale), H: even(h * scale) };
}

/** Box layout: where the footage sits (fitted inside the box area, keeping its shape). */
function boxPlacement(W: number, H: number, vw: number, vh: number) {
  const area = H > W * 1.2 ? { x: W * 0.06, y: H * 0.17, w: W * 0.88, h: H * 0.5 }
    : Math.abs(W - H) < 10 ? { x: W * 0.08, y: H * 0.16, w: W * 0.84, h: H * 0.56 }
    : { x: W * 0.1, y: H * 0.15, w: W * 0.8, h: H * 0.6 };
  const ar = vw / vh;
  let fw = area.w;
  let fh = fw / ar;
  if (fh > area.h) { fh = area.h; fw = fh * ar; }
  fw = even(fw);
  fh = even(fh);
  return { x: Math.round(area.x + (area.w - fw) / 2), y: Math.round(area.y), w: fw, h: fh };
}

/** Branded backdrop (outlet colour gradient), optionally with a framed slot for the footage or the anchor's portrait. */
async function brandedBackground(W: number, H: number, color: string, extra: { frame?: { x: number; y: number; w: number; h: number }; portrait?: { image: Buffer; cx: number; cy: number; size: number } }) {
  const dark = shade(color, 0.45);
  const f = extra.frame;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${W * 0.88}" cy="${H * 0.12}" r="${Math.max(W, H) * 0.35}" fill="#fff" opacity="0.05"/>
    <circle cx="${W * 0.1}" cy="${H * 0.9}" r="${Math.max(W, H) * 0.28}" fill="#fff" opacity="0.04"/>
    ${f ? `<rect x="${f.x - 6}" y="${f.y - 6}" width="${f.w + 12}" height="${f.h + 12}" rx="10" fill="#fff" opacity="0.9"/>` : ''}
    ${extra.portrait ? `<circle cx="${extra.portrait.cx}" cy="${extra.portrait.cy}" r="${extra.portrait.size / 2 + 8}" fill="none" stroke="#fde047" stroke-width="8"/>` : ''}
  </svg>`;
  const layers: SharpOverlay[] = [];
  if (extra.portrait) {
    const { image, cx, cy, size } = extra.portrait;
    const r = size / 2;
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
    const photo = await sharp(image).resize(size, size, { fit: 'cover', position: 'centre' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: photo, left: Math.round(cx - r), top: Math.round(cy - r) });
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}

interface AssExtras {
  duration: number;
  captions?: { start: number; end: number; text: string }[];
  boxTitle?: { text: string; y: number };
  wholeSegment?: boolean; // intro: ticker for the whole segment, ignoring the footage ranges
  anchor?: { name: string; y: number }; // intro: the anchor's name under the portrait
  captionsBottom?: number;              // overrides where captions sit (distance from the bottom)
}

function buildAss(o: OverlayOptions, W: number, H: number, x: AssExtras) {
  const { duration } = x;
  const font = FONTS[o.font];
  const s = Math.min(1.5, Math.max(0.7, o.textScale));
  const unit = Math.min(W, H); // sizes follow the short side so portrait and landscape both read well
  const px = (n: number) => Math.round(unit * n * s);
  const tickerH = Math.round(unit * 0.085 * Math.max(1, s));
  const tickerFont = Math.round(tickerH * 0.48);
  const accent = o.ticker.breaking ? '#dc2626' : '#fde047';
  const clampRange = (r: TimeRange) => x.wholeSegment ? { from: 0, to: duration } : ({ from: Math.max(0, Math.min(duration, r.from)), to: Math.max(0, Math.min(duration, r.to)) });

  const nameFont = px(0.05);
  const titleFont = px(0.034);
  const namePad = Math.round(nameFont * 0.32);
  const titlePad = Math.round(titleFont * 0.38);
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Show,${font},${px(0.04)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H90000000,1,0,0,0,100,100,0,0,1,2,1,9,${Math.round(unit * 0.04)},${Math.round(unit * 0.04)},${Math.round(unit * 0.035)},-1`,
    `Style: Ticker,${font},${tickerFont},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,6,0,0,0,-1`,
    `Style: Label,${font},${Math.round(tickerH * 0.44)},${o.ticker.breaking ? '&H00FFFFFF' : '&H00000000'},&H00FFFFFF,${assColor(accent)},${assColor(accent)},1,0,0,0,100,100,0,0,3,${Math.round(tickerH * 0.18)},0,6,0,0,0,-1`,
    `Style: LowerName,${font},${nameFont},&H00FFFFFF,&H00FFFFFF,${assColor(o.color)},${assColor(o.color)},1,0,0,0,100,100,0,0,3,${namePad},0,3,0,0,0,-1`,
    `Style: LowerTitle,${font},${titleFont},&H00000000,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,3,${titlePad},0,3,0,0,0,-1`,
    `Style: Caption,${font},${px(0.048)},&H00FFFFFF,&H00FFFFFF,&H78000000,&H78000000,1,0,0,0,100,100,0,0,3,${Math.round(unit * 0.014)},0,2,${Math.round(unit * 0.06)},${Math.round(unit * 0.06)},${x.captionsBottom ?? Math.round((o.ticker.on ? tickerH : 0) + unit * 0.2)},-1`,
    `Style: Anchor,${font},${px(0.055)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H90000000,1,0,0,0,100,100,0,0,1,2,1,8,0,0,0,-1`,
    `Style: BoxTitle,${font},${px(0.05)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H90000000,1,0,0,0,100,100,0,0,1,2,1,8,${Math.round(unit * 0.06)},${Math.round(unit * 0.06)},0,-1`,
    `Style: Mark,${font},${Math.round(unit * 0.022)},&H99FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,${Math.round(unit * 0.03)},0,${Math.round(unit * 0.03)},-1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Mark,,0,0,0,,{\\pos(${Math.round(unit * 0.03)},${Math.round(unit * (o.logoOn && o.logo ? 0.15 : 0.03))})}${assText(watermarkFor(o.domain))}`);

  const show = [o.showName, o.outletName].filter(Boolean).join(' · ');
  if (o.showNameOn && show) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Show,,0,0,0,,${assText(show)}`);
  if (x.anchor?.name) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Anchor,,0,0,0,,{\\pos(${Math.round(W / 2)},${x.anchor.y})}${assText(x.anchor.name)}`);
  if (x.boxTitle?.text) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},BoxTitle,,0,0,0,,{\\pos(${Math.round(W / 2)},${x.boxTitle.y})}${assText(x.boxTitle.text)}`);
  for (const c of x.captions ?? []) lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);

  // Lower-third: name on the outlet colour stacked right on top of the role (white), sliding in from the right
  if (o.lowerThird.on && o.lowerThird.name) {
    const r = clampRange(o.lowerThird.range);
    if (r.to > r.from) {
      const right = Math.round(W - unit * 0.05);
      const bottom = Math.round(H - (o.ticker.on ? tickerH : 0) - unit * 0.05);
      const titleBox = o.lowerThird.title ? Math.round(titleFont * 1.25 + titlePad * 2) : 0;
      const slide = (y: number) => `{\\an3\\move(${right + Math.round(unit * 0.35)},${y},${right},${y},0,350)\\fad(200,250)}`;
      if (o.lowerThird.title) lines.push(`Dialogue: 4,${assTime(r.from)},${assTime(r.to)},LowerTitle,,0,0,0,,${slide(bottom)}${assText(o.lowerThird.title)}`);
      lines.push(`Dialogue: 4,${assTime(r.from)},${assTime(r.to)},LowerName,,0,0,0,,${slide(bottom - titleBox)}${assText(o.lowerThird.name)}`);
    }
  }

  // Ticker: fixed label on the right, headlines scrolling left-to-right on one line (\q2), right-anchored (\an6)
  const headlines = o.ticker.headlines.filter(Boolean);
  let tickerRange: TimeRange | null = null;
  if (o.ticker.on && headlines.length) {
    const r = clampRange(o.ticker.range);
    if (r.to > r.from) {
      tickerRange = r;
      const y = Math.round(H - tickerH / 2);
      lines.push(`Dialogue: 3,${assTime(r.from)},${assTime(r.to)},Label,,0,0,0,,{\\pos(${W - Math.round(unit * 0.02)},${y})}${assText(o.ticker.breaking ? 'عاجل' : 'أبرز الأخبار')}`);
      const text = headlines.join('   ◆   ');
      const textW = Math.round(text.length * tickerFont * 0.5);
      const speed = Math.round(unit * 0.16);
      const cycle = (W + textW) / speed;
      for (let t = r.from; t < r.to; t += cycle) {
        const end = Math.min(r.to, t + cycle);
        const x2 = Math.round((W + textW) * ((end - t) / cycle));
        lines.push(`Dialogue: 2,${assTime(t)},${assTime(end)},Ticker,,0,0,0,,{\\an6\\q2\\move(0,${y},${x2},${y})}${assText(text)}`);
      }
    }
  }
  return { ass: lines.join('\n') + '\n', tickerH, tickerRange };
}

/** Same encoding for every segment, so the anchor intro and the footage can be joined without re-encoding. */
const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2'];

/** Caption phrases spread over the detected speech of the anchor's voice. */
function timeCaptions(text: string, wav: Buffer) {
  const chunks = captionChunks(text);
  const { intervals, duration } = speechIntervals(wav);
  const speech = intervals.length ? intervals : [[0, duration] as [number, number]];
  const total = speech.reduce((sum, [a, b]) => sum + (b - a), 0);
  const weights = chunks.map(c => c.replace(/\s/g, '').length || 1);
  const wTotal = weights.reduce((a, b) => a + b, 0);
  const at = (t: number) => {
    let left = t;
    for (const [a, b] of speech) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return speech[speech.length - 1][1];
  };
  let used = 0;
  return chunks.map((c, i) => {
    const start = at((used / wTotal) * total);
    used += weights[i];
    return { start, end: Math.max(at((used / wTotal) * total), start + 0.5), text: c };
  });
}

export function renderOverlayVideo(o: OverlayOptions): Promise<Buffer> {
  return enqueueRender(() => renderNow(o), o.onStart);
}

async function renderNow(o: OverlayOptions): Promise<Buffer> {
  const src = uploadPath(o.uploadId);
  if (!src) throw new Error('Bad upload id');
  const info = await probeVideo(src);
  if (!info) throw new Error('Unreadable video');
  const duration = Math.min(info.duration, OVERLAY_MAX_SECONDS);
  const { W, H } = canvasSize(o.canvas, info.width, info.height);
  const unit = Math.min(W, H);
  const introSeconds = o.intro ? speechIntervals(o.intro.wav).duration + 0.4 : 0;
  const total = duration + introSeconds;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sawtik-ovl-'));
  try {
    const useLogo = o.logoOn && o.logo;
    if (useLogo) {
      await fs.writeFile(path.join(dir, 'logo.png'), await sharp(o.logo!).resize({ height: Math.round(unit * 0.1), width: Math.round(W * 0.3), fit: 'inside' }).png().toBuffer());
    }
    const margin = Math.round(unit * 0.03);
    const parts: string[] = [];

    // ---- 1. Anchor intro (optional): studio card with the anchor's portrait, voice, captions ----
    if (o.intro) {
      const size = Math.round(unit * 0.36);
      const cy = Math.round(H * (H > W * 1.2 ? 0.36 : 0.4));
      await fs.writeFile(path.join(dir, 'intro-bg.png'), await brandedBackground(W, H, o.color, { portrait: { image: o.intro.anchorImage, cx: W / 2, cy, size } }));
      await fs.writeFile(path.join(dir, 'intro.wav'), o.intro.wav);
      // Studio card: portrait, the anchor's name under it, the waveform, then captions just above the ticker
      const introOpts: OverlayOptions = { ...o, lowerThird: { ...o.lowerThird, on: false } };
      const nameY = Math.round(cy + size / 2 + unit * 0.035);
      const waveY = Math.round(nameY + unit * 0.085 * Math.min(1.5, Math.max(0.7, o.textScale)));
      const tickerSpace = o.ticker.on && o.ticker.headlines.some(Boolean) ? Math.round(unit * 0.085 * Math.max(1, o.textScale)) : 0;
      const { ass, tickerH, tickerRange } = buildAss(introOpts, W, H, {
        duration: introSeconds, captions: timeCaptions(o.intro.text, o.intro.wav), wholeSegment: true,
        anchor: { name: o.intro.anchorName, y: nameY }, captionsBottom: tickerSpace + Math.round(unit * 0.05),
      });
      await fs.writeFile(path.join(dir, 'intro.ass'), ass);
      const waveW = even(W * 0.6);
      const waveH = even(unit * 0.07);
      const filter = [
        `[0:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps=30[bg]`,
        tickerRange ? `[bg]drawbox=x=0:y=ih-${tickerH}:w=iw:h=${tickerH}:color=black@0.65:t=fill[b0]` : `[bg]null[b0]`,
        useLogo ? `[b0][2:v]overlay=x=${margin}:y=${margin}[b1]` : `[b0]null[b1]`,
        `[1:a]volume=3,showwaves=s=${waveW}x${waveH}:mode=cline:rate=30:colors=#ffffff@0.7:scale=sqrt:draw=full,format=yuva420p[w]`,
        `[b1][w]overlay=x=(W-w)/2:y=${waveY}:shortest=1[v1]`,
        `[v1]subtitles=intro.ass[vout]`,
      ].join(';');
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '4',
        '-i', 'intro-bg.png', '-i', 'intro.wav', ...(useLogo ? ['-i', 'logo.png'] : []),
        '-filter_complex', filter, '-map', '[vout]', '-map', '1:a', ...ENCODE, '-shortest', 'intro.mp4',
      ], dir, { timeoutMs: renderTimeoutMs(introSeconds), duration: introSeconds, onProgress: f => o.onProgress?.((f * introSeconds) / total) });
      parts.push('intro.mp4');
    }

    // ---- 2. The footage with the on-air graphics ----
    const box = o.layout === 'box' ? boxPlacement(W, H, info.width, info.height) : null;
    if (box) await fs.writeFile(path.join(dir, 'bg.png'), await brandedBackground(W, H, o.color, { frame: box }));
    const { ass, tickerH, tickerRange } = buildAss(o, W, H, {
      duration,
      boxTitle: box && o.boxTitle ? { text: o.boxTitle, y: Math.round(box.y + box.h + unit * 0.05) } : undefined,
    });
    await fs.writeFile(path.join(dir, 'subs.ass'), ass);

    const inputs = ['-t', String(duration), '-i', src];
    let next = 1;
    const bgIndex = box ? next++ : -1;
    if (box) inputs.push('-i', 'bg.png');
    const logoIndex = useLogo ? next++ : -1;
    if (useLogo) inputs.push('-i', 'logo.png');
    const silenceIndex = info.hasAudio ? -1 : next++;
    if (!info.hasAudio) inputs.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo');

    const base = box
      ? [`[${bgIndex}:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps=30[bgl]`,
         `[0:v]scale=${box.w}:${box.h},setsar=1,fps=30[fv]`,
         `[bgl][fv]overlay=x=${box.x}:y=${box.y}:shortest=1,format=yuv420p[base]`]
      : o.fit === 'blur' && o.canvas !== 'original'
        ? [`[0:v]split[a][b]`,
           `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius=24:luma_power=2,eq=brightness=-0.08[bgv]`,
           `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
           `[bgv][fg]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1,fps=30,format=yuv420p[base]`]
        : [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[base]`];
    const filter = [
      ...base,
      tickerRange
        ? `[base]drawbox=x=0:y=ih-${tickerH}:w=iw:h=${tickerH}:color=black@0.65:t=fill:enable='between(t,${tickerRange.from.toFixed(2)},${tickerRange.to.toFixed(2)})'[b1]`
        : `[base]null[b1]`,
      useLogo ? `[b1][${logoIndex}:v]overlay=x=${margin}:y=${margin}[b2]` : `[b1]null[b2]`,
      `[b2]subtitles=subs.ass[vout]`,
    ].join(';');

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '4',
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vout]', '-map', info.hasAudio ? '0:a:0' : `${silenceIndex}:a`,
      ...ENCODE, '-t', String(duration), '-movflags', '+faststart', 'main.mp4',
    ], dir, {
      timeoutMs: renderTimeoutMs(duration) * 2, duration,
      onProgress: f => o.onProgress?.((introSeconds + f * duration) / total),
    });
    parts.push('main.mp4');

    // ---- 3. Join (same encoding, so no quality loss) ----
    if (parts.length === 1) return await fs.readFile(path.join(dir, 'main.mp4'));
    await fs.writeFile(path.join(dir, 'list.txt'), parts.map(p => `file '${p}'`).join('\n'));
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'],
      dir, { timeoutMs: 120_000, duration: total });
    return await fs.readFile(path.join(dir, 'out.mp4'));
  } finally {
    // The upload stays (up to an hour) so the journalist can adjust and render again
    await fs.rm(dir, { recursive: true, force: true });
  }
}
