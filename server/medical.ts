// Medical cards and reels for doctors: the doctor writes a piece of health information, an AI review points out
// anything doubtful or overstated and suggests a simpler wording (the doctor decides), then it becomes an image card
// (here) or a short reel (the render route lives in server.ts next to the other video jobs). Every card and reel
// carries the doctor's identity and a fixed disclaimer that cannot be removed.
import express from 'express';
import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { ThinkingLevel } from '@google/genai';
import { db, getSettings } from './db.ts';
import { requireAuth, requireVerifiedEmail, createRateLimiter } from './auth.ts';
import { withGeminiFailover } from './keys.ts';
import { chargePoints, InsufficientCreditsError, logUsage, pointsText } from './credits.ts';
import { textPng, EM } from './calm-text.ts';
import { isCalm, searchClips } from './calm.ts';
import { watermarkFor } from './video.ts';
import { DoctorProfile, MEDICAL_DISCLAIMER, MEDICAL_LIMITS, MEDICAL_SCENES, MEDICAL_THEMES, ReviewResult } from '../src/data/medical.ts';

const DOCTORS_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'doctors');
const PIXABAY_IMAGES = 'https://pixabay.com/api/';

/** On top of the calm list: nothing that would upset a patient scrolling past. */
export const MEDICAL_BLOCKED_TAGS = [
  'surgery', 'surgical', 'operation', 'surgeon', 'scalpel', 'syringe', 'needle', 'injection', 'vaccine', 'wound', 'injury',
  'scar', 'corpse', 'autopsy', 'vomit', 'cancer', 'tumor', 'sick', 'illness', 'disease', 'virus', 'pandemic', 'coronavirus',
  'covid', 'emergency', 'ambulance', 'xray', 'x-ray', 'skeleton', 'skull', 'pain', 'crying',
  // The audience is conservative: no women or girls (the vision check below catches what tags miss)
  'woman', 'women', 'girl', 'girls', 'female', 'lady', 'ladies', 'mother', 'mom', 'mum', 'mommy', 'wife', 'bride',
  'daughter', 'sister', 'grandmother', 'granny', 'businesswoman', 'nurse', 'model', 'makeup', 'cosmetics', 'fashion',
  'dress', 'bikini', 'swimsuit', 'lingerie', 'sexy', 'pregnant', 'pregnancy', 'yoga', 'feminine', 'couple', 'romantic',
];

// ── doctor profile ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS doctor_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    specialty TEXT NOT NULL DEFAULT '',
    clinic TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0ea5e9',
    has_logo INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const logoFile = (userId: number) => path.join(DOCTORS_DIR, String(userId), 'logo.png');

export function getDoctorProfile(userId: number): DoctorProfile | null {
  const r = db.prepare('SELECT * FROM doctor_profiles WHERE user_id = ?').get(userId) as any;
  return r ? { name: r.name, specialty: r.specialty, clinic: r.clinic, contact: r.contact, color: r.color, hasLogo: !!r.has_logo } : null;
}

export const readDoctorLogo = (userId: number) => fs.readFile(logoFile(userId)).catch(() => null);

/** The identity lines shown on a card or reel: name, specialty · clinic, contact. */
export const identityLines = (p: DoctorProfile | null) =>
  p ? [p.name, [p.specialty, p.clinic].filter(Boolean).join(' · '), p.contact].filter(Boolean) : [];

// ── backgrounds ──────────────────────────────────────────────────────────────

interface Photo { id: number; tags: string; thumb: string; url: string }
const photoCache = new Map<string, { at: number; photos: Photo[] }>();
const photoIndex = new Map<number, Photo>(); // only photos from our own filtered searches can be used

