import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, Users, ListOrdered, Settings, Loader2, Search, Plus, Minus, Ban, CheckCircle2,
  ShieldCheck, ShieldOff, RefreshCw, Trash2, ChevronDown, ChevronUp, Save, ExternalLink, MailCheck, KeyRound, ShieldAlert, AudioLines, Clapperboard, FlaskConical
} from 'lucide-react';
import { AuthUser, formatCredits } from '../types/auth';
import { api, card, date, num, td, th, usd } from './adminShared';
import { KeysTab } from './KeysTab';
import { ModerationTab } from './ModerationTab';
import { CustomVoicesTab } from './CustomVoicesTab';
import { MotionTab } from './MotionTab';
import { SmtpCard } from './SmtpCard';
import { BenchmarkTab } from './BenchmarkTab';
import { PACKAGES, packageBaseMinutes, packageBonusMinutes, packageLabel, packageTotalMinutes } from '../data/packages';

type Tab = 'overview' | 'users' | 'usage' | 'keys' | 'voices' | 'motion' | 'moderation' | 'settings' | 'benchmark';

interface UsageSummary {
  feature: 'tts' | 'dialogue' | 'tashkeel' | 'optimize' | 'script';
  requests: number;
  failed: number;
  chars: number;
  prompt_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  credits_charged: number;
  cost_usd: number;
}

interface Stats {
  days: number;
  users: { total: number; new_users: number; outstanding_credits: number };
  usage: UsageSummary[];
  daily: { day: string; requests: number; audio_seconds: number; prompt_tokens: number; output_tokens: number; cost_usd: number }[];
  granted: { admin_granted: number; signup_bonus: number };
}

interface MotionStats {
  totalVideos: number;
  totalDurationMinutes: number;
  totalLambdaGbSeconds: number;
  totalLambdaCostUsd: number;
  totalPlanCostUsd: number;
  totalCostUsd: number;
  byRenderer: { renderer: string; count: number; costUsd: number }[];
  byStyle: { style: string; count: number; costUsd: number }[];
  recentJobs: {
    jobId: string;
    title: string;
    durationSeconds: number;
    totalCostUsd: number;
    renderedOn: string;
    createdAt: string;
  }[];
}

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  credits: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
  credits_used: number;
  audio_seconds: number;
  cost_usd: number;
  requests: number;
  email_verified: number;
  via_google: number;
  permissions: string; // JSON array, e.g. ["motion"]
}

interface Transaction {
  id: number;
  delta: number;
  balance_after: number;
  type: 'signup_bonus' | 'admin_grant' | 'charge';
  note: string;
  created_at: string;
  admin_email: string | null;
}

interface UsageEvent {
  id: number;
  email: string;
  feature: string;
  model: string;
  voice: string | null;
  chars: number;
  prompt_tokens: number;
  output_tokens: number;
  audio_seconds: number;
  credits_charged: number;
  cost_usd: number;
  status: 'ok' | 'failed';
  created_at: string;
}

interface AppSettings {
  signupBonusCredits: number;
  maxTextChars: number;
  generationsPerMinute: number;
  ttsInputPricePerM: number;
  ttsOutputPricePerM: number;
  textInputPricePerM: number;
  textOutputPricePerM: number;
  contactWhatsapp: string;
  costTtsPerMinute: number;
  costGreeting: number;
  costMotionLibrary: number;
  costMotionFree: number;
}

const FEATURE_LABELS: Record<string, string> = {
  tts: 'توليد صوت', dialogue: 'حوار بصوتين', tashkeel: 'تشكيل', optimize: 'تحسين نص', script: 'كتابة حوار',
};
const TX_LABELS: Record<Transaction['type'], string> = { signup_bonus: 'رصيد ترحيبي', admin_grant: 'إدارة', charge: 'استهلاك' };

