import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, AudioLines, Mic2, Languages, Users, Wand2, Copy, Film, Gift, ArrowLeft, Check, Headphones, PenLine, Download, Cake, Moon, TreePine, Gem, GraduationCap, PartyPopper } from 'lucide-react';
import { VOICES } from '../data/presets';
import { CUSTOMER_PACKAGES, isOfferActive, packageBaseMinutes, packageBonusMinutes, packageTotalMinutes } from '../data/packages';

interface LandingPageProps {
  isLoggedIn: boolean;
  signupBonusCredits: number;
  onStart: () => void;        // go to the studio (or sign up)
  onOpenPackages: () => void;
}

// Candy accents rotated across cards
const ACCENTS = [
  { bg: 'bg-cyan-100', text: 'text-cyan-700', ring: 'ring-cyan-300' },
  { bg: 'bg-pink-100', text: 'text-pink-600', ring: 'ring-pink-300' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', ring: 'ring-yellow-300' },
  { bg: 'bg-violet-100', text: 'text-violet-600', ring: 'ring-violet-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  { bg: 'bg-rose-100', text: 'text-rose-600', ring: 'ring-rose-300' },
];

const FEATURES = [
  { icon: Mic2, title: 'أصوات طبيعية جداً', text: '20 مؤدياً صوتياً بالذكاء الاصطناعي، رجال ونساء وأطفال، بأداء يشبه البشر.' },
  { icon: Languages, title: 'كل اللهجات العربية', text: 'فصحى، خليجي، مصري، شامي، مغاربي، ولغات أجنبية أيضاً.' },
  { icon: Users, title: 'بودكاست بصوتين', text: 'حوار طبيعي بين شخصين بصوتين مختلفين، في ملف واحد.' },
  { icon: Wand2, title: 'اكتب الحوار عنّي', text: 'اكتب الفكرة فقط، والذكاء الاصطناعي يكتب سيناريو الحوار كاملاً.' },
  { icon: Copy, title: 'انسخ أسلوب العيّنة', text: 'أعجبتك عيّنة؟ اكتب نصك واسمعه بنفس الأداء تماماً.' },
  { icon: Film, title: 'حوّله لفيديو', text: 'فيديو جاهز لريلز وتيك توك مع موجات صوتية ونص مكتوب.' },
];

const STEPS = [
  { icon: Headphones, title: 'اختر الصوت', text: 'استمع للعيّنات واختر المؤدي الأنسب' },
  { icon: PenLine, title: 'اكتب نصك', text: 'أو اختر نموذجاً جاهزاً بضغطة' },
  { icon: Download, title: 'ولّد وحمّل', text: 'خلال ثوانٍ: ملف صوتي أو فيديو جاهز' },
];

// Featured voices for the hero / showcase (the rest are in the studio)
const SHOWCASE_IDS = ['Kore', 'Puck', 'Fenrir', 'Laomedeia', 'Despina', 'Algieba', 'Autonoe', 'Sulafat'];

export const LandingPage: React.FC<LandingPageProps> = ({ isLoggedIn, signupBonusCredits, onStart, onOpenPackages }) => {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const showcase = SHOWCASE_IDS.map(id => VOICES.find(v => v.id === id)).filter(Boolean) as typeof VOICES;
  const offer = isOfferActive();

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(`/api/tts/preview/${id}`);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(id);
  };

  const ctaLabel = isLoggedIn ? 'ادخل إلى الاستوديو' : 'ابدأ مجاناً الآن';

  return (
    <div className="space-y-24 pb-10">
      {/* ---------- Hero ---------- */}
      <section className="relative pt-6 sm:pt-12">
        <div className="blob w-72 h-72 bg-cyan-300 -top-10 -right-10" />
        <div className="blob w-64 h-64 bg-pink-300 top-40 -left-16" />
        <div className="blob w-56 h-56 bg-yellow-200 bottom-0 right-1/3" />

        <div className="relative grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-6 text-center lg:text-right">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white shadow-sm text-sm font-semibold text-cyan-700 ring-1 ring-cyan-200">
              <AudioLines className="w-4 h-4" /> استوديو الصوت العربي بالذكاء الاصطناعي
            </span>
            <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1.25] text-gray-800">
              حوّل كلماتك إلى
              <span className="block bg-gradient-to-l from-cyan-500 via-violet-500 to-pink-500 bg-clip-text text-transparent">
                أصوات تنبض بالحياة
              </span>
            </h1>
            <p className="text-lg text-gray-500 leading-relaxed max-w-xl mx-auto lg:mx-0">
              إعلانات، بودكاست، قصص أطفال، كتب صوتية وفيديوهات للسوشيال ميديا — بأصوات عربية طبيعية وبكل اللهجات، خلال ثوانٍ.
            </p>
            <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
              <button
                type="button"
                onClick={onStart}
                className="group flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-gradient-to-l from-cyan-500 to-violet-500 text-[#fff] text-lg font-bold shadow-lg shadow-cyan-500/30 hover:scale-[1.03] active:scale-[0.98] transition-transform"
              >
                {ctaLabel}
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
              <a href="#voices" className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white text-gray-700 text-lg font-bold ring-1 ring-gray-200 hover:ring-cyan-300 transition">
                <Play className="w-5 h-5 text-cyan-500 fill-current" /> استمع للأصوات
              </a>
            </div>
            {!isLoggedIn && signupBonusCredits > 0 && (
              <p className="flex items-center gap-2 justify-center lg:justify-start text-sm font-semibold text-emerald-600">
                <Gift className="w-4 h-4" /> دقيقة صوت مجانية عند التسجيل — بدون بطاقة
              </p>
            )}
          </div>

          {/* Floating voice avatars */}
          <div className="relative h-80 sm:h-96 hidden sm:block">
            {showcase.slice(0, 6).map((v, i) => {
              const spots = [
                'top-0 right-10', 'top-8 left-6', 'top-36 right-0', 'top-40 left-28', 'bottom-2 right-24', 'bottom-6 left-0',
              ];
              const accent = ACCENTS[i % ACCENTS.length];
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggle(v.id)}
                  style={{ ['--r' as any]: `${(i % 2 ? 4 : -4)}deg`, animationDelay: `${i * 0.6}s` }}
                  className={`floaty absolute ${spots[i]} flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-white shadow-xl ring-4 ${accent.ring} hover:scale-105 transition-transform`}
                >
                  <img src={v.avatar} alt={v.name} className="w-14 h-14 rounded-full object-cover" />
                  <span className="text-right">
                    <span className="block font-bold text-gray-800">{v.name}</span>
                    <span className={`block text-xs ${accent.text}`}>{v.tags[0]}</span>
                  </span>
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center ${accent.bg} ${accent.text}`}>
                    {playing === v.id ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick stats */}
        <div className="relative mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[['20', 'صوتاً عربياً'], ['5', 'لهجات عربية'], ['2', 'صوتان في حوار واحد'], ['10x', 'فيديو أسرع من الوقت الحقيقي']].map(([n, l], i) => (
            <div key={l} className={`rounded-3xl p-5 text-center ${ACCENTS[i].bg}`}>
              <div className={`text-3xl font-extrabold ${ACCENTS[i].text}`}>{n}</div>
              <div className="text-sm text-gray-600 font-semibold">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Voices ---------- */}
      <section id="voices" className="space-y-8 scroll-mt-24">
        <div className="text-center space-y-2">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800">تعرّف على المؤدّين</h2>
          <p className="text-gray-500">اضغط على أي صوت واسمع عيّنة حقيقية</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {showcase.map((v, i) => {
            const accent = ACCENTS[i % ACCENTS.length];
            const isPlaying = playing === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggle(v.id)}
                className={`group rounded-3xl bg-white p-5 text-center shadow-md hover:shadow-xl hover:-translate-y-1 transition-all ring-2 ${isPlaying ? accent.ring : 'ring-transparent'}`}
              >
                <div className="relative w-24 h-24 mx-auto">
                  <img src={v.avatar} alt={v.name} className={`w-24 h-24 rounded-full object-cover ring-4 ${accent.ring}`} />
                  <span className={`absolute -bottom-1 -left-1 w-10 h-10 rounded-full flex items-center justify-center shadow-md ${isPlaying ? 'bg-pink-500 text-[#fff]' : 'bg-cyan-500 text-[#fff]'} group-hover:scale-110 transition-transform`}>
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </span>
                </div>
                <div className="mt-3 text-lg font-extrabold text-gray-800">{v.name}</div>
                <div className={`mt-1 inline-block px-3 py-0.5 rounded-full text-xs font-semibold ${accent.bg} ${accent.text}`}>
                  {v.tags.slice(0, 2).join(' · ')}
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-center">
          <button type="button" onClick={onStart} className="px-6 py-3 rounded-2xl bg-white ring-1 ring-cyan-200 text-cyan-700 font-bold hover:bg-cyan-50 transition">
            اكتشف كل الأصوات الـ20 في الاستوديو ←
          </button>
        </div>
      </section>

      {/* ---------- Voice greetings (seasonal) ---------- */}
      <section className="relative overflow-hidden rounded-[2.5rem] p-8 sm:p-12 text-[#fff] shadow-xl" style={{ background: 'linear-gradient(120deg, #7c3aed, #db2777 55%, #f97316)' }}>
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
          <div className="space-y-4 text-center lg:text-right">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ffffff]/20 text-sm font-bold">
              <PartyPopper className="w-4 h-4" /> جديد
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold leading-snug">هنّئ أحبابك بالصوت والفيديو</h2>
            <p className="text-[#ffffff]/90 leading-relaxed">
              عيد ميلاد، رمضان والأعياد، الميلاد ورأس السنة، زواج، تخرّج… اكتب الاسم واختر الصوت، حتى صوت طفل،
              ونصنع لك فيديو تهنئة جاهزاً للواتساب خلال دقيقة. أو ارفع قالبك الخاص.
            </p>
            <a href="#/greetings" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-[#ffffff] text-pink-600 text-lg font-extrabold shadow-lg hover:scale-[1.03] transition-transform">
              اصنع تهنئتك الآن <ArrowLeft className="w-5 h-5" />
            </a>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
            {[Cake, Moon, TreePine, Gem, GraduationCap, Gift].map((Icon, i) => (
              <div key={i} className="floaty aspect-square rounded-3xl bg-[#ffffff]/20 flex items-center justify-center" style={{ animationDelay: `${i * 0.4}s` }}>
                <Icon className="w-9 h-9" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="space-y-8">
        <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-gray-800">كل ما تحتاجه في مكان واحد</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <div key={f.title} className="rounded-3xl bg-white p-6 shadow-md hover:shadow-lg transition-shadow">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${accent.bg} ${accent.text}`}>
                  <Icon className="w-7 h-7" />
                </div>
                <h3 className="mt-4 text-xl font-extrabold text-gray-800">{f.title}</h3>
                <p className="mt-1 text-gray-500 leading-relaxed">{f.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="rounded-[2.5rem] bg-gradient-to-l from-cyan-500 to-violet-500 p-8 sm:p-12 text-[#fff] space-y-8">
        <h2 className="text-center text-3xl sm:text-4xl font-extrabold">ثلاث خطوات فقط</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-3xl bg-[#ffffff26] backdrop-blur p-6 text-center">
              <div className="relative mx-auto w-20 h-20 rounded-full bg-[#ffffff] text-cyan-600 flex items-center justify-center shadow-lg">
                <s.icon className="w-9 h-9" strokeWidth={2.2} />
                <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-yellow-300 text-gray-800 text-sm font-extrabold flex items-center justify-center ring-4 ring-[#ffffff33]">
                  {i + 1}
                </span>
              </div>
              <div className="mt-4 text-2xl font-extrabold">{s.title}</div>
              <p className="mt-1 opacity-90">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-800">باقات تناسب الجميع</h2>
          {offer && (
            <p className="inline-flex items-center gap-2 font-semibold text-pink-600">
              <Gift className="w-5 h-5" /> عرض الإطلاق: دقائق مجانية إضافية حتى نهاية السنة
            </p>
          )}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CUSTOMER_PACKAGES.map((p, i) => {
            const bonus = packageBonusMinutes(p);
            return (
              <div
                key={p.id}
                className={`relative rounded-3xl p-6 text-center ${p.popular ? 'bg-gradient-to-b from-cyan-500 to-violet-500 text-[#fff] shadow-xl scale-[1.03]' : 'bg-white shadow-md'}`}
              >
                {p.popular && (
                  <span className="absolute -top-3 right-1/2 translate-x-1/2 px-3 py-1 rounded-full bg-yellow-300 text-gray-800 text-xs font-extrabold">
                    الأكثر طلباً
                  </span>
                )}
                <div className={`text-4xl font-extrabold ${p.popular ? '' : 'text-gray-800'}`}>₪{p.priceIls}</div>
                <div className={`mt-1 text-lg font-bold ${p.popular ? 'opacity-95' : 'text-gray-600'}`}>{packageBaseMinutes(p)} دقيقة</div>
                {bonus > 0 && (
                  <div className={`mt-2 inline-block px-3 py-1 rounded-full text-sm font-bold ${p.popular ? 'bg-[#ffffff33]' : 'bg-emerald-100 text-emerald-700'}`}>
                    +{bonus} دقيقة هدية
                  </div>
                )}
                <ul className={`mt-4 space-y-1.5 text-sm text-right ${p.popular ? 'opacity-95' : 'text-gray-500'}`}>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> المجموع {packageTotalMinutes(p)} دقيقة</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> كل الأصوات واللهجات</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 shrink-0" /> حوار بصوتين وفيديو</li>
                </ul>
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <button type="button" onClick={onOpenPackages} className="px-6 py-3 rounded-2xl bg-white ring-1 ring-cyan-200 text-cyan-700 font-bold hover:bg-cyan-50 transition">
            اطلب باقتك ←
          </button>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="relative overflow-hidden rounded-[2.5rem] bg-white p-10 sm:p-14 text-center shadow-lg">
        <div className="blob w-60 h-60 bg-pink-200 -top-16 -left-10" />
        <div className="blob w-60 h-60 bg-cyan-200 -bottom-16 -right-10" />
        <div className="relative space-y-4">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-gray-800">جاهز تسمع صوتك؟</h2>
          <p className="text-lg text-gray-500">جرّب الآن مجاناً، وأول دقيقة علينا.</p>
          <button
            type="button"
            onClick={onStart}
            className="mx-auto flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-l from-cyan-500 to-violet-500 text-[#fff] text-xl font-extrabold shadow-lg shadow-cyan-500/30 hover:scale-[1.03] transition-transform"
          >
            {ctaLabel} <ArrowLeft className="w-6 h-6" />
          </button>
        </div>
      </section>
    </div>
  );
};