async function searchPhotos(query: string): Promise<Photo[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw Object.assign(new Error('PIXABAY_API_KEY missing'), { code: 'NO_KEY' });
  const cached = photoCache.get(query);
  if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.photos;
  const url = `${PIXABAY_IMAGES}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&image_type=photo&safesearch=true&orientation=vertical&min_width=900&per_page=40`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const data = await res.json();
  const photos: Photo[] = (data.hits ?? [])
    .filter((h: any) => isCalm(String(h.tags || ''), MEDICAL_BLOCKED_TAGS) && h.largeImageURL)
    .map((h: any) => ({ id: h.id, tags: String(h.tags || ''), thumb: h.webformatURL || h.previewURL, url: h.largeImageURL }));
  for (const p of photos) photoIndex.set(p.id, p);
  photoCache.set(query, { at: Date.now(), photos });
  return photos;
}

// ── no women or girls ────────────────────────────────────────────────────────
// The audience is conservative, so a background never shows a woman or girl. Tags catch some (MEDICAL_BLOCKED_TAGS);
// every photo and clip is also looked at by a vision model (a clip as three frames: start, middle and end) and only
// what passes is offered or accepted. Each verdict is stored, so a background is checked once.

db.exec(`
  CREATE TABLE IF NOT EXISTS medical_bg_checks (
    key TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
const verdictOf = (key: string) => (db.prepare('SELECT ok FROM medical_bg_checks WHERE key = ?').get(key) as { ok: number } | undefined)?.ok;
const saveVerdict = (key: string, ok: boolean) => db.prepare('INSERT OR REPLACE INTO medical_bg_checks (key, ok) VALUES (?, ?)').run(key, ok ? 1 : 0);

/** Whether a background passed the check: `p:<id>` for a photo, `v:<id>` for a clip. */
export const backgroundApproved = (key: string) => verdictOf(key) === 1;

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const run = promisify(execFile);

/** A small JPEG of a photo for the check. */
async function photoPreview(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Photo ${res.status}`);
  return sharp(Buffer.from(await res.arrayBuffer())).resize(384, 384, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
}

