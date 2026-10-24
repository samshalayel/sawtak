import React, { useState } from 'react';
import { X, Smartphone, Lock, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { CreditPackage, packageLabel, packageTotalMinutes, packageBonusMinutes, isOfferActive } from '../data/packages';
import { api } from './adminShared';

interface Props {
  pkg: CreditPackage;
  userEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'invoice' | 'otp' | 'done';

export const JawwalPayModal: React.FC<Props> = ({ pkg, userEmail, onClose, onSuccess }) => {
  const [step, setStep] = useState<Step>('invoice');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);

  const total = packageTotalMinutes(pkg);
  const bonus = packageBonusMinutes(pkg);
  const offerActive = isOfferActive();

  const formatPhone = (raw: string) => {
    // Normalize to 00970XXXXXXXXX
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00970')) return digits;
    if (digits.startsWith('970')) return '00' + digits;
    if (digits.startsWith('0')) return '00970' + digits.slice(1);
    return '00970' + digits;
  };

  const sendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const formatted = formatPhone(phone);
      await api('/api/jawwal/otp', {
        method: 'POST',
        body: JSON.stringify({ phone: formatted, packageId: pkg.id }),
      });
      setStep('otp');
    } catch (e: any) {
      setError(e.message || 'تعذّر إرسال الرمز، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const confirmPay = async () => {
    setError(null);
    setLoading(true);
    try {
      const formatted = formatPhone(phone);
      const res = await api<{ txId: string }>('/api/jawwal/pay', {
        method: 'POST',
        body: JSON.stringify({ phone: formatted, otp, packageId: pkg.id }),
      });
      setTxId(res.txId);
      setStep('done');
      setTimeout(onSuccess, 2500);
    } catch (e: any) {
      setError(e.message || 'الدفع لم يتم، تحقق من الرمز وأعد المحاولة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={step !== 'done' ? onClose : undefined}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl relative text-right"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800">
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">
              {step === 'invoice' ? 'تفاصيل الفاتورة' : step === 'otp' ? 'أدخل رمز التأكيد' : 'تمّت العملية ✓'}
            </span>
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center">
              <span className="text-base">📱</span>
            </div>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2 py-3 px-5">
          {(['invoice', 'otp', 'done'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s ? 'bg-green-500 text-white' :
                ['invoice','otp','done'].indexOf(step) > i ? 'bg-green-500/30 text-green-300' :
                'bg-slate-800 text-slate-500'
              }`}>{i + 1}</div>
              {i < 2 && <div className={`w-8 h-px ${['invoice','otp','done'].indexOf(step) > i ? 'bg-green-500/50' : 'bg-slate-700'}`} />}
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 space-y-4">

          {/* ── STEP 1: INVOICE ── */}
          {step === 'invoice' && (
            <>
              {/* Invoice card */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-white">{pkg.minutes} دقيقة صوت</span>
                  <span className="text-slate-400">الباقة</span>
                </div>
                {offerActive && bonus > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold text-emerald-400">+{bonus} دقيقة مجاناً 🎁</span>
                    <span className="text-slate-400">عرض الإطلاق</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-200">{total} دقيقة</span>
                  <span className="text-slate-400">المجموع</span>
                </div>
                <div className="border-t border-slate-800 pt-2.5 flex justify-between">
                  <span className="text-xl font-extrabold text-amber-300">₪{pkg.priceIls}</span>
                  <span className="text-slate-400 text-sm self-end">المبلغ المستحق</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{userEmail}</span>
                  <span>الحساب</span>
                </div>
              </div>

              {/* Phone input */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block text-right">رقم موبايل جوال باي</label>
                <div className="relative">
                  <Smartphone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="05X XXX XXXX"
                    dir="ltr"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-9 pl-3 py-2.5 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-green-500 text-left"
                  />
                </div>
                <p className="text-[11px] text-slate-500">سيصلك رمز تأكيد على هذا الرقم</p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}

              <button
                type="button"
                onClick={sendOtp}
                disabled={loading || phone.replace(/\D/g, '').length < 9}
                className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                {loading ? 'جاري الإرسال…' : 'أرسل رمز التأكيد'}
              </button>
            </>
          )}

          {/* ── STEP 2: OTP ── */}
          {step === 'otp' && (
            <>
              <div className="text-center space-y-1 py-2">
                <p className="text-sm text-slate-300">أرسلنا رمزاً إلى</p>
                <p className="text-base font-bold text-white dir-ltr">{phone}</p>
                <p className="text-xs text-slate-500">أدخل الرمز المكوّن من 6 أرقام</p>
              </div>

              <div className="space-y-1.5">
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="• • • • • •"
                    dir="ltr"
                    maxLength={6}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-9 pl-3 py-3 text-slate-100 text-xl tracking-widest font-mono placeholder:text-slate-700 focus:outline-none focus:border-green-500 text-center"
                  />
                </div>
              </div>

              {/* Invoice summary */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 flex justify-between items-center">
                <span className="text-xl font-extrabold text-amber-300">₪{pkg.priceIls}</span>
                <span className="text-sm text-slate-300">{total} دقيقة صوت</span>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}

              <button
                type="button"
                onClick={confirmPay}
                disabled={loading || otp.length < 4}
                className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {loading ? 'جاري التأكيد…' : 'أتمّ الدفع'}
              </button>

              <button type="button" onClick={() => { setStep('invoice'); setError(null); }} className="w-full text-xs text-slate-500 hover:text-slate-300 py-1">
                ← تغيير رقم الموبايل
              </button>
            </>
          )}

          {/* ── STEP 3: DONE ── */}
          {step === 'done' && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle className="w-14 h-14 text-green-400 mx-auto" />
              <p className="text-lg font-bold text-white">تمّت العملية بنجاح!</p>
              <p className="text-sm text-slate-400">تمّت إضافة <b className="text-white">{total} دقيقة</b> إلى رصيدك.</p>
              {txId && <p className="text-xs text-slate-600 font-mono">#{txId}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
