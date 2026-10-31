// The public gallery ("معرض الأعمال"): voices, voice fingerprints, videos, reels, pictures, motion graphics and
// greeting cards made on the site, with search, kinds and categories, open to visitors. Customers share their own work
// (with their consent to show it publicly) and it waits for an admin's approval; the admin's own work, shared from the
// admin tools, goes up at once. Files live in DATA_DIR/gallery as <id>.<ext>, with a small <id>-poster.jpg for videos
// and pictures so the grid loads light.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { db } from './db.ts';
import { requireAuth } from './auth.ts';

const DATA = () => path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const dir = () => path.join(DATA(), 'gallery');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_UPLOAD = 60 * 1024 * 1024;
const MAX_PENDING_PER_USER = 10;
const PAGE = 24;

export const KINDS = {
  voice: 'أصوات',
  fingerprint: 'بصمات صوت',
  video: 'فيديو',
  reel: 'ريلز',
  image: 'صور',
  motion: 'موشن جرافيك',
  greeting: 'بطاقات تهنئة',
} as const;
type Kind = keyof typeof KINDS;
const AUDIO_KINDS: Kind[] = ['voice', 'fingerprint'];

export const CATEGORIES = {
  occasions: 'مناسبات',
  religious: 'ديني',
  education: 'تعليمي',
  ads: 'إعلاني',
  stories: 'قصص',
  motivation: 'تحفيزي',
  news: 'أخبار',
  kids: 'أطفال',
  health: 'صحة',
  other: 'أخرى',
} as const;
type Category = keyof typeof CATEGORIES;

db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    tags TEXT NOT NULL DEFAULT '',
    ext TEXT NOT NULL,
    mime TEXT NOT NULL,
    has_poster INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    by_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reject_reason TEXT,
    featured INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'upload',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS gallery_items_status ON gallery_items(status, approved_at);
`);

interface ItemRow {
  id: number; kind: Kind; title: string; description: string; category: Category; tags: string; ext: string; mime: string;
  has_poster: number; user_id: number | null; by_admin: number; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null;
  featured: number; views: number; source: string; created_at: string; approved_at: string | null;
}

const fileOf = (row: Pick<ItemRow, 'id' | 'ext'>) => path.join(dir(), `${row.id}.${row.ext}`);
const posterOf = (id: number) => path.join(dir(), `${id}-poster.jpg`);
const getItem = (id: number) => db.prepare('SELECT * FROM gallery_items WHERE id = ?').get(id) as unknown as ItemRow | undefined;

/** What visitors see of an item (never the owner's email). */
function publicItem(row: ItemRow & { author_name?: string | null }) {
  return {
    id: row.id, kind: row.kind, title: row.title, description: row.description, category: row.category,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [], mime: row.mime, poster: Boolean(row.has_poster),
    featured: Boolean(row.featured), views: row.views, date: row.approved_at || row.created_at,
    author: row.by_admin ? 'صوتك الذكي' : (row.author_name || '').trim() || 'مستخدم صوتك الذكي',
  };
}

// ---------- Files ----------

/** The media type of uploaded bytes, from their first bytes (never from what the browser claims). */
function sniff(b: Buffer): { ext: string; mime: string; media: 'audio' | 'video' | 'image' } | null {
  const ascii = (a: number, z: number) => b.toString('ascii', a, z);
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { ext: 'png', mime: 'image/png', media: 'image' };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg', media: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp', media: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav', media: 'audio' };
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg', media: 'audio' };
  if (ascii(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg', media: 'audio' };
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    return /M4A|M4B/.test(brand) ? { ext: 'm4a', mime: 'audio/mp4', media: 'audio' } : { ext: 'mp4', mime: 'video/mp4', media: 'video' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm', media: 'video' };
  return null;
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    const timer = setTimeout(() => proc.kill('SIGKILL'), 60_000);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`)); });
  });
}

