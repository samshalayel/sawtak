// The calm / Quran / medical reel renderer itself: scenes, voice, captions, sticker and closing card into one MP4.
// Pure work on files (no database, no web routes), so the same code runs on this server and in the AWS Lambda
// function (lambda/reel): render options in, MP4 out. server/calm.ts queues it and holds the routes.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { CALM_FONTS } from '../src/data/calmFonts.ts';
import { textPng } from './calm-text.ts';
import { STICKER_ICONS, STICKER_THEMES, STICKER_LOOKS, CalmSticker, stickerLayout, DAY_ART, DECOR_GRADIENT } from '../src/data/calmStickers.ts';
import { assTime, assText, runFfmpeg, renderTimeoutMs, watermarkFor, speechIntervals, captionChunks } from './video.ts';
export const CLIP_TTL_MS = 60 * 60 * 1000;
export const CLIP_DIR = path.join(os.tmpdir(), 'sawtik-calm-clips');
const FONTS_DIR = path.resolve('fonts'); // calligraphy faces for the day sticker
const W = 720;
const H = 1280;
const FADE = 1.2; // seconds of cross-fade between scenes

/**
 * What a reel costs to make and to send: «standard» is 720x1280 at 25 fps (slow calm footage looks the same as at 30,
 * and each reel renders faster); «light» is scaled to 540x960 at the very end (after the captions are drawn at 720,
 * so the layout is the same), 20 fps and a higher CRF: a file about half the size that reaches a phone sooner.
 */
export type ReelQuality = 'standard' | 'light';
const PROFILES: Record<ReelQuality, { width: number; height: number; fps: number; crf: number; maxrate: string; bufsize: string }> = {
  standard: { width: W, height: H, fps: 25, crf: 28, maxrate: '2M', bufsize: '4M' },
  light: { width: 540, height: 960, fps: 20, crf: 31, maxrate: '1M', bufsize: '2M' },
};
export const clampQuality = (raw: unknown): ReelQuality => (raw === 'light' ? 'light' : 'standard');

export interface Clip { id: number; duration: number; tags: string; thumb: string; preview: string; url: string; width: number; height: number }

/** Downloads a clip once per hour into the temp folder. */
async function localClip(clip: Clip): Promise<string> {
  await fs.mkdir(CLIP_DIR, { recursive: true });
  const file = path.join(CLIP_DIR, `${clip.id}.mp4`);
  const stat = await fs.stat(file).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs < CLIP_TTL_MS && stat.size > 10_000) return file;
  const res = await fetch(clip.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Clip download ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// ---------- Render ----------

export interface CalmRenderOptions {
  clips: Clip[];
  voice: Buffer;          // the calm voice (WAV)
  text: string;           // captions
  /** Quran reels: one entry per verse with its exact span in `voice` (seconds); replaces the timing guessed from text. */
  verses?: { text: string; start: number; end: number }[];
  title: string;          // optional line at the top
  /** Optional smaller line near the title, above it by default (Quran reels: the reciter's name). */
  info?: string;
  /** Optional text shown for the whole reel, e.g. a dedication ("عن روح ..."). */
  dedication?: string;
  /** Medical reels: the doctor's identity (logo, name, specialty, contact) along the bottom for the whole reel. */
  brand?: { logo: Buffer | null; lines: string[]; color: string };
  supportCard: string;    // optional closing card text (empty = none)
  domain: string;
  style?: CalmStyle;
  sticker?: CalmSticker | null;
  /** Size and weight of the MP4 (default standard). */
  quality?: ReelQuality;
  onProgress?: (f: number) => void;
  onStart?: () => void;
}

/**
 * Customer text look, in 720x1280 design pixels: font, colour, caption size and the captions' vertical centre; the
 * title's top, and the vertical centres of the line under it and of the dedication (all dragged on the preview).
 */
export interface CalmStyle { font: string; color: string; size: number; y: number; titleSize: number; titleY: number; infoY: number; dedicationY: number }
export const DEFAULT_CALM_STYLE: CalmStyle = { font: 'naskh', color: '#ffffff', size: 88, y: 840, titleSize: 58, titleY: 140, infoY: 60, dedicationY: 1070 };

export function clampCalmStyle(raw: any): CalmStyle {
  if (!raw || typeof raw !== 'object') return DEFAULT_CALM_STYLE;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
  };
  return {
    font: CALM_FONTS.some(f => f.id === raw.font) ? String(raw.font) : DEFAULT_CALM_STYLE.font,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_CALM_STYLE.color,
    size: num(raw.size, 48, 130, DEFAULT_CALM_STYLE.size),
    y: num(raw.y, 220, 1120, DEFAULT_CALM_STYLE.y),
    titleSize: num(raw.titleSize, 36, 100, DEFAULT_CALM_STYLE.titleSize),
    titleY: num(raw.titleY, 40, 1160, DEFAULT_CALM_STYLE.titleY),
    infoY: num(raw.infoY, 40, 1200, DEFAULT_CALM_STYLE.infoY),
    dedicationY: num(raw.dedicationY, 60, 1200, DEFAULT_CALM_STYLE.dedicationY),
  };
}

