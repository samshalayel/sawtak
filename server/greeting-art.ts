// Artwork for greeting videos: an occasion background (gradient + decoration) and a centre circle holding
// the recipient's photo or, without a photo, the occasion's emblem. Drawn as SVG and rasterised with sharp.
// No text is drawn here: titles and captions go through libass, which shapes Arabic correctly.
import sharp, { OverlayOptions } from 'sharp';
import { GreetingEmblem, GreetingMotif, GreetingTheme } from './greeting-themes.ts';

// Designed on a 1080×1920 canvas; everything is scaled to the render size.
export const GREETING_DESIGN = { width: 1080, height: 1920, circle: 620, circleTop: 540 };

// Deterministic randomness so the same occasion always looks the same
function seeded(seedText: string) {
  let seed = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEART = 'M0,-10 C-14,-30 -44,-18 -36,6 C-30,24 -10,34 0,46 C10,34 30,24 36,6 C44,-18 14,-30 0,-10Z';
const SPARKLE = 'M0,-24 Q4,-4 24,0 Q4,4 0,24 Q-4,4 -24,0 Q-4,-4 0,-24Z';

function starPoints(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    coords.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return coords.join(' ');
}

// Keeps decoration out of the centre circle and the caption area so the photo and text stay clean
function freeSpot(rand: () => number): [number, number] {
  for (let i = 0; i < 20; i++) {
    const x = rand() * 1080;
    const y = rand() * 1920;
    const inCircle = Math.hypot(x - 540, y - (GREETING_DESIGN.circleTop + GREETING_DESIGN.circle / 2)) < GREETING_DESIGN.circle / 2 + 60;
    if (!inCircle) return [x, y];
  }
  return [rand() * 1080, rand() * 300];
}

function motifSvg(motif: GreetingMotif, theme: GreetingTheme, rand: () => number): string {
  const palette = [theme.accent, '#ffffff', '#38bdf8', '#f472b6', '#a3e635', '#fb923c'];
  const pick = () => palette[Math.floor(rand() * palette.length)];
  const parts: string[] = [];

  if (motif === 'confetti') {
    for (let i = 0; i < 80; i++) {
      const [x, y] = freeSpot(rand);
      const op = (0.55 + rand() * 0.4).toFixed(2);
      if (rand() < 0.6) {
        const w = 12 + rand() * 16, h = 7 + rand() * 8;
        parts.push(`<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${pick()}" opacity="${op}" transform="rotate(${Math.round(rand() * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
      } else {
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(4 + rand() * 6).toFixed(1)}" fill="${pick()}" opacity="${op}"/>`);
      }
    }
  } else if (motif === 'snow') {
    for (let i = 0; i < 110; i++) {
      const [x, y] = freeSpot(rand);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.5 + rand() * 8).toFixed(1)}" fill="#ffffff" opacity="${(0.3 + rand() * 0.55).toFixed(2)}"/>`);
    }
  } else if (motif === 'hearts') {
    for (let i = 0; i < 34; i++) {
      const [x, y] = freeSpot(rand);
      const s = 0.5 + rand() * 1.1;
      parts.push(`<path d="${HEART}" fill="${rand() < 0.5 ? theme.accent : '#ffffff'}" opacity="${(0.2 + rand() * 0.45).toFixed(2)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(rand() * 50 - 25)}) scale(${s.toFixed(2)})"/>`);
    }
  } else if (motif === 'balloons') {
    for (let i = 0; i < 12; i++) {
      const [x, y] = freeSpot(rand);
      const s = 0.7 + rand() * 0.8;
      const color = ['#ffffff', '#fde047', '#f472b6', '#38bdf8', '#a78bfa'][i % 5];
      parts.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})" opacity="0.8">
        <path d="M0,62 Q-10,95 4,130" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.7"/>
        <ellipse cx="0" cy="0" rx="40" ry="52" fill="${color}"/>
        <path d="M-7,50 L7,50 L0,62Z" fill="${color}"/>
        <ellipse cx="-13" cy="-18" rx="8" ry="14" fill="#ffffff" opacity="0.45"/>
      </g>`);
    }
  } else {
    // crescent / sparkles: twinkling stars, plus a large faint crescent for Ramadan
    if (motif === 'crescent') {
      parts.push(`<mask id="moon"><rect width="1080" height="1920" fill="#fff"/><circle cx="905" cy="210" r="150" fill="#000"/></mask>
        <circle cx="840" cy="250" r="165" fill="${theme.accent}" opacity="0.35" mask="url(#moon)"/>`);
    }
    for (let i = 0; i < 60; i++) {
      const [x, y] = freeSpot(rand);
      const s = 0.25 + rand() * 0.9;
      parts.push(`<path d="${SPARKLE}" fill="${rand() < 0.6 ? theme.accent : '#ffffff'}" opacity="${(0.35 + rand() * 0.6).toFixed(2)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(2)})"/>`);
    }
    for (let i = 0; i < 70; i++) {
      const [x, y] = freeSpot(rand);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.5 + rand() * 2.5).toFixed(1)}" fill="#ffffff" opacity="${(0.3 + rand() * 0.6).toFixed(2)}"/>`);
    }
  }
  return parts.join('');
}

