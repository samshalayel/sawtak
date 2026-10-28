// "Calm reels": a slow, quiet vertical video — real nature footage from Pixabay, a calm voice, large captions
// and an optional support card — made for people living through hard times. Footage search is proxied so the
// API key never reaches the browser, results are cached for 24 h (Pixabay's terms), and anything tagged with
// war, fire, smoke, weapons or destruction is filtered out so a calming video can never show a distressing scene.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth, requireVerifiedEmail } from './auth.ts';
import { db } from './db.ts';
import { enqueueRender } from './video.ts';
import { CLIP_DIR, CLIP_TTL_MS, Clip, CalmRenderOptions, renderReel } from './calm-render.ts';
// The renderer lives in calm-render.ts (it also runs in AWS Lambda); these are used across the server
export { clampCalmStyle, clampSticker, clampQuality, verseChunks, DEFAULT_CALM_STYLE } from './calm-render.ts';
export type { Clip, CalmRenderOptions, CalmStyle } from './calm-render.ts';

const PIXABAY = 'https://pixabay.com/api/videos/';
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
/** Arabic scene categories -> English Pixabay queries (Pixabay has no Arabic search). */
export const CALM_SCENES: Record<string, string> = {
  forest: 'forest trees nature',
  sea: 'sea waves beach calm',
  rain: 'rain drops window nature',
  clouds: 'clouds sky timelapse',
  sunrise: 'sunrise morning light',
  countryside: 'countryside road fields',
  mountains: 'mountains landscape',
  river: 'river stream water nature',
  snow: 'snow winter landscape',
  flowers: 'flowers meadow',
  stars: 'night sky stars',
};

// Never show these in a calming video (checked against Pixabay's tags)
const BLOCKED_TAGS = [
  'war', 'army', 'soldier', 'military', 'weapon', 'gun', 'tank', 'explosion', 'bomb', 'fire', 'flame', 'smoke', 'burning',
  'destruction', 'ruin', 'ruins', 'rubble', 'disaster', 'blood', 'death', 'dead', 'funeral', 'cemetery', 'grave', 'police',
  'protest', 'riot', 'crash', 'accident', 'storm', 'lightning', 'tornado', 'hurricane', 'flood', 'earthquake', 'scary', 'horror',
];

const searchCache = new Map<string, { at: number; clips: Clip[] }>();
const clipIndex = new Map<number, Clip>(); // clips seen in searches, so render requests can only use vetted ids

export const isCalm = (tags: string, extraBlocked: string[] = []) => {
  const words = tags.toLowerCase().split(/[,\s]+/);
  return ![...BLOCKED_TAGS, ...extraBlocked].some(b => words.includes(b));
};