/** Validates the "today" sticker sent by the page (the date lines are formatted in the visitor's browser). */
export function clampSticker(raw: any): CalmSticker | null {
  if (!raw || typeof raw !== 'object') return null;
  const clean = (v: unknown, max: number) => String(v ?? '').replace(/[{}\\\r\n]/g, '').trim().slice(0, max);
  const label = clean(raw.label, 24);
  const dates = (Array.isArray(raw.dates) ? raw.dates : []).slice(0, 2).map((d: unknown) => clean(d, 40)).filter(Boolean);
  const icon = STICKER_ICONS.some(i => i.id === raw.icon) ? String(raw.icon) : 'none';
  const look = STICKER_LOOKS.some(l => l.id === raw.look) ? String(raw.look) : 'sticker';
  const day = Number.isInteger(raw.day) && raw.day >= 0 && raw.day <= 6 ? raw.day : new Date().getDay();
  if (look !== 'decor' && !label && !dates.length && icon === 'none') return null;
  return {
    icon, label: look === 'decor' ? '' : label, dates, look, day,
    theme: STICKER_THEMES.some(t => t.id === raw.theme) ? String(raw.theme) : 'rose',
    position: raw.position === 'bottom' ? 'bottom' : 'top',
  };
}

/** #rrggbb -> ASS &HAABBGGRR */
const assColor = (hex: string, alpha = '00') => `&H${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

/**
 * Ornamented day name: the white artwork mask (public/days) fitted in the box, painted with the theme colour
 * (or the original pink-to-orange gradient for "rose") over a soft shadow. `pad` is the transparent margin.
 */
async function dayArt(day: number, themeId: string, maxW: number, maxH: number) {
  const mask = await sharp(path.resolve('public' + DAY_ART[day])).resize(maxW, maxH, { fit: 'inside' }).png().toBuffer();
  const { width = maxW, height = maxH } = await sharp(mask).metadata();
  const theme = STICKER_THEMES.find(t => t.id === themeId) ?? STICKER_THEMES[0];
  const paint = (fill: string) => sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${DECOR_GRADIENT[0]}"/><stop offset="1" stop-color="${DECOR_GRADIENT[1]}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="${fill}"/></svg>`,
  )).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const colored = await paint(theme.id === 'rose' ? 'url(#g)' : theme.fill);
  const pad = 18;
  const shadow = await sharp(await paint('rgba(0,0,0,0.5)'))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(5).png().toBuffer();
  const png = await sharp({ create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, top: 3, left: 0, blend: 'over' }, { input: colored, top: pad, left: pad }])
    .png().toBuffer();
  return { png, width: width + pad * 2, height: height + pad * 2, pad };
}

