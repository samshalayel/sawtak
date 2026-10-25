// Bulk voice greetings: one message for a whole member list (an association, a company, a school…).
// Runs as a background job on the server, one greeting at a time, so it scales from 3 names to thousands
// without the customer keeping the page open. Videos are kept on disk only until downloaded
// (deleted after 24 hours at most, or immediately on request).
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import zlib from 'zlib';
import { db, getSettings } from './db.ts';
import { estimateCredits, pointsText, reserveCredits, releaseCredits, settleTtsCharge, logUsage, pcmSeconds, InsufficientCreditsError, AUDIO_TOKENS_PER_SECOND } from './credits.ts';

/** Each card costs the card price (or its voice price if a long text costs more). */
const cardPrice = () => ({ minPoints: getSettings().costGreeting, note: 'بطاقة تهنئة' });
import { NoKeysAvailableError } from './keys.ts';
import { renderVoiceVideo, normalizeImage, normalizeTemplate, RenderBusyError } from './video.ts';
import { isGreetingTheme } from './greeting-themes.ts';
import { PhotoBox, TextStyle, clampPhotoBox, clampTextStyle } from './greeting-art.ts';
import { requireAuth, requireVerifiedEmail } from './auth.ts';

type Gender = 'm' | 'f' | 'p';
const GENDERS: Gender[] = ['m', 'f', 'p'];

export const MAX_MEMBERS = 300;            // per batch: keeps one ZIP under ~1 GB; bigger lists are split
const KEEP_MS = 24 * 60 * 60 * 1000;
const BATCHES_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'greeting-batches');

interface Member { name: string; gender: Gender; phone: string }
interface Item { member: Member; status: 'pending' | 'working' | 'done' | 'error'; error?: string; file?: string; seconds?: number }

interface Batch {
  id: string;
  userId: number;
  createdAt: number;
  status: 'queued' | 'running' | 'done' | 'stopped';
  stopReason?: string;
  cancelled: boolean;
  occasion: string;
  texts: Partial<Record<Gender, string>>;   // each contains {name}
  title: string;                            // may contain {name}
  from: string;
  voice: string;
  style: string;
  photo: Buffer | null;
  template: Buffer | null;
  photoBox: PhotoBox;
  textStyle: TextStyle;
  domain: string;
  items: Item[];
  creditsUsed: number;
}

/** What the batch worker needs from the main app (TTS call, style directive, moderation). */
export interface BatchDeps {
  voices: string[];
  ttsModel: string;
  buildStyle: (opts: { dialect: string; toneStyle: string; customStylePrompt: string }) => string;
  synthesize: (text: string, voice: string, style: string) => Promise<{ response: any; keyId: number; wav: Buffer | null }>;
  usageTokens: (response: any) => { promptTokens: number; outputTokens: number };
  passesModeration: (req: express.Request, res: express.Response, text: string, feature: string) => Promise<boolean>;
  watermarkDomain: (host: string) => string;
}

const batches = new Map<string, Batch>();
let queue: Batch[] = [];
let working = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fill = (template: string, name: string) => template.split('{name}').join(name);
const safeFileName = (index: number, name: string) =>
  `${String(index + 1).padStart(3, '0')}-${name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'member'}.mp4`;

// Jobs live in memory, so files left by a previous run can't be downloaded anymore: start clean
await fs.rm(BATCHES_DIR, { recursive: true, force: true }).catch(() => {});

setInterval(async () => {
  for (const batch of batches.values()) {
    if (Date.now() - batch.createdAt > KEEP_MS) await removeBatch(batch);
  }
}, 30 * 60_000).unref();

async function removeBatch(batch: Batch) {
  batch.cancelled = true;
  queue = queue.filter(b => b !== batch);
  batches.delete(batch.id);
  await fs.rm(path.join(BATCHES_DIR, batch.id), { recursive: true, force: true }).catch(() => {});
}

// ---------- Worker: one batch, one greeting at a time ----------

async function runQueue(deps: BatchDeps) {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const batch = queue.shift()!;
      if (batch.cancelled) continue;
      batch.status = 'running';
      await runBatch(batch, deps).catch(err => {
        console.error('[greeting-batch] failed:', err);
        batch.status = 'stopped';
        batch.stopReason = 'حدث خطأ غير متوقع أثناء التجهيز.';
      });
    }
  } finally {
    working = false;
  }
}