/** Pixabay videos for a query, minus anything tagged with a blocked word (`extraBlocked` adds to the calm list). */
export async function searchClips(query: string, extraBlocked: string[] = []): Promise<Clip[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw Object.assign(new Error('PIXABAY_API_KEY missing'), { code: 'NO_KEY' });
  const cacheKey = `${query}|${extraBlocked.join(',')}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.clips;

  const url = `${PIXABAY}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&safesearch=true&per_page=40&video_type=film`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const data = await res.json();
  const clips: Clip[] = (data.hits ?? [])
    .filter((h: any) => isCalm(String(h.tags || ''), extraBlocked) && h.duration >= 5)
    .map((h: any) => {
      const v = h.videos ?? {};
      // ~1080p is plenty for a 720x1280 vertical crop and keeps downloads small
      const src = v.small?.url ? v.small : v.medium?.url ? v.medium : v.tiny;
      return {
        id: h.id, duration: h.duration, tags: String(h.tags || ''),
        thumb: v.tiny?.thumbnail || v.small?.thumbnail || '', preview: v.tiny?.url || src?.url,
        url: src?.url, width: src?.width, height: src?.height,
      } as Clip;
    })
    .filter((c: Clip) => c.url);
  for (const c of clips) clipIndex.set(c.id, c);
  searchCache.set(cacheKey, { at: Date.now(), clips });
  return clips;
}

setInterval(async () => {
  const files = await fs.readdir(CLIP_DIR).catch(() => [] as string[]);
  for (const f of files) {
    const st = await fs.stat(path.join(CLIP_DIR, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > CLIP_TTL_MS) await fs.rm(path.join(CLIP_DIR, f), { force: true }).catch(() => {});
  }
}, 20 * 60_000).unref();

export function renderCalmReel(o: CalmRenderOptions): Promise<Buffer> {
  return enqueueRender(() => renderReel(o), o.onStart);
}


// ---------- Routes (search; render lives in server.ts next to the other video jobs) ----------

export const calmRouter = express.Router();
calmRouter.use(requireAuth, requireVerifiedEmail);

calmRouter.get('/search', async (req, res) => {
  const scene = String(req.query.scene || '');
  const query = CALM_SCENES[scene];
  if (!query) return res.status(400).json({ success: false, error: 'اختر نوع المشهد' });
  try {
    const clips = await searchClips(query);
    res.json({
      success: true,
      clips: clips.slice(0, 24).map(c => ({ id: c.id, duration: c.duration, thumb: c.thumb, preview: c.preview, width: c.width, height: c.height })),
    });
  } catch (err: any) {
    console.error('Calm search failed:', err?.message || err);
    res.status(503).json({ success: false, error: 'تعذّر جلب المشاهد حالياً، يرجى المحاولة لاحقاً.' });
  }
});

/** Only clips that came from our own (filtered) searches can be rendered. */
export const vettedClip = (id: number) => clipIndex.get(id) ?? null;

/**
 * Clips for a render, in order. One not seen in a search since the server started (a starred scene, or the search
 * cache expired) is looked up on Pixabay by id and goes through the same calm filter.
 */
export async function vetClips(ids: number[]): Promise<Clip[]> {
  const key = process.env.PIXABAY_API_KEY;
  const out: Clip[] = [];
  for (const id of ids) {
    let clip = clipIndex.get(id) ?? null;
    if (!clip && key && Number.isInteger(id) && id > 0) {
      try {
        const res = await fetch(`${PIXABAY}?key=${encodeURIComponent(key)}&id=${id}`, { signal: AbortSignal.timeout(15_000) });
        const h = res.ok ? (await res.json()).hits?.[0] : null;
        if (h && isCalm(String(h.tags || '')) && h.duration >= 5) {
          const v = h.videos ?? {};
          const src = v.small?.url ? v.small : v.medium?.url ? v.medium : v.tiny;
          if (src?.url) {
            clip = { id: h.id, duration: h.duration, tags: String(h.tags || ''), thumb: v.tiny?.thumbnail || '', preview: v.tiny?.url || src.url, url: src.url, width: src.width, height: src.height };
            clipIndex.set(clip.id, clip);
          }
        }
      } catch { /* left out */ }
    }
    if (clip) out.push(clip);
  }
  return out;
}

// ---------- Starred scenes (settings, not content) ----------

interface FavoriteClip { id: number; duration: number; thumb: string; preview: string; scene: string }
const PIXABAY_CDN = /^https:\/\/cdn\.pixabay\.com\//;

calmRouter.get('/favorites', (req, res) => {
  let clips: FavoriteClip[] = [];
  try { clips = JSON.parse((db.prepare('SELECT favorite_clips FROM users WHERE id = ?').get(req.user!.id) as { favorite_clips: string }).favorite_clips); } catch { /* none */ }
  res.json({ success: true, clips: Array.isArray(clips) ? clips : [] });
});

/** Replaced as a whole list; only Pixabay's own media addresses are kept. */
calmRouter.put('/favorites', (req, res) => {
  const seen = new Set<number>();
  const clips: FavoriteClip[] = (Array.isArray(req.body?.clips) ? req.body.clips : []).flatMap((c: any) => {
    const id = Number(c?.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return [];
    const thumb = String(c?.thumb || ''), preview = String(c?.preview || '');
    if ((thumb && !PIXABAY_CDN.test(thumb)) || !PIXABAY_CDN.test(preview)) return [];
    seen.add(id);
    return [{ id, duration: Math.max(0, Math.min(600, Number(c?.duration) || 0)), thumb, preview, scene: CALM_SCENES[c?.scene] ? String(c.scene) : '' }];
  }).slice(0, 60);
  db.prepare('UPDATE users SET favorite_clips = ? WHERE id = ?').run(JSON.stringify(clips), req.user!.id);
  res.json({ success: true, clips });
});