function timeCaptions(text: string, wav: Buffer, offset: number) {
  const { intervals, duration } = speechIntervals(wav);
  return spreadOverSpeech(captionChunks(text), intervals.length ? intervals : [[0, duration]], offset);
}

// Waqf (stop) signs in the Uthmani text: a good place to break a verse into caption lines
const STOP_MARK = /[ۖ-ۜ]/;
const ARABIC_LETTER = /[ء-يٱ-ۓ]/;

/** A verse in short caption lines: up to 6 words (7 when the 7th ends at a stop sign), broken after a stop sign once
 *  a line has 3; stop signs and other standalone marks stay with the word before them, and a single leftover word
 *  joins the line before. */
export function verseChunks(text: string): string[] {
  const words: string[] = [];
  for (const t of text.split(/\s+/).filter(Boolean)) {
    if (!ARABIC_LETTER.test(t) && words.length) words[words.length - 1] += ` ${t}`;
    else words.push(t);
  }
  const chunks: string[] = [];
  let line: string[] = [];
  for (const [i, w] of words.entries()) {
    line.push(w);
    const nextEndsAtStop = line.length === 6 && STOP_MARK.test(words[i + 1] ?? '');
    if ((line.length >= 6 && !nextEndsAtStop) || (line.length >= 3 && STOP_MARK.test(w))) {
      chunks.push(line.join(' '));
      line = [];
    }
  }
  if (line.length === 1 && chunks.length) chunks[chunks.length - 1] += ` ${line[0]}`;
  else if (line.length) chunks.push(line.join(' '));
  return chunks;
}

/** Quran captions: every verse keeps its own span from the recitation; inside it the lines follow the reciter's sound. */
function verseCaptions(verses: NonNullable<CalmRenderOptions['verses']>, wav: Buffer, offset: number) {
  const { intervals } = speechIntervals(wav);
  return verses.flatMap(v => {
    const inside = intervals
      .map(([a, b]) => [Math.max(a, v.start), Math.min(b, v.end)] as [number, number])
      .filter(([a, b]) => b - a > 0.05);
    return spreadOverSpeech(verseChunks(v.text), inside.length ? inside : [[v.start, v.end]], offset)
      .map(c => ({ ...c, end: Math.min(c.end, v.end + offset + 0.3) }));
  });
}

/** Lays caption lines over the speech proportionally to their length (silences are skipped). */
function spreadOverSpeech(chunks: string[], speech: [number, number][], offset: number) {
  const total = speech.reduce((s, [a, b]) => s + (b - a), 0);
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
    return { start: start + offset, end: Math.max(at((used / wTotal) * total), start + 0.8) + offset + 0.3, text: c };
  });
}