/** Three frames of a clip (start, middle, end) side by side in one JPEG, from its small preview video. */
export async function clipPreview(url: string, duration: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Clip ${res.status}`);
  const file = path.join(os.tmpdir(), `sawtik-medcheck-${crypto.randomBytes(6).toString('hex')}.mp4`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  try {
    const every = Math.max(1, duration / 3);
    const { stdout } = await run(FFMPEG, ['-v', 'error', '-i', file, '-vf', `fps=1/${every.toFixed(2)},scale=256:-2,tile=3x1`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'],
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, timeout: 30_000 });
    if (!stdout.length) throw new Error('No frames');
    return stdout as Buffer;
  } finally {
    await fs.rm(file, { force: true });
  }
}

const SCREEN_SCHEMA = { type: 'object', properties: { flagged: { type: 'array', items: { type: 'integer' } } }, required: ['flagged'] };
const SCREEN_PROMPT = `You screen background images for health-awareness posts aimed at a conservative Muslim audience.
Below are numbered images (a video is shown as three frames side by side).
Flag an image if it shows ANY woman or girl of any age, in any way: even small, partial (a hand with nail polish, long hair,
legs, a face in the corner), in the background, blurred, as a silhouette, a drawing, a statue, a mannequin or a reflection.
Also flag anything immodest or romantic. Men, boys, objects, food and scenery are fine.
When you are not sure, flag it. Return the numbers of all flagged images in "flagged".`;

interface Candidate { key: string; image: () => Promise<Buffer> }

/** Checks the candidates not seen before and returns the keys of all that passed. Fails closed. */
async function screen(cands: Candidate[], deps: MedicalDeps, userId: number): Promise<Set<string>> {
  const approved = new Set(cands.filter(c => verdictOf(c.key) === 1).map(c => c.key));
  const todo = cands.filter(c => verdictOf(c.key) === undefined);
  const ready: { key: string; img: Buffer }[] = [];
  for (let i = 0; i < todo.length; i += 6) {
    const got = await Promise.all(todo.slice(i, i + 6).map(async c => ({ key: c.key, img: await c.image().catch(() => null) })));
    for (const g of got) if (g.img) ready.push(g as { key: string; img: Buffer });
  }
  const batches: (typeof ready)[] = [];
  for (let i = 0; i < ready.length; i += 10) batches.push(ready.slice(i, i + 10));
  let failures = 0;
  await Promise.all(batches.map(async batch => {
    const parts = [{ text: SCREEN_PROMPT }, ...batch.flatMap((b, i) => [{ text: `Image ${i + 1}:` }, { inlineData: { mimeType: 'image/jpeg', data: b.img.toString('base64') } }])];
    for (const m of [{ model: deps.textModel, thinking: ThinkingLevel.LOW }, { model: 'gemini-3.5-flash-lite', thinking: ThinkingLevel.MINIMAL }]) {
      try {
        const r = await withGeminiFailover('medical-screen', client => client.models.generateContent({
          model: m.model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', responseJsonSchema: SCREEN_SCHEMA, thinkingConfig: { thinkingLevel: m.thinking }, httpOptions: { timeout: 90_000 } },
        }), { cooldown: false });
        logUsage({ userId, feature: 'optimize', model: m.model, chars: 0, ...deps.usageTokens(r.result), apiKeyId: r.keyId });
        const flagged = new Set((JSON.parse(r.result.text || '{}').flagged ?? []).map(Number));
        batch.forEach((b, i) => {
          const ok = !flagged.has(i + 1);
          saveVerdict(b.key, ok);
          if (ok) approved.add(b.key);
        });
        return;
      } catch (err: any) {
        console.error(`Medical background check (${m.model}) failed:`, err?.message || err);
      }
    }
    failures++;
  }));
  if (approved.size === 0 && (failures > 0 || ready.length < todo.length)) throw new Error('Background check failed');
  return approved;
}

const screening = new Map<string, Promise<Set<string>>>(); // one check at a time per scene

/** At most `limit` backgrounds of one search that passed the check (a search is screened in its first 30 results). */
async function screened<T extends { id: number }>(kind: 'p' | 'v', scene: string, items: T[], image: (item: T) => Promise<Buffer>, deps: MedicalDeps, userId: number, limit = 24) {
  const cands = items.slice(0, 30);
  const job = `${kind}|${scene}`;
  let p = screening.get(job);
  if (!p) {
    p = screen(cands.map(it => ({ key: `${kind}:${it.id}`, image: () => image(it) })), deps, userId).finally(() => screening.delete(job));
    screening.set(job, p);
  }
  const approved = await p;
  return cands.filter(it => approved.has(`${kind}:${it.id}`)).slice(0, limit);
}

/** A lucide icon as SVG markup (the same icon set the site uses). */
async function iconSvgBody(name: string): Promise<string> {
  const mod = await import(`lucide-react/dist/esm/icons/${name}.js`);
  const nodes: [string, Record<string, string>][] = mod.__iconNode ?? [];
  return nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}

// ── card image ───────────────────────────────────────────────────────────────

const CW = 1080;
const CH = 1350;
const size = (px: number) => px / EM; // textPng takes design sizes; these are real pixels on the card

export interface CardInput {
  title: string;
  body: string;
  themeId: string;
  photoId: number | null;
  profile: DoctorProfile | null;
  logo: Buffer | null;
  domain: string;
}

/** Renders the card as a JPEG: background, icon badge, title, the information on a panel, identity, disclaimer. */
export async function renderMedicalCard(c: CardInput): Promise<Buffer> {
  const theme = MEDICAL_THEMES.find(t => t.id === c.themeId) ?? MEDICAL_THEMES[0];
  const accent = c.profile?.color || theme.to;
  const icon = await iconSvgBody(theme.icon);
  const photo = c.photoId != null ? photoIndex.get(c.photoId) ?? null : null;

  // 1. Background: a photo darkened for reading, or the theme's gradient with a large faint icon
  let background: Buffer;
  if (photo) {
    const res = await fetch(photo.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Photo download ${res.status}`);
    const shade = Buffer.from(`<svg width="${CW}" height="${CH}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.45" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0.8"/>
      </linearGradient></defs><rect width="${CW}" height="${CH}" fill="url(#s)"/></svg>`);
    background = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(CW, CH, { fit: 'cover' }).composite([{ input: shade }]).png().toBuffer();
  } else {
    background = await sharp(Buffer.from(`<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.from}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient></defs>
      <rect width="${CW}" height="${CH}" fill="url(#g)"/>
      <g transform="translate(560 560) scale(26)" opacity="0.13" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
      <circle cx="80" cy="1250" r="220" fill="#ffffff" opacity="0.06"/></svg>`)).png().toBuffer();
  }
  const layers: { input: Buffer; left: number; top: number }[] = [];

  // 2. Icon badge and title
  const badge = await sharp(Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><circle cx="64" cy="64" r="64" fill="#ffffff"/>
    <g transform="translate(28 28) scale(3)" fill="none" stroke="${theme.from}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`)).png().toBuffer();
  layers.push({ input: badge, left: (CW - 128) / 2, top: 64 });
  const title = await textPng(c.title, { font: 'cairo', size: size(58), color: '#ffffff', width: CW - 160 });
  layers.push({ input: title.png, left: Math.round((CW - title.width) / 2), top: 212 - title.pad });
  const titleBottom = 212 + title.height - 2 * title.pad;

  // 3. Identity strip and disclaimer along the bottom (measured first so the panel can use the rest)
  const strip = await identityStrip(c.profile, c.logo, accent, CW - 120);
  const disclaimer = await textPng(MEDICAL_DISCLAIMER, { font: 'cairo', size: size(26), color: '#ffffff', width: CW - 120 });
  const mark = await textPng(watermarkFor(c.domain), { font: 'sans', size: size(18), color: '#ffffff', width: CW - 120 });
  const markTop = CH - 30 - (mark.height - 2 * mark.pad);
  const discTop = markTop - 10 - (disclaimer.height - 2 * disclaimer.pad);
  const stripTop = strip ? discTop - 22 - strip.height : discTop;
  layers.push({ input: disclaimer.png, left: Math.round((CW - disclaimer.width) / 2), top: discTop - disclaimer.pad });
  layers.push({ input: mark.png, left: Math.round((CW - mark.width) / 2), top: markTop - mark.pad });
  if (strip) layers.push({ input: strip.png, left: 60, top: stripTop });

  // 4. The information on a panel between the title and the identity, in the largest size that fits
  const panelTop = titleBottom + 40;
  const panelBottom = stripTop - 34;
  const panelW = CW - 120;
  const panelH = Math.max(200, panelBottom - panelTop);
  const dark = Boolean(photo);
  // Largest size that fits the panel: a short tip fills it, a long one shrinks (never below 26 px)
  const drawBody = (px: number) => textPng(c.body, { font: 'cairo', size: size(px), color: dark ? '#ffffff' : '#0f172a', width: panelW - 100 });
  let body = await drawBody(26);
  for (let px = 64; px > 26; px -= 4) {
    const tryBody = await drawBody(px);
    if (tryBody.height - 2 * tryBody.pad <= panelH - 90) {
      body = tryBody;
      break;
    }
  }
  const panel = Buffer.from(`<svg width="${panelW}" height="${panelH}"><rect width="${panelW}" height="${panelH}" rx="36" fill="${dark ? '#0b1220' : '#ffffff'}" fill-opacity="${dark ? 0.5 : 0.94}"/>
    <rect x="${panelW - 14}" y="40" width="8" height="${panelH - 80}" rx="4" fill="${accent}"/></svg>`);
  layers.push({ input: await sharp(panel).png().toBuffer(), left: 60, top: panelTop });
  const bodyH = body.height - 2 * body.pad;
  layers.push({ input: body.png, left: Math.round((CW - body.width) / 2), top: Math.round(panelTop + (panelH - bodyH) / 2) - body.pad });

  return sharp(background).composite(layers).jpeg({ quality: 90 }).toBuffer();
}

