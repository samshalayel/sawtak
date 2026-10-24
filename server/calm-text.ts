// Calm-reel captions drawn as transparent PNGs with Pango (sharp's text input) and laid over the video by ffmpeg.
// libass mis-shapes many Arabic Google Fonts (letters such as ا and ر come out as empty boxes), while Pango shapes
// all of them correctly, so every customer-chosen caption font goes through here.
import sharp from 'sharp';
import { calmFont } from '../src/data/calmFonts.ts';

export interface TextPngOptions {
  font: string;      // CALM_FONTS id
  size: number;      // design pixels (the page preview uses the same em size)
  color: string;     // #rrggbb
  width: number;     // wrap width in design pixels
}

/** Same factor the page preview applies, so a size of 88 is a 53 px em on the 720 px wide frame. */
export const EM = 0.6;

const escapeMarkup = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

/**
 * Renders centred, wrapped text with a soft halo (dark, or light for dark text). Returns the PNG and its size;
 * `pad` is the transparent margin around the text block that holds the halo.
 */
export async function textPng(text: string, o: TextPngOptions) {
  const f = calmFont(o.font);
  const px = Math.max(8, Math.round(o.size * EM));
  const desc = `${f.family},Noto Sans Arabic${f.bold ? ' Bold' : ''} ${px}`;
  const draw = (color: string) => sharp({
    text: {
      text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
      font: desc, width: o.width, align: 'centre', rgba: true, dpi: 72, wrap: 'word', spacing: Math.round(px * 0.25),
    },
  }).png().toBuffer();
  const fill = await draw(o.color);
  const { width = 1, height = 1 } = await sharp(fill).metadata();
  const pad = Math.round(px * 0.35) + 6;
  const halo = await sharp(await draw(isDark(o.color) ? '#ffffff' : '#000000'))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(2, px / 12)).png().toBuffer();
  const W = width + pad * 2;
  const H = height + pad * 2;
  // The blurred copy twice for a denser halo, then the letters on top
  const png = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: halo }, { input: halo }, { input: fill, top: pad, left: pad }])
    .png().toBuffer();
  return { png, width: W, height: H, pad };
}
