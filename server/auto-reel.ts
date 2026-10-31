// Automatic reels, for the admin dashboard only (mounted under /api/admin): from one idea to a finished vertical video
// of about a minute, every step written and made by AI. A text model plans the reel (the narration of each scene, the
// picture that opens it and how it moves), the studio's voice speaks each scene, an image model paints each opening
// picture, a video model animates it into a clip as long as its narration, and ffmpeg joins the clips with the voice
// and burnt-in captions. To spend less, only some scenes can be real clips: the others are their picture with a slow
// zoom made here for free. Everything made is kept in DATA_DIR/auto-reel/<id>, so a reel that stopped (a refusal, the
// spending cap, a restart) resumes where it was without paying twice for what is already there.
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { generatePicture, imageModels } from './ai-image.ts';
import { saveVideo, videoModels } from './ai-video.ts';
import { openRouterStats } from './openrouter-stats.ts';
import { ARABIC_FONT, assText, assTime, captionChunks, runFfmpeg, speechIntervals } from './video.ts';
import { VOICES } from '../src/data/presets.ts';

const base = () => process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
const key = () => process.env.OPENROUTER_API_KEY || '';
const root = () => path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'auto-reel');
const maxUsd = () => Number(process.env.AUTO_REEL_MAX_USD) || 10;
const TEXT_MODEL = () => process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash';
// A guess for a picture until the model has a real price in the image tab
const PICTURE_GUESS_USD = 0.05;
const PAUSE = 0.5;             // seconds of silence after each scene's narration
const CLIPS_AT_ONCE = 4;
const CLIP_WAIT_MS = 20 * 60_000;

// The studio's speech (server.ts synthesizeSpeech, with its provider fallbacks), handed over at start-up
type Speak = (text: string, voice: string, style: string) => Promise<Buffer | null>;
let speak: Speak | null = null;
export const setAutoReelSpeech = (fn: Speak) => { speak = fn; };

export const autoReelRouter = express.Router();

const DIALECTS: Record<string, { label: string; prompt: string }> = {
  msa: { label: 'فصحى', prompt: 'Modern Standard Arabic (فصحى), simple and natural' },
  levantine: { label: 'شامي / فلسطيني', prompt: 'Levantine Arabic as spoken in Palestine and Syria, natural and warm' },
  gulf: { label: 'خليجي', prompt: 'Gulf Arabic (Saudi/Emirati), natural' },
  egyptian: { label: 'مصري', prompt: 'Egyptian Arabic, natural' },
};

// ---------- The reel ----------

interface Scene {
  narration: string;        // Arabic, spoken by the voice
  imagePrompt: string;      // English: the opening picture
  motionPrompt: string;     // English: what moves and how the camera moves
  seconds?: number;         // length of the narration
  clipSeconds?: number;     // length of the clip asked for
  still?: boolean;          // shown as its picture with a slow zoom instead of a paid clip
  videoId?: string;         // the clip's job at OpenRouter, kept so a resume follows it instead of paying again
  imageCostUsd?: number;
  clipCostUsd?: number;
  error?: string;
}

type Stage = 'planning' | 'voice' | 'images' | 'clips' | 'assembling' | 'done' | 'failed';

interface Reel {
  id: string;
  createdAt: string;
  idea: string;
  dialect: string;
  voice: string;
  imageModel: string;
  videoModel: string;
  videoModelName: string;
  resolution: string;
  targetSeconds: number;
  sceneCount: number;
  /** How many scenes are real clips (the rest are zoomed pictures); undefined: all of them. */
  videoScenes?: number;
  estimateUsd: number;
  stage: Stage;
  error?: string;
  title?: string;
  visualStyle?: string;
  delivery?: string;        // how the narrator speaks (English direction for the voice)
  planCostUsd?: number;
  scenes: Scene[];
  duration?: number;        // of the finished video
}

const safeId = (id: unknown): string | null => (typeof id === 'string' && /^[a-f0-9]{16}$/.test(id) ? id : null);
const dirOf = (id: string) => path.join(root(), id);
const fileOf = (id: string, name: string) => path.join(dirOf(id), name);
const exists = (file: string) => fs.stat(file).then(s => s.size > 0, () => false);

