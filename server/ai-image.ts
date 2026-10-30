// AI pictures from OpenRouter's image models, for the admin dashboard only (mounted under /api/admin), next to the AI
// video tab. A picture is asked for through the chat API with `modalities: ["image", "text"]`, optionally with a
// picture to edit; the work runs in the background (some models take a minute) and the result is saved to
// DATA_DIR/ai-image so what was paid for is never lost. Models are priced per token, so the real cost of each picture
// (OpenRouter's usage.cost) is kept and shown beside the model the next time.
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { openRouterStats } from './openrouter-stats.ts';

const base = () => process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
const key = () => process.env.OPENROUTER_API_KEY || '';
const dir = () => path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'ai-image');
const MAX_ACTIVE = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:5', '3:4', '4:3'];

export const aiImageRouter = express.Router();

// ---------- Models and prices ----------

export interface ImageModel {
  id: string;
  name: string;
  editsImages: boolean;      // takes a picture as input too (to edit or restyle it)
  answersText: boolean;      // can also answer in text: image-only models refuse to be asked for both
  /** USD per million tokens, as OpenRouter lists them. */
  inputPerM: number | null;
  outputPerM: number | null;
  /** USD per picture given as input, when listed. */
  imageInputUsd: number | null;
  /** What the last pictures from this model really cost (average), once one was made. */
  lastCostUsd: number | null;
}

const perM = (v: unknown) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) * 1_000_000 : null);

let modelCache: { at: number; models: Omit<ImageModel, 'lastCostUsd'>[] } | null = null;

async function imageModels(): Promise<Omit<ImageModel, 'lastCostUsd'>[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  const res = await fetch(`${base()}/models?output_modalities=image`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const list: any[] = (await res.json())?.data ?? [];
  const models = list
    // The auto router is not a model and has no fixed price
    .filter(m => (m.architecture?.output_modalities ?? []).includes('image') && !String(m.id).startsWith('openrouter/'))
    .map(m => {
      const p = m.pricing ?? {};
      const image = Number(p.image);
      return {
        id: String(m.id), name: String(m.name || m.id).replace(/^[^:]+:\s*/, ''),
        editsImages: (m.architecture?.input_modalities ?? []).includes('image'),
        answersText: (m.architecture?.output_modalities ?? []).includes('text'),
        // Pictures out are priced in image_output (per image token); completion is only text
        inputPerM: perM(p.prompt), outputPerM: Number(p.image_output) > 0 ? perM(p.image_output) : perM(p.completion),
        imageInputUsd: Number.isFinite(image) && image > 0 ? image : null,
      };
    })
    .sort((a, b) => (a.outputPerM ?? Infinity) - (b.outputPerM ?? Infinity));
  modelCache = { at: Date.now(), models };
  return models;
}

/** Average real cost per picture of each model, from the saved pictures. */
async function lastCosts(): Promise<Map<string, number>> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const j of await allJobs()) {
    if (j.status !== 'completed' || !j.costUsd) continue;
    const s = sums.get(j.model) ?? { total: 0, n: 0 };
    s.total += j.costUsd / Math.max(1, j.files);
    s.n++;
    sums.set(j.model, s);
  }
  return new Map([...sums].map(([id, s]) => [id, s.total / s.n]));
}

aiImageRouter.get('/models', async (_req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
  try {
    const costs = await lastCosts();
    res.json({ success: true, aspectRatios: ASPECT_RATIOS, models: (await imageModels()).map(m => ({ ...m, lastCostUsd: costs.get(m.id) ?? null })) });
  } catch (error: any) {
    console.error('Image models failed:', error?.message || error);
    res.status(502).json({ success: false, error: 'تعذّر جلب قائمة النماذج من OpenRouter' });
  }
});

// ---------- Jobs: one JSON file per request, pictures beside it ----------

export interface ImageJob {
  id: string;
  model: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  edit: boolean;            // a picture was given to edit
  createdAt: string;
  status: 'working' | 'completed' | 'failed';
  error?: string;
  /** What the model said alongside the picture, if anything. */
  note?: string;
  costUsd?: number;
  files: number;            // pictures saved: <id>-0.png, <id>-1.png…
  ext?: string;
}

const safeId = (id: unknown): string | null => (typeof id === 'string' && /^[a-f0-9]{16}$/.test(id) ? id : null);
const metaFile = (id: string) => path.join(dir(), `${id}.json`);
const imageFile = (id: string, index: number, ext: string) => path.join(dir(), `${id}-${index}.${ext}`);

