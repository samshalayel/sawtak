// Motion-graphics videos (admins and accounts granted the "motion" permission): write a script from an idea or a curriculum excerpt, voice it,
// then hand it to the motion worker through a shared folder (DATA_DIR/motion/<id>: job.json + voice.wav +
// status.json). The worker (sawtik-motion, running on the host) times the words, has the AI plan the scenes,
// renders the MP4s and writes them back into the same folder. Nothing is billed; usage is logged for cost tracking.
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ThinkingLevel } from '@google/genai';
import { requireAuth, requirePermission } from './auth.ts';
import { withGeminiFailover } from './keys.ts';
import { logUsage, pcmSeconds, chargePoints, InsufficientCreditsError } from './credits.ts';
import { getSettings } from './db.ts';
import { ALLOWED_AUDIO_TAGS, keepKnownAudioTags } from '../src/utils/audioTags.ts';

const MOTION_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'motion');
const MAX_SECONDS = 190; // 3 minutes of voice-over (+ a little slack)
const FORMATS = ['vertical', 'landscape'] as const;
const THEMES = ['orange', 'blue', 'violet', 'red', 'green', 'pink', 'teal', 'gold'];

export interface MotionDeps {
  ttsModel: string;
  textModel: string;
  dialectNames: Record<string, string>;
  voices: { id: string }[];
  synthesizeSpeech: (text: string, voice: string, style: string) => Promise<{ response: any; keyId: number; wav: Buffer | null }>;
  buildStyleDirective: (o: { dialect?: string; toneStyle?: string; customStylePrompt?: string; speed?: number; pitch?: number }) => string;
  usageTokens: (response: any) => { promptTokens: number; outputTokens: number };
  passesModeration: (req: express.Request, res: express.Response, text: string, feature: string) => Promise<boolean>;
}

// Testers (non-admin accounts) share one render queue: one video at a time each, and a daily allowance in units:
// a ready-style video costs 1 unit, a free-style one (the AI codes the whole video) costs 5
const TESTER_DAILY_UNITS = 10;
const STYLE_UNITS = { library: 1, free: 5 } as const;
type Style = keyof typeof STYLE_UNITS;
const styleOf = (raw: unknown): Style => (raw === 'free' ? 'free' : 'library');

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, script: { type: 'string' } },
  required: ['title', 'script'],
};

const AUDIENCES = {
  students: 'school students (about 10-16 years old): very simple words, one idea at a time, everyday examples a child knows (kitchen, football, school, phone)',
  general: 'a general audience: clear and friendly, no jargon unless it is explained right away',
  developers: 'software developers: you may use programming terms and developer analogies',
} as const;
export type Audience = keyof typeof AUDIENCES;

function scriptPrompt(o: { source: string; mode: 'idea' | 'curriculum'; dialect: string; minutes: number; audience: Audience }) {
  const words = Math.round(o.minutes * 125);
  const from = o.mode === 'curriculum'
    ? `Turn this excerpt from a lesson or curriculum into an engaging explainer. Keep it accurate to the excerpt; simplify, do not add facts that are not in it.\n\nEXCERPT:\n"""\n${o.source}\n"""`
    : `Write an explainer about this idea:\n"""\n${o.source}\n"""\nStick to well-established facts; if a detail is uncertain, leave it out.`;
  return `You write voice-over scripts for an Arabic explainer channel (technology, science, school lessons) whose videos are
short, punchy motion graphics. ${from}

AUDIENCE: ${AUDIENCES[o.audience]}.

STYLE
- Stay on the topic itself. Analogies must come from the topic's own world or from everyday life${o.audience === 'developers' ? '' : ' — never from programming or computers unless the topic is about them'}. Never mix in unrelated technical words.
- Language: ${o.dialect}, written in Arabic letters only (Latin letters only for real technical or scientific names such as CO2, API). Never use any other alphabet.
- Friendly and direct, like explaining to a friend. Every sentence must be correct and make sense on its own.
- Length: about ${words} words (${o.minutes} minute${o.minutes > 1 ? 's' : ''} spoken). Never more than ${Math.round(words * 1.1)}.
- Structure: a strong hook in the first sentence (a question or a surprising fact), then 2-5 clear sections that each
  start with a short signpost sentence ("أول خدمة…", "تاني شي…"), concrete examples, and a short wrap-up with a call to
  subscribe at the end.
- Short sentences. Spell numbers as they are spoken. No headings, lists, emojis or markdown: only the words to be read.
- Expression tags: add 4-8 English tags in square brackets right before the words they colour, chosen ONLY from:
  ${ALLOWED_AUDIO_TAGS.map(t => `[${t}]`).join(' ')}. E.g. "[excited] يا هلا فيكم! [short pause] اليوم بدنا نحكي عن…".

Return JSON: {"title": short video title in Arabic, "script": the full voice-over text}.`;
}

