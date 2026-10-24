// Branded press video: the outlet's colour and logo, show name and episode title, one or two speaker portraits
// (the one talking lights up), waveform, synced captions, and a scrolling headline ticker for bulletins.
// Rendered with the same ffmpeg/libass pipeline and queue as the other videos.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import sharp, { OverlayOptions } from 'sharp';
import {
  RENDER_PROFILES, ARABIC_FONT, watermarkFor, renderTimeoutMs, speechIntervals, captionChunks, assTime, assText,
  runFfmpeg, enqueueRender,
} from './video.ts';

export type PressVideoFormat = 'landscape' | 'vertical' | 'square';

export interface PressSpeaker { name: string; image: Buffer }
export interface PressLine { speaker: number; text: string }

export interface PressVideoOptions {
  speech: Buffer;            // the spoken part only (timing is measured on it)
  audio: Buffer;             // what plays: speech wrapped with the intro/outro jingles
  introSeconds: number;
  format: PressVideoFormat;
  hd?: boolean;
  color: string;             // outlet colour
  logo: Buffer | null;
  outletName: string;
  showName: string;
  episodeTitle: string;
  speakers: PressSpeaker[];  // 1 (summary) or 2
  lines: PressLine[];
  headlines: string[];       // bulletin ticker (empty = no ticker)
  domain: string;
  onProgress?: (fraction: number) => void;
  onStart?: () => void;
}

/** Positions on each design canvas (1080p); scaled down for the fast profile. */
const LAYOUTS: Record<PressVideoFormat, {
  w: number; h: number; bar: number; logoH: number; titleY: number; circle: number; circleY: number; spread: number;
  nameY: number; waveY: number; waveH: number; captionsBottom: number; ticker: number; tickerBottom: number; showSize: number; titleSize: number;
  nameSize: number; captionSize: number;
}> = {
  landscape: { w: 1920, h: 1080, bar: 110, logoH: 76, titleY: 140, circle: 300, circleY: 300, spread: 0.18, nameY: 625, waveY: 690, waveH: 110, captionsBottom: 150, ticker: 86, tickerBottom: 0, showSize: 46, titleSize: 54, nameSize: 40, captionSize: 52 },
  vertical: { w: 1080, h: 1920, bar: 150, logoH: 100, titleY: 210, circle: 380, circleY: 520, spread: 0.25, nameY: 925, waveY: 1020, waveH: 150, captionsBottom: 470, ticker: 110, tickerBottom: 260, showSize: 52, titleSize: 64, nameSize: 48, captionSize: 64 },
  square: { w: 1080, h: 1080, bar: 110, logoH: 76, titleY: 135, circle: 280, circleY: 255, spread: 0.24, nameY: 560, waveY: 615, waveH: 100, captionsBottom: 150, ticker: 80, tickerBottom: 0, showSize: 40, titleSize: 48, nameSize: 36, captionSize: 50 },
};

const shade = (hex: string, factor: number) => {
  const h = hex.replace('#', '');
  return '#' + [0, 2, 4].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * factor).toString(16).padStart(2, '0')).join('');
};
const assColor = (hex: string, alpha = '00') => {
  const h = hex.replace('#', '');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};

/** Centre x of each speaker portrait. */
const speakerXs = (L: typeof LAYOUTS.landscape, count: number) =>
  count === 1 ? [L.w / 2] : [L.w * (0.5 + L.spread), L.w * (0.5 - L.spread)]; // speaker 0 on the right (RTL)

