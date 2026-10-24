// Regenerates the voice-picker showcase samples (public/samples/*.wav) via the running server.
// Usage: npm run dev (in another terminal), then: npm run samples
const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
import { VOICES } from '../src/data/presets.ts';

const VOICE_IDS = VOICES.map(v => v.id);

// Optional: pass voice ids as args to regenerate only those (e.g. npm run samples -- Charon)
const targets = process.argv.slice(2).length ? process.argv.slice(2) : VOICE_IDS;

for (const voiceId of targets) {
  let res = await fetch(`${BASE_URL}/api/tts/preview/${voiceId}?refresh=1`);
  // Free-tier Gemini TTS allows only a few requests per minute; wait and retry when rate-limited.
  for (let attempt = 0; !res.ok && attempt < 3 && (await res.clone().text()).includes('429'); attempt++) {
    console.log(`… ${voiceId}: rate-limited, retrying in 40s`);
    await new Promise(r => setTimeout(r, 40_000));
    res = await fetch(`${BASE_URL}/api/tts/preview/${voiceId}?refresh=1`);
  }
  if (!res.ok) {
    console.error(`✗ ${voiceId}: ${res.status} ${await res.text()}`);
    continue;
  }
  const size = (await res.arrayBuffer()).byteLength;
  console.log(`✓ ${voiceId}: ${(size / 1024).toFixed(0)} KB`);
}
