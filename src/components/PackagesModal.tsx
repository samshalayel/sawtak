import React from 'react';
import { X, Gift, Sparkles, Timer, Smartphone } from 'lucide-react';
import {
  PACKAGES,
  OFFER_ENDS_AT,
  isOfferActive,
  offerDaysLeft,
  packageBonusPoints,
  packageTotalPoints,
  packageLabel,
  CreditPackage,
} from '../data/packages';
import { AuthUser } from '../types/auth';

interface PackagesModalProps {
  user: AuthUser | null;
  onClose: () => void;
  onLoginRequired: () => void;
  onPurchaseSuccess?: () => void;
}

export const PackagesModal: React.FC<PackagesModalProps> = ({ user, onClose, onLoginRequired, onPurchaseSuccess }) => {
  const offerActive = isOfferActive();
  const daysLeft = offerDaysLeft();
  const basePerPoint = PACKAGES[0].priceIls / PACKAGES[0].points;
  const needsVerification = Boolean(user) && !user!.emailVerified;

  const [payingPkg, setPayingPkg] = React.useState<CreditPackage | null>(null);

  const handleOrder = (pkg: CreditPackage) => {
    if (!user) {
      onLoginRequired();
      return;
    }
    if (needsVerification) return;
    setPayingPkg(pkg);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl relative text-right max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
          aria-label="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="font-bold text-white text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-400" />
          باقات النقاط
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          كل دقيقة صوت = 10 نقاط · فيديو ريلز = 100–500 نقطة · بطاقة تهنئة = 25 نقطة
        </p>

        {offerActive && (
          <div className="mt-4 flex items-center justify-between flex-wrap gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5">
            <span className="flex items-center gap-2 text-emerald-300 text-sm font-semibold">
              <Gift className="w-4 h-4" />
              عرض الإطلاق: نقاط مجانية إضافية مع الباقات!
            </span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-200/80">
              <Timer className="w-3.5 h-3.5" />
              ينتهي {OFFER_ENDS_AT.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}باقي {daysLeft} يوم
            </span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PACKAGES.map((pkg) => {
            const bonus = packageBonusPoints(pkg);
            const total = packageTotalPoints(pkg);
            const perPoint = pkg.priceIls / total;
            const savingPct = Math.round((1 - perPoint / basePerPoint) * 100);

            return (
              <div
                key={pkg.id}
                className={`relative flex flex-col rounded-2xl border p-4 ${
                  pkg.popular
                    ? 'bg-gradient-to-b from-amber-500/10 to-slate-950 border-amber-500/70 ring-1 ring-amber-500/30'
                    : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-2.5 right-4 bg-amber-500 text-slate-950 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    الأكثر طلباً
                  </span>
                )}

                <div className="text-2xl font-extrabold text-white">
                  {pkg.points.toLocaleString('en-US')} <span className="text-sm font-semibold text-slate-400">نقطة</span>
                </div>

                {bonus > 0 ? (
                  <div className="mt-1.5 inline-flex items-center gap-1 self-start bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold px-2 py-1 rounded-lg">
                    <Gift className="w-3.5 h-3.5" />+{bonus.toLocaleString('en-US')} نقطة مجاناً
                  </div>
                ) : (
                  <div className="mt-1.5 h-[26px]" />
                )}

                <div className="mt-3 text-[11px] text-slate-400 space-y-0.5">
                  <div>المجموع: <b className="text-slate-200">{total.toLocaleString('en-US')} نقطة</b></div>
                  <div>≈ {Math.round(total / 10)} دقيقة صوت</div>
                  <div>
                    ₪{(pkg.priceIls / total * 100).toFixed(1)} لكل 100 نقطة
                    {savingPct > 0 && <span className="text-emerald-300 font-semibold"> · وفّر {savingPct}%</span>}
                  </div>
                </div>

                <div className="mt-auto pt-4">
                  <div className="text-3xl font-extrabold text-amber-300 mb-3">₪{pkg.priceIls}</div>
                  <button
                    type="button"
                    onClick={() => handleOrder(pkg)}
                    disabled={needsVerification}
                    className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      pkg.popular
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : 'bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-600'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    {needsVerification ? 'أكّد بريدك أولاً' : user ? 'ادفع بجوال باي' : 'سجّل لتطلب الباقة'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className={`mt-4 leading-relaxed ${needsVerification ? 'text-xs font-semibold text-rose-300' : 'text-[11px] text-slate-500'}`}>
          {needsVerification
            ? 'لطلب باقة، أكّد بريدك الإلكتروني أولاً من الرابط الذي أرسلناه إليك.'
            : 'بعد الدفع تُضاف النقاط لحسابك فوراً. تُخصم النقاط حسب نوع الخدمة.'}
        </p>
      </div>

      {payingPkg && (
        <JawwalPayModalLazy
          pkg={payingPkg}
          user={user!}
          onClose={() => setPayingPkg(null)}
          onSuccess={() => {
            setPayingPkg(null);
            onPurchaseSuccess?.();
            onClose();
          }}
        />
      )}
    </div>
  );
};

// Lazy-load the Jawwal modal so it doesn't bloat the initial bundle
const JawwalPayModalLazy = React.lazy(() =>
  import('./JawwalPayModal').then((m) => ({ default: m.JawwalPayModal }))
);
