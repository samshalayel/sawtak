// "Make one like it" (اصنع مثله): a customer repeats a gallery item that was made in an admin tool, with the same
// models and settings (its recipe, server/gallery.ts) and their own words in the boxes the recipe lets them change.
// The price comes from the admin settings (costRemix*), is shown before anything runs, is charged when the work
// starts, and is given back automatically if it fails. Results are kept in the media storage (remix/<id>.<ext>).
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { db, getSettings } from './db.ts';
import { requireAuth } from './auth.ts';
import { chargePoints, InsufficientCreditsError, pointsCredits } from './credits.ts';
import { BLOCKED_MESSAGE, moderateFull } from './moderation.ts';
import { serviceOn } from './services.ts';
import { itemRecipe, Recipe } from './gallery.ts';
import { generatePicture } from './ai-image.ts';
import { saveVideo } from './ai-video.ts';
import { reelState, startAutoReel } from './auto-reel.ts';
import { putMedia, putMediaFile, sendMedia, typeOf } from './storage.ts';

const base = () => process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
const key = () => process.env.OPENROUTER_API_KEY || '';
const WAIT_MS = 30 * 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_remixes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    input TEXT NOT NULL,
    points INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'done', 'failed')),
    error TEXT,
    result_key TEXT,
    result_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface RemixRow {
  id: string; user_id: number; item_id: number; type: Recipe['type']; input: string; points: number;
  status: 'working' | 'done' | 'failed'; error: string | null; result_key: string | null; result_type: string | null; created_at: string;
}

// ---------- What a recipe lets the customer change, and its price ----------

interface Box { key: string; label: string; value: string; max: number; hint: string }

function boxes(recipe: Recipe): Box[] {
  switch (recipe.type) {
    case 'image': return [{ key: 'prompt', label: 'وصف الصورة', value: recipe.prompt, max: 2000, hint: 'صف صورتك أنت: الموضوع والمكان والألوان. الإنجليزية تعطي أدق نتيجة.' }];
    case 'video': return [{ key: 'prompt', label: 'وصف المشهد', value: recipe.prompt, max: 2000, hint: 'صف المشهد وحركة الكاميرا. الإنجليزية تعطي أدق نتيجة.' }];
    case 'reel': return [{ key: 'idea', label: 'فكرة الريل', value: recipe.idea, max: 1000, hint: 'عن ماذا ريلك؟ القصة أو الرسالة أو المناسبة.' }];
  }
}

function pricePoints(recipe: Recipe): number {
  const s = getSettings();
  switch (recipe.type) {
    case 'image': return Math.max(1, Math.round(s.costRemixImage));
    case 'video': return Math.max(1, Math.round(s.costRemixVideoSecond * recipe.duration));
    case 'reel': return Math.max(1, Math.round(s.costRemixReelSecond * recipe.seconds));
  }
}

/** What the result will be, in a few words, for the confirmation. */
function summary(recipe: Recipe): string {
  switch (recipe.type) {
    case 'image': return 'صورة واحدة بنفس النموذج والأبعاد';
    case 'video': return `مقطع فيديو ${recipe.duration} ثوانٍ بنفس النموذج والدقة`;
    case 'reel': return `ريل حوالي ${recipe.seconds} ثانية بنفس الصوت والأسلوب والنماذج`;
  }
}

// ---------- Credits ----------

const balanceCredits = (userId: number) => (db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number }).credits;
const balancePoints = (userId: number) => Math.floor(balanceCredits(userId) / pointsCredits(1));

/** Gives a failed remix's points back (recorded like a charge, with a positive amount). */
function refund(row: RemixRow) {
  const seconds = pointsCredits(row.points);
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(seconds, row.user_id);
  const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(row.user_id) as { credits: number };
  db.prepare("INSERT INTO credit_transactions (user_id, delta, balance_after, type, note) VALUES (?, ?, ?, 'charge', ?)")
    .run(row.user_id, seconds, credits, `استرجاع: اصنع مثله #${row.item_id} لم يكتمل`);
}

const getRemix = (id: string) => db.prepare('SELECT * FROM gallery_remixes WHERE id = ?').get(id) as unknown as RemixRow | undefined;