/** The occasion emblem, drawn around (0,0) for a circle of radius 310. */
function emblemSvg(emblem: GreetingEmblem, theme: GreetingTheme): string {
  const a = theme.accent;
  switch (emblem) {
    case 'cake':
      return `
        <rect x="-170" y="40" width="340" height="120" rx="22" fill="#ffffff"/>
        <rect x="-170" y="40" width="340" height="34" rx="16" fill="${a}"/>
        <rect x="-120" y="-60" width="240" height="110" rx="20" fill="#ffffff" opacity="0.92"/>
        <rect x="-120" y="-60" width="240" height="30" rx="14" fill="${a}"/>
        ${[-70, 0, 70].map(x => `<rect x="${x - 9}" y="-140" width="18" height="80" rx="6" fill="#ffffff"/>
          <ellipse cx="${x}" cy="-160" rx="12" ry="20" fill="${a}"/>`).join('')}`;
    case 'crescent':
      return `
        <mask id="cres"><rect x="-300" y="-300" width="600" height="600" fill="#fff"/><circle cx="70" cy="-45" r="150" fill="#000"/></mask>
        <circle cx="0" cy="0" r="175" fill="${a}" mask="url(#cres)"/>
        <polygon points="${starPoints(105, -10, 62, 26)}" fill="#ffffff"/>`;
    case 'star':
      return `<polygon points="${starPoints(0, 0, 200, 82)}" fill="${a}"/>
        <polygon points="${starPoints(0, 0, 120, 50)}" fill="#ffffff" opacity="0.35"/>`;
    case 'tree':
      return `
        <polygon points="0,-210 120,-40 -120,-40" fill="#ffffff"/>
        <polygon points="0,-120 160,70 -160,70" fill="#ffffff" opacity="0.92"/>
        <rect x="-26" y="70" width="52" height="70" rx="8" fill="${a}"/>
        <polygon points="${starPoints(0, -215, 46, 19)}" fill="${a}"/>
        ${[[-60, 20], [55, -10], [-20, -70], [80, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="${a}"/>`).join('')}`;
    case 'rings':
      return `<circle cx="-70" cy="20" r="120" fill="none" stroke="${a}" stroke-width="30"/>
        <circle cx="70" cy="20" r="120" fill="none" stroke="#ffffff" stroke-width="30"/>
        <path d="M-110,-150 L-70,-200 L-30,-150 L-70,-110Z" fill="#ffffff"/>`;
    case 'cap':
      return `
        <polygon points="0,-150 230,-60 0,30 -230,-60" fill="#ffffff"/>
        <path d="M-130,-20 L-130,90 Q0,160 130,90 L130,-20 L0,30Z" fill="#ffffff" opacity="0.85"/>
        <path d="M0,-60 L190,-30 L190,110" stroke="${a}" stroke-width="10" fill="none"/>
        <circle cx="190" cy="125" r="22" fill="${a}"/>`;
    case 'heart':
      return `<path d="${HEART}" fill="${a}" transform="translate(0 -40) scale(5)"/>
        <path d="${HEART}" fill="#ffffff" opacity="0.3" transform="translate(-50 -110) scale(1.4)"/>`;
    case 'balloons':
      return [[-95, -40, '#fde047'], [0, -90, '#ffffff'], [95, -40, '#f472b6']].map(([x, y, c]) => `
        <path d="M${x},${Number(y) + 92} Q${Number(x) * 0.4},${Number(y) + 170} 0,230" stroke="#ffffff" stroke-width="4" fill="none"/>
        <ellipse cx="${x}" cy="${y}" rx="72" ry="92" fill="${c}"/>
        <ellipse cx="${Number(x) - 24}" cy="${Number(y) - 30}" rx="14" ry="26" fill="#ffffff" opacity="0.5"/>`).join('');
  }
}

/**
 * Full background frame for a greeting video at the given size.
 * `photo` (already decoded) goes in the centre circle; without it the occasion emblem is drawn instead.
 * `template` is the customer's own 9:16 design: it replaces the generated artwork, and the circle is
 * only drawn when a photo is added on top of it.
 */
export async function buildGreetingBackground(
  width: number, height: number, theme: GreetingTheme, themeId: string, photo: Buffer | null, template: Buffer | null = null,
  box: PhotoBox = DEFAULT_PHOTO_BOX
): Promise<Buffer> {
  const { circle, circleTop } = GREETING_DESIGN;
  const rand = seeded(themeId);
  const cx = 540;
  const cy = circleTop + circle / 2;
  const r = circle / 2;

  if (template) return buildOnTemplate(width, height, theme, photo, template, box);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="${theme.from}"/>
        <stop offset="1" stop-color="${theme.to}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 170}" fill="url(#glow)"/>
    ${motifSvg(theme.motif, theme, rand)}
    ${photo ? '' : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="0.14"/>
      <g transform="translate(${cx} ${cy})">${emblemSvg(theme.emblem, theme)}</g>`}
    <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${theme.accent}" stroke-width="14"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.6"/>
  </svg>`;

  const layers: OverlayOptions[] = [];
  if (photo) {
    const mask = Buffer.from(`<svg width="${circle}" height="${circle}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
    const round = await sharp(photo).resize(circle, circle, { fit: 'cover', position: 'centre' })
      .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: round, left: cx - r, top: circleTop });
  }

  const full = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  return width === 1080 && height === 1920 ? full : sharp(full).resize(width, height).png().toBuffer();
}