/** Sticker text and watermark (Noto and Amiri, which libass shapes well); captions are PNG overlays. */
function buildAss(o: CalmRenderOptions, total: number) {
  const lay = stickerLayout(o.sticker?.position ?? 'top', !!o.title, o.sticker?.look, (o.sticker?.icon ?? 'none') !== 'none', !!o.info);
  const theme = STICKER_THEMES.find(t => t.id === o.sticker?.theme) ?? STICKER_THEMES[0];
  const look = STICKER_LOOKS.find(l => l.id === o.sticker?.look) ?? STICKER_LOOKS[0];
  const callig = look.id !== 'sticker';
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Sticker look: letters with a coloured edge. Calligraphy: a large vowelled day name with a soft shadow,
    // a bold numeric date under it, then the Hijri date in the calligraphic face
    callig
      ? `Style: Sticker,${look.font},${lay.labelSize},${assColor(theme.fill)},${assColor(theme.fill)},&H70000000,&H70000000,1,0,0,0,100,100,0,0,1,2,4,8,30,30,0,-1`
      : `Style: Sticker,${look.font},${lay.labelSize},${assColor(theme.fill)},${assColor(theme.fill)},${assColor(theme.edge)},&H64000000,1,0,0,0,100,100,0,0,1,4,2,8,40,40,0,-1`,
    `Style: StickerDate,${callig ? 'Noto Sans Arabic' : 'Noto Kufi Arabic'},${lay.dateSize},${assColor(theme.fill)},&H00FFFFFF,&H50000000,&H70000000,${callig ? 1 : 0},0,0,0,100,100,0,0,1,${callig ? 2 : 3},${callig ? 3 : 1},8,40,40,0,-1`,
    `Style: StickerDate2,${callig ? look.font : 'Noto Kufi Arabic'},${lay.dateSize2},${assColor(theme.fill)},&H00FFFFFF,&H50000000,&H70000000,${callig ? 1 : 0},0,0,0,100,100,0,0,1,${callig ? 2 : 3},${callig ? 3 : 1},8,40,40,0,-1`,
    'Style: Mark,Noto Sans Arabic,24,&H66FFFFFF,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,40,40,46,-1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${assTime(0)},${assTime(total)},Mark,,0,0,0,,${assText(watermarkFor(o.domain))}`,
  ];
  const sk = o.sticker;
  if (sk) {
    if (sk.label) lines.push(`Dialogue: 2,${assTime(0.6)},${assTime(total)},Sticker,,0,0,0,,{\\an8\\pos(${W / 2},${lay.labelY})\\fad(900,0)}${assText(sk.label)}`);
    sk.dates.forEach((d, i) => lines.push(`Dialogue: 2,${assTime(0.8)},${assTime(total)},${i === 0 ? 'StickerDate' : 'StickerDate2'},,0,0,0,,{\\an8\\pos(${W / 2},${lay.dateY + i * lay.dateGap - (sk.label || look.id === 'decor' ? 0 : 80)})\\fad(900,0)\\blur2}${assText(d)}`));
  }
  return lines.join('\n') + '\n';
}

/**
 * Title (and the line under it), captions, dedication and support card as timed PNG overlays drawn with Pango (see calm-text.ts): the customer's font
 * and colour, captions centred on style.y, each one fading in and out with the voice.
 */
async function textOverlays(o: CalmRenderOptions, voiceStart: number, voiceEnd: number, total: number) {
  const st = { ...DEFAULT_CALM_STYLE, ...o.style };
  const out: { png: Buffer; x: number; y: number; start: number; end: number; fade: number }[] = [];
  const centred = async (text: string, size: number, width: number, cy: number | null, top: number, start: number, end: number, fade: number) => {
    const t = await textPng(text, { font: st.font, size, color: st.color, width });
    const y = cy == null ? top - t.pad : Math.round(cy - t.height / 2);
    out.push({ png: t.png, x: Math.round((W - t.width) / 2), y: Math.max(0, y), start, end, fade });
  };
  if (o.title) await centred(o.title, st.titleSize, W - 120, null, st.titleY, 0.6, voiceEnd, 0.9);
  if (o.info) await centred(o.info, Math.round(st.titleSize * 0.62), W - 120, st.infoY, 0, 0.8, voiceEnd, 0.9);
  // The dedication stays for the whole reel, the closing card included
  if (o.dedication) await centred(o.dedication, Math.round(st.size * 0.52), W - 120, st.dedicationY, 0, 0.6, total - 0.3, 0.9);
  for (const c of o.verses?.length ? verseCaptions(o.verses, o.voice, voiceStart) : timeCaptions(o.text, o.voice, voiceStart)) {
    await centred(c.text, st.size, W - 110, st.y, 0, c.start, Math.min(c.end, voiceEnd + 0.4), 0.35);
  }
  if (o.supportCard) await centred(o.supportCard, Math.round(st.size * 0.68), W - 140, st.y, 0, voiceEnd + 0.6, total - 0.3, 0.6);
  return out.filter(t => t.end - t.start > 0.2);
}