async function runBatch(batch: Batch, deps: BatchDeps) {
  const dir = path.join(BATCHES_DIR, batch.id);
  await fs.mkdir(dir, { recursive: true });

  for (let i = 0; i < batch.items.length; i++) {
    if (batch.cancelled) return;
    const item = batch.items[i];
    const text = fill(batch.texts[item.member.gender] ?? Object.values(batch.texts)[0]!, item.member.name);
    item.status = 'working';

    // 1. Hold credit for this greeting; an empty balance stops the batch (what's done stays downloadable)
    let held = 0;
    const price = cardPrice();
    try {
      held = reserveCredits(batch.userId, estimateCredits(text, 1, price.minPoints));
    } catch (err) {
      if (!(err instanceof InsufficientCreditsError)) throw err;
      item.status = 'pending';
      batch.status = 'stopped';
      batch.stopReason = `نفد الرصيد بعد ${batch.items.filter(x => x.status === 'done').length} تهنئة. اشحن رصيدك ثم أعد إرسال الأسماء المتبقية.`;
      return;
    }

    try {
      // 2. Voice: when every key is busy, wait and retry instead of failing the greeting
      let synth: Awaited<ReturnType<BatchDeps['synthesize']>> | null = null;
      for (let attempt = 0; !synth; attempt++) {
        try {
          synth = await deps.synthesize(text, batch.voice, batch.style);
        } catch (err) {
          if (!(err instanceof NoKeysAvailableError) || attempt >= 15 || batch.cancelled) throw err;
          await sleep(60_000);
        }
      }
      const tokens = deps.usageTokens(synth.response);
      if (!synth.wav) {
        releaseCredits(batch.userId, held);
        held = 0;
        logUsage({ userId: batch.userId, feature: 'tts', model: deps.ttsModel, voice: batch.voice, chars: text.length, ...tokens, status: 'failed', apiKeyId: synth.keyId });
        throw new Error('لم يصل صوت من النموذج');
      }
      const audioSeconds = pcmSeconds(synth.wav);
      const { charged } = settleTtsCharge({
        userId: batch.userId, feature: 'tts', model: deps.ttsModel, voice: batch.voice, chars: text.length,
        promptTokens: tokens.promptTokens, outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
        audioSeconds, apiKeyId: synth.keyId,
      }, held, price);
      held = 0;
      batch.creditsUsed += charged;

      // 3. Video (shares the render queue with everyone else; waits politely when it is full)
      let mp4: Buffer | null = null;
      while (!mp4) {
        try {
          mp4 = await renderVoiceVideo({
            wav: synth.wav, text, image: batch.photo, format: 'vertical',
            greeting: { themeId: batch.occasion, from: batch.from, template: batch.template, photoBox: batch.photoBox, textStyle: batch.textStyle },
            title: fill(batch.title, item.member.name).slice(0, 60), captions: true, domain: batch.domain,
          });
        } catch (err) {
          if (!(err instanceof RenderBusyError) || batch.cancelled) throw err;
          await sleep(5_000);
        }
      }
      item.file = safeFileName(i, item.member.name);
      item.seconds = audioSeconds;
      await fs.writeFile(path.join(dir, item.file), mp4);
      item.status = 'done';
    } catch (err: any) {
      if (held > 0) releaseCredits(batch.userId, held);
      item.status = 'error';
      item.error = err instanceof NoKeysAvailableError ? 'الخوادم مشغولة' : 'تعذّر التجهيز';
      console.warn(`[greeting-batch] ${batch.id} item ${i + 1}:`, err?.message || err);
    }
  }
  // A stop request keeps its "stopped" status and reason
  if (!batch.cancelled) batch.status = 'done';
}