function finish(id: string, result: { key: string; type: string } | { error: string }) {
  if ('key' in result) {
    db.prepare("UPDATE gallery_remixes SET status = 'done', result_key = ?, result_type = ? WHERE id = ?").run(result.key, result.type, id);
    return;
  }
  db.prepare("UPDATE gallery_remixes SET status = 'failed', error = ? WHERE id = ?").run(result.error.slice(0, 300), id);
  const row = getRemix(id);
  if (row) refund(row);
}

// Work left mid-way by a restart cannot be followed: it is refunded
for (const row of db.prepare("SELECT * FROM gallery_remixes WHERE status = 'working'").all() as unknown as RemixRow[]) {
  finish(row.id, { error: 'توقف الخادم أثناء العمل، أُعيدت النقاط' });
}

// ---------- Running a recipe ----------

async function makeVideo(id: string, recipe: Extract<Recipe, { type: 'video' }>, prompt: string): Promise<string> {
  const res = await fetch(`${base()}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: recipe.model, prompt, duration: recipe.duration, resolution: recipe.resolution, aspect_ratio: recipe.aspectRatio,
      ...(recipe.sound ? { generate_audio: true } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const answer: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof answer.id !== 'string') throw new Error(`رُفض الطلب: ${String(answer?.error?.message || res.status).slice(0, 200)}`);
  const started = Date.now();
  while (Date.now() - started < WAIT_MS) {
    await sleep(10_000);
    const r = await fetch(`${base()}/videos/${answer.id}`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const d: any = r?.ok ? await r.json().catch(() => null) : null;
    if (!d) continue;
    if (d.status === 'completed') {
      const file = path.join(os.tmpdir(), `sawtik-remix-${id}.mp4`);
      await saveVideo(answer.id, d, file);
      await putMediaFile(`remix/${id}.mp4`, file, 'video/mp4');
      await fs.rm(file, { force: true }).catch(() => {});
      return `remix/${id}.mp4`;
    }
    if (['failed', 'cancelled', 'expired'].includes(d.status)) throw new Error(String(d.error?.message || d.error || d.status).slice(0, 200));
  }
  throw new Error('تأخر التوليد أكثر من 30 دقيقة');
}

async function run(row: RemixRow, recipe: Recipe, input: Record<string, string>) {
  try {
    if (recipe.type === 'image') {
      const result = await generatePicture({ model: recipe.model, prompt: input.prompt, aspectRatio: recipe.aspectRatio, resolution: recipe.resolution });
      const { bytes, ext } = result.pictures[0];
      await putMedia(`remix/${row.id}.${ext}`, bytes, typeOf(`x.${ext}`));
      return finish(row.id, { key: `remix/${row.id}.${ext}`, type: typeOf(`x.${ext}`) });
    }
    if (recipe.type === 'video') return finish(row.id, { key: await makeVideo(row.id, recipe, input.prompt), type: 'video/mp4' });

    // A reel runs in the automatic reel pipeline (it keeps its own files), followed here until it is done
    const reel = await startAutoReel({ ...recipe, idea: input.idea }, row.user_id);
    const started = Date.now();
    while (Date.now() - started < WAIT_MS) {
      await sleep(10_000);
      const state = await reelState(reel.id);
      if (state?.stage === 'done') return finish(row.id, { key: `auto-reel/${reel.id}/final.mp4`, type: 'video/mp4' });
      if (!state || state.stage === 'failed') throw new Error(state?.error || 'توقف الريل');
    }
    throw new Error('تأخر الريل أكثر من 30 دقيقة');
  } catch (error: any) {
    console.error(`[remix] ${row.id}:`, error?.message || error);
    finish(row.id, { error: String(error?.message || error) });
  }
}

// ---------- Routes (/api/remix) ----------

export const remixRouter = express.Router();

remixRouter.get('/info/:itemId', (req, res) => {
  const found = itemRecipe(Number(req.params.itemId));
  if (!found) return res.status(404).json({ success: false, error: 'هذا العمل لا يمكن صنع مثله' });
  res.json({
    success: true, available: serviceOn('remix') && serviceOn('gallery'), boxes: boxes(found.recipe), price: pricePoints(found.recipe),
    summary: summary(found.recipe), balance: req.user ? balancePoints(req.user.id) : null, credits: req.user ? balanceCredits(req.user.id) : null,
  });
});

remixRouter.post('/:itemId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    if ((!serviceOn('remix') || !serviceOn('gallery')) && req.user!.role !== 'admin') return res.status(503).json({ success: false, error: 'هذه الخدمة متوقفة مؤقتاً' });
    if (!key()) return res.status(503).json({ success: false, error: 'الخدمة غير متاحة حالياً' });
    const found = itemRecipe(Number(req.params.itemId));
    if (!found) return res.status(404).json({ success: false, error: 'هذا العمل لا يمكن صنع مثله' });
    const { recipe, row: item } = found;

    // Only the boxes the recipe offers, each within its length
    const input: Record<string, string> = {};
    for (const box of boxes(recipe)) {
      const value = String(req.body?.[box.key] ?? '').trim().slice(0, box.max);
      if (value.length < 3) return res.status(400).json({ success: false, error: `اكتب ${box.label}` });
      input[box.key] = value;
    }
    const { moderationMode, moderationAi } = getSettings();
    const verdict = await moderateFull(Object.values(input).join('\n'), { userId, feature: 'remix', mode: moderationMode, ai: moderationAi === 'on' });
    if (!verdict.allowed) return res.status(400).json({ success: false, code: 'CONTENT_BLOCKED', error: BLOCKED_MESSAGE });

    const busy = (db.prepare("SELECT COUNT(*) AS n FROM gallery_remixes WHERE user_id = ? AND status = 'working'").get(userId) as { n: number }).n;
    if (busy >= 2) return res.status(429).json({ success: false, error: 'لديك عملان قيد التنفيذ، انتظر حتى ينتهي أحدهما' });

    const points = pricePoints(recipe);
    // The customer confirmed this price: a changed setting since then is refused rather than charged differently
    if (req.body?.price != null && Number(req.body.price) !== points) return res.status(409).json({ success: false, error: 'تغيّر السعر، راجع التكلفة من جديد' });
    const id = crypto.randomBytes(8).toString('hex');
    try {
      chargePoints(userId, points, `اصنع مثله · ${item.title}`);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ: تحتاج ${points} نقطة ورصيدك ${balancePoints(userId)} نقطة.` });
      }
      throw err;
    }
    db.prepare('INSERT INTO gallery_remixes (id, user_id, item_id, type, input, points) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, item.id, recipe.type, JSON.stringify(input), points);
    run(getRemix(id)!, recipe, input);
    res.json({ success: true, id, balance: balancePoints(userId), credits: balanceCredits(userId) });
  } catch (error: any) {
    console.error('Remix start failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّر البدء، حاول لاحقاً' });
  }
});