async function circlePhoto(image: Buffer, size: number): Promise<Buffer> {
  const r = size / 2;
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  return sharp(image).resize(size, size, { fit: 'cover', position: 'centre' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function buildBackground(o: PressVideoOptions, L: typeof LAYOUTS.landscape): Promise<Buffer> {
  const dark = shade(o.color, 0.45);
  const xs = speakerXs(L, o.speakers.length);
  const r = L.circle / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.color}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${L.w * 0.9}" cy="${L.h * 0.15}" r="${L.h * 0.45}" fill="#fff" opacity="0.05"/>
    <circle cx="${L.w * 0.08}" cy="${L.h * 0.92}" r="${L.h * 0.35}" fill="#fff" opacity="0.04"/>
    <rect width="100%" height="${L.bar}" fill="#000" opacity="0.28"/>
    ${xs.map(x => `<circle cx="${x}" cy="${L.circleY + r}" r="${r + 60}" fill="url(#glow)"/>
      <circle cx="${x}" cy="${L.circleY + r}" r="${r + 6}" fill="none" stroke="#fff" stroke-width="4" opacity="0.55"/>`).join('')}
    ${o.headlines.length ? `<rect y="${L.h - L.tickerBottom - L.ticker}" width="100%" height="${L.ticker}" fill="#000" opacity="0.6"/>` : ''}
  </svg>`;

  const layers: OverlayOptions[] = [];
  for (let i = 0; i < o.speakers.length; i++) {
    layers.push({ input: await circlePhoto(o.speakers[i].image, L.circle), left: Math.round(xs[i] - r), top: L.circleY });
  }
  if (o.logo) {
    const logo = await sharp(o.logo).resize({ height: L.logoH, width: Math.round(L.w * 0.3), fit: 'inside' }).png().toBuffer();
    layers.push({ input: logo, left: Math.round(L.bar * 0.3), top: Math.round((L.bar - L.logoH) / 2) });
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}

/** The glowing ring drawn over the portrait of whoever is speaking. */
function ringPng(size: number, color: string): Promise<Buffer> {
  const d = size + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">
    <circle cx="${d / 2}" cy="${d / 2}" r="${size / 2 + 8}" fill="none" stroke="${color}" stroke-width="12"/>
    <circle cx="${d / 2}" cy="${d / 2}" r="${size / 2 + 17}" fill="none" stroke="#fff" stroke-width="3" opacity="0.8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * When each line is spoken: lines are laid onto the detected speech in proportion to their length, skipping
 * silences, then shifted by the intro jingle. Captions are spread the same way inside each line.
 */
function timeLines(o: PressVideoOptions) {
  const { intervals, duration } = speechIntervals(o.speech);
  const speech = intervals.length ? intervals : [[0, duration] as [number, number]];
  const total = speech.reduce((s, [a, b]) => s + (b - a), 0);
  const weights = o.lines.map(l => l.text.replace(/\s/g, '').length || 1);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  const at = (secondsOfSpeech: number) => {
    let left = secondsOfSpeech;
    for (const [a, b] of speech) {
      if (left <= b - a) return a + left;
      left -= b - a;
    }
    return speech[speech.length - 1][1];
  };
  let used = 0;
  const lines = o.lines.map((line, i) => {
    const start = at((used / weightTotal) * total);
    used += weights[i];
    const end = at((used / weightTotal) * total);
    return { ...line, start: start + o.introSeconds, end: end + o.introSeconds };
  });
  const captions = lines.flatMap(line => {
    const chunks = captionChunks(line.text);
    const cw = chunks.map(c => c.replace(/\s/g, '').length || 1);
    const sum = cw.reduce((a, b) => a + b, 0);
    let acc = 0;
    return chunks.map((text, i) => {
      const start = line.start + ((line.end - line.start) * acc) / sum;
      acc += cw[i];
      const end = line.start + ((line.end - line.start) * acc) / sum;
      return { start, end: Math.max(end, start + 0.5), text };
    });
  });
  return { lines, captions };
}

function buildAss(o: PressVideoOptions, L: typeof LAYOUTS.landscape, scale: number, duration: number, captions: { start: number; end: number; text: string }[]) {
  const px = (n: number) => Math.round(n * scale);
  const W = px(L.w);
  const H = px(L.h);
  const xs = speakerXs(L, o.speakers.length);
  const accent = '#fde047';
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Show,${ARABIC_FONT},${px(L.showSize)},&H00FFFFFF,&H00FFFFFF,&H60000000,&H00000000,1,0,0,0,100,100,0,0,1,${px(2)},0,9,${px(40)},${px(40)},${px((L.bar - L.showSize) / 2 - 4)},-1`,
    `Style: Title,${ARABIC_FONT},${px(L.titleSize)},${assColor(accent)},&H00FFFFFF,&H70000000,&H80000000,1,0,0,0,100,100,0,0,1,${px(3)},${px(2)},8,${px(60)},${px(60)},${px(L.titleY)},-1`,
    `Style: Name,${ARABIC_FONT},${px(L.nameSize)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H80000000,1,0,0,0,100,100,0,0,1,${px(2)},${px(2)},8,0,0,0,-1`,
    `Style: Caption,${ARABIC_FONT},${px(L.captionSize)},&H00FFFFFF,&H00FFFFFF,&H78000000,&H78000000,1,0,0,0,100,100,0,0,3,${px(14)},0,2,${px(80)},${px(80)},${px(L.captionsBottom)},-1`,
    `Style: Intro,${ARABIC_FONT},${px(L.titleSize * 1.5)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H90000000,1,0,0,0,100,100,0,0,1,${px(4)},${px(3)},5,${px(80)},${px(80)},0,-1`,
    `Style: Ticker,${ARABIC_FONT},${px(L.ticker * 0.48)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,6,0,0,0,-1`,
    `Style: Label,${ARABIC_FONT},${px(L.ticker * 0.4)},&H00000000,&H00FFFFFF,${assColor(accent)},${assColor(accent)},1,0,0,0,100,100,0,0,3,${px(14)},0,6,0,0,0,-1`,
    `Style: Mark,${ARABIC_FONT},${px(26)},&H99FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,${px(30)},${px(30)},${px(o.headlines.length ? L.tickerBottom + L.ticker + 12 : 24)},-1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${assTime(0)},${assTime(duration)},Mark,,0,0,0,,${assText(watermarkFor(o.domain))}`,
  ];
  const show = [o.showName, o.outletName].filter(Boolean).join(' · ');
  if (show) lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Show,,0,0,0,,${assText(show)}`);
  if (o.episodeTitle) lines.push(`Dialogue: 0,${assTime(o.introSeconds)},${assTime(duration)},Title,,0,0,0,,${assText(o.episodeTitle)}`);
  o.speakers.forEach((s, i) => {
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Name,,0,0,0,,{\\an8\\pos(${px(xs[i])},${px(L.nameY)})}${assText(s.name)}`);
  });
  // During the intro jingle: the show name (or episode title) as a title card
  if (o.introSeconds > 0.5) {
    lines.push(`Dialogue: 2,${assTime(0)},${assTime(o.introSeconds)},Intro,,0,0,0,,{\\fad(300,300)}${assText(o.showName || o.episodeTitle)}`);
  }
  for (const c of captions) lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);

  // Bulletin ticker: headlines scroll left-to-right (Arabic reading direction) under a fixed label
  if (o.headlines.length) {
    const label = 'أبرز الأخبار';
    const y = px(L.h - L.tickerBottom - L.ticker / 2);
    lines.push(`Dialogue: 3,${assTime(0)},${assTime(duration)},Label,,0,0,0,,{\\pos(${W - px(20)},${y})}${assText(label)}`);
    const text = o.headlines.join('   ◆   ');
    const fontPx = px(L.ticker * 0.48);
    const textW = Math.round(text.length * fontPx * 0.5);
    const speed = px(170); // px per second
    // Anchored by its right edge (\an6): libass places right-to-left text by its end, so a left anchor pushed
    // it off screen. The text enters from the left and travels right until it has fully left the frame.
    const cycle = (W + textW) / speed;
    for (let t = 0; t < duration; t += cycle) {
      const end = Math.min(duration, t + cycle);
      const x2 = Math.round((W + textW) * ((end - t) / cycle));
      lines.push(`Dialogue: 2,${assTime(t)},${assTime(end)},Ticker,,0,0,0,,{\\an6\\q2\\move(0,${y},${x2},${y})}${assText(text)}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function renderPressVideo(o: PressVideoOptions): Promise<Buffer> {
  return enqueueRender(() => renderPressNow(o), o.onStart);
}

async function renderPressNow(o: PressVideoOptions): Promise<Buffer> {
  const profile = o.hd ? RENDER_PROFILES.hd : RENDER_PROFILES.fast;
  const base = LAYOUTS[o.format];
  const scale = profile.scale;
  const even = (n: number) => Math.round((n * scale) / 2) * 2;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sawtik-press-${crypto.randomBytes(4).toString('hex')}-`));
  try {
    const { duration } = speechIntervals(o.audio);
    const { lines, captions } = timeLines(o);

    const background = await sharp(await buildBackground(o, base)).resize(even(base.w), even(base.h)).png().toBuffer();
    const ringSize = Math.round(base.circle * scale);
    const ring = await ringPng(ringSize, '#fde047');
    await Promise.all([
      fs.writeFile(path.join(dir, 'bg.png'), background),
      fs.writeFile(path.join(dir, 'ring.png'), ring),
      fs.writeFile(path.join(dir, 'audio.wav'), o.audio),
      fs.writeFile(path.join(dir, 'subs.ass'), buildAss(o, base, scale, duration, captions)),
    ]);

    const xs = speakerXs(base, o.speakers.length);
    const ringD = ringSize + 40;
    const waveW = even(base.w * 0.6);
    const waveH = even(base.waveH);
    // The ring shows over whoever is speaking (only worth it with two people on screen)
    const highlight = o.speakers.length > 1 ? o.speakers.map((_, i) => {
      const spans = lines.filter(l => l.speaker === i).map(l => `between(t,${l.start.toFixed(2)},${l.end.toFixed(2)})`);
      return spans.length ? spans.join('+') : '0';
    }) : [];

    const filter = [
      `[0:v]format=yuv420p,loop=loop=-1:size=1:start=0,fps=${profile.fps}[bg]`,
      ...(highlight.length ? [
        `[2:v]format=yuva420p,loop=loop=-1:size=1:start=0,fps=${profile.fps},split=${highlight.length}${highlight.map((_, i) => `[r${i}]`).join('')}`,
        ...highlight.map((expr, i) =>
          `[${i === 0 ? 'bg' : `h${i - 1}`}][r${i}]overlay=x=${Math.round(xs[i] * scale - ringD / 2)}:y=${Math.round((base.circleY + base.circle / 2) * scale - ringD / 2)}:enable='${expr}':format=yuv420[h${i}]`),
      ] : []),
      `[1:a]volume=3,showwaves=s=${waveW}x${waveH}:mode=cline:rate=${profile.fps}:colors=#ffffff@0.75:scale=sqrt:draw=full,format=yuva420p[waves]`,
      `[${highlight.length ? `h${highlight.length - 1}` : 'bg'}][waves]overlay=x=(W-w)/2:y=${Math.round(base.waveY * scale)}:format=yuv420:shortest=1[v1]`,
      `[v1]subtitles=subs.ass[vout]`,
    ].join(';');

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '4',
      '-i', 'bg.png', '-i', 'audio.wav', ...(highlight.length ? ['-i', 'ring.png'] : []),
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', profile.preset, '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', String(profile.fps), '-shortest', '-movflags', '+faststart',
      'out.mp4',
    ], dir, { timeoutMs: renderTimeoutMs(duration), duration, onProgress: o.onProgress });

    return await fs.readFile(path.join(dir, 'out.mp4'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
