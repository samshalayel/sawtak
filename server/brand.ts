// Outlet brand kit for the press studio: name, show name, colour, logo.
// Stored per account so a newsroom sets it up once (settings and assets, not generated content).
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { db } from './db.ts';
import { requireAuth, requireVerifiedEmail } from './auth.ts';

const BRANDS_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'brands');

db.exec(`
  CREATE TABLE IF NOT EXISTS brand_kits (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    outlet_name TEXT NOT NULL DEFAULT '',
    show_name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0e7490',
    has_logo INTEGER NOT NULL DEFAULT 0,
    has_intro INTEGER NOT NULL DEFAULT 0,
    has_outro INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface BrandKit {
  outletName: string;
  showName: string;
  color: string;
  hasLogo: boolean;
}

const fileFor = (userId: number) => path.join(BRANDS_DIR, String(userId), 'logo.png');

export function getBrandKit(userId: number): BrandKit | null {
  const row = db.prepare('SELECT * FROM brand_kits WHERE user_id = ?').get(userId) as any;
  if (!row) return null;
  return {
    outletName: row.outlet_name, showName: row.show_name, color: row.color,
    hasLogo: Boolean(row.has_logo),
  };
}

export const readBrandLogo = (userId: number) => fs.readFile(fileFor(userId)).catch(() => null);

const decode = (v: unknown) => (typeof v === 'string' && v ? Buffer.from(v.replace(/^data:[^,]*,/, ''), 'base64') : null);

export const brandRouter = express.Router();
brandRouter.use(requireAuth, requireVerifiedEmail);

brandRouter.get('/', (req, res) => {
  res.json({ success: true, brand: getBrandKit(req.user!.id) });
});

brandRouter.get('/logo', async (req, res) => {
  const logo = await readBrandLogo(req.user!.id);
  if (!logo) return res.status(404).end();
  res.type('image/png').set('Cache-Control', 'no-store').send(logo);
});

/**
 * Saves the kit. Files: send base64 to replace, `null` to remove, or leave the field out to keep the current one.
 */
brandRouter.put('/', async (req, res) => {
  const userId = req.user!.id;
  const body = req.body ?? {};
  const current = getBrandKit(userId) ?? { outletName: '', showName: '', color: '#0e7490', hasLogo: false };
  const next = { ...current };
  if (typeof body.outletName === 'string') next.outletName = body.outletName.trim().slice(0, 50);
  if (typeof body.showName === 'string') next.showName = body.showName.trim().slice(0, 50);
  if (typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)) next.color = body.color.toLowerCase();

  await fs.mkdir(path.join(BRANDS_DIR, String(userId)), { recursive: true });
  try {
    if (body.logo === null) {
      await fs.rm(fileFor(userId), { force: true });
      next.hasLogo = false;
    } else if (decode(body.logo)) {
      const png = await sharp(decode(body.logo)!).rotate().resize(600, 600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      await fs.writeFile(fileFor(userId), png);
      next.hasLogo = true;
    }
  } catch {
    return res.status(400).json({ success: false, error: 'تعذّر قراءة الشعار، جرّب صورة PNG أو JPG' });
  }

  db.prepare(`
    INSERT INTO brand_kits (user_id, outlet_name, show_name, color, has_logo, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET outlet_name = excluded.outlet_name, show_name = excluded.show_name, color = excluded.color,
      has_logo = excluded.has_logo, updated_at = excluded.updated_at
  `).run(userId, next.outletName, next.showName, next.color, next.hasLogo ? 1 : 0);
  res.json({ success: true, brand: getBrandKit(userId) });
});
