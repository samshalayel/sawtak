// AWS Lambda function that renders one calm / Quran reel with the same code as the server (server/calm-render.ts).
// The site uploads the voice to S3 and invokes this with the render options; the MP4 goes back to S3 and the site
// streams it to the customer from there (server/reel-lambda.ts). Runs on the custom runtime loop in bootstrap.ts.
import fs from 'fs/promises';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { renderReel, CalmRenderOptions } from '../../server/calm-render.ts';

/** What the site sends: everything renderReel needs except the voice, which is in S3 (payloads are capped at 6 MB). */
export interface ReelJob {
  voiceKey: string;
  outKey: string;
  options: Omit<CalmRenderOptions, 'voice' | 'brand' | 'onProgress' | 'onStart'>;
}
export interface ReelResult { bytes: number; renderSeconds: number }

const BUCKET = process.env.REEL_BUCKET || '';
// Local tests only: a folder stands in for the bucket
const LOCAL_DIR = process.env.REEL_LOCAL_DIR;
const s3 = new S3Client({});

async function read(key: string): Promise<Buffer> {
  if (LOCAL_DIR) return fs.readFile(path.join(LOCAL_DIR, key));
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

async function write(key: string, body: Buffer) {
  if (LOCAL_DIR) {
    await fs.mkdir(path.dirname(path.join(LOCAL_DIR, key)), { recursive: true });
    return fs.writeFile(path.join(LOCAL_DIR, key), body);
  }
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'video/mp4' }));
}

export async function handler(job: ReelJob): Promise<ReelResult> {
  if (!job?.voiceKey || !job.outKey || !job.options?.clips?.length) throw new Error('Bad reel job');
  const t0 = Date.now();
  const voice = await read(job.voiceKey);
  const mp4 = await renderReel({ ...job.options, voice });
  await write(job.outKey, mp4);
  return { bytes: mp4.length, renderSeconds: Math.round((Date.now() - t0) / 100) / 10 };
}