/** A small JPEG for the grid: a frame a second in (or the first) for videos, the picture itself scaled down for images. */
async function makePoster(id: number, file: string, media: 'audio' | 'video' | 'image'): Promise<boolean> {
  if (media === 'audio') return false;
  const out = posterOf(id);
  const scale = ['-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '4', out];
  try {
    await ffmpeg(media === 'video' ? ['-ss', '1', '-i', file, ...scale] : ['-i', file, ...scale]);
    return true;
  } catch {
    if (media !== 'video') return false;
    return ffmpeg(['-i', file, ...scale]).then(() => true, () => false);
  }
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanTags = (v: unknown) => clean(v, 200).split(/[,،#]/).map(t => t.trim()).filter(Boolean).slice(0, 8).join(',');
const isKind = (v: unknown): v is Kind => typeof v === 'string' && v in KINDS;
const isCategory = (v: unknown): v is Category => typeof v === 'string' && v in CATEGORIES;

/** Stores a new item from its bytes and returns it. `approved`: the admin's own work, shown at once. */
async function addItem(o: {
  bytes: Buffer; kind: Kind; title: string; description: string; category: Category; tags: string;
  userId: number | null; byAdmin: boolean; source: string;
}): Promise<ItemRow> {
  const type = sniff(o.bytes);
  const wanted = AUDIO_KINDS.includes(o.kind) ? 'audio' : o.kind === 'image' ? 'image' : null;
  if (!type) throw Object.assign(new Error('نوع الملف غير مدعوم (صوت: mp3/wav/m4a، فيديو: mp4/webm، صورة: png/jpg/webp)'), { status: 400 });
  // A greeting card or motion graphic can be a picture or a video; voices must be sound, pictures pictures
  if (wanted ? type.media !== wanted : type.media === 'audio') throw Object.assign(new Error(`الملف لا يناسب النوع «${KINDS[o.kind]}»`), { status: 400 });
  const row = db.prepare(`
    INSERT INTO gallery_items (kind, title, description, category, tags, ext, mime, user_id, by_admin, status, source, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${o.byAdmin ? "datetime('now')" : 'NULL'})
  `).run(o.kind, o.title, o.description, o.category, o.tags, type.ext, type.mime, o.userId, o.byAdmin ? 1 : 0, o.byAdmin ? 'approved' : 'pending', o.source);
  const id = Number(row.lastInsertRowid);
  await fs.mkdir(dir(), { recursive: true });
  const file = fileOf({ id, ext: type.ext });
  await fs.writeFile(file, o.bytes);
  if (await makePoster(id, file, type.media)) db.prepare('UPDATE gallery_items SET has_poster = 1 WHERE id = ?').run(id);
  return getItem(id)!;
}

async function removeItem(row: ItemRow) {
  db.prepare('DELETE FROM gallery_items WHERE id = ?').run(row.id);
  await Promise.all([fs.rm(fileOf(row), { force: true }), fs.rm(posterOf(row.id), { force: true })]);
}

// ---------- Public: browse, and customers share their work ----------

export const galleryRouter = express.Router();

galleryRouter.get('/meta', (_req, res) => {
  const counts = db.prepare("SELECT kind, COUNT(*) AS n FROM gallery_items WHERE status = 'approved' GROUP BY kind").all() as { kind: Kind; n: number }[];
  res.json({ success: true, kinds: KINDS, categories: CATEGORIES, counts: Object.fromEntries(counts.map(c => [c.kind, c.n])) });
});

galleryRouter.get('/', (req, res) => {
  const where = ["g.status = 'approved'"];
  const params: (string | number)[] = [];
  const q = clean(req.query.q, 80);
  if (q) {
    where.push('(g.title LIKE ? OR g.description LIKE ? OR g.tags LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (isKind(req.query.kind)) { where.push('g.kind = ?'); params.push(req.query.kind); }
  if (isCategory(req.query.category)) { where.push('g.category = ?'); params.push(req.query.category); }
  const order = req.query.sort === 'popular' ? 'g.views DESC, g.id DESC' : req.query.sort === 'featured' ? 'g.featured DESC, g.approved_at DESC' : 'g.approved_at DESC, g.id DESC';
  const page = Math.max(0, Math.floor(Number(req.query.page) || 0));
  const rows = db.prepare(`
    SELECT g.*, u.name AS author_name FROM gallery_items g LEFT JOIN users u ON u.id = g.user_id
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...params, PAGE + 1, page * PAGE) as unknown as (ItemRow & { author_name: string | null })[];
  res.json({ success: true, items: rows.slice(0, PAGE).map(publicItem), more: rows.length > PAGE });
});

galleryRouter.get('/item/:id', (req, res) => {
  const row = db.prepare("SELECT g.*, u.name AS author_name FROM gallery_items g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ? AND g.status = 'approved'")
    .get(Number(req.params.id)) as unknown as (ItemRow & { author_name: string | null }) | undefined;
  if (!row) return res.status(404).json({ success: false, error: 'العمل غير موجود' });
  res.json({ success: true, item: publicItem(row) });
});

// Views counted once an hour per visitor and item
const seen = new Map<string, number>();
galleryRouter.post('/:id/view', (req, res) => {
  const id = Number(req.params.id);
  const key = `${req.ip}:${id}`;
  if (Date.now() - (seen.get(key) ?? 0) > 60 * 60_000) {
    seen.set(key, Date.now());
    if (seen.size > 50_000) seen.clear();
    db.prepare("UPDATE gallery_items SET views = views + 1 WHERE id = ? AND status = 'approved'").run(id);
  }
  res.json({ success: true });
});

/** Approved items are public; the others only for their owner and admins (to preview before approval). */
const canSee = (req: express.Request, row: ItemRow) => row.status === 'approved' || req.user?.role === 'admin' || (req.user && req.user.id === row.user_id);

galleryRouter.get('/:id/file', (req, res) => {
  const row = getItem(Number(req.params.id));
  if (!row || !canSee(req, row)) return res.status(404).end();
  res.set('Cache-Control', row.status === 'approved' ? 'public, max-age=86400' : 'private, no-store');
  if (req.query.download) res.attachment(`sawtik-${row.id}.${row.ext}`);
  res.type(row.mime).sendFile(fileOf(row), error => { if (error && !res.headersSent) res.status(404).end(); });
});

galleryRouter.get('/:id/poster', (req, res) => {
  const row = getItem(Number(req.params.id));
  if (!row || !row.has_poster || !canSee(req, row)) return res.status(404).end();
  res.set('Cache-Control', row.status === 'approved' ? 'public, max-age=86400' : 'private, no-store');
  res.type('image/jpeg').sendFile(posterOf(row.id), error => { if (error && !res.headersSent) res.status(404).end(); });
});

// The file is the request body itself (no base64), the details are in the query string
galleryRouter.post('/submit', requireAuth, express.raw({ type: () => true, limit: MAX_UPLOAD }), async (req, res) => {
  try {
    const admin = req.user!.role === 'admin';
    if (req.query.consent !== '1') return res.status(400).json({ success: false, error: 'يجب الموافقة على شروط النشر في المعرض' });
    if (!isKind(req.query.kind)) return res.status(400).json({ success: false, error: 'اختر نوع العمل' });
    const title = clean(req.query.title, 80);
    if (title.length < 2) return res.status(400).json({ success: false, error: 'اكتب عنواناً للعمل' });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length < 1000) return res.status(400).json({ success: false, error: 'أرفق الملف' });
    if (!admin) {
      const pending = (db.prepare("SELECT COUNT(*) AS n FROM gallery_items WHERE user_id = ? AND status = 'pending'").get(req.user!.id) as { n: number }).n;
      if (pending >= MAX_PENDING_PER_USER) return res.status(429).json({ success: false, error: 'لديك أعمال كثيرة بانتظار المراجعة، انتظر حتى تُراجع' });
    }
    const item = await addItem({
      bytes, kind: req.query.kind, title, description: clean(req.query.description, 500),
      category: isCategory(req.query.category) ? req.query.category : 'other', tags: cleanTags(req.query.tags),
      userId: req.user!.id, byAdmin: admin, source: 'upload',
    });
    res.json({ success: true, item: { ...publicItem(item), status: item.status } });
  } catch (error: any) {
    if (error?.status === 400) return res.status(400).json({ success: false, error: error.message });
    if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'الملف أكبر من 60 ميغابايت' });
    console.error('Gallery submit failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّر رفع العمل' });
  }
});

galleryRouter.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM gallery_items WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user!.id) as unknown as ItemRow[];
  res.json({ success: true, items: rows.map(r => ({ ...publicItem(r), status: r.status, rejectReason: r.reject_reason })) });
});

galleryRouter.delete('/mine/:id', requireAuth, async (req, res) => {
  const row = getItem(Number(req.params.id));
  if (!row || row.user_id !== req.user!.id) return res.status(404).json({ success: false, error: 'العمل غير موجود' });
  await removeItem(row);
  res.json({ success: true });
});

// ---------- Admin (mounted under /api/admin/gallery, so already admin-only) ----------

export const galleryAdminRouter = express.Router();

galleryAdminRouter.get('/', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
  const rows = db.prepare(`
    SELECT g.*, u.name AS author_name, u.email AS author_email FROM gallery_items g LEFT JOIN users u ON u.id = g.user_id
    WHERE g.status = ? ORDER BY g.id DESC LIMIT 200
  `).all(status) as unknown as (ItemRow & { author_name: string | null; author_email: string | null })[];
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM gallery_items WHERE status = 'pending'").get() as { n: number }).n;
  res.json({
    success: true, pending,
    items: rows.map(r => ({ ...publicItem(r), status: r.status, rejectReason: r.reject_reason, email: r.author_email, source: r.source, createdAt: r.created_at })),
  });
});

galleryAdminRouter.post('/:id/approve', (req, res) => {
  const r = db.prepare("UPDATE gallery_items SET status = 'approved', reject_reason = NULL, approved_at = COALESCE(approved_at, datetime('now')) WHERE id = ?").run(Number(req.params.id));
  res.json({ success: r.changes > 0 });
});

galleryAdminRouter.post('/:id/reject', (req, res) => {
  const r = db.prepare("UPDATE gallery_items SET status = 'rejected', reject_reason = ? WHERE id = ?").run(clean(req.body?.reason, 300) || null, Number(req.params.id));
  res.json({ success: r.changes > 0 });
});

galleryAdminRouter.patch('/:id', (req, res) => {
  const row = getItem(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'العمل غير موجود' });
  const b = req.body ?? {};
  db.prepare('UPDATE gallery_items SET title = ?, description = ?, category = ?, kind = ?, tags = ?, featured = ? WHERE id = ?').run(
    clean(b.title, 80) || row.title, b.description === undefined ? row.description : clean(b.description, 500),
    isCategory(b.category) ? b.category : row.category, isKind(b.kind) ? b.kind : row.kind,
    b.tags === undefined ? row.tags : cleanTags(b.tags), b.featured === undefined ? row.featured : b.featured ? 1 : 0, row.id,
  );
  res.json({ success: true });
});

galleryAdminRouter.delete('/:id', async (req, res) => {
  const row = getItem(Number(req.params.id));
  if (!row) return res.status(404).json({ success: false, error: 'العمل غير موجود' });
  await removeItem(row);
  res.json({ success: true });
});

/** The file behind something made in an admin tool, read where that tool keeps it. */
async function toolFile(source: string, ref: string): Promise<Buffer | null> {
  const id = /^[A-Za-z0-9_-]{4,80}$/.test(ref) ? ref : null;
  if (!id) return null;
  const read = (p: string) => fs.readFile(p).catch(() => null);
  switch (source) {
    case 'ai-image': {
      for (const ext of ['png', 'jpg', 'webp']) { const b = await read(path.join(DATA(), 'ai-image', `${id}-0.${ext}`)); if (b) return b; }
      return null;
    }
    case 'ai-video': return read(path.join(DATA(), 'ai-video', `${id}.mp4`));
    case 'auto-reel': return read(path.join(DATA(), 'auto-reel', id, 'final.mp4'));
    case 'avatar-test': return read(path.join(DATA(), 'auto-reel', 'avatar-tests', `${id}-video.mp4`));
    default: return null;
  }
}

galleryAdminRouter.post('/from', async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!isKind(b.kind)) return res.status(400).json({ success: false, error: 'اختر النوع' });
    const title = clean(b.title, 80);
    if (title.length < 2) return res.status(400).json({ success: false, error: 'اكتب عنواناً' });
    const bytes = await toolFile(String(b.source), String(b.ref));
    if (!bytes) return res.status(404).json({ success: false, error: 'الملف غير موجود' });
    const item = await addItem({
      bytes, kind: b.kind, title, description: clean(b.description, 500), category: isCategory(b.category) ? b.category : 'other',
      tags: cleanTags(b.tags), userId: req.user!.id, byAdmin: true, source: String(b.source),
    });
    res.json({ success: true, item: publicItem(item) });
  } catch (error: any) {
    if (error?.status === 400) return res.status(400).json({ success: false, error: error.message });
    console.error('Gallery from tool failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'تعذّرت الإضافة للمعرض' });
  }
});