/**
 * Where the photo circle sits on a customer template (design pixels); `ring` draws our frame around it and
 * `wave` turns the waveform under the photo on or off (busy templates often look better without it).
 */
export interface PhotoBox { cx: number; cy: number; size: number; ring: boolean; wave: boolean }

export const DEFAULT_PHOTO_BOX: PhotoBox = {
  cx: 540, cy: GREETING_DESIGN.circleTop + GREETING_DESIGN.circle / 2, size: GREETING_DESIGN.circle, ring: true, wave: true,
};

/** Accepts a client-supplied box, keeping it on the canvas and within sensible sizes. */
export function clampPhotoBox(raw: any): PhotoBox {
  if (!raw || typeof raw !== 'object') return DEFAULT_PHOTO_BOX;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
  };
  const size = num(raw.size, 160, 1000, DEFAULT_PHOTO_BOX.size);
  return {
    size,
    cx: num(raw.cx, size / 2, 1080 - size / 2, DEFAULT_PHOTO_BOX.cx),
    cy: num(raw.cy, size / 2, 1920 - size / 2, DEFAULT_PHOTO_BOX.cy),
    ring: raw.ring !== false,
    wave: raw.wave !== false,
  };
}

// Centre crop, exactly like the browser preview (object-fit: cover), so the face lands where the customer saw it
async function photoCircle(photo: Buffer, circle: number = GREETING_DESIGN.circle): Promise<Buffer> {
  const r = circle / 2;
  const mask = Buffer.from(`<svg width="${circle}" height="${circle}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  return sharp(photo).resize(circle, circle, { fit: 'cover', position: 'centre' })
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function buildOnTemplate(width: number, height: number, theme: GreetingTheme, photo: Buffer | null, template: Buffer, box: PhotoBox): Promise<Buffer> {
  const { cx, cy, size } = box;
  const r = size / 2;
  const layers: OverlayOptions[] = [];
  if (photo) {
    if (box.ring) {
      const rings = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
        <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${theme.accent}" stroke-width="14"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.6"/></svg>`);
      layers.push({ input: rings, left: 0, top: 0 });
    }
    layers.push({ input: await photoCircle(photo, size), left: Math.round(cx - r), top: Math.round(cy - r) });
  }
  const base = await sharp(template).resize(1080, 1920, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const full = await sharp(base).composite(layers).png().toBuffer();
  return width === 1080 && height === 1920 ? full : sharp(full).resize(width, height).png().toBuffer();
}