const readStatus = (dir: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  } catch {
    return null;
  }
};

const jobDir = (id: string) => (/^[a-f0-9]{24}$/.test(id) ? path.join(MOTION_DIR, id) : null);

const ownerOf = (dir: string): number | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')).ownerId ?? null;
  } catch {
    return null;
  }
};

/** A job folder the signed-in account may see: its own jobs, or any job for an admin. */
const ownJobDir = (req: express.Request, id: string) => {
  const dir = jobDir(id);
  if (!dir || !fs.existsSync(path.join(dir, 'job.json'))) return null;
  return req.user!.role === 'admin' || ownerOf(dir) === req.user!.id ? dir : null;
};

export function createMotionRouter(deps: MotionDeps) {
  const router = express.Router();
  router.use(requireAuth, requirePermission('motion'));
  fs.mkdirSync(MOTION_DIR, { recursive: true });

  // 1. Script from an idea or a curriculum excerpt (with expression tags)
  router.post('/script', async (req, res) => {
    try {
      const source = String(req.body?.source || '').trim();
      const mode = req.body?.mode === 'curriculum' ? 'curriculum' : 'idea';
      const minutes = [1, 2, 3].includes(Number(req.body?.minutes)) ? Number(req.body.minutes) : 2;
      const dialect = deps.dialectNames[req.body?.dialect] ?? deps.dialectNames.levantine ?? 'Levantine Arabic';
      const audience: Audience = req.body?.audience in AUDIENCES ? req.body.audience : mode === 'curriculum' ? 'students' : 'general';
      if (source.length < 10) return res.status(400).json({ success: false, error: 'اكتب الفكرة أو الصق جزء المنهاج' });
      if (source.length > 12000) return res.status(400).json({ success: false, error: 'النص طويل، اختصره إلى 12 ألف حرف' });
      if (!(await deps.passesModeration(req, res, source, 'script'))) return;
      // Speed first (2026-10-20): the light model like the press studio; the full text model is only the fallback
      const prompt = scriptPrompt({ source, mode, dialect, minutes, audience });
      let r: { result: any; keyId: number } | null = null;
      let usedModel = '';
      let lastError: unknown;
      for (const { model, thinking } of [{ model: 'gemini-3.5-flash-lite', thinking: ThinkingLevel.MINIMAL }, { model: deps.textModel, thinking: ThinkingLevel.LOW }]) {
        try {
          r = await withGeminiFailover('motion-script', client => client.models.generateContent({
            model,
            contents: prompt,
            config: { responseMimeType: 'application/json', responseJsonSchema: SCRIPT_SCHEMA, thinkingConfig: { thinkingLevel: thinking }, httpOptions: { timeout: 120_000 } },
          }), { cooldown: false });
          usedModel = model;
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[motion] ${model} could not write the script, trying the next model`);
        }
      }
      if (!r) throw lastError;
      logUsage({ userId: req.user!.id, feature: 'script', model: usedModel, chars: source.length, ...deps.usageTokens(r.result), apiKeyId: r.keyId });
      const parsed = JSON.parse(r.result.text || '{}');
      // Arabic + Latin + digits/punctuation only: drop any stray letters from other alphabets
      const cleaned = String(parsed.script || '').replace(/[^؀-ۿݐ-ݿ -~ -ÿ\s،؛؟…–—“”«»]/g, '');
      const script = keepKnownAudioTags(cleaned.replace(/[ \t]+/g, ' ').trim());
      if (!script) return res.status(502).json({ success: false, error: 'تعذّرت كتابة السكربت، جرّب مرة أخرى' });
      res.json({ success: true, title: String(parsed.title || '').trim().slice(0, 100), script });
    } catch (err: any) {
      console.error('Motion script failed:', err?.message || err);
      res.status(500).json({ success: false, error: 'تعذّرت كتابة السكربت حالياً، يرجى المحاولة لاحقاً.' });
    }
  });

  // 2. Voice the script and queue the job for the worker
  router.post('/jobs', async (req, res) => {
    try {
      const b = req.body ?? {};
      const script = String(b.script || '').trim();
      const voice = deps.voices.some(v => v.id === b.voice) ? String(b.voice) : 'Charon';
      const formats = FORMATS.filter(f => Array.isArray(b.formats) && b.formats.includes(f));
      if (!script) return res.status(400).json({ success: false, error: 'السكربت فارغ' });
      if (script.length > 6000) return res.status(400).json({ success: false, error: 'السكربت أطول من 6000 حرف (أكثر من 3 دقائق)' });
      if (!formats.length) return res.status(400).json({ success: false, error: 'اختر حجم فيديو واحداً على الأقل' });
      if (req.user!.role !== 'admin') {
        const mine = fs.readdirSync(MOTION_DIR).map(jobDir).filter((d): d is string => !!d && ownerOf(d) === req.user!.id);
        if (mine.some(d => ['queued', 'transcribing', 'planning', 'rendering'].includes(readStatus(d)?.state))) {
          return res.status(429).json({ success: false, error: 'عندك فيديو قيد التجهيز، انتظر حتى ينتهي ثم اصنع التالي' });
        }
        const used = mine
          .map(d => JSON.parse(fs.readFileSync(path.join(d, 'job.json'), 'utf8')))
          .filter(j => Date.now() - (j.createdAt ?? 0) < 86_400_000)
          .reduce((sum, j) => sum + STYLE_UNITS[styleOf(j.style)], 0);
        if (used + STYLE_UNITS[styleOf(b.style)] > TESTER_DAILY_UNITS) {
          return res.status(429).json({ success: false, error: `وصلت للحد اليومي (${TESTER_DAILY_UNITS} نقاط: الجاهز نقطة، والحر 5). جرّب غداً${styleOf(b.style) === 'free' ? ' أو اختر النسق الجاهز' : ''}.` });
        }
      }
      if (!(await deps.passesModeration(req, res, [b.title || '', script, b.brief || ''].join('\n'), 'script'))) return;

      const style = deps.buildStyleDirective({
        dialect: deps.dialectNames[b.dialect] ? String(b.dialect) : 'levantine',
        toneStyle: typeof b.tone === 'string' ? b.tone : 'educational_tutor',
        speed: Number(b.speed) || 1,
        pitch: 0,
      });
      const r = await deps.synthesizeSpeech(script, voice, style);
      if (!r.wav) return res.status(502).json({ success: false, error: 'لم يرجع صوت من الخدمة، جرّب مرة أخرى' });
      const seconds = pcmSeconds(r.wav);
      const tokens = deps.usageTokens(r.response);
      logUsage({ userId: req.user!.id, feature: 'tts', model: deps.ttsModel, voice, chars: script.length, promptTokens: tokens.promptTokens, outputTokens: tokens.outputTokens, audioSeconds: seconds, apiKeyId: r.keyId });
      if (seconds > MAX_SECONDS) return res.status(400).json({ success: false, error: `الصوت ${Math.round(seconds)} ثانية، والحد 3 دقائق. اختصر السكربت.` });

      // Deduct points for non-admin users
      const jobStyle = styleOf(b.style);
      if (req.user!.role !== 'admin') {
        const settings = getSettings();
        const cost = jobStyle === 'free' ? settings.costMotionFree : settings.costMotionLibrary;
        try {
          chargePoints(req.user!.id, cost, `موشن ${jobStyle === 'free' ? 'حر' : 'جاهز'}`);
        } catch (e) {
          if (e instanceof InsufficientCreditsError) {
            return res.status(402).json({ success: false, error: `رصيدك غير كافٍ. هذا الفيديو يحتاج ${cost} نقطة.` });
          }
          throw e;
        }
      }

      const id = crypto.randomBytes(12).toString('hex');
      const dir = path.join(MOTION_DIR, id);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'voice.wav'), r.wav);
      fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({
        id,
        ownerId: req.user!.id,
        script,
        formats,
        captions: !!b.captions,
        brief: b.brief ? String(b.brief).slice(0, 1500) : undefined,
        theme: THEMES.includes(b.theme) ? b.theme : undefined,
        style: styleOf(b.style),
        // Named look ("نسق"): classic tech stage or school notebook
        look: b.look === 'notebook' ? 'notebook' : 'classic',
        // Where to render (admins only: Lambda is billed to the AWS account); testers get the worker's default
        renderer: req.user!.role === 'admin' && (b.renderer === 'local' || b.renderer === 'lambda') ? b.renderer : undefined,
        title: b.title ? String(b.title).slice(0, 100) : undefined,
        createdAt: Date.now(),
      }));
      // status.json last: the worker only picks up a folder once it is complete
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ id, state: 'queued', progress: 0, step: 'في الانتظار', outputs: {}, updatedAt: Date.now() }));
      res.status(201).json({ success: true, id, seconds: Math.round(seconds) });
    } catch (err: any) {
      console.error('Motion job failed:', err?.message || err);
      res.status(500).json({ success: false, error: 'تعذّر تجهيز الصوت حالياً، يرجى المحاولة لاحقاً.' });
    }
  });

  router.get('/jobs', (req, res) => {
    const jobs = fs.readdirSync(MOTION_DIR)
      .map(id => ({ id, dir: jobDir(id) }))
      .filter(j => j.dir && fs.existsSync(path.join(j.dir, 'job.json')))
      .filter(j => req.user!.role === 'admin' || ownerOf(j.dir!) === req.user!.id)
      .map(j => {
        const job = JSON.parse(fs.readFileSync(path.join(j.dir!, 'job.json'), 'utf8'));
        return { id: j.id, title: job.title || job.script.slice(0, 60), formats: job.formats, createdAt: job.createdAt, style: job.style, look: job.look, status: readStatus(j.dir!) };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    res.json({ success: true, jobs });
  });

  router.get('/jobs/:id', (req, res) => {
    const dir = ownJobDir(req, req.params.id);
    const status = dir && readStatus(dir);
    if (!status) return res.status(404).json({ success: false, error: 'غير موجود' });
    res.json({ success: true, status });
  });

  router.get('/jobs/:id/plan', (req, res) => {
    const dir = ownJobDir(req, req.params.id);
    const file = dir && path.join(dir, 'plan.json');
    if (!file || !fs.existsSync(file)) return res.status(404).json({ success: false, error: 'لا توجد خطة بعد' });
    res.type('json').send(fs.readFileSync(file));
  });

  router.get('/jobs/:id/video/:format', (req, res) => {
    const dir = ownJobDir(req, req.params.id);
    const format = FORMATS.find(f => f === req.params.format);
    const file = dir && format && path.join(dir, `${format}.mp4`);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ success: false, error: 'الفيديو غير جاهز' });
    if (req.query.download) res.attachment(`motion-${format}.mp4`);
    res.sendFile(file);
  });

  router.delete('/jobs/:id', (req, res) => {
    const dir = ownJobDir(req, req.params.id);
    const status = dir && readStatus(dir);
    if (!status) return res.status(404).json({ success: false, error: 'غير موجود' });
    if (['transcribing', 'planning', 'rendering'].includes(status.state)) return res.status(409).json({ success: false, error: 'الفيديو قيد التجهيز، انتظر حتى ينتهي' });
    fs.rmSync(dir!, { recursive: true, force: true });
    res.json({ success: true });
  });

  return router;
}
