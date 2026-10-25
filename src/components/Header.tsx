import React, { useState } from 'react';
import {
  Mic,
  Volume2,
  HelpCircle,
  X,
  Check,
  Clock,
  LogIn,
  LogOut,
  Shield,
  ArrowRight,
  Package,
  Sun,
  Moon, Clapperboard, Eye, EyeOff } from 'lucide-react';
import { AuthUser, formatCredits } from '../types/auth';
import { isOfferActive } from '../data/packages';
import { getTheme, setTheme, Theme } from '../utils/theme';

interface HeaderProps {
  onReset: () => void;
  user: AuthUser | null;
  onLoginClick: () => void;
  onLogout: () => void;
  onPackagesClick: () => void;
  view: 'studio' | 'admin' | 'motion';
  /** False when the motion service is stopped (the link is hidden). */
  motionOn?: boolean;
  /** Admins only: browse the site as a customer sees it (stopped services hidden). */
  viewAsCustomer?: boolean;
  onToggleViewAsCustomer?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onReset,
  user,
  onLoginClick,
  onLogout,
  onPackagesClick,
  view,
  motionOn = true,
  viewAsCustomer = false,
  onToggleViewAsCustomer,
}) => {
  const offerActive = isOfferActive();
  const [showGuide, setShowGuide] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <>
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 font-bold">
              <Mic className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>صوتك الذكي</span>
                  <span className="hidden sm:inline text-xs font-normal text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">استوديو AI</span>
                </h1>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                توليد أصوات طبيعية فائقة الجودة بمختلف اللغات واللهجات مع تحكم دقيق بالنبرة والإيقاع
              </p>
            </div>
          </div>

          {/* Account & Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Packages / pricing */}
            <button
              type="button"
              onClick={onPackagesClick}
              className="relative hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              <Package className="w-3.5 h-3.5" />
              <span>الباقات</span>
              {offerActive && (
                <span className="absolute -top-2 -left-2 bg-emerald-500 text-slate-950 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">
                  هدية
                </span>
              )}
            </button>

            {user ? (
              <>
                {/* Credit balance (1 credit = 1 second of audio) */}
                <div
                  className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold border whitespace-nowrap ${
                    user.credits > 0
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  }`}
                  title="رصيدك المتبقي من الصوت"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatCredits(user.credits)}</span>
                </div>

                {user.role !== 'admin' && motionOn && user.permissions?.includes('motion') && (
                  <a
                    href={view === 'motion' ? '#/' : '#/motion'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
                  >
                    {view === 'motion' ? <ArrowRight className="w-3.5 h-3.5" /> : <Clapperboard className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{view === 'motion' ? 'الاستوديو' : 'موشن جرافيك'}</span>
                  </a>
                )}

                {user.role === 'admin' && onToggleViewAsCustomer && (
                  <button
                    type="button"
                    onClick={onToggleViewAsCustomer}
                    title={viewAsCustomer ? 'رجوع لعرض الأدمن' : 'شاهد الموقع كما يراه الزبون (الخدمات الموقفة مخفية)'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      viewAsCustomer ? 'border-sky-500/60 bg-sky-500/10 text-sky-300' : 'border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    {viewAsCustomer ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{viewAsCustomer ? 'إنهاء عرض الزبون' : 'عرض كزبون'}</span>
                  </button>
                )}

                {user.role === 'admin' && (
                  <a
                    href={view === 'admin' ? '#/' : '#/admin'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
                  >
                    {view === 'admin' ? <ArrowRight className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{view === 'admin' ? 'الاستوديو' : 'لوحة الإدارة'}</span>
                  </a>
                )}

                <span className="text-xs text-slate-400 hidden md:inline max-w-[160px] truncate" title={user.email}>
                  {user.name || user.email}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-2 text-slate-400 hover:text-rose-300 hover:bg-slate-900 rounded-lg border border-slate-800/80 transition-colors"
                  title="تسجيل الخروج"
                  aria-label="تسجيل الخروج"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onLoginClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="sm:hidden whitespace-nowrap">دخول</span>
                <span className="hidden sm:inline">تسجيل الدخول</span>
              </button>
            )}

            {/* Quick Guide Button */}
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="hidden sm:block p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-900 rounded-lg border border-slate-800/80 transition-colors"
              title="دليل الاستخدام وميزات الاستوديو"
              aria-label="دليل الاستخدام"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Guide Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative text-right">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">دليل استخدام استوديو الصوت الذكي</h3>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs sm:text-sm text-slate-300 leading-relaxed max-h-[70vh] overflow-y-auto pl-2">
              <div className="space-y-1">
                <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  أصوات بشرية واقعية متعددة
                </h4>
                <p className="text-slate-400 text-xs mr-5">
                  اختر من بين 5 أصوات استوديو مدروسة بعناية (كوري، باك، فنرير، زفير، شارون) لتناسب مختلف أغراض المحتوى.
                </p>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  دعم اللهجات العربية واللغات العالمية
                </h4>
                <p className="text-slate-400 text-xs mr-5">
                  يدعم الفصحى، الخليجية، المصرية، الشامية، والمغاربية، بالإضافة للإنجليزية، الفرنسية، الإسبانية، الألمانية والتركية.
                </p>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  أداة التشكيل التلقائي الذكية (Tashkeel)
                </h4>
                <p className="text-slate-400 text-xs mr-5">
                  استخدم زر &quot;تشكيل النص&quot; لضبط حركات الإعراب بدقة لغوية تامة قبل التوليد، لضمان مخارج حروف فصيحة لا تشوبها شائبة.
                </p>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  تحكم دقيق بالسرعة والنبرة
                </h4>
                <p className="text-slate-400 text-xs mr-5">
                  تحكم بسرعة الإلقاء (بطيء، طبيعي، سريع) ودرجة النبرة (رخيم، متوازن، حاد)، مع إمكانية كتابة توجيه مخصص لأداء الممثل الصوتي.
                </p>
              </div>

              <div className="space-y-1">
                <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  تصدير ملفات WAV عالية الجودة
                </h4>
                <p className="text-slate-400 text-xs mr-5">
                  تحميل مباشر للمقطع الصوتي بصيغة WAV نقية بتردد 24kHz جاهزة للاستخدام في المونتاج والبودكاست والوسائط.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowGuide(false)}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
              >
                فهمت، لنبدأ الآن
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
