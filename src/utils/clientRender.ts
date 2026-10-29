// Puts a greeting video together on the customer's own device, so it neither waits in the server's render line nor
// uses the server's processor. The server sends a "plan" (server/video.ts, planGreetingVideo): the finished background
// with the headline, sender line and watermark drawn in, each caption as a transparent picture, and the voice already
// encoded as AAC. This draws the sound wave and the captions frame by frame on a canvas, encodes the frames to H.264
// with WebCodecs, and copies the AAC into an MP4 without encoding it again (browsers cannot encode AAC themselves).
// Anything unsupported or failing throws: the caller then falls back to the server render.
import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, EncodedAudioPacketSource, EncodedPacketSink, Input, Mp4OutputFormat, Output,
  canEncodeVideo,
} from 'mediabunny';

export interface GreetingPlan {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frame: string;
  wave: { x: number; y: number; w: number; h: number; color: string; alpha: number; boost: number } | null;
  captions: { start: number; end: number; png: string }[];
  audio: string;
}

const BITRATE = 1_200_000;

/** True when this browser can encode H.264 video (Chrome, Edge and Android do; many iPhones and Firefox do not yet). */
export async function canRenderOnDevice(width = 720, height = 1280): Promise<boolean> {
  try {
    return typeof VideoEncoder !== 'undefined' && await canEncodeVideo('avc', { width, height, bitrate: BITRATE });
  } catch {
    return false;
  }
}

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const bitmapOf = (b64: string) => createImageBitmap(new Blob([bytesOf(b64)], { type: 'image/png' }));

/** The 16-bit samples of a PCM WAV given as base64, and its sample rate. */
function readWav(b64: string): { samples: Int16Array; rate: number } {
  const bytes = bytesOf(b64);
  const view = new DataView(bytes.buffer);
  let rate = 24000;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') rate = view.getUint32(offset + 12, true);
    if (id === 'data') {
      const data = bytes.slice(offset + 8, Math.min(bytes.length, offset + 8 + size)); // a copy, so it is aligned
      return { samples: new Int16Array(data.buffer, 0, Math.floor(data.length / 2)), rate };
    }
    offset += 8 + size;
  }
  throw new Error('Invalid WAV');
}

/**
 * The greeting as an MP4. `wavBase64` is the voice (the page has it already): only the wave is drawn from it.
 * `onProgress` gets 0..1; `isCancelled` stops the work.
 */
export async function renderGreetingOnDevice(
  plan: GreetingPlan, wavBase64: string, onProgress?: (fraction: number) => void, isCancelled?: () => boolean,
): Promise<Blob> {
  const { width, height, fps } = plan;
  const [frame, captions, { samples, rate }] = await Promise.all([
    bitmapOf(plan.frame),
    Promise.all(plan.captions.map(async c => ({ start: c.start, end: c.end, image: await bitmapOf(c.png) }))),
    Promise.resolve(readWav(wavBase64)),
  ]);

  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No canvas');

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });

  // The voice, already AAC: its packets go into the MP4 as they are
  const input = new Input({ source: new BlobSource(new Blob([bytesOf(plan.audio)], { type: 'audio/mp4' })), formats: ALL_FORMATS });
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new Error('No audio track');
  const audio = new EncodedAudioPacketSource(audioTrack.codec!);
  output.addAudioTrack(audio);
  await output.start();

  const decoderConfig = (await audioTrack.getDecoderConfig()) ?? undefined;
  let first = true;
  for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
    await audio.add(packet, first ? { decoderConfig } : undefined);
    first = false;
  }
  audio.close();

  // Sound wave, as ffmpeg's showwaves (cline, sqrt scale) draws it on the server: a centred vertical line per column,
  // as tall as the loudest sample of that column in this frame's slice of the voice
  const wave = plan.wave;
  const drawWave = (index: number) => {
    if (!wave) return;
    const from = Math.floor((index / fps) * rate);
    const count = Math.max(1, Math.floor(rate / fps));
    const centre = wave.y + wave.h / 2;
    ctx.globalAlpha = wave.alpha;
    ctx.fillStyle = wave.color;
    for (let x = 0; x < wave.w; x++) {
      const a = from + Math.floor((x * count) / wave.w);
      const b = Math.max(a + 1, from + Math.floor(((x + 1) * count) / wave.w));
      let peak = 0;
      for (let i = a; i < b && i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      const half = Math.sqrt(Math.min(1, (peak / 32768) * wave.boost)) * (wave.h / 2);
      ctx.fillRect(wave.x + x, centre - Math.max(0.5, half), 1, Math.max(1, half * 2));
    }
    ctx.globalAlpha = 1;
  };

  const total = Math.ceil(plan.duration * fps);
  for (let i = 0; i < total; i++) {
    if (isCancelled?.()) throw new Error('Cancelled');
    const t = i / fps;
    ctx.drawImage(frame, 0, 0);
    drawWave(i);
    const caption = captions.find(c => t >= c.start && t < c.end);
    if (caption) ctx.drawImage(caption.image, 0, 0);
    await video.add(t, 1 / fps);
    if (i % 24 === 0) {
      onProgress?.(i / total);
      await new Promise(r => setTimeout(r)); // lets the page breathe (progress bar, buttons)
    }
  }
  video.close();
  await output.finalize();
  onProgress?.(1);
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
}