/** The doctor's logo (round) on the right and up to 3 lines of identity, on a translucent bar. */
async function identityStrip(p: DoctorProfile | null, logo: Buffer | null, accent: string, width: number) {
  const lines = identityLines(p);
  if (!lines.length && !logo) return null;
  const logoSize = logo ? 104 : 0;
  const pngs = await Promise.all(lines.slice(0, 3).map((t, i) => textPng(t, { font: 'cairo', size: size(i === 0 ? 36 : 27), color: '#ffffff', width: width - logoSize - 70 })));
  const textH = pngs.reduce((s, l) => s + l.height - 2 * l.pad, 0) + Math.max(0, pngs.length - 1) * 6;
  const height = Math.max(logoSize, textH) + 36;
  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (logo) {
    const mask = Buffer.from(`<svg width="${logoSize}" height="${logoSize}"><circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="#fff"/></svg>`);
    const round = await sharp(logo).resize(logoSize, logoSize, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: round, left: width - logoSize - 18, top: Math.round((height - logoSize) / 2) });
  }
  let y = Math.round((height - textH) / 2);
  for (const l of pngs) {
    layers.push({ input: l.png, left: Math.max(0, width - logoSize - 40 - l.width), top: y - l.pad });
    y += l.height - 2 * l.pad + 6;
  }
  const box = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="28" fill="#0b1220" fill-opacity="0.6"/><rect x="0" y="${height - 6}" width="${width}" height="6" rx="3" fill="${accent}"/></svg>`);
  return { png: await sharp(box).composite(layers).png().toBuffer(), height };
}

// ── AI review ────────────────────────────────────────────────────────────────

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['quote', 'problem', 'suggestion', 'severity'],
      },
    },
    simplified: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['notes', 'simplified', 'title'],
};

function reviewPrompt(text: string) {
  return `You are a careful medical editor helping a doctor publish a short health-awareness post in Arabic for the general public.