const view = (r: RemixRow) => ({
  id: r.id, itemId: r.item_id, type: r.type, status: r.status, error: r.error, points: r.points, createdAt: r.created_at,
  input: JSON.parse(r.input), resultType: r.result_type, file: r.status === 'done' ? `/api/remix/job/${r.id}/file` : null,
});

remixRouter.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM gallery_remixes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user!.id) as unknown as RemixRow[];
  res.json({ success: true, remixes: rows.map(view) });
});

remixRouter.get('/job/:id', requireAuth, (req, res) => {
  const row = getRemix(String(req.params.id));
  if (!row || (row.user_id !== req.user!.id && req.user!.role !== 'admin')) return res.status(404).json({ success: false, error: 'غير موجود' });
  res.json({ success: true, remix: view(row), balance: balancePoints(req.user!.id), credits: balanceCredits(req.user!.id) });
});

remixRouter.get('/job/:id/file', requireAuth, (req, res) => {
  const row = getRemix(String(req.params.id));
  if (!row?.result_key || (row.user_id !== req.user!.id && req.user!.role !== 'admin')) return res.status(404).end();
  const ext = row.result_key.split('.').pop();
  sendMedia(res, row.result_key, { type: row.result_type || 'application/octet-stream', download: req.query.download ? `sawtik-${row.id}.${ext}` : undefined, cache: 'private' })
    .catch(() => res.status(404).end());
});
