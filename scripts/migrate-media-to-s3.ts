// Moves the media already on the server's disk into the S3 media bucket (server/storage.ts), one file at a time:
// each is uploaded under the same path, checked, and only then removed from the disk, several at once (--parallel=N,
// default 8). Small job files (.json),
// captions and the voice fingerprints' reference clips stay. Safe to run again. Inside the container:
//   docker exec sawtik-ai-tts-studio node scripts/migrate-media-to-s3.ts          (add --dry-run to only count)
import fs from 'fs/promises';
import path from 'path';
import { mediaExists, putMediaFile, remoteStorage, typeOf } from '../server/storage.ts';

const DATA = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const FOLDERS = ['gallery', 'ai-image', 'ai-video', 'auto-reel'];
const MEDIA = /\.(mp4|webm|png|jpe?g|webp|wav|mp3|m4a|ogg)$/i;
const dry = process.argv.includes('--dry-run');
const PARALLEL = Math.max(1, Math.min(32, Number(process.argv.find(a => a.startsWith('--parallel='))?.split('=')[1]) || 8));

if (!remoteStorage()) {
  console.error('MEDIA_BUCKET is not set: run scripts/setup-media-bucket.sh and recreate the container first.');
  process.exit(1);
}

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (MEDIA.test(entry.name)) yield full;
  }
}

let moved = 0, bytes = 0, failed = 0;
const all: string[] = [];
for (const folder of FOLDERS) for await (const file of files(path.join(DATA, folder))) all.push(file);

async function move(file: string) {
  const key = path.relative(DATA, file).split(path.sep).join('/');
  const size = (await fs.stat(file)).size;
  if (dry) { moved++; bytes += size; return; }
  try {
    // The disk copy is removed by putMediaFile only after the upload succeeded; checked once more here
    await putMediaFile(key, file, typeOf(file));
    if (!(await mediaExists(key))) throw new Error('not found after upload');
    moved++;
    bytes += size;
    if (moved % 25 === 0) console.log(`${moved}/${all.length} files, ${(bytes / 1e6).toFixed(0)} MB…`);
  } catch (error: any) {
    failed++;
    console.error(`FAILED ${key}: ${error?.message || error}`);
  }
}

let next = 0;
await Promise.all(Array.from({ length: Math.min(PARALLEL, all.length) }, async () => {
  while (next < all.length) await move(all[next++]);
}));
console.log(`${dry ? 'Would move' : 'Moved'} ${moved} files (${(bytes / 1e6).toFixed(1)} MB)${failed ? `, ${failed} failed (kept on disk; run again)` : ''}.`);
