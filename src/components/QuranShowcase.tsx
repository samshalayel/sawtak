import React from 'react';
import { BookOpen, Heart, Mic2, Mountain, Sparkles } from 'lucide-react';
import { QURAN_RECITERS } from '../data/quran';

// Home-page showcase of the Quran reels service (shown when it is the main service on offer): a real reel made with
// it first (in a phone), then a few large lines and the way in.

const POINTS = [
  { icon: Mic2, text: `تلاوة أصلية لـ ${QURAN_RECITERS.length} قارئاً` },
  { icon: Mountain, text: 'مشاهد طبيعة هادئة' },
  { icon: Heart, text: 'إهداء «عن روح…» والتاريخ' },
];

export const QuranShowcase: React.FC<{ price: number }> = ({ price }) => (
  <section className="rounded-3xl border-2 border-emerald-600/70 bg-slate-900 shadow-sm overflow-hidden">
    <div className="grid md:grid-cols-[1fr_auto] gap-6 md:gap-12 p-5 sm:p-8 items-center">
      <div className="space-y-5 text-center md:text-right">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold bg-emerald-500 text-slate-950 px-3 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5" /> جديد
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">ريلز الآيات بصوت القارئ</h2>
          <p className="text-lg sm:text-xl text-slate-300 leading-relaxed">اختر الآيات والقارئ، ونجهّز لك فيديو هادئاً جاهزاً للمشاركة.</p>
        </div>
        <ul className="space-y-3 w-fit mx-auto md:mx-0">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-base sm:text-lg font-semibold text-slate-200">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><Icon className="w-5 h-5" /></span>
              {text}
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row items-center md:items-center gap-3 md:justify-start">
          <a href="#/quran" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-extrabold text-lg shadow-lg shadow-emerald-500/20 hover:brightness-105">
            <BookOpen className="w-5 h-5" /> اصنع ريلك الآن
          </a>
          <span className="text-sm text-slate-400">سعر الريل {price} نقطة</span>
        </div>
      </div>

      {/* A real reel made with the service, in a phone (first on phones, beside the text on wider screens) */}
      <figure className="order-first md:order-last mx-auto w-[230px] sm:w-[260px] space-y-3">
        <div className="relative" dir="ltr">
          <span className="absolute -left-[3px] top-[17%] w-[3px] h-6 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -left-[3px] top-[25%] w-[3px] h-11 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -left-[3px] top-[34%] w-[3px] h-11 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -right-[3px] top-[28%] w-[3px] h-16 rounded-r-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <div className="rounded-[2.7rem] p-[3px] bg-gradient-to-b from-[#e4e4e7] via-[#a1a1aa] to-[#d4d4d8] shadow-2xl">
            <div className="rounded-[2.55rem] bg-[#000000] p-[6px]">
              {/* A phone-shaped screen (19.5:9) with the 9:16 reel in the middle, as a phone plays it */}
              <div className="relative overflow-hidden rounded-[2.2rem] bg-[#000000] aspect-[9/19.5] flex items-center">
                <video src="/examples/quran-reel.mp4" poster="/examples/quran-reel.jpg" controls playsInline preload="none"
                  className="block w-full aspect-[9/16] object-cover" />
                {/* Notch (over the black band above the reel) */}
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[38%] h-[20px] bg-[#000000] rounded-b-[12px] flex items-center justify-end pr-3">
                  <span className="w-[6px] h-[6px] rounded-full bg-[#1e2638] ring-1 ring-[#334063]" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <figcaption className="text-center text-xs text-slate-500">مثال حقيقي: سورة الأعراف 8–9 بصوت الشيخ محمد جبريل</figcaption>
      </figure>
    </div>
  </section>
);
