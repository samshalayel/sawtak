// Speech the server has just made, kept for a while so the page can ask for a video of it by id instead of uploading
// the same WAV back: a 2-minute episode is ~9 MB of base64, which takes minutes on a slow home connection (and the
// upload sometimes breaks half way). Held in memory only; if the server restarts the page falls back to uploading.
import crypto from 'crypto';

const TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 256 * 1024 * 1024;

const kept = new Map<string, { userId: number; wav: Buffer; at: number }>();
let bytes = 0;

function drop(id: string) {
  const e = kept.get(id);
  if (!e) return;
  bytes -= e.wav.length;
  kept.delete(id);
}

function prune(now = Date.now()) {
  for (const [id, e] of kept) if (now - e.at > TTL_MS) drop(id);
}
setInterval(prune, 5 * 60 * 1000).unref();

/** Keeps `wav` for `userId`; returns the id the page uses to ask for it. The oldest clips go first when the memory budget is full. */
export function keepAudio(userId: number, wav: Buffer): string {
  prune();
  while (bytes + wav.length > MAX_BYTES && kept.size > 0) drop(kept.keys().next().value!);
  const id = crypto.randomBytes(12).toString('base64url');
  kept.set(id, { userId, wav, at: Date.now() });
  bytes += wav.length;
  return id;
}

/** The clip kept under `id` for this user (it stays available for the whole lifetime, e.g. to make another format), or null. */
export function takeAudio(userId: number, id: string): Buffer | null {
  const e = kept.get(id);
  if (!e || e.userId !== userId || Date.now() - e.at > TTL_MS) return null;
  return e.wav;
}
