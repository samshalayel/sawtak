// Load test for the Lambda reel renderer: starts N reels at the same moment and reports how each one went.
// Talks to Lambda directly (no accounts, no points, no database): a made-up voice and 3 Pixabay scenes.
// Run inside the site's container, where the REEL_* and PIXABAY_API_KEY settings already are:
//   docker cp scripts/load-test-reels.ts sawtik-ai-tts-studio:/app/scripts/ && docker compose exec sawtik node scripts/load-test-reels.ts 15 30
// Arguments: how many reels (default 15) and the length of each one's voice in seconds (default 30).
import { spawnSync } from 'child_process';
import { lambdaConfigured, renderOnLambda } from '../server/reel-lambda.ts';
import type { Clip } from '../server/calm-render.ts';

const count = Math.min(60, Math.max(1, Number(process.argv[2]) || 15));
const seconds = Math.min(180, Math.max(5, Number(process.argv[3]) || 30));

if (!lambdaConfigured()) throw new Error('REEL_LAMBDA_FUNCTION / REEL_BUCKET are not set here');
if (!process.env.PIXABAY_API_KEY) throw new Error('PIXABAY_API_KEY is not set here');

/** A steady tone as 24 kHz mono WAV, so the renderer has a voice of the wanted length to time the captions on. */
function tone(len: number): Buffer {
  const out = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${len}`, '-ar', '24000', '-ac', '1', '-f', 'wav', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`ffmpeg: ${out.stderr}`);
  return out.stdout;
}

async function scenes(): Promise<Clip[]> {
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(process.env.PIXABAY_API_KEY!)}&q=${encodeURIComponent('forest trees nature')}&safesearch=true&per_page=20&video_type=film`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pixabay ${res.status}`);
  const hits = ((await res.json()).hits ?? []).filter((h: any) => h.duration >= 8 && h.videos?.small?.url).slice(0, 3);
  if (hits.length === 0) throw new Error('No Pixabay scenes found');
  return hits.map((h: any) => ({
    id: h.id, duration: h.duration, tags: String(h.tags || ''), thumb: h.videos.tiny?.thumbnail || '', preview: h.videos.tiny?.url || h.videos.small.url,
    url: h.videos.small.url, width: h.videos.small.width, height: h.videos.small.height,
  }));
}

const clips = await scenes();
const voice = tone(seconds);
const text = 'بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين إياك نعبد وإياك نستعين اهدنا الصراط المستقيم';
console.log(`Starting ${count} reels of ${seconds} s on ${process.env.REEL_LAMBDA_FUNCTION} (${process.env.REEL_AWS_REGION}) at ${new Date().toISOString()}`);

const started = Date.now();
const results = await Promise.all(Array.from({ length: count }, async (_, i) => {
  const t0 = Date.now();
  const id = `loadtest-${started}-${i + 1}`;
  try {
    const r = await renderOnLambda(id, { clips, voice, text, title: 'اختبار', supportCard: '', domain: 'loadtest', info: '', dedication: '' });
    const wall = (Date.now() - t0) / 1000;
    console.log(`#${i + 1} ok    wall ${wall.toFixed(1)} s, in Lambda ${r.renderSeconds} s, ${(r.bytes / 1e6).toFixed(1)} MB`);
    return { ok: true, wall, inLambda: r.renderSeconds };
  } catch (error: any) {
    const wall = (Date.now() - t0) / 1000;
    console.log(`#${i + 1} FAIL  wall ${wall.toFixed(1)} s: ${error?.name || ''} ${String(error?.message || error).slice(0, 200)}`);
    return { ok: false, wall, inLambda: 0 };
  }
}));

const ok = results.filter(r => r.ok);
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s: ${ok.length} ok, ${results.length - ok.length} failed`);
console.log(`Wall time per reel: avg ${avg(ok.map(r => r.wall))} s, max ${Math.max(0, ...ok.map(r => r.wall)).toFixed(1)} s | in Lambda: avg ${avg(ok.map(r => r.inLambda))} s`);
process.exit(results.length === ok.length ? 0 : 1);
