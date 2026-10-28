// Calm / Quran reels rendered in AWS Lambda (lambda/reel) instead of on this server, so customers do not wait in
// line: the voice goes to S3, the function renders with the same code (server/calm-render.ts) and puts the MP4 in
// S3, and the customer streams it from there through a short-lived link. Off unless the function and bucket are
// configured (.env) and the admin turns it on (setting reelLambda).
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CalmRenderOptions } from './calm-render.ts';
import type { ReelJob, ReelResult } from '../lambda/reel/handler.ts';

const FUNCTION = process.env.REEL_LAMBDA_FUNCTION || '';
const BUCKET = process.env.REEL_BUCKET || '';
const REGION = process.env.REEL_AWS_REGION || process.env.AWS_REGION || 'eu-central-1';
// Its own key (lambda/reel/setup-aws.sh makes it: invoke this function, reels/ in this bucket), so it never mixes
// with other AWS credentials on the server
const credentials = process.env.REEL_AWS_ACCESS_KEY_ID && process.env.REEL_AWS_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.REEL_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.REEL_AWS_SECRET_ACCESS_KEY }
  : undefined;

export const lambdaConfigured = () => Boolean(FUNCTION && BUCKET);

let lambda: LambdaClient | null = null;
let s3: S3Client | null = null;
const clients = () => {
  // A render can take minutes: the invoke call waits up to the function's 15-minute limit
  lambda ??= new LambdaClient({ region: REGION, credentials, requestHandler: { requestTimeout: 900_000, connectionTimeout: 10_000 } });
  s3 ??= new S3Client({ region: REGION, credentials });
  return { lambda, s3 };
};

/** Renders on Lambda; resolves with the S3 key of the MP4. Throws on any failure (the caller renders locally). */
export async function renderOnLambda(jobId: string, o: CalmRenderOptions): Promise<{ key: string } & ReelResult> {
  const { lambda, s3 } = clients();
  const voiceKey = `reels/${jobId}/voice.wav`;
  const outKey = `reels/${jobId}/reel.mp4`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: voiceKey, Body: o.voice, ContentType: 'audio/wav' }));
  const { voice: _voice, brand: _brand, onProgress: _p, onStart: _s, ...options } = o;
  const job: ReelJob = { voiceKey, outKey, options };
  const res = await lambda.send(new InvokeCommand({ FunctionName: FUNCTION, Payload: Buffer.from(JSON.stringify(job)) }));
  const answer = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString('utf8')) : null;
  if (res.FunctionError || !answer?.bytes) throw new Error(`Lambda reel failed: ${answer?.errorMessage || res.FunctionError || 'no answer'}`);
  return { key: outKey, ...(answer as ReelResult) };
}

/** A link to the MP4 in S3 for half an hour (plays with byte ranges; `download` saves it under that name). */
export function reelLink(key: string, download?: string): Promise<string> {
  const { s3 } = clients();
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET, Key: key,
    ...(download ? { ResponseContentDisposition: `attachment; filename="${download}.mp4"` } : {}),
  }), { expiresIn: 1800 });
}
