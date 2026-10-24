// "Today" sticker for calm reels: a small flat icon, the day (or a short greeting) and the Hijri / Gregorian
// date. Icons are plain SVG so the page preview and the server render (sharp) draw exactly the same shape.

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${body}</svg>`;

export const STICKER_ICONS: { id: string; label: string; svg: string }[] = [
  {
    id: 'heart', label: 'قلب',
    svg: svg('<path d="M32 56C13 43 5 33 5 21 5 12 12 5 21 5c5 0 9 3 11 7 2-4 6-7 11-7 9 0 16 7 16 16 0 12-8 22-27 35z" fill="#ff5c7a" stroke="#fff" stroke-width="2.5"/><ellipse cx="19" cy="18" rx="5" ry="3.5" fill="#fff" opacity=".45" transform="rotate(-30 19 18)"/>'),
  },
  {
    id: 'smile', label: 'ابتسامة',
    svg: svg('<circle cx="32" cy="32" r="27" fill="#ffd34d" stroke="#fff" stroke-width="2.5"/><ellipse cx="23" cy="26" rx="3.2" ry="4.2" fill="#6b4300"/><ellipse cx="41" cy="26" rx="3.2" ry="4.2" fill="#6b4300"/><path d="M20 37q12 12 24 0" fill="none" stroke="#6b4300" stroke-width="3.6" stroke-linecap="round"/><circle cx="16" cy="36" r="4" fill="#ff8a8a" opacity=".45"/><circle cx="48" cy="36" r="4" fill="#ff8a8a" opacity=".45"/>'),
  },
  {
    id: 'sun', label: 'شمس',
    svg: svg('<g stroke="#ffc93c" stroke-width="4" stroke-linecap="round"><path d="M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M12 52l6-6M46 18l6-6"/></g><circle cx="32" cy="32" r="13" fill="#ffd34d" stroke="#fff" stroke-width="2.5"/>'),
  },
  {
    id: 'moon', label: 'قمر',
    svg: svg('<path d="M40 6a26 26 0 1 0 18 40A22 22 0 0 1 40 6z" fill="#ffe9a8" stroke="#fff" stroke-width="2.5"/><path d="M50 14l1.6 3.4 3.4 1.6-3.4 1.6L50 24l-1.6-3.4L45 19l3.4-1.6z" fill="#fff"/>'),
  },
  {
    id: 'leaf', label: 'ورقة',
    svg: svg('<path d="M10 54C8 28 24 10 56 8c0 30-16 46-46 46z" fill="#5cc98a" stroke="#fff" stroke-width="2.5"/><path d="M12 52C24 40 34 30 46 18" fill="none" stroke="#2f8a57" stroke-width="2.6" stroke-linecap="round"/>'),
  },
  {
    id: 'flower', label: 'زهرة',
    svg: svg('<g fill="#ff9cc2" stroke="#fff" stroke-width="2"><circle cx="32" cy="15" r="11"/><circle cx="48" cy="27" r="11"/><circle cx="42" cy="46" r="11"/><circle cx="22" cy="46" r="11"/><circle cx="16" cy="27" r="11"/></g><circle cx="32" cy="32" r="8" fill="#ffd34d" stroke="#fff" stroke-width="2"/>'),
  },
  {
    id: 'sparkle', label: 'لمعة',
    svg: svg('<path d="M28 6l5 17 17 5-17 5-5 17-5-17-17-5 17-5z" fill="#ffe28a" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><path d="M50 40l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z" fill="#fff"/>'),
  },
];

/** Label outline colours: white letters with a coloured edge give the "sticker" look. */
export const STICKER_THEMES: { id: string; label: string; fill: string; edge: string }[] = [
  { id: 'rose', label: 'وردي', fill: '#ffffff', edge: '#e2557f' },
  { id: 'gold', label: 'ذهبي', fill: '#fff7e0', edge: '#c08a2a' },
  { id: 'mint', label: 'أخضر', fill: '#ffffff', edge: '#2f9e72' },
  { id: 'sky', label: 'أزرق', fill: '#ffffff', edge: '#3b7fc4' },
  { id: 'plain', label: 'أبيض', fill: '#ffffff', edge: '#000000' },
];

/**
 * Sticker looks: the coloured-edge "sticker", or a large calligraphic day name (vowelled, like the Friday
 * posts on social media) over a bold numeric date. Calligraphy fonts ship in /fonts (OFL).
 */
export const STICKER_LOOKS: { id: string; label: string; font: string }[] = [
  { id: 'decor', label: 'مزخرف', font: 'Amiri' },
  { id: 'sticker', label: 'ملصق', font: 'Noto Kufi Arabic' },
  { id: 'amiri', label: 'نسخ مخطوط', font: 'Amiri' },
];

const VOWELLED: Record<string, string> = {
  'السبت': 'السَّبْت', 'الأحد': 'الأَحَد', 'الاثنين': 'الاِثْنَيْن', 'الثلاثاء': 'الثُّلَاثَاء', 'الأربعاء': 'الأَرْبِعَاء',
  'الخميس': 'الخَمِيس', 'الجمعة': 'الجُمُعَة', 'جمعة': 'جُمُعَة', 'مباركة': 'مُبَارَكَة', 'صباح': 'صَبَاح', 'مساء': 'مَسَاء',
  'الخير': 'الخَيْر', 'تصبحون': 'تُصْبِحُونَ', 'على': 'عَلَى', 'خير': 'خَيْر',
};
/** Adds the short vowels calligraphy is written with (known words only; anything else is left as typed). */
export const vowelled = (text: string) => text.split(' ').map(w => VOWELLED[w] ?? w).join(' ');

export interface CalmSticker {
  icon: string;          // STICKER_ICONS id or 'none'
  theme: string;         // STICKER_THEMES id
  look: string;          // STICKER_LOOKS id
  day?: number;          // 0-6 (Sunday first) for the ornamented day artwork
  label: string;         // e.g. "الجمعة" or "صباح الخير"
  dates: string[];       // up to two short date lines
  position: 'top' | 'bottom';
}

/** Vertical layout of the sticker block (720x1280 design pixels): icon top, label area, date lines. */
export function stickerLayout(position: 'top' | 'bottom', hasTitle: boolean, look = 'sticker', hasIcon = true) {
  if (look === 'decor') {
    // Ornamented day-name artwork (public/days) fitted in a 460x250 box, the dates under it
    const top = position === 'top' ? (hasTitle ? 210 : 100) : 740;
    const artY = top + (hasIcon ? 70 : 0);
    return { iconY: top, iconSize: 60, labelY: artY, labelSize: 0, artW: 460, artH: 250, dateY: artY + 262, dateSize: 96, dateSize2: 90, dateGap: 104 };
  }
  if (look !== 'sticker') {
    const top = position === 'top' ? (hasTitle ? 215 : 110) : 770;
    // (Amiri's tall line box: glyphs sit ~0.27-0.7 of the size below the anchor)
    return { iconY: top, iconSize: 60, labelY: top - 30, labelSize: 340, artW: 0, artH: 0, dateY: top + 226, dateSize: 96, dateSize2: 90, dateGap: 104 };
  }
  const top = position === 'top' ? (hasTitle ? 225 : 120) : 900;
  return { iconY: top, iconSize: 68, labelY: top + 74, labelSize: 72, artW: 0, artH: 0, dateY: top + 168, dateSize: 36, dateSize2: 36, dateGap: 48 };
}

/** Ornamented day-name artwork (white-on-transparent masks, coloured at render time), by Date.getDay(). */
export const DAY_ART = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(k => `/days/${k}.png`);
/** "Rose" colours the artwork with the original pink-to-orange gradient; other themes use their fill colour. */
export const DECOR_GRADIENT = ['#ff4f81', '#ff8a1a'];
