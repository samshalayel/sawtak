import React, { useEffect, useRef, useState } from 'react';
import { Move, RotateCcw, Type } from 'lucide-react';

// Live 9:16 preview of a greeting with the customer's adjustments: drag the photo (on their own template),
// drag the headline and the captions up or down, pick the font, sizes and headline colour.
// Everything is in the 1080×1920 design space the server renders with (server/greeting-art.ts, server/video.ts).

export interface PhotoBox { cx: number; cy: number; size: number; ring: boolean; wave: boolean }
export const DEFAULT_PHOTO_BOX: PhotoBox = { cx: 540, cy: 850, size: 620, ring: true, wave: true };

export type GreetingFont = 'sans' | 'kufi' | 'naskh';
export interface TextStyle {
  font: GreetingFont;
  titleSize: number;
  titleColor: string | null;     // null = the occasion's colour
  titleTop: number;
  captionSize: number;
  captionsBottom: number | null; // null = automatic
}
export const DEFAULT_TEXT_STYLE: TextStyle = { font: 'sans', titleSize: 112, titleColor: null, titleTop: 140, captionSize: 60, captionsBottom: null };

const FONTS: { id: GreetingFont; label: string; family: string }[] = [
  { id: 'sans', label: 'عصري', family: 'Noto Sans Arabic' },
  { id: 'kufi', label: 'كوفي', family: 'Noto Kufi Arabic' },
  { id: 'naskh', label: 'نسخ', family: 'Noto Naskh Arabic' },
];
const fontFamily = (id: GreetingFont) => `'${FONTS.find(f => f.id === id)!.family}', sans-serif`;

const W = 1080;
const H = 1920;
const PREVIEW_W = 252;
const scale = PREVIEW_W / W;
const px = (n: number) => `${n * scale}px`;

const clampBox = (box: PhotoBox): PhotoBox => {
  const size = Math.round(Math.min(1000, Math.max(160, box.size)));
  return {
    ...box,
    size,
    cx: Math.round(Math.min(W - size / 2, Math.max(size / 2, box.cx))),
    cy: Math.round(Math.min(H - size / 2, Math.max(size / 2, box.cy))),
  };
};

// Mirrors greetingLayout() in server/video.ts
function layoutFor(box: PhotoBox, text: TextStyle, onTemplate: boolean, hasPhoto: boolean) {
  const boxHeight = Math.round(text.captionSize * 1.4 + 32);
  const fromFor = (cb: number) => (cb === 330 ? 200 : cb === 200 ? 100 : Math.max(40, cb - 130));
  if (!onTemplate || !hasPhoto) {
    const cb = text.captionsBottom ?? 330;
    return { waveTop: 1225, waveHeight: 170, captionsBottom: cb, fromBottom: fromFor(cb), boxHeight };
  }
  const waveTop = Math.round(box.cy + box.size / 2 + 30);
  const room = (cb: number) => H - cb - boxHeight - 20 - waveTop;
  const cb = text.captionsBottom ?? (room(330) < 90 ? 200 : 330);
  const space = box.wave ? Math.min(96, room(cb)) : 0;
  return { waveTop, waveHeight: space >= 50 ? space : 0, captionsBottom: cb, fromBottom: fromFor(cb), boxHeight };
}

// The preview shows the same fonts the video uses (loaded once, only when the designer is opened)
function useGreetingFonts() {
  useEffect(() => {
    if (document.getElementById('greeting-fonts')) return;
    const link = document.createElement('link');
    link.id = 'greeting-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@700&family=Noto+Kufi+Arabic:wght@700&family=Noto+Naskh+Arabic:wght@700&display=swap';
    document.head.appendChild(link);
  }, []);
}

/**
 * Brightness (0–1) of a horizontal band of the template, measured the way the server does (waveColorFor in
 * server/greeting-art.ts), so the preview picks the same colours for the wave and the sender line.
 */
function useBandLuminance(template: string | null, top: number, height: number): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (!template) return setValue(null);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 108;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // object-fit: cover, like the server's resize
      const ratio = Math.max(108 / img.width, 192 / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, (108 - w) / 2, (192 - h) / 2, w, h);
      const y = Math.max(0, Math.min(191, Math.round(top / 10)));
      const data = ctx.getImageData(11, y, 86, Math.max(1, Math.round(height / 10))).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      setValue(sum / (data.length / 4));
    };
    img.src = template;
  }, [template, Math.round(top / 20), Math.round(height / 20)]);
  return value;
}

const hexLuminance = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

type DragTarget = 'photo' | 'title' | 'captions';

interface Props {
  template: string | null;          // the customer's own design, or null for the occasion artwork
  colors: [string, string];         // occasion gradient (preview of the artwork)
  photo: string | null;
  ringColor: string;
  defaultTitleColor: string;
  title: string;
  captionSample: string;
  fromLine: string;
  box: PhotoBox;
  onBox: (box: PhotoBox) => void;
  text: TextStyle;
  onText: (text: TextStyle) => void;
}

