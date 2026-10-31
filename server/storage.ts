// Where the site keeps the media it makes (gallery, AI pictures and clips, automatic reels, presenter trials): an S3
// bucket when MEDIA_BUCKET is set in .env (made by scripts/setup-media-bucket.sh), so the server keeps only the
// programs and the database; otherwise the server's own disk (DATA_DIR), as before. Keys are paths like
// "gallery/12.mp4" and are the same in both, so scripts/migrate-media-to-s3.ts can move existing files one to one.
// Files are served by redirecting to a short-lived S3 link: the bytes never pass through the server.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.MEDIA_BUCKET || '';
const REGION = process.env.MEDIA_AWS_REGION || process.env.REEL_AWS_REGION || process.env.AWS_REGION || 'eu-north-1';
// Its own key (only this bucket), never mixed with the reel renderer's key
const credentials = process.env.MEDIA_AWS_ACCESS_KEY_ID && process.env.MEDIA_AWS_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.MEDIA_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.MEDIA_AWS_SECRET_ACCESS_KEY }
  : undefined;
const LINK_SECONDS = 60 * 60;

const local = (key: string) => path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), key);
const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes('..') || key.startsWith('/')) throw new Error(`Bad storage key: ${key}`);
  return key;
};

/** True when media goes to S3 (else the local disk). */
export const remoteStorage = () => Boolean(BUCKET);

let client: S3Client | null = null;
// MEDIA_S3_ENDPOINT: another S3-compatible service (or a local one for tests)
const s3 = () => (client ??= new S3Client({
  region: REGION, credentials,
  ...(process.env.MEDIA_S3_ENDPOINT ? { endpoint: process.env.MEDIA_S3_ENDPOINT, forcePathStyle: true } : {}),
}));

export async function putMedia(key: string, body: Buffer, contentType: string) {
  safeKey(key);
  if (!remoteStorage()) {
    await fs.mkdir(path.dirname(local(key)), { recursive: true });
    await fs.writeFile(local(key), body);
    return;
  }
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** Stores a file made on disk; when media is remote the local file is removed once it is safely in S3. */
export async function putMediaFile(key: string, file: string, contentType: string) {
  safeKey(key);
  if (!remoteStorage()) {
    if (path.resolve(file) !== path.resolve(local(key))) {
      await fs.mkdir(path.dirname(local(key)), { recursive: true });
      await fs.copyFile(file, local(key));
    }
    return;
  }
  await putMedia(key, await fs.readFile(file), contentType);
  await fs.rm(file, { force: true });
}

export async function getMedia(key: string): Promise<Buffer | null> {
  safeKey(key);
  if (!remoteStorage()) return fs.readFile(local(key)).catch(() => null);
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch {
    // Made before the switch to S3 and not moved yet (scripts/migrate-media-to-s3.ts)
    return fs.readFile(local(key)).catch(() => null);
  }
}

export async function mediaExists(key: string): Promise<boolean> {
  safeKey(key);
  if (!remoteStorage()) return fs.stat(local(key)).then(s => s.size > 0, () => false);
  return s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })).then(() => true, () => false);
}

export async function removeMedia(...keys: string[]) {
  keys.forEach(safeKey);
  if (!remoteStorage()) {
    await Promise.all(keys.map(k => fs.rm(local(k), { force: true })));
    return;
  }
  await Promise.all(keys.map(k => s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })).catch(() => {})));
}

/** Removes everything under a folder ("auto-reel/<id>/"). */
export async function removeMediaFolder(prefix: string) {
  safeKey(prefix);
  if (!remoteStorage()) {
    await fs.rm(local(prefix), { recursive: true, force: true });
    return;
  }
  for (let token: string | undefined; ;) {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map(o => ({ Key: o.Key! }));
    if (keys.length) await s3().send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
    if (!page.IsTruncated) break;
    token = page.NextContinuationToken;
  }
}

/**
 * Answers a request for a stored file: a redirect to a short-lived S3 link (the bytes go straight from S3 to the
 * viewer, ranges included), or the file from disk. A missing file is a 404.
 */
export async function sendMedia(res: express.Response, key: string, o: { type: string; download?: string; cache?: 'public' | 'private' }) {
  safeKey(key);
  // On disk: local storage, or made before the switch to S3 and not moved yet
  if (!remoteStorage() || await fs.stat(local(key)).then(() => true, () => false)) {
    if (o.cache) res.set('Cache-Control', o.cache === 'public' ? 'public, max-age=86400' : 'private, max-age=3600');
    if (o.download) res.attachment(o.download);
    return res.type(o.type).sendFile(local(key), error => { if (error && !res.headersSent) res.status(404).end(); });
  }
  const url = await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: BUCKET, Key: key, ResponseContentType: o.type,
    ...(o.download ? { ResponseContentDisposition: `attachment; filename="${o.download.replace(/"/g, '')}"` } : {}),
  }), { expiresIn: LINK_SECONDS });
  // The link expires, so the redirect itself is only kept briefly
  res.set('Cache-Control', 'private, max-age=600');
  res.redirect(302, url);
}

/** A file's type from its name. */
export const typeOf = (name: string) =>
  ({ mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg' } as Record<string, string>)[
    name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
