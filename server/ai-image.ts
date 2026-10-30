// AI pictures from OpenRouter's image models, for the admin dashboard only (mounted under /api/admin), next to the AI
// video tab. A picture is asked for through OpenRouter's images API (POST /images), optionally with a picture to edit; the work runs in the background (some models take a minute) and the result is saved to
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

export const aiImageRouter = express.Router();

// ---------- Models and prices ----------

export interface ImageModel {
  id: string;
  name: string;
  editsImages: boolean;      // takes a picture as input too (to edit or restyle it)
  aspectRatios: string[];    // as the model lists them (empty: it picks)
  resolutions: string[];     // e.g. 1K, 2K, 4K (empty: it picks)
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

const getJson = async (url: string) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  return (await res.json())?.data ?? [];
};

export async function imageModels(): Promise<Omit<ImageModel, 'lastCostUsd'>[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  // The images API lists the models and their options; the prices are in the general model list
  const [list, priced]: any[][] = await Promise.all([
    getJson(`${base()}/images/models`),
    getJson(`${base()}/models?output_modalities=image`).catch(() => []),
  ]);
  const pricing = new Map(priced.map(m => [String(m.id), m.pricing ?? {}]));
  const values = (param: any): string[] => (Array.isArray(param?.values) ? param.values.map(String) : []);
  const models = list
    .filter(m => m?.id && !String(m.id).startsWith('openrouter/'))
    .map(m => {
      const p: any = pricing.get(String(m.id)) ?? {};
      const image = Number(p.image);
      const params = m.supported_parameters ?? {};
      return {
        id: String(m.id), name: String(m.name || m.id).replace(/^[^:]+:\s*/, ''),
        editsImages: Number(params.input_references?.max) > 0,
        aspectRatios: values(params.aspect_ratio).filter(a => a !== 'auto'),
        resolutions: values(params.resolution),
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
    res.json({ success: true, models: (await imageModels()).map(m => ({ ...m, lastCostUsd: costs.get(m.id) ?? null })) });
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
  resolution?: string;
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

/** The file type of picture bytes, from their first bytes. */
const kindOf = (b: Buffer): Picture['ext'] | null =>
  b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;

/** Asks OpenRouter for the picture and saves what comes back. */
export interface Picture { bytes: Buffer; ext: 'png' | 'jpg' | 'webp' }

/**
 * One picture from an OpenRouter image model (also used by the auto reel pipeline). `references` are pictures the
 * model works from (data URLs), on models that take them.
 */
export async function generatePicture(o: {
  model: string; prompt: string; aspectRatio?: string; resolution?: string; references?: string[];
}): Promise<{ pictures: Picture[]; costUsd?: number; note?: string }> {
  const res = await fetch(`${base()}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: o.model, prompt: o.prompt, n: 1,
      ...(o.aspectRatio ? { aspect_ratio: o.aspectRatio } : {}),
      ...(o.resolution ? { resolution: o.resolution } : {}),
      ...(o.references?.length ? { input_references: o.references.map(url => ({ type: 'image_url', image_url: { url } })) } : {}),
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error?.message || data?.error || `HTTP ${res.status}`).slice(0, 300));
  const cost = Number(data?.usage?.cost);
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  const note = items.map(i => i?.revised_prompt).find(t => typeof t === 'string' && t.trim())?.trim().slice(0, 500);
  if (items.length === 0) throw new Error('لم يرجع النموذج صورة');

  const pictures: Picture[] = [];
  for (const item of items.slice(0, 4)) {
    let bytes: Buffer;
    if (typeof item?.b64_json === 'string') bytes = Buffer.from(item.b64_json.replace(/^data:[^,]*,/, ''), 'base64');
    else if (typeof item?.url === 'string') {
      const inline = item.url.match(/^data:[^,]*;base64,(.*)$/s);
      if (inline) bytes = Buffer.from(inline[1], 'base64');
      else {
        // A link instead of the bytes: fetched without the key
        const r = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) continue;
        bytes = Buffer.from(await r.arrayBuffer());
      }
    } else continue;
    const ext = kindOf(bytes);
    if (ext) pictures.push({ bytes, ext });
  }
  if (pictures.length === 0) throw new Error('تعذّر حفظ الصورة');
  return { pictures, costUsd: Number.isFinite(cost) && cost > 0 ? cost : undefined, note };
}

async function run(job: ImageJob, editDataUrl: string | null) {
  try {
    const result = await generatePicture({
      model: job.model, prompt: job.prompt, aspectRatio: job.aspectRatio || undefined, resolution: job.resolution,
      references: editDataUrl ? [editDataUrl] : undefined,
    });
    job.costUsd = result.costUsd;
    job.note = result.note;
    for (const [i, p] of result.pictures.entries()) await fs.writeFile(imageFile(job.id, i, p.ext), p.bytes);
    job.ext = result.pictures[0].ext;
    job.files = result.pictures.length;
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
    const aspectRatio = model.aspectRatios.includes(b.aspectRatio) ? b.aspectRatio : '';
    const resolution = model.resolutions.includes(b.resolution) ? b.resolution : undefined;
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
      id: crypto.randomBytes(8).toString('hex'), model: model.id, modelName: model.name, prompt, aspectRatio, resolution, edit: Boolean(edit),
      createdAt: new Date().toISOString(), status: 'working', files: 0,
    };
    await writeJob(job);
    running.add(job.id);
    run(job, edit);
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
