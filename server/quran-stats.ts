// Log of Quran reels for the admin dashboard: one row per reel (who, which verses, which reciter, how long, the
// points charged, and whether it rendered), and the totals shown in the "ريلز الآيات" tab.
import { db, POINTS_TO_SECONDS } from './db.ts';
import { refundPoints } from './credits.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS quran_reels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    surah INTEGER NOT NULL,
    surah_name TEXT NOT NULL DEFAULT '',
    start_verse INTEGER NOT NULL,
    end_verse INTEGER NOT NULL,
    reciter TEXT NOT NULL DEFAULT '',
    reel_seconds REAL NOT NULL DEFAULT 0,       -- length of the recitation
    points INTEGER NOT NULL DEFAULT 0,          -- points charged
    status TEXT NOT NULL DEFAULT 'rendering' CHECK (status IN ('rendering', 'done', 'failed')),
    render_seconds REAL,                        -- time the server took to make it
    error TEXT,
    refunded INTEGER NOT NULL DEFAULT 0,        -- 1 = the points went back to the user (failed reel)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_quran_reels_time ON quran_reels(created_at);
`);
// The first version of the table had no refunded column
if (!(db.prepare('PRAGMA table_info(quran_reels)').all() as { name: string }[]).some(c => c.name === 'refunded')) {
  db.exec('ALTER TABLE quran_reels ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0');
}

export function logQuranReel(r: { userId: number; surah: number; surahName: string; start: number; end: number; reciter: string; reelSeconds: number; points: number }): number {
  const res = db.prepare(`
    INSERT INTO quran_reels (user_id, surah, surah_name, start_verse, end_verse, reciter, reel_seconds, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(r.userId, r.surah, r.surahName, r.start, r.end, r.reciter, r.reelSeconds, r.points);
  return Number(res.lastInsertRowid);
}

export function finishQuranReel(id: number, ok: boolean, renderSeconds: number, error?: string) {
  db.prepare('UPDATE quran_reels SET status = ?, render_seconds = ?, error = ? WHERE id = ?')
    .run(ok ? 'done' : 'failed', Math.round(renderSeconds * 10) / 10, error ? error.slice(0, 300) : null, id);
}

/** A reel that did not render: its points go back to the user (once). Returns the new balance in points, or null. */
export function refundQuranReel(id: number): number | null {
  const reel = db.prepare('SELECT user_id, points, surah_name, start_verse, end_verse, refunded FROM quran_reels WHERE id = ?').get(id) as
    { user_id: number | null; points: number; surah_name: string; start_verse: number; end_verse: number; refunded: number } | undefined;
  if (!reel || reel.refunded || !reel.user_id || reel.points <= 0) return null;
  db.prepare('UPDATE quran_reels SET refunded = 1 WHERE id = ?').run(id);
  const verses = reel.start_verse === reel.end_verse ? `${reel.start_verse}` : `${reel.start_verse}–${reel.end_verse}`;
  return refundPoints(reel.user_id, reel.points, `استرجاع · لم يكتمل ريل آيات · ${reel.surah_name} ${verses}`);
}

/**
 * At start-up no render is running, so reels still marked "rendering" were cut off (restart or crash): they are
 * marked failed and refunded.
 */
export function recoverInterruptedQuranReels() {
  const ids = (db.prepare("SELECT id FROM quran_reels WHERE status = 'rendering'").all() as { id: number }[]).map(r => r.id);
  for (const id of ids) {
    finishQuranReel(id, false, 0, 'انقطع التجهيز (إعادة تشغيل الخادم)');
    refundQuranReel(id);
  }
  if (ids.length) console.log(`Quran reels cut off by a restart, refunded: ${ids.join(', ')}`);
}

/** Totals since `days` ago (0 = all time), the most used reciters and surahs, and every reel in that period. */
export function quranReelStats(days: number) {
  const since = days > 0 ? `datetime('now', '-${Math.floor(days)} days')` : `'1970-01-01'`;
  const totals = db.prepare(`
    SELECT COUNT(*) AS reels,
           SUM(status = 'done') AS done,
           SUM(status = 'failed') AS failed,
           COUNT(DISTINCT user_id) AS users,
           COALESCE(SUM(end_verse - start_verse + 1), 0) AS verses,
           COALESCE(SUM(reel_seconds), 0) AS reel_seconds,
           COALESCE(SUM(CASE WHEN refunded = 1 THEN 0 ELSE points END), 0) AS points,
           SUM(refunded) AS refunded,
           AVG(CASE WHEN status = 'done' THEN render_seconds END) AS avg_render_seconds
    FROM quran_reels WHERE created_at >= ${since}
  `).get();
  const byReciter = db.prepare(`
    SELECT reciter AS name, COUNT(*) AS reels FROM quran_reels WHERE created_at >= ${since}
    GROUP BY reciter ORDER BY reels DESC LIMIT 10
  `).all();
  const bySurah = db.prepare(`
    SELECT surah, surah_name AS name, COUNT(*) AS reels FROM quran_reels WHERE created_at >= ${since}
    GROUP BY surah ORDER BY reels DESC LIMIT 10
  `).all();
  const daily = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS reels, COALESCE(SUM(CASE WHEN refunded = 1 THEN 0 ELSE points END), 0) AS points
    FROM quran_reels WHERE created_at >= ${since} GROUP BY day ORDER BY day DESC
  `).all();
  const reels = db.prepare(`
    SELECT q.*, u.email FROM quran_reels q LEFT JOIN users u ON u.id = q.user_id
    WHERE q.created_at >= ${since} ORDER BY q.id DESC LIMIT 5000
  `).all();
  // Points customers still hold (admins' test balances left out); balances are stored in seconds
  const balances = db.prepare(`
    SELECT COALESCE(SUM(credits), 0) AS seconds, COUNT(*) AS users
    FROM users WHERE deleted_at IS NULL AND role = 'user'
  `).get() as { seconds: number; users: number };
  return {
    totals, byReciter, bySurah, daily, reels,
    customers: { users: balances.users, points: Math.round(balances.seconds / POINTS_TO_SECONDS) },
  };
}
