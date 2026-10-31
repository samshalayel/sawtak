import express from 'express';
import { db, getSettings, getUserById, grantSignupBonusOnce, PERMISSIONS, publicUser, transaction, updateSettings } from './db.ts';
import { grantCredits } from './credits.ts';
import { ApiKeyRow, maskKey, testApiKey } from './keys.ts';
import { invalidateModerationCache } from './moderation.ts';
import { sendTestEmail } from './mailer.ts';
import { requireAdmin, requireAuth } from './auth.ts';
import { customVoicesRouter } from './custom-voices.ts';
import { quranReelStats } from './quran-stats.ts';
import { openRouterStats } from './openrouter-stats.ts';
import { aiVideoRouter } from './ai-video.ts';
import { aiImageRouter } from './ai-image.ts';
import { autoReelRouter } from './auto-reel.ts';
import { galleryAdminRouter } from './gallery.ts';

export const adminRouter = express.Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use('/custom-voices', customVoicesRouter);
adminRouter.use('/ai-video', aiVideoRouter);
adminRouter.use('/ai-image', aiImageRouter);
adminRouter.use('/auto-reel', autoReelRouter);
adminRouter.use('/gallery', galleryAdminRouter);

adminRouter.get('/stats', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = `-${days} days`;

  const users = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS new_users,
           COALESCE(SUM(credits), 0) AS outstanding_credits
    FROM users
    WHERE deleted_at IS NULL
  `).get(since);

  const usage = db.prepare(`
    SELECT feature,
           COUNT(*) AS requests,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           COALESCE(SUM(chars), 0) AS chars,
           COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(audio_seconds), 0) AS audio_seconds,
           COALESCE(SUM(credits_charged), 0) AS credits_charged,
           COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM usage_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY feature
  `).all(since);

  const daily = db.prepare(`
    SELECT date(created_at) AS day,
           COUNT(*) AS requests,
           COALESCE(SUM(audio_seconds), 0) AS audio_seconds,
           COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM usage_events
    WHERE created_at >= datetime('now', ?)
    GROUP BY day
    ORDER BY day
  `).all(since);

  const granted = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'admin_grant' THEN delta ELSE 0 END), 0) AS admin_granted,
           COALESCE(SUM(CASE WHEN type = 'signup_bonus' THEN delta ELSE 0 END), 0) AS signup_bonus
    FROM credit_transactions
    WHERE created_at >= datetime('now', ?)
  `).get(since);

  res.json({ success: true, days, users, usage, daily, granted });
});

adminRouter.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.credits, u.disabled, u.created_at, u.last_login_at,
           u.email_verified, (u.google_sub IS NOT NULL) AS via_google, u.permissions,
           COALESCE(SUM(e.credits_charged), 0) AS credits_used,
           COALESCE(SUM(e.audio_seconds), 0) AS audio_seconds,
           COALESCE(SUM(e.cost_usd), 0) AS cost_usd,
           COUNT(e.id) AS requests
    FROM users u
    LEFT JOIN usage_events e ON e.user_id = u.id
    WHERE u.deleted_at IS NULL AND (u.email LIKE ? OR u.name LIKE ?)
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT 5000
  `).all(q, q);
  res.json({ success: true, users });
});

adminRouter.get('/users/:id/transactions', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.delta, t.balance_after, t.type, t.note, t.created_at, a.email AS admin_email
    FROM credit_transactions t
    LEFT JOIN users a ON a.id = t.admin_id
    WHERE t.user_id = ?
    ORDER BY t.id DESC
    LIMIT 2000
  `).all(Number(req.params.id));
  res.json({ success: true, transactions: rows });
});

adminRouter.post('/users/:id/credits', (req, res) => {
  const userId = Number(req.params.id);
  const amount = Math.trunc(Number(req.body?.amount));
  const note = String(req.body?.note || '').trim().slice(0, 200) || (amount >= 0 ? 'شحن رصيد' : 'خصم رصيد');

  const target = getUserById(userId);
  if (!target) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
    return res.status(400).json({ success: false, error: 'قيمة الرصيد غير صالحة' });
  }
  // Paid credit on an unconfirmed (possibly mistyped) address could never be used; deductions stay allowed
  if (amount > 0 && !target.email_verified) {
    return res.status(400).json({
      success: false,
      error: 'لا يمكن شحن رصيد لحساب لم يؤكّد بريده الإلكتروني. اطلب من المستخدم تأكيد بريده أولاً، أو التسجيل من جديد ببريد صحيح.',
    });
  }

  const balance = grantCredits(userId, amount, req.user!.id, note);
  res.json({ success: true, balance });
});