async function readJob(id: string): Promise<ImageJob | null> {
  try { return JSON.parse(await fs.readFile(metaFile(id), 'utf8')); } catch { return null; }
}
async function writeJob(job: ImageJob) {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(metaFile(job.id), JSON.stringify(job, null, 1));
}
async function allJobs(): Promise<ImageJob[]> {
  const names = await fs.readdir(dir()).catch(() => [] as string[]);
  const jobs = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => readJob(n.slice(0, -5))));
  return jobs.filter((j): j is ImageJob => Boolean(j)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Jobs being worked on in this process: one left "working" after a restart is shown as failed
const running = new Set<string>();

/** Asks OpenRouter for the picture and saves what comes back. */
async function run(job: ImageJob, editDataUrl: string | null, answersText: boolean) {
  try {
    const content = editDataUrl
      ? [{ type: 'text', text: job.prompt }, { type: 'image_url', image_url: { url: editDataUrl } }]
      : job.prompt;
    const res = await fetch(`${base()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: job.model,
        messages: [{ role: 'user', content }],
        modalities: answersText ? ['image', 'text'] : ['image'],
        image_config: { aspect_ratio: job.aspectRatio },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error?.message || data?.error || `HTTP ${res.status}`).slice(0, 300));
    const message = data?.choices?.[0]?.message ?? {};
    const urls: string[] = (message.images ?? []).map((i: any) => i?.image_url?.url).filter((u: unknown) => typeof u === 'string');
    const cost = Number(data?.usage?.cost);
    if (Number.isFinite(cost) && cost > 0) job.costUsd = cost;
    job.note = typeof message.content === 'string' && message.content.trim() ? message.content.trim().slice(0, 500) : undefined;
    if (urls.length === 0) throw new Error(job.note ? `لم يرجع النموذج صورة: ${job.note}` : 'لم يرجع النموذج صورة');

    let saved = 0;
    for (const url of urls.slice(0, 4)) {
      let bytes: Buffer;
      let ext = 'png';
      const inline = url.match(/^data:image\/(\w+);base64,(.*)$/s);
      if (inline) {
        ext = inline[1] === 'jpeg' ? 'jpg' : inline[1];
        bytes = Buffer.from(inline[2], 'base64');
      } else {
        // A link instead of the bytes: fetched without the key
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) continue;
        bytes = Buffer.from(await r.arrayBuffer());
        ext = /jpe?g/.test(r.headers.get('content-type') || '') ? 'jpg' : /webp/.test(r.headers.get('content-type') || '') ? 'webp' : 'png';
      }
      if (!/^(png|jpg|webp)$/.test(ext) || bytes.length < 100) continue;
      job.ext = ext;
      await fs.writeFile(imageFile(job.id, saved, ext), bytes);
      saved++;
    }
    if (saved === 0) throw new Error('تعذّر حفظ الصورة');
    job.files = saved;
    job.status = 'completed';
  } catch (error: any) {
    console.error('Image generate failed:', error?.message || error);
    job.status = 'failed';
    job.error = String(error?.name === 'TimeoutError' ? 'انتهت المهلة (5 دقائق)' : error?.message || error).slice(0, 300);
  } finally {
    running.delete(job.id);
    await writeJob(job).catch(() => {});
  }
}

aiImageRouter.post('/generate', async (req, res) => {
  try {
    if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
    const b = req.body ?? {};
    const model = (await imageModels()).find(m => m.id === b.model);
    if (!model) return res.status(400).json({ success: false, error: 'النموذج غير موجود في القائمة' });
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (prompt.length < 3) return res.status(400).json({ success: false, error: 'اكتب وصف الصورة' });
    const aspectRatio = ASPECT_RATIOS.includes(b.aspectRatio) ? b.aspectRatio : '1:1';
    const edit = typeof b.imageDataUrl === 'string' && b.imageDataUrl.startsWith('data:image/') ? b.imageDataUrl : null;
    if (edit && (!model.editsImages || edit.length > MAX_IMAGE_BYTES * 1.4)) {
      return res.status(400).json({ success: false, error: model.editsImages ? 'الصورة أكبر من 4 ميغابايت' : 'هذا النموذج لا يأخذ صورة' });
    }
    const stats = await openRouterStats().catch(() => null);
    if (stats?.remaining != null && stats.remaining < 0.05) {
      return res.status(402).json({ success: false, error: `المتبقي من حد صرف المفتاح $${stats.remaining.toFixed(2)} فقط. ارفع الحد من openrouter.ai/settings/keys` });
    }
    if (running.size >= MAX_ACTIVE) return res.status(429).json({ success: false, error: 'هناك عدة صور قيد التوليد الآن، انتظر حتى تنتهي' });

    const job: ImageJob = {
      id: crypto.randomBytes(8).toString('hex'), model: model.id, modelName: model.name, prompt, aspectRatio, edit: Boolean(edit),
      createdAt: new Date().toISOString(), status: 'working', files: 0,
    };
    await writeJob(job);
    running.add(job.id);
    run(job, edit, model.answersText);
    res.json({ success: true, job });
  } catch (error: any) {
    console.error('Image request failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّر إرسال الطلب، حاول بعد قليل' });
  }
});

const shown = (job: ImageJob): ImageJob =>
  job.status === 'working' && !running.has(job.id) ? { ...job, status: 'failed', error: 'توقف الخادم أثناء التوليد' } : job;

aiImageRouter.get('/jobs/:id', async (req, res) => {
  const id = safeId(req.params.id);
  const job = id ? await readJob(id) : null;
  if (!id || !job) return res.status(404).json({ success: false, error: 'الصورة غير موجودة' });
  res.json({ success: true, job: shown(job) });
});

aiImageRouter.get('/jobs/:id/file/:index', async (req, res) => {
  const id = safeId(req.params.id);
  const job = id ? await readJob(id) : null;
  const index = Number(req.params.index);
  if (!id || !job?.ext || !Number.isInteger(index) || index < 0 || index >= job.files) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  if (req.query.download) res.attachment(`ai-image-${id}-${index}.${job.ext}`);
  res.sendFile(imageFile(id, index, job.ext), error => { if (error && !res.headersSent) res.status(404).end(); });
});

aiImageRouter.get('/library', async (_req, res) => {
  const jobs = (await allJobs()).slice(0, 120).map(shown);
  res.json({ success: true, jobs, spentUsd: Math.round(jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0) * 10_000) / 10_000 });
});

aiImageRouter.delete('/jobs/:id', async (req, res) => {
  const id = safeId(req.params.id);
  const job = id ? await readJob(id) : null;
  if (!id || !job) return res.status(404).json({ success: false, error: 'الصورة غير موجودة' });
  await Promise.all([
    fs.rm(metaFile(id), { force: true }),
    ...Array.from({ length: job.files }, (_, i) => fs.rm(imageFile(id, i, job.ext || 'png'), { force: true })),
  ]);
  res.json({ success: true });
});