export const AdminPage: React.FC<{ currentUser: AuthUser; onCurrentUserCreditsChange: (credits: number) => void }> = ({
  currentUser,
  onCurrentUserCreditsChange,
}) => {
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'نظرة عامة', icon: BarChart3 },
    { id: 'users', label: 'المستخدمون', icon: Users },
    { id: 'usage', label: 'سجل الاستهلاك', icon: ListOrdered },
    { id: 'keys', label: 'مفاتيح API', icon: KeyRound },
    { id: 'voices', label: 'البصمة الصوتية', icon: AudioLines },
    { id: 'motion', label: 'موشن جرافيك', icon: Clapperboard },
    { id: 'moderation', label: 'الرقابة على المحتوى', icon: ShieldAlert },
    { id: 'settings', label: 'الإعدادات والتسعير', icon: Settings },
    { id: 'benchmark', label: 'اختبار الأداء', icon: FlaskConical },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm border transition-colors ${
                tab === t.id
                  ? 'bg-amber-500/10 border-amber-500/70 text-amber-300 font-semibold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersTab currentUser={currentUser} onCurrentUserCreditsChange={onCurrentUserCreditsChange} />}
      {tab === 'usage' && <UsageTab />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'voices' && <CustomVoicesTab />}
      {tab === 'motion' && <MotionTab admin />}
      {tab === 'moderation' && <ModerationTab />}
      {tab === 'benchmark' && <BenchmarkTab />}
      {tab === 'settings' && (
        <div className="space-y-4">
          <SettingsTab />
          <SmtpCard />
        </div>
      )}
    </div>
  );
};

// ---------- Overview ----------

