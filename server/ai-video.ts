// AI video clips from OpenRouter's video API, for the admin dashboard only (mounted under /api/admin). A clip is
// asked for with a prompt and a model; OpenRouter works on it in the background (30 seconds to a few minutes), and
// when it is done the MP4 is saved to DATA_DIR/ai-video so what was paid for is never lost and can be reused as a
// scene later. Every price is shown before generating, and a clip that would cost more than what is left of the
// key's spending cap (or more than AI_VIDEO_MAX_USD, default 3) is refused.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { openRouterStats } from './openrouter-stats.ts';

const base = () => process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
const key = () => process.env.OPENROUTER_API_KEY || '';
const dir = () => path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'ai-video');
const maxUsd = () => Number(process.env.AI_VIDEO_MAX_USD) || 3;
const MAX_ACTIVE = 5;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const aiVideoRouter = express.Router();

// ---------- Models and prices ----------

export interface VideoModel {
  id: string;
  name: string;
  resolutions: string[];
  aspectRatios: string[];
  durations: number[];
  audio: boolean;           // can make sound too (generate_audio)
  firstFrame: boolean;      // can start from a picture
  needsImage: boolean;      // only animates a picture: a first frame is required
  /** USD per second at each resolution, with and without sound (null: priced another way, e.g. tokens). */
  prices: Record<string, { silent: number | null; sound: number | null }>;
  /** USD for each picture used as input, when the model charges for it. */
  imageUsd: number;
}

/** USD per second of video for these SKUs, or null when the price is not per second. */
export function perSecond(skus: Record<string, string>, resolution: string, sound: boolean, image: boolean): number | null {
  const r = resolution.toLowerCase();
  const a = sound ? 'with_audio' : 'without_audio';
  const dollars = (k: string) => (skus[k] !== undefined && Number.isFinite(Number(skus[k])) ? Number(skus[k]) : undefined);
  const cents = (k: string) => (dollars(k) === undefined ? undefined : dollars(k)! / 100);
  const found = [
    image ? dollars(`image_to_video_duration_seconds_${r}`) : undefined,
    dollars(`duration_seconds_${a}_${r}`), dollars(`duration_seconds_${a}`),
    dollars(`duration_seconds_${r}`), dollars(`text_to_video_duration_seconds_${r}`), dollars('duration_seconds'),
    cents(`cents_per_video_output_second_${r}`), cents(`cents_per_second_output_${r}`), cents('cents_per_second_output'),
  ].find(v => v !== undefined);
  return found ?? null;
}

let modelCache: { at: number; models: VideoModel[] } | null = null;
// Models that turned out to need a picture (OpenRouter's list does not say so): learnt from their refusal
const needImage = new Set<string>();

/** A description that offers image-to-video but never text-to-video, e.g. "It supports image to video and…". */
const imageOnly = (description: string) =>
  /image[ -]to[ -]video/i.test(description) && !/text[ -]to[ -]video|from (?:a )?text|text prompts?/i.test(description);
const withLearnt = (m: VideoModel): VideoModel => (needImage.has(m.id) ? { ...m, needsImage: true } : m);