adminRouter.delete('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  const target = getUserById(userId);
  if (!target || (target as { deleted_at?: string | null }).deleted_at) {
    return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
  }
  if (userId === req.user!.id) {
    return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك الخاص' });
  }

  transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(userId);
    db.prepare(`
      UPDATE users
      SET email = ?, email_normalized = NULL, name = '', password_hash = '', google_sub = NULL,
          credits = 0, disabled = 1, role = 'user', deleted_at = datetime('now')
      WHERE id = ?
    `).run(`deleted-${userId}@deleted.invalid`, userId);
  });
  res.json({ success: true });
});

adminRouter.patch('/users/:id', (req, res) => {
  const userId = Number(req.params.id);
  const target = getUserById(userId);
  if (!target) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
  if (userId === req.user!.id) {
    return res.status(400).json({ success: false, error: 'لا يمكنك تعديل صلاحيات حسابك الخاص' });
  }

  if (typeof req.body?.disabled === 'boolean') {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(req.body.disabled ? 1 : 0, userId);
    if (req.body.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  if (req.body?.emailVerified === true && !target.email_verified) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
    grantSignupBonusOnce(userId);
  }
  // Feature access for testers (e.g. ["motion"]) without admin rights
  if (Array.isArray(req.body?.permissions)) {
    const granted = PERMISSIONS.filter(p => req.body.permissions.includes(p));
    db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(granted), userId);
  }
  if (req.body?.role === 'admin' || req.body?.role === 'user') {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, userId);
  }
  res.json({ success: true, user: publicUser(getUserById(userId)!) });
});

// ---------- Quran reels ----------

adminRouter.get('/quran', (req, res) => {
  const days = Math.min(3650, Math.max(0, Math.floor(Number(req.query.days) || 0)));
  res.json({ success: true, days, ...quranReelStats(days) });
});

// ---------- Fresh start before launch ----------
// Clears the chosen statistics; users, their balances, settings, keys and Jawwal Pay payments are never touched.
const RESETTABLE = {
  usage: 'usage_events',              // usage and Google cost log (also the per-user "used" figures)
  transactions: 'credit_transactions', // balance history (balances themselves stay)
  quran: 'quran_reels',
  moderation: 'moderation_events',
  motion: 'motion_stats',
  benchmark: 'benchmark_runs',
} as const;

adminRouter.post('/reset-stats', (req, res) => {
  const chosen = (Object.keys(RESETTABLE) as (keyof typeof RESETTABLE)[]).filter(k => req.body?.[k] === true);
  if (!chosen.length) return res.status(400).json({ success: false, error: 'اختر ما تريد مسحه' });
  const deleted = transaction(() => {
    const counts: Record<string, number> = {};
    // Balance history points at usage rows: keep it valid when only the usage log goes
    if (chosen.includes('usage') && !chosen.includes('transactions')) db.prepare('UPDATE credit_transactions SET usage_id = NULL').run();
    for (const k of ['transactions', ...chosen.filter(c => c !== 'transactions')] as (keyof typeof RESETTABLE)[]) {
      if (!chosen.includes(k)) continue;
      counts[k] = Number(db.prepare(`DELETE FROM ${RESETTABLE[k]}`).run().changes);
    }
    return counts;
  });
  console.log(`Admin ${req.user!.email} cleared statistics:`, deleted);
  res.json({ success: true, deleted });
});

adminRouter.get('/usage', (req, res) => {
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 100));
  const rows = db.prepare(`
    SELECT e.*, u.email
    FROM usage_events e
    JOIN users u ON u.id = e.user_id
    ORDER BY e.id DESC
    LIMIT ?
  `).all(limit);
  res.json({ success: true, usage: rows });
});

// The SMTP password never leaves the server; the UI only learns whether one is stored
const publicSettings = (s: ReturnType<typeof getSettings>) => ({ ...s, smtpPass: '', smtpPassSet: Boolean(s.smtpPass) });

adminRouter.get('/settings', (_req, res) => {
  res.json({ success: true, settings: publicSettings(getSettings()) });
});

