import React, { useEffect, useState } from 'react';
import { Download, Gift, Leaf, Mic, Newspaper, PartyPopper, Share, X } from 'lucide-react';

// Phone-only app chrome: a bottom tab bar like native apps, and an "install the app" suggestion
// (Android: the browser's install prompt; iPhone: how to add it to the home screen).
// Hidden from the small breakpoint up, so computers and tablets keep the regular website layout.

interface Props {
  view: string;
  studioHash: string;       // '#/' on the classic site, '#/studio' on the redesign
  onPackages: () => void;
}

const DISMISS_KEY = 'sawtik_install_dismissed';
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

export const MobileAppNav: React.FC<Props> = ({ view, studioHash, onPackages }) => {
  const [deferred, setDeferred] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    let dismissedAt = 0;
    try { dismissedAt = Number(localStorage.getItem(DISMISS_KEY)) || 0; } catch { /* storage off */ }
    const recentlyDismissed = Date.now() - dismissedAt < DISMISS_DAYS * 86_400_000;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      if (!recentlyDismissed) setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    // iPhone has no install prompt: suggest the manual way (Safari only)
    if (isIos() && !recentlyDismissed && /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS/i.test(navigator.userAgent)) {
      setShowInstall(true);
    }
    const onInstalled = () => setShowInstall(false);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setShowInstall(false);
    setIosHelp(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage off */ }
  };

  const install = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      setDeferred(null);
      setShowInstall(false);
    } else if (isIos()) {
      setIosHelp(true);
    }
  };

  const tabs = [
    { id: 'studio', label: 'الاستوديو', icon: Mic, href: studioHash, active: view === 'studio' || view === 'home' },
    { id: 'greetings', label: 'التهاني', icon: PartyPopper, href: '#/greetings', active: view === 'greetings' },
    { id: 'press', label: 'الصحفيين', icon: Newspaper, href: '#/press', active: view === 'press' },
    { id: 'calm', label: 'السكينة', icon: Leaf, href: '#/calm', active: view === 'calm' },
  ];

  return (
    <div className="sm:hidden">
      {/* Keeps page content clear of the fixed bar */}
      <div style={{ height: 'calc(68px + env(safe-area-inset-bottom))' }} />

      {showInstall && (
        <div className="fixed inset-x-3 z-40 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-3 flex items-center gap-3"
          style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}>
          <img src="/icons/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">ثبّت تطبيق صوتك الذكي</div>
            <div className="text-[11px] text-slate-400">يفتح بملء الشاشة مثل أي تطبيق، بدون متجر</div>
          </div>
          <button type="button" onClick={install} className="px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold flex items-center gap-1">
            <Download className="w-3.5 h-3.5" /> تثبيت
          </button>
          <button type="button" onClick={dismiss} className="text-slate-500 p-1" aria-label="إغلاق"><X className="w-4 h-4" /></button>
        </div>
      )}

      {iosHelp && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end" onClick={() => setIosHelp(false)}>
          <div className="w-full rounded-t-3xl bg-slate-900 border-t border-slate-700 p-5 space-y-3 text-right" onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="text-base font-bold text-white">إضافة التطبيق إلى الشاشة الرئيسية</div>
            <ol className="space-y-2 text-sm text-slate-300 list-decimal pr-5">
              <li className="flex items-center gap-1.5 flex-wrap">اضغط زر المشاركة <Share className="w-4 h-4 text-sky-400 inline" /> أسفل Safari</li>
              <li>اختر «إضافة إلى الشاشة الرئيسية»</li>
              <li>اضغط «إضافة»، وسيظهر التطبيق بين تطبيقاتك</li>
            </ol>
            <button type="button" onClick={dismiss} className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-200 text-sm">فهمت</button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800 grid grid-cols-5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(t => (
          <a key={t.id} href={t.href} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${t.active ? 'text-amber-400' : 'text-slate-400'}`}>
            <t.icon className="w-5 h-5" />
            {t.label}
          </a>
        ))}
        <button type="button" onClick={onPackages} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-slate-400">
          <Gift className="w-5 h-5" />
          الباقات
        </button>
      </nav>
    </div>
  );
};