const Overview: React.FC = () => {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [motionStats, setMotionStats] = useState<MotionStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    setMotionStats(null);
    api<Stats>(`/api/admin/stats?days=${days}`).then(setStats).catch(e => setError(e.message));
    api<MotionStats>(`/api/admin/motion/stats?days=${days}`).then(setMotionStats).catch(() => {/* motion stats optional */});
  }, [days]);

  if (error) return <p className="text-rose-300 text-sm">{error}</p>;
  if (!stats) return <Loader2 className="w-5 h-5 animate-spin text-amber-400" />;

  // Single-voice and two-voice generations are both audio output billed per second
  const audioRows = stats.usage.filter(u => u.feature === 'tts' || u.feature === 'dialogue');
  const tts = audioRows.length
    ? audioRows.reduce((acc, u) => ({
        ...acc,
        requests: acc.requests + u.requests,
        failed: acc.failed + u.failed,
        output_tokens: acc.output_tokens + u.output_tokens,
        audio_seconds: acc.audio_seconds + u.audio_seconds,
        credits_charged: acc.credits_charged + u.credits_charged,
      }))
    : undefined;
  const totals = stats.usage.reduce(
    (acc, u) => ({
      prompt: acc.prompt + u.prompt_tokens,
      output: acc.output + u.output_tokens,
      cost: acc.cost + u.cost_usd,
    }),
    { prompt: 0, output: 0, cost: 0 }
  );
  const tokensPerSecond = tts && tts.audio_seconds > 0 ? tts.output_tokens / tts.audio_seconds : null;

  const tiles = [
    { label: 'المستخدمون', value: num(stats.users.total), hint: `${num(stats.users.new_users)} جديد خلال الفترة` },
    { label: 'صوت مولّد', value: formatCredits(Math.round(tts?.audio_seconds ?? 0)), hint: `${num(tts?.requests ?? 0)} طلب · ${num(tts?.failed ?? 0)} فاشل` },
    { label: 'كريدت مخصوم', value: num(tts?.credits_charged ?? 0), hint: 'ثانية مفوترة للعملاء' },
    { label: 'رصيد قائم لدى العملاء', value: num(stats.users.outstanding_credits), hint: 'ثانية لم تُستهلك بعد' },
    { label: 'توكنات Google (إخراج)', value: num(totals.output), hint: `+ ${num(totals.prompt)} توكن إدخال` },
    { label: 'التكلفة التقديرية', value: usd(totals.cost), hint: 'حسب أسعار صفحة الإعدادات' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">الفترة:</span>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 rounded-lg border ${days === d ? 'border-amber-500/70 text-amber-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            آخر {d} يوم
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map(t => (
          <div key={t.label} className={card}>
            <div className="text-xs text-slate-400">{t.label}</div>
            <div className="text-xl font-bold text-white mt-1" dir="ltr" style={{ textAlign: 'right' }}>{t.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{t.hint}</div>
          </div>
        ))}
      </div>

      {tokensPerSecond !== null && (
        <p className="text-xs text-slate-400">
          معدل الفوترة الفعلي من Google: <span className="text-amber-300 font-mono">{tokensPerSecond.toFixed(1)}</span> توكن إخراج لكل ثانية صوت.
        </p>
      )}

      <div className={card}>
        <h3 className="text-sm font-bold text-white mb-3">حسب الخدمة</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={th}>الخدمة</th><th className={th}>طلبات</th><th className={th}>أحرف</th>
                <th className={th}>توكن إدخال</th><th className={th}>توكن إخراج</th><th className={th}>ثواني صوت</th><th className={th}>التكلفة</th>
              </tr>
            </thead>
            <tbody>
              {stats.usage.map(u => (
                <tr key={u.feature} className="border-b border-slate-800/50 text-slate-200">
                  <td className={td}>{FEATURE_LABELS[u.feature]}</td>
                  <td className={td}>{num(u.requests)}</td>
                  <td className={td}>{num(u.chars)}</td>
                  <td className={td}>{num(u.prompt_tokens)}</td>
                  <td className={td}>{num(u.output_tokens)}</td>
                  <td className={td}>{u.audio_seconds.toFixed(1)}</td>
                  <td className={td}>{usd(u.cost_usd)}</td>
                </tr>
              ))}
              {stats.usage.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-500">لا يوجد استهلاك خلال هذه الفترة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-bold text-white mb-3">يومياً</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={th}>اليوم</th><th className={th}>طلبات</th><th className={th}>ثواني صوت</th>
                <th className={th}>توكن إدخال</th><th className={th}>توكن إخراج</th><th className={th}>التكلفة</th>
              </tr>
            </thead>
            <tbody>
              {[...stats.daily].reverse().map(d => (
                <tr key={d.day} className="border-b border-slate-800/50 text-slate-200">
                  <td className={td}>{d.day}</td>
                  <td className={td}>{num(d.requests)}</td>
                  <td className={td}>{d.audio_seconds.toFixed(1)}</td>
                  <td className={td}>{num(d.prompt_tokens)}</td>
                  <td className={td}>{num(d.output_tokens)}</td>
                  <td className={td}>{usd(d.cost_usd)}</td>
                </tr>
              ))}
              {stats.daily.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">لا يوجد بيانات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Motion Graphics Stats */}
      {motionStats && motionStats.totalVideos > 0 && (
        <>
          <div className={card}>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-amber-400" />
              إحصائيات الموشن جرافيك (AWS Lambda)
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">فيديوهات</div>
                <div className="text-xl font-bold text-white">{num(motionStats.totalVideos)}</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">مدة إجمالية</div>
                <div className="text-xl font-bold text-white">{motionStats.totalDurationMinutes.toFixed(1)} د</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">Lambda GB-Seconds</div>
                <div className="text-xl font-bold text-amber-300" dir="ltr">{num(Math.round(motionStats.totalLambdaGbSeconds))}</div>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">تكلفة AWS Lambda</div>
                <div className="text-xl font-bold text-emerald-300">{usd(motionStats.totalLambdaCostUsd)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400 mb-2">حسب مكان الرندر</div>
                <div className="space-y-1">
                  {motionStats.byRenderer.map(r => (
                    <div key={r.renderer} className="flex items-center justify-between text-xs bg-slate-950 rounded px-2 py-1.5 border border-slate-800">
                      <span className="text-slate-200">{r.renderer === 'lambda' ? 'AWS Lambda' : 'السيرفر المحلي'}</span>
                      <span className="text-slate-400">{r.count} فيديو · {usd(r.costUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-2">حسب نوع التصميم</div>
                <div className="space-y-1">
                  {motionStats.byStyle.map(s => (
                    <div key={s.style} className="flex items-center justify-between text-xs bg-slate-950 rounded px-2 py-1.5 border border-slate-800">
                      <span className="text-slate-200">{s.style === 'library' ? 'مكتبة المشاهد' : 'تصميم حر'}</span>
                      <span className="text-slate-400">{s.count} فيديو · {usd(s.costUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 mt-3">
              التكلفة الإجمالية (Lambda + Claude): <span className="text-amber-300 font-mono">{usd(motionStats.totalCostUsd)}</span>
              {motionStats.totalVideos > 0 && (
                <> · متوسط تكلفة الفيديو: <span className="text-amber-300 font-mono">{usd(motionStats.totalCostUsd / motionStats.totalVideos)}</span></>
              )}
            </p>
          </div>

          {motionStats.recentJobs.length > 0 && (
            <div className={card}>
              <h3 className="text-sm font-bold text-white mb-3">آخر فيديوهات الموشن</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className={th}>التاريخ</th><th className={th}>العنوان</th><th className={th}>المدة</th>
                      <th className={th}>الرندر</th><th className={th}>التكلفة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {motionStats.recentJobs.slice(0, 20).map(j => (
                      <tr key={j.jobId} className="border-b border-slate-800/50 text-slate-200">
                        <td className={td}>{date(j.createdAt)}</td>
                        <td className={`${td} max-w-[200px] truncate`} title={j.title}>{j.title || '—'}</td>
                        <td className={td}>{(j.durationSeconds / 60).toFixed(1)} د</td>
                        <td className={td}>{j.renderedOn === 'lambda' ? 'Lambda' : 'محلي'}</td>
                        <td className={td}>{usd(j.totalCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ---------- Users ----------

const UsersTab: React.FC<{ currentUser: AuthUser; onCurrentUserCreditsChange: (credits: number) => void }> = ({
  currentUser,
  onCurrentUserCreditsChange,
}) => {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(query)}`)
      .then(d => setUsers(d.users))
      .catch(e => setError(e.message));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const deleteUser = async (target: AdminUser) => {
    if (!window.confirm(`حذف المستخدم ${target.email} نهائياً؟\n\nسيُحذف اسمه وبريده ورصيده المتبقي ولن يستطيع الدخول، ويصبح البريد متاحاً للتسجيل من جديد. سجل الاستهلاك يبقى بدون بيانات شخصية.`)) return;
    if (!window.confirm('تأكيد أخير: لا يمكن التراجع عن الحذف. متابعة؟')) return;
    try {
      await api(`/api/admin/users/${target.id}`, { method: 'DELETE' });
      setExpandedId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const patchUser = async (id: number, body: Partial<{ disabled: boolean; role: 'user' | 'admin'; emailVerified: boolean; permissions: string[] }>) => {
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="بحث بالبريد أو الاسم"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>
        <button type="button" onClick={load} className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-white" title="تحديث">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}
      {!users ? (
        <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
      ) : (
        <div className={`${card} p-0 overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={th}>المستخدم</th><th className={th}>الرصيد</th><th className={th}>المستهلك</th>
                <th className={th}>طلبات</th><th className={th}>تكلفة Google</th><th className={th}>آخر دخول</th>
                <th className={th}>الحالة</th><th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === currentUser.id;
                const isOpen = expandedId === u.id;
                return (
                  <React.Fragment key={u.id}>
                    <tr className={`border-b border-slate-800/50 text-slate-200 ${u.disabled ? 'opacity-50' : ''}`}>
                      <td className={td}>
                        <div className="font-medium flex items-center gap-1.5">
                          {u.name || '—'}
                          {u.role === 'admin' && <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1">أدمن</span>}
                          {u.role !== 'admin' && (u.permissions || '').includes('motion') && <span className="text-[10px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1">موشن</span>}
                          {u.via_google ? <span className="text-[10px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1">Google</span> : null}
                          {!u.email_verified && <span className="text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-1">غير مؤكد</span>}
                        </div>
                        <div className="text-slate-500" dir="ltr" style={{ textAlign: 'right' }}>{u.email}</div>
                      </td>
                      <td className={`${td} font-bold ${u.credits > 0 ? 'text-amber-300' : 'text-rose-300'}`}>{formatCredits(u.credits)}</td>
                      <td className={td}>{formatCredits(u.credits_used)}</td>
                      <td className={td}>{num(u.requests)}</td>
                      <td className={td}>{usd(u.cost_usd)}</td>
                      <td className={td}>{date(u.last_login_at)}</td>
                      <td className={td}>{u.disabled ? <span className="text-rose-300">موقوف</span> : <span className="text-emerald-300">فعّال</span>}</td>
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : u.id)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-amber-500/50"
                        >
                          <span>إدارة</span>
                          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-800/50 bg-slate-950/40">
                        <td colSpan={8} className="px-3 py-3">
                          <UserManager
                            user={u}
                            isSelf={isSelf}
                            onCreditsChanged={(balance) => {
                              if (isSelf) onCurrentUserCreditsChange(balance);
                              load();
                            }}
                            onPatch={(body) => patchUser(u.id, body)}
                            onDelete={() => deleteUser(u)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">لا يوجد مستخدمون</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const QUICK_AMOUNTS = [60, 300, 600, 1800, 3600];

const UserManager: React.FC<{
  user: AdminUser;
  isSelf: boolean;
  onCreditsChanged: (balance: number) => void;
  onPatch: (body: Partial<{ disabled: boolean; role: 'user' | 'admin'; emailVerified: boolean; permissions: string[] }>) => void;
  onDelete: () => void;
}> = ({ user, isSelf, onCreditsChanged, onPatch, onDelete }) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);

  const loadTransactions = useCallback(() => {
    api<{ transactions: Transaction[] }>(`/api/admin/users/${user.id}/transactions`).then(d => setTransactions(d.transactions));
  }, [user.id]);

  useEffect(loadTransactions, [loadTransactions]);

  const grant = async (seconds: number, grantNote: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const { balance } = await api<{ balance: number }>(`/api/admin/users/${user.id}/credits`, {
        method: 'POST',
        body: JSON.stringify({ amount: seconds, note: grantNote }),
      });
      setMessage(`تم. الرصيد الجديد: ${formatCredits(balance)}`);
      setAmount('');
      setNote('');
      onCreditsChanged(balance);
      loadTransactions();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (sign: 1 | -1) => {
    const value = Math.trunc(Number(amount));
    if (!value || value <= 0) {
      setMessage('أدخل عدد ثوانٍ صحيح');
      return;
    }
    grant(sign * value, note);
  };

  // The server refuses top-ups for unconfirmed e-mails (the address may be mistyped and the credit unusable)
  const topUpBlocked = !user.email_verified;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        {topUpBlocked && (
          <div className="text-[11px] leading-relaxed text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            لا يمكن شحن رصيد لهذا الحساب لأن بريده غير مؤكد. اطلب من المستخدم تأكيد بريده أولاً، أو التسجيل من جديد ببريد صحيح.
          </div>
        )}
        <div className="text-xs font-bold text-white">شحن باقة (تشمل هدية العرض إن وُجدت)</div>
        <div className="flex flex-wrap gap-1.5">
          {PACKAGES.map(pkg => {
            const bonus = packageBonusMinutes(pkg);
            return (
              <button
                key={pkg.id}
                type="button"
                disabled={busy || topUpBlocked}
                onClick={() => {
                  if (window.confirm(`شحن ${packageLabel(pkg)} لـ ${user.email}؟`)) {
                    grant(packageTotalMinutes(pkg) * 60, packageLabel(pkg));
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                ₪{pkg.priceIls} · {packageBaseMinutes(pkg)} د{bonus > 0 && <b className="text-emerald-300"> +{bonus} هدية</b>}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-bold text-white pt-2">تعديل يدوي (بالثواني)</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_AMOUNTS.map(a => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(String(a))}
              className="px-2 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300 hover:border-amber-500/50"
            >
              {formatCredits(a)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="عدد الثواني"
            className="w-32 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="ملاحظة (مثال: دفعة 20$ عبر تحويل)"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || topUpBlocked}
            onClick={() => submit(1)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة رصيد
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(-1)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Minus className="w-3.5 h-3.5" /> خصم رصيد
          </button>
        </div>
        {message && <p className="text-xs text-slate-300">{message}</p>}

        {!isSelf && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/60">
            {!user.email_verified && (
              <button
                type="button"
                onClick={() => onPatch({ emailVerified: true })}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-500/40 text-xs text-emerald-300 hover:bg-emerald-500/10"
                title="يؤكد البريد ويمنح الرصيد الترحيبي"
              >
                <MailCheck className="w-3.5 h-3.5" />
                تأكيد البريد يدوياً
              </button>
            )}
            <button
              type="button"
              onClick={() => onPatch({ disabled: !user.disabled })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white"
            >
              {user.disabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
              {user.disabled ? 'تفعيل الحساب' : 'إيقاف الحساب'}
            </button>
            <button
              type="button"
              onClick={() => onPatch({ role: user.role === 'admin' ? 'user' : 'admin' })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white"
            >
              {user.role === 'admin' ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              {user.role === 'admin' ? 'إزالة صلاحية الأدمن' : 'منح صلاحية الأدمن'}
            </button>
            {user.role !== 'admin' && (() => {
              // Feature access for testers, without the admin dashboard
              const perms: string[] = (() => { try { return JSON.parse(user.permissions || '[]'); } catch { return []; } })();
              const on = perms.includes('motion');
              return (
                <button
                  type="button"
                  onClick={() => onPatch({ permissions: on ? perms.filter(p => p !== 'motion') : [...perms, 'motion'] })}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs ${on ? 'border-amber-500/60 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-300 hover:text-white'}`}
                >
                  <Clapperboard className="w-3.5 h-3.5" />
                  {on ? 'إيقاف الموشن جرافيك' : 'منح الموشن جرافيك'}
                </button>
              );
            })()}
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-500/40 text-xs text-rose-300 hover:bg-rose-500/10 mr-auto"
              title="يحذف بيانات الحساب الشخصية ويحرّر البريد، مع الإبقاء على سجل الاستهلاك مجهولاً"
            >
              <Trash2 className="w-3.5 h-3.5" />
              حذف المستخدم
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-bold text-white mb-2">حركة الرصيد</div>
        <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg">
          <table className="w-full text-[11px]">
            <tbody>
              {transactions?.map(t => (
                <tr key={t.id} className="border-b border-slate-800/50 text-slate-300">
                  <td className="px-2 py-1.5 whitespace-nowrap">{date(t.created_at)}</td>
                  <td className="px-2 py-1.5">{TX_LABELS[t.type]}</td>
                  <td className={`px-2 py-1.5 font-mono ${t.delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`} dir="ltr">
                    {t.delta > 0 ? `+${t.delta}` : t.delta}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">= {t.balance_after}</td>
                  <td className="px-2 py-1.5 text-slate-400 truncate max-w-[180px]" title={t.note}>
                    {t.note}{t.admin_email ? ` · ${t.admin_email}` : ''}
                  </td>
                </tr>
              ))}
              {transactions?.length === 0 && (
                <tr><td className="px-2 py-3 text-center text-slate-500">لا توجد حركات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ---------- Usage log ----------

const UsageTab: React.FC = () => {
  const [rows, setRows] = useState<UsageEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ usage: UsageEvent[] }>('/api/admin/usage?limit=200').then(d => setRows(d.usage)).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <p className="text-rose-300 text-sm">{error}</p>;
  if (!rows) return <Loader2 className="w-5 h-5 animate-spin text-amber-400" />;

  return (
    <div className={`${card} p-0 overflow-x-auto`}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800">
            <th className={th}>الوقت</th><th className={th}>المستخدم</th><th className={th}>الخدمة</th><th className={th}>الصوت</th>
            <th className={th}>أحرف</th><th className={th}>توكن إدخال</th><th className={th}>توكن إخراج</th>
            <th className={th}>ثواني</th><th className={th}>كريدت</th><th className={th}>التكلفة</th><th className={th}>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-slate-800/50 text-slate-200">
              <td className={td}>{date(r.created_at)}</td>
              <td className={`${td} text-slate-400`} dir="ltr">{r.email}</td>
              <td className={td}>{FEATURE_LABELS[r.feature] ?? r.feature}</td>
              <td className={td}>{r.voice ?? '—'}</td>
              <td className={td}>{num(r.chars)}</td>
              <td className={td}>{num(r.prompt_tokens)}</td>
              <td className={td}>{num(r.output_tokens)}</td>
              <td className={td}>{r.audio_seconds ? r.audio_seconds.toFixed(1) : '—'}</td>
              <td className={td}>{r.credits_charged || '—'}</td>
              <td className={td}>{usd(r.cost_usd)}</td>
              <td className={td}>{r.status === 'ok' ? <span className="text-emerald-300">ناجح</span> : <span className="text-rose-300">فشل</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={11} className="px-3 py-4 text-center text-slate-500">لا يوجد استهلاك بعد</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// ---------- Settings ----------

const SERVICE_COST_FIELDS: { key: keyof AppSettings; label: string; icon: string; hint: string }[] = [
  { key: 'costTtsPerMinute',   label: 'نص → صوت', icon: '🎙️', hint: 'نقطة لكل دقيقة صوت' },
  { key: 'costGreeting',       label: 'بطاقة تهنئة', icon: '🎴', hint: 'نقطة للبطاقة الواحدة' },
  { key: 'costMotionLibrary',  label: 'ريلز — نسق جاهز', icon: '🎬', hint: 'نقطة للفيديو الواحد' },
  { key: 'costMotionFree',     label: 'ريلز — نسق حر', icon: '✨', hint: 'نقطة للفيديو الواحد' },
];

const SETTING_FIELDS: { key: Exclude<keyof AppSettings, 'contactWhatsapp'>; label: string; hint: string; step?: string }[] = [
  { key: 'signupBonusCredits', label: 'الرصيد الترحيبي (ثانية)', hint: 'يُمنح لكل حساب جديد عند التسجيل' },
  { key: 'maxTextChars', label: 'الحد الأقصى لطول النص (حرف)', hint: 'لكل طلب توليد' },
  { key: 'generationsPerMinute', label: 'عدد التوليدات بالدقيقة لكل مستخدم', hint: 'حماية من الاستهلاك المفرط' },
  { key: 'ttsInputPricePerM', label: 'سعر توكن الإدخال — TTS ($ / مليون)', hint: 'نموذج gemini-3.8-flash-lite-tts', step: 'any' },
  { key: 'ttsOutputPricePerM', label: 'سعر توكن الإخراج الصوتي — TTS ($ / مليون)', hint: 'نموذج gemini-3.8-flash-lite-tts', step: 'any' },
  { key: 'textInputPricePerM', label: 'سعر توكن الإدخال — نصي ($ / مليون)', hint: 'نموذج gemini-3.8-flash (التشكيل والتحسين)', step: 'any' },
  { key: 'textOutputPricePerM', label: 'سعر توكن الإخراج — نصي ($ / مليون)', hint: 'نموذج gemini-3.8-flash (التشكيل والتحسين)', step: 'any' },
];

const SettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: AppSettings }>('/api/admin/settings').then(d => setSettings(d.settings)).catch(e => setMessage(e.message));
  }, []);

  if (!settings) return message ? <p className="text-rose-300 text-sm">{message}</p> : <Loader2 className="w-5 h-5 animate-spin text-amber-400" />;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      // Only this form's fields: the SMTP card saves its own values separately
      const own = Object.fromEntries([...SETTING_FIELDS.map(f => f.key), 'contactWhatsapp', ...SERVICE_COST_FIELDS.map(f => f.key)].map(k => [k, settings[k as keyof AppSettings]]));
      const d = await api<{ settings: AppSettings }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(own) });
      setSettings(d.settings);
      setMessage('تم حفظ الإعدادات');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${card} space-y-4 max-w-2xl`}>
      <p className="text-xs text-slate-400 leading-relaxed">
        الأسعار تُستخدم فقط لحساب تكلفة Google التقديرية في لوحة الإدارة، ولا تؤثر على رصيد العملاء.
        انسخها من صفحة الأسعار الرسمية:{' '}
        <a href="https://ai.google.dev/pricing" target="_blank" rel="noreferrer" className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-1">
          ai.google.dev/pricing <ExternalLink className="w-3 h-3" />
        </a>
      </p>
      <label className="block">
        <span className="text-xs font-semibold text-slate-300">رقم واتساب لطلبات الباقات</span>
        <input
          type="tel"
          value={settings.contactWhatsapp}
          onChange={e => setSettings({ ...settings, contactWhatsapp: e.target.value })}
          placeholder="972591234567"
          className="mt-1 w-full max-w-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
          dir="ltr"
        />
        <span className="block text-[11px] text-slate-500">بالصيغة الدولية بدون + أو أصفار بالبداية. زر "اطلب عبر واتساب" يفتح محادثة مع هذا الرقم.</span>
      </label>
      {/* Service pricing table */}
      <div className="border border-slate-700 rounded-xl overflow-hidden">
        <div className="bg-slate-800/60 px-4 py-2.5 flex items-center gap-2">
          <span className="text-sm font-bold text-white">💎 تسعير الخدمات بالنقاط</span>
          <span className="text-[11px] text-slate-400">(10 نقاط = دقيقة صوت = ₪0.2)</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-900/50">
            <tr className="text-[11px] text-slate-400">
              <th className="text-right px-4 py-2">الخدمة</th>
              <th className="text-center px-4 py-2">النقاط</th>
              <th className="text-right px-4 py-2 text-slate-500">ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_COST_FIELDS.map((f, i) => (
              <tr key={f.key} className={i % 2 === 0 ? 'bg-slate-950/40' : ''}>
                <td className="px-4 py-2.5 text-slate-200 font-medium">{f.icon} {f.label}</td>
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={settings[f.key] as number}
                    onChange={e => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-amber-300 font-bold text-sm focus:outline-none focus:border-amber-500"
                    dir="ltr"
                  />
                </td>
                <td className="px-4 py-2.5 text-[11px] text-slate-500">{f.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SETTING_FIELDS.map(f => (
          <label key={f.key} className="block">
            <span className="text-xs font-semibold text-slate-300">{f.label}</span>
            <input
              type="number"
              min={0}
              step={f.step ?? '1'}
              value={settings[f.key]}
              onChange={e => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              dir="ltr"
            />
            <span className="text-[11px] text-slate-500">{f.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          حفظ
        </button>
        {message && <span className="text-xs text-slate-300">{message}</span>}
      </div>
    </div>
  );
};