adminRouter.put('/settings', (req, res) => {
  res.json({ success: true, settings: publicSettings(updateSettings(req.body || {})) });
});

adminRouter.post('/smtp/test', async (req, res) => {
  const result = await sendTestEmail(req.user!.email);
  res.json(result.ok
    ? { success: true, message: `تم الإرسال إلى ${req.user!.email} ✓ تفقّد بريدك (وقد يصل إلى Spam)` }
    : { success: false, error: `فشل الإرسال: ${result.error}` });
});

// ---------- Gemini API keys ----------

const TTS_TEST_MODEL = 'gemini-3.8-flash-lite-tts';

adminRouter.get('/openrouter', async (_req, res) => {
  try {
    res.json({ success: true, stats: await openRouterStats() });
  } catch (error: any) {
    console.error('OpenRouter stats failed:', error?.message || error);
    res.status(502).json({ success: false, error: 'تعذّر جلب بيانات OpenRouter حالياً' });
  }
});

adminRouter.get('/keys', (_req, res) => {
  const rows = db.prepare(`
    SELECT k.id, k.label, k.api_key, k.enabled, k.priority, k.cooldown_until, k.last_error, k.last_error_at,
           k.last_used_at, k.success_count, k.error_count, k.created_at,
           COUNT(e.id) AS requests,
           SUM(CASE WHEN e.created_at >= date('now') THEN 1 ELSE 0 END) AS requests_today,
           COALESCE(SUM(e.prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(e.output_tokens), 0) AS output_tokens,
           COALESCE(SUM(e.audio_seconds), 0) AS audio_seconds,
           COALESCE(SUM(e.cost_usd), 0) AS cost_usd
    FROM api_keys k
    LEFT JOIN usage_events e ON e.api_key_id = k.id
    GROUP BY k.id
    ORDER BY k.priority ASC, k.id ASC
  `).all() as (ApiKeyRow & Record<string, unknown>)[];

  // Never send the full key to the browser
  const keys = rows.map(({ api_key, ...rest }) => ({ ...rest, masked: maskKey(api_key) }));
  res.json({ success: true, keys });
});

adminRouter.post('/keys', async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  const label = String(req.body?.label || '').trim().slice(0, 60);

  if (apiKey.length < 20 || /\s/.test(apiKey)) {
    return res.status(400).json({ success: false, error: 'صيغة المفتاح غير صحيحة' });
  }
  if (db.prepare('SELECT 1 FROM api_keys WHERE api_key = ?').get(apiKey)) {
    return res.status(409).json({ success: false, error: 'هذا المفتاح مضاف مسبقاً' });
  }

  const test = await testApiKey(apiKey, TTS_TEST_MODEL);
  if (!test.ok) {
    return res.status(400).json({ success: false, error: `فشل اختبار المفتاح: ${test.error}` });
  }

  const { maxPriority } = db.prepare('SELECT COALESCE(MAX(priority), 0) AS maxPriority FROM api_keys').get() as { maxPriority: number };
  db.prepare('INSERT INTO api_keys (label, api_key, priority) VALUES (?, ?, ?)').run(label, apiKey, maxPriority + 1);
  res.json({ success: true });
});

adminRouter.post('/keys/:id/test', async (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(req.params.id)) as ApiKeyRow | undefined;
  if (!key) return res.status(404).json({ success: false, error: 'المفتاح غير موجود' });

  const test = await testApiKey(key.api_key, TTS_TEST_MODEL);
  if (test.ok) {
    db.prepare('UPDATE api_keys SET cooldown_until = NULL WHERE id = ?').run(key.id);
    return res.json({ success: true, message: 'المفتاح يعمل ✓' });
  }
  db.prepare("UPDATE api_keys SET last_error = ?, last_error_at = datetime('now') WHERE id = ?").run(test.error, key.id);
  res.json({ success: false, error: test.error });
});