async function readReel(id: string): Promise<Reel | null> {
  try { return JSON.parse(await fs.readFile(fileOf(id, 'reel.json'), 'utf8')); } catch { return null; }
}
async function writeReel(reel: Reel) {
  await fs.mkdir(dirOf(reel.id), { recursive: true });
  await fs.writeFile(fileOf(reel.id, 'reel.json'), JSON.stringify(reel, null, 1));
}

const running = new Set<string>();
/** A reel left mid-way by a restart shows as stopped, ready to resume. */
const shown = (r: Reel) => (r.stage !== 'done' && r.stage !== 'failed' && !running.has(r.id) ? { ...r, stage: 'failed' as Stage, error: r.error || 'توقف الخادم أثناء العمل، اضغط «أكمل»' } : r);
const spent = (r: Reel) => (r.planCostUsd ?? 0) + r.scenes.reduce((sum, s) => sum + (s.imageCostUsd ?? 0) + (s.clipCostUsd ?? 0), 0);

// ---------- Step 1: the plan, written by a text model ----------

/** The clip length a scene is planned around: the longest the model makes up to 10 seconds. */
const baseClip = (durations: number[]) => [...durations].sort((a, b) => a - b).filter(d => d <= 10).pop() ?? Math.min(...durations);

async function writePlan(reel: Reel, clip: number) {
  const words = Math.max(6, Math.floor(clip * 2.1));
  const instructions = [
    `You direct short vertical videos (Reels, 9:16). Plan a reel of about ${reel.targetSeconds} seconds about this idea:`,
    `"""${reel.idea}"""`,
    '',
    `It has exactly ${reel.sceneCount} scenes of about ${clip} seconds each. Answer with JSON only, in this shape:`,
    '{"title": "...", "visual_style": "...", "delivery": "...", "scenes": [{"narration": "...", "image_prompt": "...", "motion_prompt": "..."}]}',
    '',
    `- narration: what the narrator says in that scene, in ${DIALECTS[reel.dialect].prompt}. At most ${words} words, so it is spoken within ${clip} seconds.`,
    '  All the narrations read as one flowing script: a hook in the first scene, a clear closing line in the last. No hashtags, emojis or stage directions.',
    '- image_prompt: in English, a detailed description of the first frame of the scene (subject, setting, composition for a vertical frame,',
    '  lighting, colours, lens), ending with the shared visual style. Never ask for text, letters, captions, logos or watermarks in the picture.',
    `- motion_prompt: in English, what moves during the ${clip} seconds and how the camera moves, starting from that first frame. Keep it physically simple.`,
    '- visual_style: one English sentence (look, palette, lighting) shared by every scene so they belong together.',
    '- delivery: one English sentence telling the narrator how to speak (tone, pace, emotion).',
    '- title: a short Arabic title for the reel.',
  ].join('\n');
  const res = await fetch(`${base()}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEXT_MODEL(), temperature: 0.8, response_format: { type: 'json_object' }, usage: { include: true },
      messages: [{ role: 'user', content: instructions }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`كتابة الخطة: ${data?.error?.message || res.status}`);
  const text = String(data?.choices?.[0]?.message?.content ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  let plan: any;
  try { plan = JSON.parse(text); } catch { throw new Error('لم يرجع نموذج النص خطة صالحة'); }
  const scenes = (Array.isArray(plan?.scenes) ? plan.scenes : [])
    .map((s: any): Scene => ({
      narration: String(s?.narration || '').trim(), imagePrompt: String(s?.image_prompt || '').trim(), motionPrompt: String(s?.motion_prompt || '').trim(),
    }))
    .filter((s: Scene) => s.narration && s.imagePrompt)
    .slice(0, reel.sceneCount);
  if (scenes.length < 2) throw new Error('الخطة ناقصة: أقل من مشهدين');
  reel.title = String(plan.title || '').slice(0, 120);
  reel.visualStyle = String(plan.visual_style || '').slice(0, 500);
  reel.delivery = String(plan.delivery || '').slice(0, 300);
  reel.scenes = scenes;
  const cost = Number(data?.usage?.cost);
  if (Number.isFinite(cost)) reel.planCostUsd = cost;
}

/** Which scenes get a real clip when only `count` of `total` do: the first, the last, and the rest spread between. */
export function animatedScenes(total: number, count: number): Set<number> {
  if (count >= total) return new Set(Array.from({ length: total }, (_, i) => i));
  if (count <= 0) return new Set();
  if (count === 1) return new Set([0]);
  return new Set(Array.from({ length: count }, (_, k) => Math.round((k * (total - 1)) / (count - 1))));
}

// ---------- Steps 2–4: voice, pictures, clips ----------

/** Runs `fn` on every item, `limit` at a time; errors are kept on the item's scene, not thrown. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Asks for one scene's clip (or follows the one already asked for) and saves it when ready. */
async function makeClip(reel: Reel, i: number, model: Awaited<ReturnType<typeof videoModels>>[number]) {
  const scene = reel.scenes[i];
  const out = fileOf(reel.id, `scene-${i}.mp4`);
  if (await exists(out)) return;
  if (!scene.videoId) {
    const frame = await fs.readFile(fileOf(reel.id, `scene-${i}.jpg`));
    const res = await fetch(`${base()}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        // Text-to-video models only have the words: they get the picture's description as well
        prompt: (model.firstFrame ? scene.motionPrompt : `${scene.imagePrompt}\n${scene.motionPrompt}`).slice(0, 2000),
        duration: scene.clipSeconds, resolution: reel.resolution, aspect_ratio: '9:16',
        ...(model.audio ? { generate_audio: false } : {}),
        ...(model.firstFrame ? { frame_images: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${frame.toString('base64')}` }, frame_type: 'first_frame' }] } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const answer: any = await res.json().catch(() => ({}));
    if (!res.ok || typeof answer.id !== 'string') throw new Error(`رفض نموذج الفيديو: ${String(answer?.error?.message || answer?.error || res.status).slice(0, 200)}`);
    scene.videoId = answer.id;
    await writeReel(reel);
  }
  const started = Date.now();
  while (Date.now() - started < CLIP_WAIT_MS) {
    await sleep(10_000);
    const r = await fetch(`${base()}/videos/${scene.videoId}`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const d: any = r?.ok ? await r.json().catch(() => null) : null;
    if (!d) continue;
    if (d.status === 'completed') {
      await saveVideo(scene.videoId!, d, out);
      const cost = Number(d.usage?.cost);
      const rate = model.prices[reel.resolution]?.silent ?? 0;
      scene.clipCostUsd = Number.isFinite(cost) && cost > 0 ? cost : rate * (scene.clipSeconds ?? 0);
      return;
    }
    if (['failed', 'cancelled', 'expired'].includes(d.status)) {
      // A new request on resume
      scene.videoId = undefined;
      throw new Error(`فشل المقطع: ${String(d.error?.message || d.error || d.status).slice(0, 200)}`);
    }
  }
  throw new Error('تأخر المقطع أكثر من 20 دقيقة، اضغط «أكمل» لمتابعته');
}

// ---------- Step 5: one video ----------

async function assemble(reel: Reel) {
  const tall = /1080|1k|2k|4k/i.test(reel.resolution);
  const [W, H] = tall ? [1080, 1920] : [720, 1280];
  const lengths = reel.scenes.map(s => (s.seconds ?? 3) + PAUSE);
  const total = lengths.reduce((a, b) => a + b, 0);

  // Captions: each scene's phrases spread over its narration, in proportion to their length
  const fontSize = Math.round(W * 0.058);
  const events: string[] = [];
  let offset = 0;
  reel.scenes.forEach((s, i) => {
    const chunks = captionChunks(s.narration);
    const weights = chunks.map(c => c.replace(/\s/g, '').length || 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    let at = offset + 0.05;
    chunks.forEach((c, k) => {
      const len = ((s.seconds ?? 3) * weights[k]) / sum;
      events.push(`Dialogue: 0,${assTime(at)},${assTime(at + len)},Caption,,0,0,0,,${assText(c)}`);
      at += len;
    });
    offset += lengths[i];
  });
  const ass = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${ARABIC_FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,&H78000000,&H78000000,1,0,0,0,100,100,0,0,3,${Math.round(fontSize * 0.3)},0,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * 0.16)},-1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events,
  ].join('\n') + '\n';
  await fs.writeFile(fileOf(reel.id, 'captions.ass'), ass);

  // Each clip fills the frame, holds its last picture if the narration is longer, and is cut to its scene;
  // the clips' own sound (if any) is dropped for the narration
  const inputs: string[] = [];
  const parts: string[] = [];
  reel.scenes.forEach((scene, i) => {
    const d = lengths[i].toFixed(3);
    if (scene.still) {
      // The picture with a slow zoom, in on one still scene and out on the next (drawn larger first so it stays smooth)
      const frames = Math.ceil(lengths[i] * 30) + 2;
      const zoom = i % 2 === 0 ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      const [BW, BH] = [Math.round(W * 1.5 / 2) * 2, Math.round(H * 1.5 / 2) * 2];
      inputs.push('-i', `scene-${i}.jpg`, '-i', `scene-${i}.wav`);
      parts.push(`[${2 * i}:v]scale=${BW}:${BH}:force_original_aspect_ratio=increase,crop=${BW}:${BH},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30,setsar=1,format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
    } else {
      inputs.push('-i', `scene-${i}.mp4`, '-i', `scene-${i}.wav`);
      parts.push(`[${2 * i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=30,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
    }
    parts.push(`[${2 * i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const joined = reel.scenes.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${joined}concat=n=${reel.scenes.length}:v=1:a=1[vc][ac]`);
  parts.push(`[vc]subtitles=captions.ass,fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, total - 0.6).toFixed(2)}:d=0.6[vout]`);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', parts.join(';'), '-map', '[vout]', '-map', '[ac]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'final.mp4',
  ], dirOf(reel.id), { timeoutMs: 15 * 60_000, duration: total });
  reel.duration = Math.round(total * 10) / 10;
}

// ---------- The whole run (also a resume) ----------

async function pipeline(reel: Reel) {
  running.add(reel.id);
  const failures = () => reel.scenes.filter(s => s.error);
  const stopIfFailed = (what: string) => {
    if (failures().length) throw new Error(`${what}: ${failures().length} مشهد فشل — ${failures()[0].error}`);
  };
  try {
    reel.error = undefined;
    const video = (await videoModels()).find(m => m.id === reel.videoModel);
    if (!video) throw new Error('نموذج الفيديو لم يعد في القائمة');
    const picture = (await imageModels()).find(m => m.id === reel.imageModel);
    if (!picture) throw new Error('نموذج الصور لم يعد في القائمة');

    if (reel.scenes.length === 0) {
      reel.stage = 'planning';
      await writeReel(reel);
      await writePlan(reel, baseClip(video.durations));
      const animated = animatedScenes(reel.scenes.length, reel.videoScenes ?? reel.scenes.length);
      reel.scenes.forEach((s, i) => { s.still = !animated.has(i); });
      await writeReel(reel);
    }

    // The voice, scene by scene, so each scene knows its length
    reel.stage = 'voice';
    await writeReel(reel);
    if (!speak) throw new Error('محرك الصوت غير متاح');
    await eachLimit(reel.scenes.map((s, i) => i), 3, async i => {
      const s = reel.scenes[i];
      const file = fileOf(reel.id, `scene-${i}.wav`);
      try {
        s.error = undefined;
        if (!(await exists(file))) {
          const wav = await speak!(s.narration, reel.voice, reel.delivery || 'Natural, engaging narration for a short video');
          if (!wav) throw new Error('لم يرجع صوت');
          await fs.writeFile(file, wav);
        }
        s.seconds = Math.round(speechIntervals(await fs.readFile(file)).duration * 100) / 100;
        // The shortest clip the model makes that covers the narration (else its longest, held on the last frame)
        const fits = [...video.durations].sort((a, b) => a - b).find(d => d >= s.seconds! + 0.3);
        s.clipSeconds = fits ?? Math.max(...video.durations);
      } catch (error: any) {
        s.error = `الصوت: ${String(error?.message || error).slice(0, 200)}`;
      }
    });
    stopIfFailed('الصوت');

    // The opening picture of each scene
    reel.stage = 'images';
    await writeReel(reel);
    const aspect = picture.aspectRatios.includes('9:16') ? '9:16' : undefined;
    await eachLimit(reel.scenes.map((s, i) => i), 4, async i => {
      const s = reel.scenes[i];
      const file = fileOf(reel.id, `scene-${i}.jpg`);
      if (await exists(file)) return;
      try {
        s.error = undefined;
        const result = await generatePicture({ model: picture.id, prompt: s.imagePrompt, aspectRatio: aspect, resolution: picture.resolutions[0] });
        s.imageCostUsd = result.costUsd ?? s.imageCostUsd;
        // A JPEG of a sensible size: it is sent to the video model as the first frame
        const raw = fileOf(reel.id, `scene-${i}-raw.${result.pictures[0].ext}`);
        await fs.writeFile(raw, result.pictures[0].bytes);
        await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', path.basename(raw), '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', '-q:v', '3', `scene-${i}.jpg`],
          dirOf(reel.id), { timeoutMs: 60_000, duration: 0 });
        await fs.rm(raw, { force: true });
      } catch (error: any) {
        s.error = `الصورة: ${String(error?.message || error).slice(0, 200)}`;
      }
    });
    stopIfFailed('الصور');

    // The clips: what they will cost is checked against the key before asking for any
    reel.stage = 'clips';
    await writeReel(reel);
    const rate = video.prices[reel.resolution]?.silent;
    if (rate == null) throw new Error('سعر نموذج الفيديو غير معروف');
    const missing: number[] = [];
    for (const [i, s] of reel.scenes.entries()) if (!s.still && !(await exists(fileOf(reel.id, `scene-${i}.mp4`)))) missing.push(i);
    const toPay = missing.filter(i => !reel.scenes[i].videoId).reduce((sum, i) => sum + rate * (reel.scenes[i].clipSeconds ?? 0), 0);
    if (spent(reel) + toPay > maxUsd()) throw new Error(`تكلفة المقاطع $${toPay.toFixed(2)} تتجاوز حد الريل ($${maxUsd()})`);
    const stats = await openRouterStats().catch(() => null);
    if (toPay > 0 && stats?.remaining != null && toPay > stats.remaining) {
      throw new Error(`المتبقي من حد صرف المفتاح $${stats.remaining.toFixed(2)} لا يكفي للمقاطع ($${toPay.toFixed(2)}). ارفع الحد ثم اضغط «أكمل»`);
    }
    await eachLimit(missing, CLIPS_AT_ONCE, async i => {
      const s = reel.scenes[i];
      try {
        s.error = undefined;
        await makeClip(reel, i, video);
      } catch (error: any) {
        s.error = String(error?.message || error).slice(0, 300);
      }
      await writeReel(reel);
    });
    stopIfFailed('المقاطع');

    reel.stage = 'assembling';
    await writeReel(reel);
    await assemble(reel);
    reel.stage = 'done';
  } catch (error: any) {
    console.error(`[auto-reel] ${reel.id}:`, error?.message || error);
    reel.stage = 'failed';
    reel.error = String(error?.message || error).slice(0, 400);
  } finally {
    running.delete(reel.id);
    await writeReel(reel).catch(() => {});
  }
}

// ---------- Routes ----------

autoReelRouter.get('/options', async (_req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
  try {
    const [videos, images] = await Promise.all([videoModels(), imageModels()]);
    res.json({
      success: true,
      maxUsd: maxUsd(),
      pictureGuessUsd: PICTURE_GUESS_USD,
      voices: VOICES.map(v => ({ id: v.id, name: v.name, gender: v.gender })),
      dialects: Object.entries(DIALECTS).map(([id, d]) => ({ id, label: d.label })),
      // Vertical clips priced per second only
      videoModels: videos
        .filter(m => m.aspectRatios.includes('9:16') && m.resolutions.some(r => m.prices[r]?.silent != null))
        .map(m => ({ id: m.id, name: m.name, durations: m.durations, firstFrame: m.firstFrame, resolutions: m.resolutions.filter(r => m.prices[r]?.silent != null), prices: Object.fromEntries(m.resolutions.map(r => [r, m.prices[r]?.silent ?? null])) })),
      imageModels: images.map(m => ({ id: m.id, name: m.name, vertical: m.aspectRatios.includes('9:16'), outputPerM: m.outputPerM })),
    });
  } catch (error: any) {
    console.error('Auto reel options failed:', error?.message || error);
    res.status(502).json({ success: false, error: 'تعذّر جلب النماذج من OpenRouter' });
  }
});

autoReelRouter.post('/', async (req, res) => {
  try {
    if (!key()) return res.status(503).json({ success: false, error: 'مفتاح OpenRouter غير مضبوط على الخادم' });
    const b = req.body ?? {};
    const idea = String(b.idea || '').trim().slice(0, 2000);
    if (idea.length < 5) return res.status(400).json({ success: false, error: 'اكتب فكرة الريل' });
    const dialect = DIALECTS[b.dialect] ? b.dialect : 'msa';
    const voice = VOICES.some(v => v.id === b.voice) ? b.voice : VOICES[0].id;
    const video = (await videoModels()).find(m => m.id === b.videoModel);
    if (!video || !video.aspectRatios.includes('9:16')) return res.status(400).json({ success: false, error: 'اختر نموذج فيديو يدعم 9:16' });
    const resolution = String(b.resolution || '');
    const rate = video.prices[resolution]?.silent;
    if (rate == null) return res.status(400).json({ success: false, error: 'الدقة غير مدعومة أو سعرها غير معروف' });
    const picture = (await imageModels()).find(m => m.id === b.imageModel);
    if (!picture) return res.status(400).json({ success: false, error: 'اختر نموذج الصور' });
    const targetSeconds = Math.min(90, Math.max(20, Math.round(Number(b.seconds) || 60)));
    const clip = baseClip(video.durations);
    const sceneCount = Math.min(12, Math.max(2, Math.round(targetSeconds / clip)));
    const wanted = Math.round(Number(b.videoScenes));
    const videoScenes = Number.isFinite(wanted) && wanted >= 0 && wanted < sceneCount ? wanted : undefined;
    const estimateUsd = Math.round(((videoScenes ?? sceneCount) * rate * clip + sceneCount * PICTURE_GUESS_USD + 0.01) * 100) / 100;
    if (estimateUsd > maxUsd()) return res.status(400).json({ success: false, error: `التكلفة المقدّرة $${estimateUsd} تتجاوز حد الريل ($${maxUsd()})` });
    if (running.size >= 2) return res.status(429).json({ success: false, error: 'هناك ريلز قيد العمل الآن، انتظر حتى تنتهي' });

    const reel: Reel = {
      id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), idea, dialect, voice,
      imageModel: picture.id, videoModel: video.id, videoModelName: video.name, resolution, targetSeconds, sceneCount, videoScenes, estimateUsd,
      stage: 'planning', scenes: [],
    };
    await writeReel(reel);
    pipeline(reel);
    res.json({ success: true, reel });
  } catch (error: any) {
    console.error('Auto reel start failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّر بدء الريل' });
  }
});

autoReelRouter.get('/', async (_req, res) => {
  const ids = await fs.readdir(root()).catch(() => [] as string[]);
  const reels = (await Promise.all(ids.filter(id => safeId(id)).map(readReel))).filter((r): r is Reel => Boolean(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  res.json({ success: true, reels: reels.map(r => ({ ...shown(r), spentUsd: Math.round(spent(r) * 10_000) / 10_000 })) });
});

autoReelRouter.get('/:id', async (req, res) => {
  const id = safeId(req.params.id);
  const reel = id ? await readReel(id) : null;
  if (!reel) return res.status(404).json({ success: false, error: 'الريل غير موجود' });
  const files = await fs.readdir(dirOf(reel.id)).catch(() => [] as string[]);
  res.json({ success: true, reel: { ...shown(reel), spentUsd: Math.round(spent(reel) * 10_000) / 10_000 }, files });
});

autoReelRouter.post('/:id/resume', async (req, res) => {
  const id = safeId(req.params.id);
  const reel = id ? await readReel(id) : null;
  if (!reel) return res.status(404).json({ success: false, error: 'الريل غير موجود' });
  if (running.has(reel.id)) return res.status(409).json({ success: false, error: 'الريل قيد العمل' });
  if (reel.stage === 'done') return res.status(400).json({ success: false, error: 'الريل جاهز' });
  pipeline(reel);
  res.json({ success: true });
});

autoReelRouter.get('/:id/file/:name', async (req, res) => {
  const id = safeId(req.params.id);
  const name = String(req.params.name);
  if (!id || !/^(scene-\d{1,2}\.(jpg|mp4|wav)|final\.mp4)$/.test(name)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  if (req.query.download) res.attachment(`reel-${id}-${name}`);
  res.sendFile(fileOf(id, name), error => { if (error && !res.headersSent) res.status(404).end(); });
});

autoReelRouter.delete('/:id', async (req, res) => {
  const id = safeId(req.params.id);
  if (!id || !(await readReel(id))) return res.status(404).json({ success: false, error: 'الريل غير موجود' });
  if (running.has(id)) return res.status(409).json({ success: false, error: 'الريل قيد العمل، انتظر حتى يتوقف' });
  await fs.rm(dirOf(id), { recursive: true, force: true });
  res.json({ success: true });
});
