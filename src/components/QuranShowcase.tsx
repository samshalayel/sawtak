import React from 'react';
import { BookOpen, Heart, Mountain, Mic2, Share2, Sparkles } from 'lucide-react';
import { QURAN_RECITERS } from '../data/quran';

// Home-page showcase of the Quran reels service (shown when it is the main service on offer): what it does, a real
// reel made with it, and the way in.

const POINTS = [
  { icon: BookOpen, text: 'اختر آيات كاملة حسب الموضوع أو من أي سورة' },
  { icon: Mic2, text: `بتلاوة أصلية لـ ${QURAN_RECITERS.length} قارئاً، بلا أي تعديل على الصوت` },
  { icon: Mountain, text: 'فوق مشاهد طبيعة حقيقية وهادئة، تختار منها حتى ثلاثة' },
  { icon: Heart, text: 'إهداء ثابت مثل «عن روح المرحوم…»، واسم القارئ والتاريخ' },
  { icon: Share2, text: 'فيديو عمودي جاهز للواتساب والستوري والريلز' },
];

export const QuranShowcase: React.FC<{ price: number }> = ({ price }) => (
  <section className="rounded-3xl border-2 border-emerald-600/70 bg-slate-900 shadow-sm overflow-hidden">
    <div className="grid md:grid-cols-[1fr_auto] gap-6 md:gap-10 p-5 sm:p-8 items-center">
      <div className="space-y-5">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold bg-emerald-500 text-slate-950 px-2.5 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5" /> جديد
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-snug">ريلز الآيات بصوت القارئ</h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            اصنع فيديو قرآني هادئ خلال دقائق: آيات تختارها، بصوت قارئك المفضّل، فوق مشاهد طبيعة تريح القلب.
          </p>
        </div>
        <ul className="space-y-2.5">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-slate-200">
              <span className="w-8 h-8 shrink-0 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><Icon className="w-4 h-4" /></span>
              {text}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <a href="#/quran" className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-emerald-500/20 hover:brightness-105">
            <BookOpen className="w-4 h-4" /> اصنع ريلك الآن
          </a>
          <span className="text-xs text-slate-400">سعر الريل {price} نقطة</span>
        </div>
      </div>

      {/* A real reel made with the service, in a phone: silver edge, black bezel, notch and side buttons */}
      <figure className="mx-auto w-[230px] sm:w-[260px] space-y-3">
        <div className="relative" dir="ltr">
          <span className="absolute -left-[3px] top-[17%] w-[3px] h-6 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -left-[3px] top-[25%] w-[3px] h-11 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -left-[3px] top-[34%] w-[3px] h-11 rounded-l-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <span className="absolute -right-[3px] top-[28%] w-[3px] h-16 rounded-r-sm bg-gradient-to-b from-[#d4d4d8] to-[#a1a1aa]" />
          <div className="rounded-[2.7rem] p-[3px] bg-gradient-to-b from-[#e4e4e7] via-[#a1a1aa] to-[#d4d4d8] shadow-2xl">
            <div className="rounded-[2.55rem] bg-[#000000] p-[10px]">
              <div className="relative overflow-hidden rounded-[2rem] bg-[#000000]">
                <video src="/examples/quran-reel.mp4" poster="/examples/quran-reel.jpg" controls playsInline preload="none"
                  className="block w-full aspect-[9/16] object-cover" />
                {/* Notch (small enough to leave the reciter's name at the top visible) */}
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[38%] h-[15px] bg-[#000000] rounded-b-[10px] flex items-center justify-end pr-3">
                  <span className="w-[6px] h-[6px] rounded-full bg-[#1e2638] ring-1 ring-[#334063]" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <figcaption className="text-center text-[11px] text-slate-500">مثال حقيقي: سورة الأعراف 8–9 بصوت الشيخ محمد جبريل</figcaption>
      </figure>
    </div>
  </section>
);