export async function videoModels(): Promise<VideoModel[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  const res = await fetch(`${base()}/videos/models`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const list: any[] = (await res.json())?.data ?? [];
  const models = list
    // Editing and upscaling models need a video, avatar models a voice: only the ones that make a clip from a prompt
    .filter(m => Array.isArray(m.supported_durations) && Array.isArray(m.supported_aspect_ratios) && Array.isArray(m.supported_resolutions))
    .map((m): VideoModel => {
      const skus: Record<string, string> = m.pricing_skus ?? {};
      const prices: VideoModel['prices'] = {};
      for (const r of m.supported_resolutions as string[]) prices[r] = { silent: perSecond(skus, r, false, false), sound: m.generate_audio ? perSecond(skus, r, true, false) : null };
      const imageCents = Number(skus.cents_per_image_input);
      return {
        id: m.id, name: String(m.name || m.id).replace(/^[^:]+:\s*/, ''),
        resolutions: m.supported_resolutions, aspectRatios: m.supported_aspect_ratios, durations: m.supported_durations,
        audio: m.generate_audio === true, firstFrame: Array.isArray(m.supported_frame_images) && m.supported_frame_images.includes('first_frame'),
        needsImage: imageOnly(String(m.description || '')),
        prices, imageUsd: Number.isFinite(imageCents) ? imageCents / 100 : 0,
      };
    })
    .sort((a, b) => cheapest(a) - cheapest(b));
  modelCache = { at: Date.now(), models };
  return models;
}

/** The lowest per-second price of a model (models priced another way go last). */
const cheapest = (m: VideoModel) => Math.min(Infinity, ...Object.values(m.prices).map(p => p.silent ?? Infinity));

aiVideoRouter.get('/models', async (_req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
  try {
    res.json({ success: true, models: (await videoModels()).map(withLearnt) });
  } catch (error: any) {
    console.error('Video models failed:', error?.message || error);
    res.status(502).json({ success: false, error: 'تعذّر جلب قائمة النماذج من OpenRouter' });
  }
});

// ---------- Jobs: one JSON file per clip, so a restart loses nothing that was paid for ----------

export interface VideoJob {
  id: string;
  model: string;
  modelName: string;
  prompt: string;
  resolution: string;
  aspectRatio: string;
  duration: number;
  sound: boolean;
  image: boolean;
  estimateUsd: number;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  error?: string;
  costUsd?: number;
  file?: boolean;
}

const safeId = (id: unknown): string | null => (typeof id === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(id) ? id : null);
const metaFile = (id: string) => path.join(dir(), `${id}.json`);
const videoFile = (id: string) => path.join(dir(), `${id}.mp4`);
const terminal = (s: VideoJob['status']) => s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'expired';

async function readJob(id: string): Promise<VideoJob | null> {
  try { return JSON.parse(await fs.readFile(metaFile(id), 'utf8')); } catch { return null; }
}
async function writeJob(job: VideoJob) {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(metaFile(job.id), JSON.stringify(job, null, 1));
}
async function allJobs(): Promise<VideoJob[]> {
  const names = await fs.readdir(dir()).catch(() => [] as string[]);
  const jobs = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => readJob(n.slice(0, -5))));
  return jobs.filter((j): j is VideoJob => Boolean(j)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Ask for a clip ----------

aiVideoRouter.post('/generate', async (req, res) => {
  try {
    if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
    const b = req.body ?? {};
    const found = (await videoModels()).find(m => m.id === b.model);
    const model = found && withLearnt(found);
    if (!model) return res.status(400).json({ success: false, error: 'النموذج غير موجود في القائمة' });
    const prompt = String(b.prompt || '').trim().slice(0, 2000);
    if (prompt.length < 5) return res.status(400).json({ success: false, error: 'اكتب وصف المشهد' });
    const resolution = String(b.resolution || '');
    const aspectRatio = String(b.aspectRatio || '');
    const duration = Number(b.duration);
    if (!model.resolutions.includes(resolution) || !model.aspectRatios.includes(aspectRatio) || !model.durations.includes(duration)) {
      return res.status(400).json({ success: false, error: 'الدقة أو الأبعاد أو المدة غير مدعومة في هذا النموذج' });
    }
    const sound = b.sound === true && model.audio;
    const image = typeof b.imageDataUrl === 'string' && b.imageDataUrl.startsWith('data:image/');
    if (image && (!model.firstFrame || b.imageDataUrl.length > MAX_IMAGE_BYTES * 1.4)) {
      return res.status(400).json({ success: false, error: model.firstFrame ? 'الصورة أكبر من 4 ميغابايت' : 'هذا النموذج لا يبدأ من صورة' });
    }
    if (!image && model.needsImage) return res.status(400).json({ success: false, error: 'هذا النموذج يحرّك صورة فقط: أضف صورة البداية' });

    // What it will cost, before anything is spent
    const rate = model.prices[resolution]?.[sound ? 'sound' : 'silent'] ?? null;
    if (rate === null) return res.status(400).json({ success: false, error: 'سعر هذا النموذج بالتوكنز ولا يمكن تقديره، اختر نموذجاً آخر' });
    const estimateUsd = Math.round((rate * duration + (image ? model.imageUsd : 0)) * 10_000) / 10_000;
    if (estimateUsd > maxUsd()) return res.status(400).json({ success: false, error: `التكلفة المقدّرة $${estimateUsd} تتجاوز الحد المسموح للمقطع الواحد ($${maxUsd()})` });
    const stats = await openRouterStats().catch(() => null);
    if (stats?.remaining != null && estimateUsd > stats.remaining) {
      return res.status(402).json({ success: false, error: `المتبقي من حد صرف المفتاح $${stats.remaining.toFixed(2)} ولا يكفي (التقدير $${estimateUsd}). ارفع الحد من openrouter.ai/settings/keys` });
    }
    if ((await allJobs()).filter(j => !terminal(j.status)).length >= MAX_ACTIVE) {
      return res.status(429).json({ success: false, error: 'هناك عدة مقاطع قيد التوليد الآن، انتظر حتى تنتهي' });
    }

    const submit = await fetch(`${base()}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id, prompt, duration, resolution, aspect_ratio: aspectRatio,
        ...(model.audio ? { generate_audio: sound } : {}),
        ...(image ? { frame_images: [{ type: 'image_url', image_url: { url: b.imageDataUrl }, frame_type: 'first_frame' }] } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const answer: any = await submit.json().catch(() => ({}));
    const id = safeId(answer.id);
    if (!submit.ok || !id) {
      console.error('Video request refused:', submit.status, JSON.stringify(answer).slice(0, 400));
      const reason = String(answer?.error?.message || answer?.error || submit.status).slice(0, 200);
      if (!image && /frame_images|first_frame/i.test(reason)) needImage.add(model.id);
      // Our own 4xx/500, not 502: a gateway in front of the site may swap a 502 for its own page and hide the reason
      return res.status(submit.status >= 400 && submit.status < 500 ? 400 : 500).json({ success: false, error: `رفض OpenRouter الطلب: ${reason}` });
    }
    const job: VideoJob = {
      id, model: model.id, modelName: model.name, prompt, resolution, aspectRatio, duration, sound, image, estimateUsd,
      createdAt: new Date().toISOString(), status: answer.status === 'completed' ? 'completed' : 'pending',
    };
    await writeJob(job);
    res.json({ success: true, job });
  } catch (error: any) {
    console.error('Video generate failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّر إرسال الطلب، حاول بعد قليل' });
  }
});

// ---------- Follow a clip, and save it when it is ready ----------

const lastPoll = new Map<string, number>();

async function saveVideo(id: string, done: any) {
  const own = typeof done.unsigned_urls?.[0] === 'string' && !done.unsigned_urls[0].startsWith(new URL(base()).origin) ? done.unsigned_urls[0] : null;
  // The key is only ever sent to OpenRouter itself, not to wherever a signed link points
  const res = await fetch(own ?? `${base()}/videos/${id}/content?index=0`, {
    headers: own ? {} : { Authorization: `Bearer ${key()}` }, redirect: 'follow', signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error('empty video');
  await fs.writeFile(videoFile(id), bytes);
}

aiVideoRouter.get('/jobs/:id', async (req, res) => {
  const id = safeId(req.params.id);
  const job = id ? await readJob(id) : null;
  if (!id || !job) return res.status(404).json({ success: false, error: 'المقطع غير موجود' });
  if (terminal(job.status) && (job.status !== 'completed' || job.file)) return res.json({ success: true, job });
  // Polled at most every 4 seconds per clip, however often the page asks
  if (Date.now() - (lastPoll.get(id) ?? 0) < 4000) return res.json({ success: true, job });
  lastPoll.set(id, Date.now());
  try {
    const r = await fetch(`${base()}/videos/${id}`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`poll ${r.status}`);
    if (d.status === 'completed') {
      await saveVideo(id, d);
      job.status = 'completed';
      job.file = true;
      const reported = Number(d.usage?.cost);
      job.costUsd = Number.isFinite(reported) && reported > 0 ? reported : job.estimateUsd;
    } else if (['failed', 'cancelled', 'expired'].includes(d.status)) {
      job.status = d.status;
      job.error = String(d.error?.message || d.error || '').slice(0, 300) || undefined;
    } else {
      job.status = d.status === 'in_progress' ? 'in_progress' : 'pending';
    }
    await writeJob(job);
    res.json({ success: true, job });
  } catch (error: any) {
    console.error('Video poll failed:', error?.message || error);
    res.json({ success: true, job }); // the page just asks again
  }
});

aiVideoRouter.get('/jobs/:id/file', async (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  if (req.query.download) res.attachment(`ai-scene-${id}.mp4`);
  res.type('video/mp4').sendFile(videoFile(id), error => { if (error && !res.headersSent) res.status(404).end(); });
});

aiVideoRouter.get('/library', async (_req, res) => {
  const jobs = (await allJobs()).slice(0, 100);
  res.json({ success: true, jobs, spentUsd: Math.round(jobs.reduce((sum, j) => sum + (j.status === 'completed' ? j.costUsd ?? 0 : 0), 0) * 100) / 100 });
});

aiVideoRouter.delete('/jobs/:id', async (req, res) => {
  const id = safeId(req.params.id);
  if (!id || !(await readJob(id))) return res.status(404).json({ success: false, error: 'المقطع غير موجود' });
  await Promise.all([fs.rm(metaFile(id), { force: true }), fs.rm(videoFile(id), { force: true })]);
  lastPoll.delete(id);
  res.json({ success: true });
});