adminRouter.patch('/keys/:id', (req, res) => {
  const id = Number(req.params.id);
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow | undefined;
  if (!key) return res.status(404).json({ success: false, error: 'المفتاح غير موجود' });

  if (typeof req.body?.enabled === 'boolean') {
    db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, id);
  }
  if (typeof req.body?.label === 'string') {
    db.prepare('UPDATE api_keys SET label = ? WHERE id = ?').run(req.body.label.trim().slice(0, 60), id);
  }
  if (req.body?.clearCooldown === true) {
    db.prepare('UPDATE api_keys SET cooldown_until = NULL WHERE id = ?').run(id);
  }
  // Move one step up/down in the failover order by swapping with the neighbour
  if (req.body?.move === 'up' || req.body?.move === 'down') {
    const ordered = db.prepare('SELECT id FROM api_keys ORDER BY priority ASC, id ASC').all() as { id: number }[];
    const index = ordered.findIndex(k => k.id === id);
    const swapWith = ordered[req.body.move === 'up' ? index - 1 : index + 1];
    if (swapWith) {
      ordered[index] = swapWith;
      ordered[req.body.move === 'up' ? index - 1 : index + 1] = { id };
    }
    const setPriority = db.prepare('UPDATE api_keys SET priority = ? WHERE id = ?');
    ordered.forEach((k, i) => setPriority.run(i + 1, k.id));
  }
  res.json({ success: true });
});

adminRouter.delete('/keys/:id', (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// ---------- Content moderation (banned words) ----------

adminRouter.get('/moderation', (_req, res) => {
  const words = db.prepare('SELECT id, word, created_at FROM moderation_words ORDER BY word').all();
  const events = db.prepare(`
    SELECT m.id, m.feature, m.matched, m.excerpt, m.action, m.created_at, u.email, u.id AS user_id
    FROM moderation_events m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC
    LIMIT 2000
  `).all();
  res.json({ success: true, mode: getSettings().moderationMode, ai: getSettings().moderationAi, words, events });
});

adminRouter.post('/moderation/words', (req, res) => {
  // Accepts one word/phrase or many separated by new lines or commas
  const words = String(req.body?.words || '')
    .split(/[\n,،]+/)
    .map(w => w.trim().replace(/\s+/g, ' ').slice(0, 60))
    .filter(Boolean);
  if (words.length === 0) return res.status(400).json({ success: false, error: 'اكتب كلمة واحدة على الأقل' });
  const insert = db.prepare('INSERT OR IGNORE INTO moderation_words (word) VALUES (?)');
  let added = 0;
  for (const w of words) added += Number(insert.run(w).changes);
  invalidateModerationCache();
  res.json({ success: true, added });
});

adminRouter.delete('/moderation/words/:id', (req, res) => {
  db.prepare('DELETE FROM moderation_words WHERE id = ?').run(Number(req.params.id));
  invalidateModerationCache();
  res.json({ success: true });
});

// ---------- Motion Stats (video rendering analytics) ----------

import { getMotionStatsReport, logMotionStat, MotionStatInput } from './db.ts';

adminRouter.get('/motion/stats', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json({ success: true, ...getMotionStatsReport(days) });
});

// Internal endpoint for the motion worker to log stats (uses MOTION_STATS_TOKEN for auth)
export const motionStatsRouter = express.Router();

const MOTION_STATS_TOKEN = process.env.MOTION_STATS_TOKEN || '';

motionStatsRouter.post('/log', (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!MOTION_STATS_TOKEN || token !== MOTION_STATS_TOKEN) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const input: MotionStatInput = {
      jobId: String(req.body.jobId || ''),
      title: String(req.body.title || '').slice(0, 200),
      durationSeconds: Number(req.body.durationSeconds) || 0,
      formats: Array.isArray(req.body.formats) ? req.body.formats : [],
      style: req.body.style === 'free' ? 'free' : 'library',
      look: req.body.look === 'notebook' ? 'notebook' : 'classic',
      renderedOn: req.body.renderedOn === 'local' ? 'local' : 'lambda',
      lambdaInvocations: Number(req.body.lambdaInvocations) || 0,
      lambdaGbSeconds: Number(req.body.lambdaGbSeconds) || 0,
      lambdaCostUsd: Number(req.body.lambdaCostUsd) || 0,
      planCostUsd: Number(req.body.planCostUsd) || 0,
      scenesCount: Number(req.body.scenesCount) || 0,
      theme: String(req.body.theme || ''),
      status: req.body.status === 'error' ? 'error' : 'done',
      errorMessage: req.body.errorMessage ? String(req.body.errorMessage).slice(0, 500) : undefined,
    };

    if (!input.jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }

    const id = logMotionStat(input);
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error logging motion stat:', err);
    res.status(500).json({ success: false, error: 'failed to log stat' });
  }
});