const hexLuminance = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Picks a waveform colour that stands out on the template where the wave is drawn: on light designs the
 * occasion's own deep colour (softer than black, and in tune with the theme), on dark ones its bright accent.
 */
export async function waveColorFor(template: Buffer, waveTop: number, waveHeight: number, theme: GreetingTheme): Promise<string> {
  const { channels } = await sharp(template)
    .extract({ left: 108, top: Math.max(0, Math.min(1920 - waveHeight, waveTop)), width: 864, height: waveHeight })
    .stats();
  const [r, g, b] = channels.map(c => c.mean / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance <= 0.55) return theme.accent;
  // Some themes start almost black (New Year): use whichever gradient colour has some colour in it
  return hexLuminance(theme.from) > 0.08 ? theme.from : theme.to;
}

// ---------- Text style (font, headline size/colour, text positions) ----------

/** Fonts the customer can pick; each must be installed in the container (see Dockerfile). */
export const GREETING_FONTS = {
  sans: 'Noto Sans Arabic',    // modern
  kufi: 'Noto Kufi Arabic',    // bold, geometric
  naskh: 'Noto Naskh Arabic',  // classic
} as const;
export type GreetingFont = keyof typeof GREETING_FONTS;

/**
 * Customer text settings in design pixels. `titleColor` null = the occasion's colour;
 * `captionsBottom` null = automatic placement under the photo (see greetingLayout in video.ts).
 */
export interface TextStyle {
  font: GreetingFont;
  titleSize: number;
  titleColor: string | null;
  titleTop: number;
  captionSize: number;
  captionsBottom: number | null;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'sans', titleSize: 112, titleColor: null, titleTop: 140, captionSize: 60, captionsBottom: null,
};

export function clampTextStyle(raw: any): TextStyle {
  if (!raw || typeof raw !== 'object') return DEFAULT_TEXT_STYLE;
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
  };
  return {
    font: raw.font in GREETING_FONTS ? raw.font : 'sans',
    titleSize: num(raw.titleSize, 60, 170, DEFAULT_TEXT_STYLE.titleSize),
    titleColor: typeof raw.titleColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.titleColor) ? raw.titleColor : null,
    titleTop: num(raw.titleTop, 30, 1700, DEFAULT_TEXT_STYLE.titleTop),
    captionSize: num(raw.captionSize, 40, 96, DEFAULT_TEXT_STYLE.captionSize),
    captionsBottom: raw.captionsBottom == null ? null : num(raw.captionsBottom, 60, 1700, 330),
  };
}

export const isDarkColor = (hex: string) => hexLuminance(hex) < 0.45;