The doctor is responsible for the content; your job is only to point out problems and suggest a clearer wording.

TEXT FROM THE DOCTOR:
"""
${text}
"""

1. notes: list each sentence (quote it exactly as written) that is
   - factually doubtful or outdated according to mainstream medical guidance,
   - overstated (a cure, a guarantee, "always", "never", miracle claims),
   - unsafe for a reader acting alone (doses, stopping or mixing medicines, delaying care for serious symptoms),
   - or likely to be misunderstood.
   For each: problem (one short Arabic sentence), suggestion (a safer Arabic wording of that sentence), severity
   (high = could harm someone, medium = misleading, low = wording). Do not invent facts or add new medical claims.
   If nothing needs attention, return an empty list.
2. simplified: the same information rewritten for patients in clear, warm Arabic (keep the doctor's dialect if it is
   one; otherwise simple Modern Standard Arabic), short sentences, no jargon (or explain it in brackets), the same
   meaning and no new claims, at most ${MEDICAL_LIMITS.body} characters. Apply the safer wording for any high note.
3. title: a short, catchy Arabic title for the post (at most 8 words), not clickbait.

All text in Arabic letters, except standard medical abbreviations (e.g. HbA1c). Return JSON only.`;
}

// ── routes ───────────────────────────────────────────────────────────────────

export interface MedicalDeps {
  textModel: string;
  usageTokens: (response: any) => { promptTokens: number; outputTokens: number };
  passesModeration: (req: express.Request, res: express.Response, text: string, feature: string) => Promise<boolean>;
}

const reviewLimiter = createRateLimiter(() => 10, 60_000);
const decode = (v: unknown) => (typeof v === 'string' && v ? Buffer.from(v.replace(/^data:[^,]*,/, ''), 'base64') : null);

export function createMedicalRouter(deps: MedicalDeps) {
  const router = express.Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get('/profile', (req, res) => res.json({ success: true, profile: getDoctorProfile(req.user!.id) }));

  router.get('/profile/logo', async (req, res) => {
    const logo = await readDoctorLogo(req.user!.id);
    if (!logo) return res.status(404).end();
    res.type('image/png').set('Cache-Control', 'no-store').send(logo);
  });

  /** Saves the profile. Logo: base64 to replace, `null` to remove, leave out to keep. */
  router.put('/profile', async (req, res) => {
    const userId = req.user!.id;
    const b = req.body ?? {};
    const cur = getDoctorProfile(userId) ?? { name: '', specialty: '', clinic: '', contact: '', color: '#0ea5e9', hasLogo: false };
    const next = { ...cur };
    for (const k of ['name', 'specialty', 'clinic', 'contact'] as const) if (typeof b[k] === 'string') next[k] = b[k].trim().slice(0, k === 'contact' ? 40 : 60);
    if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) next.color = b.color.toLowerCase();
    if (!(await deps.passesModeration(req, res, [next.name, next.specialty, next.clinic].join('\n'), 'video'))) return;
    try {
      await fs.mkdir(path.dirname(logoFile(userId)), { recursive: true });
      if (b.logo === null) {
        await fs.rm(logoFile(userId), { force: true });
        next.hasLogo = false;
      } else if (decode(b.logo)) {
        await fs.writeFile(logoFile(userId), await sharp(decode(b.logo)!).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer());
        next.hasLogo = true;
      }
    } catch {
      return res.status(400).json({ success: false, error: 'تعذّر قراءة الشعار، جرّب صورة PNG أو JPG' });
    }
    db.prepare(`
      INSERT INTO doctor_profiles (user_id, name, specialty, clinic, contact, color, has_logo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, specialty = excluded.specialty, clinic = excluded.clinic,
        contact = excluded.contact, color = excluded.color, has_logo = excluded.has_logo, updated_at = excluded.updated_at
    `).run(userId, next.name, next.specialty, next.clinic, next.contact, next.color, next.hasLogo ? 1 : 0);
    res.json({ success: true, profile: getDoctorProfile(userId) });
  });

  /** Background photos (for cards) or videos (for reels) of one scene, filtered for a medical audience. */
  router.get('/backgrounds', async (req, res) => {
    const scene = MEDICAL_SCENES.find(s => s.id === req.query.scene);
    if (!scene) return res.status(400).json({ success: false, error: 'اختر نوع المشهد' });
    try {
      const userId = req.user!.id;
      if (req.query.kind === 'video') {
        const clips = await screened('v', scene.id, await searchClips(scene.query, MEDICAL_BLOCKED_TAGS), c => clipPreview(c.preview, c.duration), deps, userId);
        return res.json({ success: true, clips: clips.map(c => ({ id: c.id, duration: c.duration, thumb: c.thumb, preview: c.preview })) });
      }
      const photos = await screened('p', scene.id, await searchPhotos(scene.query), p => photoPreview(p.thumb), deps, userId);
      res.json({ success: true, photos: photos.map(p => ({ id: p.id, thumb: p.thumb })) });
    } catch (err: any) {
      console.error('Medical backgrounds failed:', err?.message || err);
      res.status(503).json({ success: false, error: 'تعذّر جلب الخلفيات حالياً، يرجى المحاولة لاحقاً.' });
    }
  });

  /** AI review: notes on doubtful or overstated sentences, a simplified wording and a title. Changes nothing. */
  router.post('/review', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (text.length < 20) return res.status(400).json({ success: false, error: 'اكتب المعلومة الطبية أولاً (جملة أو أكثر)' });
    if (text.length > MEDICAL_LIMITS.reelBody) return res.status(400).json({ success: false, error: `النص طويل، اختصره إلى ${MEDICAL_LIMITS.reelBody} حرف` });
    if (!reviewLimiter(`user:${req.user!.id}`)) return res.status(429).json({ success: false, error: 'طلبات مراجعة كثيرة، انتظر دقيقة ثم حاول.' });
    if (!(await deps.passesModeration(req, res, text, 'script'))) return;
    try {
      let r: { result: any; keyId: number } | null = null;
      let model = '';
      let lastError: unknown;
      // The full text model first (accuracy matters here); the light one only if it fails
      for (const m of [{ model: deps.textModel, thinking: ThinkingLevel.LOW }, { model: 'gemini-3.5-flash-lite', thinking: ThinkingLevel.MINIMAL }]) {
        try {
          r = await withGeminiFailover('medical-review', client => client.models.generateContent({
            model: m.model,
            contents: reviewPrompt(text),
            config: { responseMimeType: 'application/json', responseJsonSchema: REVIEW_SCHEMA, thinkingConfig: { thinkingLevel: m.thinking }, httpOptions: { timeout: 90_000 } },
          }), { cooldown: false });
          model = m.model;
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!r) throw lastError;
      logUsage({ userId: req.user!.id, feature: 'optimize', model, chars: text.length, ...deps.usageTokens(r.result), apiKeyId: r.keyId });
      const parsed = JSON.parse(r.result.text || '{}');
      const result: ReviewResult = {
        notes: (Array.isArray(parsed.notes) ? parsed.notes : []).slice(0, 12).map((n: any) => ({
          quote: String(n.quote || '').slice(0, 300), problem: String(n.problem || '').slice(0, 300),
          suggestion: String(n.suggestion || '').slice(0, 400), severity: ['high', 'medium', 'low'].includes(n.severity) ? n.severity : 'low',
        })),
        simplified: String(parsed.simplified || '').trim().slice(0, MEDICAL_LIMITS.reelBody),
        title: String(parsed.title || '').trim().slice(0, MEDICAL_LIMITS.title),
      };
      res.json({ success: true, review: result });
    } catch (err: any) {
      console.error('Medical review failed:', err?.message || err);
      res.status(503).json({ success: false, error: 'تعذّرت المراجعة حالياً، يرجى المحاولة لاحقاً.' });
    }
  });

  /** The image card. Charged (costMedicalCard) only once it has rendered. */
  router.post('/card', async (req, res) => {
    const userId = req.user!.id;
    const title = String(req.body?.title || '').trim().slice(0, MEDICAL_LIMITS.title);
    const body = String(req.body?.body || '').trim();
    if (!title || body.length < 10) return res.status(400).json({ success: false, error: 'اكتب عنواناً والمعلومة الطبية' });
    if (body.length > MEDICAL_LIMITS.body) return res.status(400).json({ success: false, error: `نص البطاقة طويل، اختصره إلى ${MEDICAL_LIMITS.body} حرف (أو اصنع ريلاً)` });
    const photoId = req.body?.photoId != null ? Number(req.body.photoId) : null;
    if (photoId != null && (!photoIndex.has(photoId) || !backgroundApproved(`p:${photoId}`))) return res.status(400).json({ success: false, error: 'اختر الخلفية من جديد (انتهت صلاحية البحث)' });
    if (!(await deps.passesModeration(req, res, `${title}\n${body}`, 'video'))) return;
    const price = getSettings().costMedicalCard;
    const { credits } = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number };
    if (credits < price * 6) return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ. تحتاج البطاقة ${price} نقطة ورصيدك ${pointsText(credits)}.` });
    try {
      const jpeg = await renderMedicalCard({
        title, body, themeId: String(req.body?.themeId || ''), photoId,
        profile: getDoctorProfile(userId), logo: await readDoctorLogo(userId), domain: req.hostname,
      });
      try {
        chargePoints(userId, price, `بطاقة طبية · ${title}`);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ. تحتاج البطاقة ${price} نقطة.` });
        throw err;
      }
      const balance = (db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number }).credits;
      res.json({ success: true, image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, balance });
    } catch (err: any) {
      console.error('Medical card failed:', err?.message || err);
      res.status(503).json({ success: false, error: 'تعذّر تجهيز البطاقة حالياً، يرجى المحاولة لاحقاً.' });
    }
  });

  return router;
}