// ---------- ZIP (stored, no compression: MP4 is already compressed) ----------

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export async function streamZip(res: express.Response, files: { name: string; data: () => Promise<Buffer> }[]) {
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());
  const write = (chunk: Buffer) => new Promise<void>(resolve => (res.write(chunk) ? resolve() : res.once('drain', resolve)));

  for (const file of files) {
    const data = await file.data();
    const name = Buffer.from(file.name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);        // UTF-8 file names (Arabic)
    local.writeUInt16LE(0, 8);             // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(local);
    await write(name);
    await write(data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(centralBuf);
  await write(end);
  res.end();
}

// ---------- Routes ----------

const GENDER_WORDS: Record<string, Gender> = {
  m: 'm', male: 'm', 'ذكر': 'm', 'م': 'm', 'رجل': 'm',
  f: 'f', female: 'f', 'أنثى': 'f', 'انثى': 'f', 'ف': 'f', 'ث': 'f', 'امرأة': 'f',
  p: 'p', 'جمع': 'p', 'عائلة': 'p', 'زوجان': 'p',
};

function publicBatch(b: Batch) {
  return {
    id: b.id,
    status: b.status,
    stopReason: b.stopReason,
    total: b.items.length,
    done: b.items.filter(i => i.status === 'done').length,
    failed: b.items.filter(i => i.status === 'error').length,
    creditsUsed: b.creditsUsed,
    ahead: b.status === 'queued' ? queue.indexOf(b) + (working ? 1 : 0) : 0,
    expiresAt: b.createdAt + KEEP_MS,
    items: b.items.map((i, n) => ({ n, name: i.member.name, status: i.status, error: i.error, ready: Boolean(i.file) })),
  };
}

export function createGreetingBatchRouter(deps: BatchDeps) {
  const router = express.Router();
  router.use(requireAuth);

  const own = (req: express.Request) => {
    const b = batches.get(String(req.params.id));
    return b && b.userId === req.user!.id ? b : null;
  };

  router.post('/', requireVerifiedEmail, async (req, res) => {
    const body = req.body ?? {};
    if (!isGreetingTheme(body.occasion)) return res.status(400).json({ success: false, error: 'المناسبة غير معروفة' });
    if (!deps.voices.includes(body.voice)) return res.status(400).json({ success: false, error: 'الصوت المختار غير متاح' });

    const members: Member[] = (Array.isArray(body.members) ? body.members : [])
      .map((m: any) => ({
        name: String(m?.name || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        gender: GENDERS.includes(m?.gender) ? m.gender : (GENDER_WORDS[String(m?.gender || '').trim().toLowerCase()] ?? 'm'),
        phone: String(m?.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
      }))
      .filter((m: Member) => m.name);
    if (members.length === 0) return res.status(400).json({ success: false, error: 'أضف اسماً واحداً على الأقل' });
    if (members.length > MAX_MEMBERS) {
      return res.status(400).json({ success: false, error: `الحد الأقصى ${MAX_MEMBERS} اسماً في الدفعة الواحدة. قسّم القائمة إلى دفعات.` });
    }

    const texts: Partial<Record<Gender, string>> = {};
    for (const g of GENDERS) {
      const t = String(body.texts?.[g] || '').trim().slice(0, 1500);
      if (t) texts[g] = t;
    }
    const missing = [...new Set(members.map(m => m.gender))].filter(g => !texts[g]);
    if (Object.keys(texts).length === 0 || missing.length) {
      return res.status(400).json({ success: false, error: 'نص التهنئة ناقص لبعض الأعضاء (ذكر / أنثى / جمع)' });
    }
    const title = String(body.title || '').trim().slice(0, 60);
    const from = String(body.from || '').trim().slice(0, 40);

    // Everything that ends up spoken or written is checked once, names included
    const allText = [...Object.values(texts), title, from, members.map(m => m.name).join('، ')].join('\n');
    if (!(await deps.passesModeration(req, res, allText, 'video'))) return;

    if ([...batches.values()].some(b => b.userId === req.user!.id && (b.status === 'queued' || b.status === 'running'))) {
      return res.status(409).json({ success: false, error: 'لديك دفعة تهاني قيد التجهيز. انتظر انتهاءها أو أوقفها أولاً.' });
    }

    // The whole list must be affordable up front (each card is charged when it is made)
    const { minPoints } = cardPrice();
    const estimate = members.reduce((sum, m) => sum + estimateCredits(fill(texts[m.gender]!, m.name), 1, minPoints), 0);
    const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user!.id) as { credits: number };
    if (credits < estimate) {
      return res.status(402).json({
        success: false, code: 'INSUFFICIENT_CREDITS',
        error: `تحتاج هذه الدفعة حوالي ${pointsText(estimate)}، ورصيدك ${pointsText(credits)}.`,
      });
    }

    let photo: Buffer | null = null;
    let template: Buffer | null = null;
    try {
      if (typeof body.imageBase64 === 'string' && body.imageBase64) photo = await normalizeImage(Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      if (typeof body.templateBase64 === 'string' && body.templateBase64) template = await normalizeTemplate(Buffer.from(body.templateBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
    } catch {
      return res.status(400).json({ success: false, error: 'تعذّر قراءة الصورة، جرّب صورة JPG أو PNG' });
    }

    const batch: Batch = {
      id: crypto.randomBytes(12).toString('base64url'),
      userId: req.user!.id,
      createdAt: Date.now(),
      status: 'queued',
      cancelled: false,
      occasion: body.occasion,
      texts,
      title,
      from,
      voice: body.voice,
      style: deps.buildStyle({ dialect: String(body.dialect || 'msa'), toneStyle: String(body.tone || 'conversational_warm'), customStylePrompt: String(body.style || '').slice(0, 300) }),
      photo,
      template,
      photoBox: clampPhotoBox(body.photoBox),
      textStyle: clampTextStyle(body.textStyle),
      domain: deps.watermarkDomain(req.hostname),
      items: members.map(member => ({ member, status: 'pending' })),
      creditsUsed: 0,
    };
    batches.set(batch.id, batch);
    queue.push(batch);
    runQueue(deps);
    res.status(202).json({ success: true, batch: publicBatch(batch), estimate });
  });

  router.get('/latest', (req, res) => {
    const mine = [...batches.values()].filter(b => b.userId === req.user!.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    res.json({ success: true, batch: mine ? publicBatch(mine) : null });
  });

  router.get('/:id', (req, res) => {
    const b = own(req);
    if (!b) return res.status(404).json({ success: false, error: 'الدفعة غير موجودة أو انتهت صلاحيتها' });
    res.json({ success: true, batch: publicBatch(b) });
  });

  router.get('/:id/items/:n', async (req, res) => {
    const b = own(req);
    const item = b?.items[Number(req.params.n)];
    if (!b || !item?.file) return res.status(404).json({ success: false, error: 'الفيديو غير جاهز' });
    res.type('video/mp4').sendFile(path.join(BATCHES_DIR, b.id, item.file));
  });

  router.get('/:id/zip', async (req, res) => {
    const b = own(req);
    if (!b) return res.status(404).json({ success: false, error: 'الدفعة غير موجودة أو انتهت صلاحيتها' });
    const ready = b.items.filter(i => i.file);
    if (ready.length === 0) return res.status(404).json({ success: false, error: 'لا توجد فيديوهات جاهزة بعد' });

    // A list next to the videos: who each file is for, and their phone for sending
    const csv = '﻿' + ['الاسم,الجنس,الجوال,الملف', ...b.items.map(i =>
      [i.member.name, i.member.gender === 'f' ? 'أنثى' : i.member.gender === 'p' ? 'جمع' : 'ذكر', i.member.phone, i.file ?? (i.status === 'error' ? 'لم يُجهّز' : '')]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\r\n');

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="greetings-${b.occasion}.zip"`,
    });
    await streamZip(res, [
      { name: 'قائمة-التهاني.csv', data: async () => Buffer.from(csv, 'utf8') },
      ...ready.map(i => ({ name: i.file!, data: () => fs.readFile(path.join(BATCHES_DIR, b.id, i.file!)) })),
    ]);
  });

  router.post('/:id/stop', (req, res) => {
    const b = own(req);
    if (!b) return res.status(404).json({ success: false, error: 'الدفعة غير موجودة' });
    if (b.status === 'queued' || b.status === 'running') {
      b.cancelled = true;
      b.status = 'stopped';
      b.stopReason = 'أوقفتَ الدفعة. الفيديوهات الجاهزة متاحة للتحميل.';
      queue = queue.filter(x => x !== b);
    }
    res.json({ success: true, batch: publicBatch(b) });
  });

  router.delete('/:id', async (req, res) => {
    const b = own(req);
    if (!b) return res.status(404).json({ success: false, error: 'الدفعة غير موجودة' });
    await removeBatch(b);
    res.json({ success: true });
  });

  return router;
}
