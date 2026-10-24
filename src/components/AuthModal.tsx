import React, { useState } from 'react';
import { X, Loader2, LogIn, UserPlus, Gift, MailCheck } from 'lucide-react';
import { AuthUser, formatCredits } from '../types/auth';

interface AuthModalProps {
  initialMode?: 'login' | 'register';
  signupBonusCredits: number;
  googleEnabled: boolean;
  reason?: string;
  onClose: () => void;
  onAuthenticated: (user: AuthUser, mode: 'login' | 'register') => void;
}

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

export const AuthModal: React.FC<AuthModalProps> = ({
  initialMode = 'register',
  signupBonusCredits,
  googleEnabled,
  reason,
  onClose,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ email: string; delivered: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuggestion(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { name, email, password, acceptTerms } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.suggestion) setSuggestion(data.suggestion);
        throw new Error(data.error);
      }
      if (mode === 'register' && !data.user.emailVerified) {
        setSentTo({ email: data.user.email, delivered: data.verificationSent !== false });
      }
      onAuthenticated(data.user, mode);
    } catch (err: any) {
      setError(err instanceof TypeError || !err?.message
        ? 'تعذّر إتمام الطلب حالياً، يرجى المحاولة لاحقاً. شكراً لتفهمكم.'
        : err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-right"
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

        {sentTo ? (
          // Post-signup: ask the user to confirm their inbox
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto">
              <MailCheck className="w-7 h-7 text-emerald-300" />
            </div>
            <h3 className="font-bold text-white text-lg mt-4">تحقق من بريدك الإلكتروني</h3>
            {sentTo.delivered ? (
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                أرسلنا رابط تأكيد إلى
                <br />
                <b className="text-amber-300" dir="ltr">{sentTo.email}</b>
                <br />
                اضغط الرابط لتفعيل حسابك
                {signupBonusCredits > 0 && <> والحصول على <b className="text-emerald-300">{formatCredits(signupBonusCredits)} مجاناً</b></>}.
              </p>
            ) : (
              <p className="text-sm text-rose-300 mt-2 leading-relaxed">
                تم إنشاء حسابك، لكن تعذّر إرسال رسالة التأكيد الآن. يمكنك إعادة الإرسال من الشريط أعلى الصفحة.
              </p>
            )}
            <p className="text-xs text-slate-500 mt-3">لم تصلك الرسالة؟ تفقد مجلد الرسائل غير المرغوب فيها (Spam).</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm"
            >
              حسناً
            </button>
          </div>
        ) : (
          <>
            <h3 className="font-bold text-white text-lg">
              {mode === 'register' ? 'أنشئ حسابك' : 'تسجيل الدخول'}
            </h3>
            {reason && <p className="text-xs text-slate-400 mt-1">{reason}</p>}

            {mode === 'register' && signupBonusCredits > 0 && (
              <div className="mt-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl px-3 py-2 text-xs">
                <Gift className="w-4 h-4 shrink-0" />
                <span>احصل على {formatCredits(signupBonusCredits)} من الصوت مجاناً عند التسجيل</span>
              </div>
            )}

            {googleEnabled && (
              <>
                <a
                  href="/api/auth/google"
                  className="mt-4 w-full py-2.5 rounded-xl bg-white ring-1 ring-gray-300 hover:bg-gray-50 text-gray-800 font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors"
                >
                  <GoogleIcon />
                  <span>المتابعة بحساب Google</span>
                </a>
                <p className="mt-1.5 text-[10px] text-slate-500 text-center">
                  بالمتابعة فإنك توافق على <a href="#/terms" target="_blank" className="text-amber-400 hover:text-amber-300">شروط الاستخدام</a>
                </p>
                <div className="flex items-center gap-3 my-4 text-[11px] text-slate-500">
                  <span className="flex-1 h-px bg-slate-800" />
                  أو بالبريد الإلكتروني
                  <span className="flex-1 h-px bg-slate-800" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className={`${googleEnabled ? '' : 'mt-4'} space-y-3`}>
              {mode === 'register' && (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="الاسم"
                  autoComplete="name"
                  className={inputClass}
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="البريد الإلكتروني"
                autoComplete="email"
                required
                dir="ltr"
                className={`${inputClass} text-left`}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'كلمة المرور (8 أحرف على الأقل)' : 'كلمة المرور'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                minLength={mode === 'register' ? 8 : undefined}
                required
                dir="ltr"
                className={`${inputClass} text-left`}
              />

              {mode === 'register' && (
                <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={e => setAcceptTerms(e.target.checked)}
                    required
                    className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
                  />
                  <span>
                    أوافق على <a href="#/terms" target="_blank" className="text-amber-400 hover:text-amber-300 underline">شروط الاستخدام</a> وأتعهّد بعدم استخدام المنصة لمحتوى مسيء أو مضلّل
                  </span>
                </label>
              )}

              {error && (
                <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                  <p>{error}</p>
                  {suggestion && (
                    <button
                      type="button"
                      onClick={() => { setEmail(suggestion); setError(null); setSuggestion(null); }}
                      className="mt-1.5 text-amber-300 hover:text-amber-200 font-semibold underline"
                    >
                      استخدم <span dir="ltr">{suggestion}</span>
                    </button>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : mode === 'register' ? (
                  <UserPlus className="w-4 h-4" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{mode === 'register' ? 'إنشاء الحساب' : 'دخول'}</span>
              </button>
            </form>

            <p className="mt-4 text-xs text-slate-400 text-center">
              {mode === 'register' ? 'لديك حساب؟ ' : 'ليس لديك حساب؟ '}
              <button
                type="button"
                onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(null); setSuggestion(null); }}
                className="text-amber-400 hover:text-amber-300 font-medium"
              >
                {mode === 'register' ? 'سجّل الدخول' : 'أنشئ حساباً جديداً'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
};