/** The identity strip of a medical reel: a translucent rounded box with the logo on the right and up to 3 lines. */
async function brandStrip(b: NonNullable<CalmRenderOptions['brand']>) {
  const width = W - 80;
  const logoSize = b.logo ? 96 : 0;
  const lines = await Promise.all(b.lines.filter(Boolean).slice(0, 3).map((t, i) =>
    textPng(t, { font: 'cairo', size: i === 0 ? 34 : 26, color: '#ffffff', width: width - logoSize - 60 })));
  const textH = lines.reduce((s, l) => s + l.height - 2 * l.pad, 0) + Math.max(0, lines.length - 1) * 6;
  const height = Math.max(logoSize, textH) + 36;
  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (b.logo) {
    const mask = Buffer.from(`<svg width="${logoSize}" height="${logoSize}"><circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="#fff"/></svg>`);
    const round = await sharp(b.logo).resize(logoSize, logoSize, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: round, left: width - logoSize - 18, top: Math.round((height - logoSize) / 2) });
  }
  let y = Math.round((height - textH) / 2);
  for (const l of lines) {
    // Right-aligned next to the logo (Arabic reads from the right)
    layers.push({ input: l.png, left: Math.max(0, width - logoSize - 34 - l.width), top: y - l.pad });
    y += l.height - 2 * l.pad + 6;
  }
  const box = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="26" fill="#0b1220" fill-opacity="0.62"/><rect x="0" y="${height - 6}" width="${width}" height="6" rx="3" fill="${b.color}"/></svg>`);
  const png = await sharp(box).composite(layers).png().toBuffer();
  return { png, width, height };
}

export async function renderReel(o: CalmRenderOptions): Promise<Buffer> {
  const q = PROFILES[clampQuality(o.quality)];
  const voiceStart = 1.2;
  const voiceLen = speechIntervals(o.voice).duration;
  const voiceEnd = voiceStart + voiceLen;
  const total = Math.ceil((voiceEnd + (o.supportCard ? 4.5 : 1.8)) * 10) / 10;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sawtik-calm-'));
  try {
    const files = await Promise.all(o.clips.map(localClip));
    await fs.writeFile(path.join(dir, 'voice.wav'), o.voice);
    await fs.writeFile(path.join(dir, 'subs.ass'), buildAss(o, total));

    // Scenes cycle through the chosen clips until the reel is covered; each scene shows up to ~9 s
    const segments: { file: string; len: number }[] = [];
    let covered = 0;
    for (let i = 0; covered < total + FADE; i++) {
      const clip = o.clips[i % o.clips.length];
      const len = Math.min(clip.duration - 0.2, 9, total + FADE - covered + FADE);
      segments.push({ file: files[i % files.length], len: Math.max(len, FADE + 1) });
      covered += segments[segments.length - 1].len - (segments.length > 1 ? FADE : 0);
      if (segments.length > 12) break;
    }

    // Sticker pictures (the icon, drawn from the same SVG the page previews, and the ornamented day name)
    // are laid over the scenes as still images that fade in
    const sk = o.sticker;
    const icon = sk && STICKER_ICONS.find(i => i.id === sk.icon);
    const lay = stickerLayout(sk?.position ?? 'top', !!o.title, sk?.look, !!icon, !!o.info);
    // Every still overlay (sticker pictures, then the Pango-drawn title/captions/card) is a looped PNG that starts
    // at its own time, fades in (and out, for text) and drops away when it ends
    const pictures: { file: string; x: number; y: number; start: number; end: number; fade: number; fadeOut: boolean }[] = [];
    if (icon) {
      await fs.writeFile(path.join(dir, 'icon.png'), await sharp(Buffer.from(icon.svg)).resize(lay.iconSize, lay.iconSize).png().toBuffer());
      pictures.push({ file: 'icon.png', x: (W - lay.iconSize) / 2, y: lay.iconY, start: 0.5, end: total, fade: 0.9, fadeOut: false });
    }
    if (sk?.look === 'decor') {
      const art = await dayArt(sk.day ?? new Date().getDay(), sk.theme, lay.artW, lay.artH);
      await fs.writeFile(path.join(dir, 'day.png'), art.png);
      pictures.push({ file: 'day.png', x: Math.round((W - art.width) / 2), y: lay.labelY + lay.artH - art.height + art.pad, start: 0.5, end: total, fade: 0.9, fadeOut: false });
    }
    if (o.brand) {
      const strip = await brandStrip(o.brand);
      await fs.writeFile(path.join(dir, 'brand.png'), strip.png);
      pictures.push({ file: 'brand.png', x: Math.round((W - strip.width) / 2), y: H - strip.height - 92, start: 0.6, end: total, fade: 0.8, fadeOut: false });
    }
    const texts = await textOverlays(o, voiceStart, voiceEnd, total);
    for (const [k, t] of texts.entries()) {
      await fs.writeFile(path.join(dir, `t${k}.png`), t.png);
      pictures.push({ file: `t${k}.png`, x: t.x, y: t.y, start: t.start, end: t.end, fade: t.fade, fadeOut: true });
    }
    const iconInput = pictures.flatMap(p => ['-framerate', String(q.fps), '-loop', '1', '-t', (p.end - p.start).toFixed(2), '-i', p.file]);
    const iconFilter = pictures.map((p, j) => {
      const len = p.end - p.start;
      const fade = Math.min(p.fade, len / 2);
      const out = p.fadeOut ? `,fade=t=out:st=${(len - fade).toFixed(2)}:d=${fade.toFixed(2)}:alpha=1` : '';
      return `[cb${j}];[${segments.length + 1 + j}:v]format=rgba,fade=t=in:st=0:d=${fade.toFixed(2)}:alpha=1${out},setpts=PTS+${p.start.toFixed(2)}/TB[ci${j}];` +
        `[cb${j}][ci${j}]overlay=${p.x}:${p.y}:eof_action=pass`;
    }).join('');
    const inputs = segments.flatMap(s => ['-t', s.len.toFixed(2), '-i', s.file]);
    const voiceIdx = segments.length;
    const prep = segments.map((s, i) =>
      `[${i}:v]trim=0:${s.len.toFixed(2)},setpts=PTS-STARTPTS,fps=${q.fps},crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${W}:${H},format=yuv420p,eq=brightness=-0.1:saturation=1.05,setsar=1[s${i}]`);
    const fades: string[] = [];
    let last = 's0';
    let offset = segments[0].len - FADE;
    for (let i = 1; i < segments.length; i++) {
      fades.push(`[${last}][s${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[x${i}]`);
      last = `x${i}`;
      offset += segments[i].len - FADE;
    }
    const filter = [
      ...prep,
      ...fades,
      `[${last}]trim=0:${total},setpts=PTS-STARTPTS${iconFilter},fade=t=in:st=0:d=1,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2,subtitles=subs.ass:fontsdir=${FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\\\:')}${q.width === W ? '' : `,scale=${q.width}:${q.height}:flags=bicubic`}[vout]`,
      // Voice starts after a breath of silence; the soundtrack fades out with the picture
      `[${voiceIdx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(voiceStart * 1000)}|${Math.round(voiceStart * 1000)},apad,atrim=0:${total},afade=t=out:st=${(total - 1).toFixed(2)}:d=1[aout]`,
    ].join(';');

    // CRF 28 and 2 Mb/s: half the size of CRF 24 / 4 Mb/s with no visible difference on calm footage (measured
    // SSIM 0.97), so the reel reaches a phone twice as fast
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '4',
      ...inputs, '-i', 'voice.wav', ...iconInput,
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q.crf), '-maxrate', q.maxrate, '-bufsize', q.bufsize, '-r', String(q.fps), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-t', String(total), '-movflags', '+faststart', 'out.mp4',
    ], dir, { timeoutMs: renderTimeoutMs(total) * 3, duration: total, onProgress: o.onProgress });
    return await fs.readFile(path.join(dir, 'out.mp4'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