export const GreetingDesigner: React.FC<Props> = ({
  template, colors, photo, ringColor, defaultTitleColor, title, captionSample, fromLine, box, onBox, text, onText,
}) => {
  useGreetingFonts();
  const onTemplate = Boolean(template);
  const photoMovable = onTemplate && Boolean(photo);
  // On the occasion artwork the circle is fixed (it is part of the drawing)
  const circle = photoMovable ? box : DEFAULT_PHOTO_BOX;
  const place = layoutFor(box, text, onTemplate, Boolean(photo));
  const titleColor = text.titleColor ?? defaultTitleColor;
  // Same contrast rule as the server: deep occasion colour on light parts of a template, accent on dark ones
  const waveLight = useBandLuminance(template, place.waveTop, place.waveHeight || 60);
  const fromLight = useBandLuminance(template, H - place.fromBottom - 70, 60);
  // Deep colour for light templates: the gradient start, or its end when the start is almost black (as the server)
  const deepColor = hexLuminance(colors[0]) > 0.08 ? colors[0] : colors[1];
  const waveColor = waveLight !== null && waveLight > 0.55 ? deepColor : ringColor;
  const fromColor = fromLight !== null && fromLight > 0.55 ? deepColor : ringColor;
  const drag = useRef<{ target: DragTarget; x: number; y: number; box: PhotoBox; text: TextStyle; captionsBottom: number } | null>(null);

  const start = (target: DragTarget) => (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // pointer already released: the drag still works while the pointer stays over the element
    }
    drag.current = { target, x: e.clientX, y: e.clientY, box, text, captionsBottom: place.captionsBottom };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    if (d.target === 'photo') onBox(clampBox({ ...d.box, cx: d.box.cx + dx, cy: d.box.cy + dy }));
    if (d.target === 'title') onText({ ...d.text, titleTop: Math.round(Math.min(1700, Math.max(30, d.text.titleTop + dy))) });
    if (d.target === 'captions') onText({ ...d.text, captionsBottom: Math.round(Math.min(1700, Math.max(60, d.captionsBottom - dy))) });
  };
  const end = () => { drag.current = null; };
  const dragProps = (target: DragTarget) => ({
    onPointerDown: start(target), onPointerMove: move, onPointerUp: end, onPointerCancel: end,
  });

  const swatches = [null, '#ffffff', '#1e293b', '#fbbf24', ringColor, '#db2777'].filter((c, i, a) => a.indexOf(c) === i);

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
      {/* ---------- Preview ---------- */}
      <div
        className="relative shrink-0 rounded-xl overflow-hidden shadow-lg select-none touch-none"
        style={{ width: px(W), height: px(H), background: `linear-gradient(170deg, ${colors[0]}, ${colors[1]})` }}
        dir="rtl"
      >
        {template && <img src={template} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" draggable={false} />}

        {/* Photo circle (or the occasion emblem's place) */}
        {photo ? (
          <img
            src={photo}
            alt=""
            draggable={false}
            {...(photoMovable ? dragProps('photo') : {})}
            className={`absolute rounded-full object-cover ${photoMovable ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'}`}
            style={{
              left: px(circle.cx - circle.size / 2), top: px(circle.cy - circle.size / 2), width: px(circle.size), height: px(circle.size),
              boxShadow: circle.ring || !photoMovable ? `0 0 0 ${Math.max(2, 14 * scale)}px ${ringColor}` : undefined,
            }}
          />
        ) : !onTemplate && (
          <div
            className="absolute rounded-full bg-[#ffffff]/15 pointer-events-none"
            style={{ left: px(540 - 310), top: px(850 - 310), width: px(620), height: px(620), boxShadow: `0 0 0 ${Math.max(2, 14 * scale)}px ${ringColor}` }}
          />
        )}

        {place.waveHeight > 0 && (
          <div className="absolute left-[10%] right-[10%] rounded pointer-events-none" style={{ top: px(place.waveTop), height: px(place.waveHeight), background: `${waveColor}88` }} />
        )}

        {/* Headline: drag up / down */}
        {title && (
          <div
            {...dragProps('title')}
            className="absolute left-0 right-0 text-center font-bold leading-tight cursor-ns-resize"
            style={{
              top: px(text.titleTop), paddingLeft: px(70), paddingRight: px(70), fontSize: px(text.titleSize), color: titleColor, fontFamily: fontFamily(text.font),
              textShadow: '0 1px 2px rgba(0,0,0,.45)',
            }}
          >
            {title}
          </div>
        )}

        {/* Captions: drag up / down */}
        <div
          {...dragProps('captions')}
          className="absolute left-0 right-0 flex justify-center cursor-ns-resize"
          style={{ top: px(H - place.captionsBottom - place.boxHeight) }}
        >
          <span
            className="bg-[#000000]/45 text-[#ffffff] font-bold rounded-sm"
            style={{ fontSize: px(text.captionSize), fontFamily: fontFamily(text.font), padding: `${px(12)} ${px(18)}` }}
          >
            {captionSample}
          </span>
        </div>

        {fromLine && (
          <div
            className="absolute left-0 right-0 text-center font-bold pointer-events-none"
            style={{ bottom: px(place.fromBottom), fontSize: px(50), color: fromColor, fontFamily: fontFamily(text.font), textShadow: '0 1px 2px rgba(0,0,0,.45)' }}
          >
            {fromLine}
          </div>
        )}
      </div>

      {/* ---------- Controls ---------- */}
      <div className="flex-1 w-full space-y-4 text-xs text-slate-300">
        <p className="flex items-center gap-1.5 text-slate-400 leading-relaxed">
          <Move className="w-4 h-4 shrink-0" />
          {photoMovable ? 'اسحب الصورة والعنوان والنص داخل المعاينة لتغيير أماكنها.' : 'اسحب العنوان أو النص المكتوب داخل المعاينة لتغيير مكانه.'}
        </p>

        {photoMovable && (
          <div className="space-y-2">
            <div className="font-bold text-white">الصورة</div>
            <label className="block space-y-1">
              <span>الحجم</span>
              <input type="range" min={160} max={1000} value={box.size} onChange={e => onBox(clampBox({ ...box, size: Number(e.target.value) }))} className="w-full accent-amber-500" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={box.ring} onChange={e => onBox({ ...box, ring: e.target.checked })} className="accent-amber-500" />
              <span>إطار ملوّن حول الصورة (ألغِه إذا كان قالبك يحتوي إطاراً)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={box.wave} onChange={e => onBox({ ...box, wave: e.target.checked })} className="accent-amber-500" />
              <span>إظهار الموجة الصوتية تحت الصورة</span>
            </label>
            {box.wave && place.waveHeight === 0 && (
              <p className="text-[11px] text-amber-300">لا يوجد مكان للموجة بين الصورة والنص، فسيظهر الفيديو بدونها. صغّر الصورة أو انزل بالنص.</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="font-bold text-white flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> الخط</div>
          <div className="grid grid-cols-3 gap-2">
            {FONTS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => onText({ ...text, font: f.id })}
                className={`rounded-xl border py-2 text-center transition-colors ${text.font === f.id ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}
              >
                <div className="text-lg text-white leading-snug" style={{ fontFamily: fontFamily(f.id), fontWeight: 700 }}>عيد سعيد</div>
                <div className="text-[10px] text-slate-400">{f.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-bold text-white">العنوان</div>
          <label className="block space-y-1">
            <span>الحجم</span>
            <input type="range" min={60} max={170} value={text.titleSize} onChange={e => onText({ ...text, titleSize: Number(e.target.value) })} className="w-full accent-amber-500" />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <span>اللون</span>
            {swatches.map(c => (
              <button
                key={c ?? 'auto'}
                type="button"
                onClick={() => onText({ ...text, titleColor: c })}
                title={c ? c : 'لون المناسبة'}
                className={`w-7 h-7 rounded-full border-2 ${text.titleColor === c ? 'border-amber-400 scale-110' : 'border-slate-700'} transition-transform`}
                style={{ background: c ?? `conic-gradient(${colors[0]}, ${colors[1]}, ${ringColor}, ${colors[0]})` }}
              />
            ))}
            <input
              type="color"
              value={titleColor}
              onChange={e => onText({ ...text, titleColor: e.target.value })}
              className="w-7 h-7 rounded-full bg-transparent cursor-pointer"
              title="لون آخر"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="font-bold text-white">النص المكتوب مع الصوت</div>
          <label className="block space-y-1">
            <span>الحجم</span>
            <input type="range" min={40} max={96} value={text.captionSize} onChange={e => onText({ ...text, captionSize: Number(e.target.value) })} className="w-full accent-amber-500" />
          </label>
          {text.captionsBottom !== null && (
            <button type="button" onClick={() => onText({ ...text, captionsBottom: null })} className="text-amber-400 hover:text-amber-300">
              إرجاع مكان النص للوضع التلقائي
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => { onText(DEFAULT_TEXT_STYLE); onBox(DEFAULT_PHOTO_BOX); }}
          className="flex items-center gap-1 text-amber-400 hover:text-amber-300"
        >
          <RotateCcw className="w-3.5 h-3.5" /> إرجاع كل شيء للوضع الافتراضي
        </button>
      </div>
    </div>
  );
};
