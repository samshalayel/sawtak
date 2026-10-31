import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ThinkingLevel } from '@google/genai';

dotenv.config();

// Loaded after dotenv so ADMIN_EMAIL / DATA_DIR from .env are visible at module init
const { authRouter, loadUser, requireAuth, requireVerifiedEmail, createRateLimiter } = await import('./server/auth.ts');
const { adminRouter, motionStatsRouter } = await import('./server/admin.ts');
const { getSettings, getUserById } = await import('./server/db.ts');
const {
  estimateSeconds, pcmSeconds, reserveCredits, releaseCredits, settleTtsCharge, logUsage,
  InsufficientCreditsError, AUDIO_TOKENS_PER_SECOND, estimateCredits, pointsText, chargePoints
} = await import('./server/credits.ts');
const { withGeminiFailover, hasUsableKeys } = await import('./server/keys.ts');
const { elevenLabsEnabled, synthesizeElevenLabs } = await import('./server/tts-elevenlabs.ts');
const { openRouterEnabled, synthesizeOpenRouter, synthesizeOpenRouterDialogue } = await import('./server/tts-openrouter.ts');
// Automatic reels (admin) speak each scene with the studio's own voice chain
(await import('./server/auto-reel.ts')).setAutoReelSpeech(async (text, voice, style) => (await synthesizeSpeech(text, voice, style)).wav);
const { keepAudio, takeAudio } = await import('./server/audio-handoff.ts');
const { VOICE_PREVIEWS } = await import('./server/voice-previews.ts');
const { VOICES } = await import('./src/data/presets.ts');
const { renderVoiceVideo, planGreetingVideo, enqueueRender, normalizeImage, normalizeTemplate, RenderBusyError, renderQueueFull, localRenderBusy, RENDER_SLOTS } = await import('./server/video.ts');
const { lambdaConfigured, renderOnLambda, reelLink } = await import('./server/reel-lambda.ts');
const { isGreetingTheme } = await import('./server/greeting-themes.ts');
const { clampPhotoBox, clampTextStyle } = await import('./server/greeting-art.ts');
const { createGreetingBatchRouter } = await import('./server/greeting-batch.ts');
const { brandRouter, getBrandKit, readBrandLogo } = await import('./server/brand.ts');
const { createPressRouter } = await import('./server/press.ts');
const { createMotionRouter } = await import('./server/motion.ts');
const { renderPressVideo } = await import('./server/press-video.ts');
const { newUploadPath, uploadPath, probeVideo, renderOverlayVideo, isOverlayFont, OVERLAY_MAX_SECONDS, OVERLAY_MAX_BYTES } = await import('./server/press-overlay.ts');
const { createWriteStream } = await import('fs');
const { calmRouter, renderCalmReel, vettedClip, vetClips, clampCalmStyle, clampSticker, clampQuality } = await import('./server/calm.ts');
const { quranRouter, parseQuranPick, quranRecitation, QuranTooLongError } = await import('./server/quran.ts');
const { QURAN_RECITERS } = await import('./src/data/quran.ts');
const { logQuranReel, finishQuranReel, refundQuranReel, recoverInterruptedQuranReels } = await import('./server/quran-stats.ts');
recoverInterruptedQuranReels();
const { serviceGate, serviceBlocked } = await import('./server/services.ts');
const { createMedicalRouter, getDoctorProfile, readDoctorLogo, identityLines, backgroundApproved } = await import('./server/medical.ts');
const { MEDICAL_DISCLAIMER, MEDICAL_LIMITS } = await import('./src/data/medical.ts');
const { moderateFull, BLOCKED_MESSAGE } = await import('./server/moderation.ts');
const { jawwalRouter } = await import('./server/jawwal.ts');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const TEXT_MODEL = 'gemini-3.8-flash';

// Behind Traefik in production: trust the first proxy so req.ip is the real client IP
app.set('trust proxy', 1);
// Video rendering uploads the generated WAV (and optionally an image), and custom voices upload reference clips,
// so they get a larger body limit
const smallJson = express.json({ limit: '1mb' });
const largeJson = express.json({ limit: '30mb' });
const LARGE_BODY_PATHS = new Set([
  '/api/video/render', '/api/admin/custom-voices', '/api/admin/ai-video/generate', '/api/admin/ai-image/generate', '/api/admin/auto-reel/avatar-test', '/api/greetings/batch', '/api/brand', '/api/press/master', '/api/press/video',
  '/api/medical/profile',
]);
app.use((req, res, next) => (LARGE_BODY_PATHS.has(req.path) ? largeJson : smallJson)(req, res, next));
app.use(loadUser);
// Stopped services refuse new work (admins excepted); see server/services.ts
app.use(serviceGate);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/motion-stats', motionStatsRouter);

const generationLimiter = createRateLimiter(() => getSettings().generationsPerMinute, 60 * 1000);
const textToolLimiter = createRateLimiter(() => 10, 60 * 1000);

// Content policy (banned words, then the meaning check). Returns false (and responds) when the text must not be processed.
async function passesModeration(req: express.Request, res: express.Response, text: string, feature: string): Promise<boolean> {
  const { moderationMode, moderationAi } = getSettings();
  const verdict = await moderateFull(text, { userId: req.user!.id, feature, mode: moderationMode, ai: moderationAi === 'on' });
  if (verdict.allowed) return true;
  res.status(400).json({ success: false, code: 'CONTENT_BLOCKED', error: BLOCKED_MESSAGE });
  return false;
}

function usageTokens(response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }) {
  return {
    promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// User-facing errors: never leak provider details (quota, billing, keys) to the client.
const BUSY_MESSAGE = 'الخوادم مشغولة حالياً، يرجى المحاولة لاحقاً. شكراً لتفهمكم.';
const GENERIC_MESSAGE = 'تعذّر إتمام الطلب حالياً، يرجى المحاولة لاحقاً. شكراً لتفهمكم.';

function sendFriendlyError(res: express.Response, error: any, context: string) {
  console.error(`${context}:`, error);
  const status = Number(error?.status ?? error?.code);
  const isBusy = status === 429 || status === 503 || /RESOURCE_EXHAUSTED|quota|overloaded|UNAVAILABLE/i.test(String(error?.message));
  res.status(isBusy ? 503 : 500).json({ success: false, error: isBusy ? BUSY_MESSAGE : GENERIC_MESSAGE });
}

// Samples shipped with the code live in public/samples; samples generated on the server are written to the
// persistent data volume (data/samples) so they survive redeploys. Reads check the data volume first.
const BUNDLED_SAMPLES_DIR = path.resolve(__dirname, 'public', 'samples');
const GENERATED_SAMPLES_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'samples');

async function readCachedSample(voiceId: string): Promise<Buffer | null> {
  for (const dir of [GENERATED_SAMPLES_DIR, BUNDLED_SAMPLES_DIR]) {
    const file = await fs.readFile(path.join(dir, `${voiceId}.wav`)).catch(() => null);
    if (file) return file;
  }
  return null;
}
const pendingPreviews = new Map<string, Promise<Buffer>>();

// Gemini TTS returns raw 16-bit PCM (audio/L16;rate=24000); wrap it in a WAV header so browsers can play it.
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function toWavBuffer(base64: string, mimeType?: string): Buffer {
  const raw = Buffer.from(base64, 'base64');
  if (raw.subarray(0, 4).toString('ascii') === 'RIFF') return raw;
  const rateMatch = mimeType?.match(/rate=(\d+)/);
  return pcmToWav(raw, rateMatch ? Number(rateMatch[1]) : 24000);
}

async function generatePreview(voiceId: string): Promise<Buffer> {
  const preview = VOICE_PREVIEWS[voiceId];
  const { result: response } = await withGeminiFailover('preview', client => client.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text: preview.text, speechMetadata: { style: preview.style } }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
    },
  }));

  const inline = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('No audio returned for preview');

  const wav = toWavBuffer(inline.data, inline.mimeType);
  await fs.mkdir(GENERATED_SAMPLES_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_SAMPLES_DIR, `${voiceId}.wav`), wav);
  return wav;
}

// Voice preview endpoint: serves the cached showcase sample, generating it on first request.
// Pass ?refresh=1 to regenerate (used by scripts/generate-samples.ts).
app.get('/api/tts/preview/:voiceId', async (req, res) => {
  const { voiceId } = req.params;
  if (!VOICE_PREVIEWS[voiceId]) {
    return res.status(404).json({ success: false, error: 'الصوت غير موجود' });
  }

  // Regenerating costs quota: only admins or local scripts (scripts/generate-samples.ts) may force it
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
  const refresh = req.query.refresh === '1' && (isLocal || req.user?.role === 'admin');

  try {
    if (!refresh) {
      const cached = await readCachedSample(voiceId);
      if (cached) {
        res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=86400' });
        return res.send(cached);
      }
    }

    if (!hasUsableKeys()) {
      return res.status(500).json({ success: false, error: GENERIC_MESSAGE });
    }

    let job = pendingPreviews.get(voiceId);
    if (!job) {
      job = generatePreview(voiceId).finally(() => pendingPreviews.delete(voiceId));
      pendingPreviews.set(voiceId, job);
    }
    const wav = await job;
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-cache' });
    res.send(wav);
  } catch (error: any) {
    sendFriendlyError(res, error, 'Preview generation failed');
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: hasUsableKeys(),
    time: new Date().toISOString()
  });
});

// Voices list endpoint
app.get('/api/tts/voices', (req, res) => {
  res.json({
    voices: VOICES
  });
});

// Turns the delivery controls (dialect, tone, speed, pitch) into a Gemini speech style directive
function buildStyleDirective({ dialect = 'msa', toneStyle = 'professional_news', customStylePrompt = '', speed = 1, pitch = 0 }: {
  dialect?: string; toneStyle?: string; customStylePrompt?: string; speed?: number; pitch?: number;
}): string {
  // Build dialect instructions
  const dialectMap: Record<string, string> = {
    msa: 'Modern Standard Arabic (الفصحى الحديثة الفصيحة بدقة تشكيل وإعراب سليم)',
    egyptian: 'Egyptian Arabic dialect (اللهجة المصرية الطبيعية الدافئة)',
    gulf: 'Gulf Arabic / Saudi dialect (اللهجة الخليجية والسعودية الأصيلة)',
    levantine: 'Levantine Arabic dialect (اللهجة الشامية السورية واللبنانية)',
    maghrebi: 'Maghrebi / North African Arabic dialect (اللهجة المغاربية)',
    en_us: 'English with standard American accent',
    en_uk: 'English with British Received Pronunciation accent',
    fr_fr: 'French with standard Parisian accent',
    es_es: 'Spanish with standard Castilian accent',
    de_de: 'German with clean Hochdeutsch accent',
    tr_tr: 'Turkish with natural Istanbul accent',
  };

  const toneMap: Record<string, string> = {
    professional_news: 'Clear, articulate professional news anchor with steady rhythm and authority',
    documentary_story: 'Cinematic documentary narrator, contemplative, deep pauses, storytelling cadence',
    energetic_promo: 'Enthusiastic, energetic commercial voiceover, upbeat, inspiring and engaging',
    educational_tutor: 'Patient, warm educator and instructor, explaining clearly with crystal pronunciation',
    conversational_warm: 'Friendly, intimate and casual conversational speaker, naturally breathing and approachable',
    poetic_literary: 'Expressive poetic recital, profound emotional resonance and melodious flow',
    calm_meditation: 'Soft, whisper-gentle, deeply calming meditation guide, slow soothing pace',
    custom: customStylePrompt || 'Natural, realistic human voice'
  };

  // Rate descriptor
  let rateDescription = 'Natural moderate speaking pace';
  if (speed <= 0.8) rateDescription = 'Deliberate, slow and steady speaking pace with relaxed pauses';
  else if (speed >= 1.25) rateDescription = 'Brisk, swift and dynamic speaking pace without rushing words';

  // Pitch descriptor
  let pitchDescription = 'Natural balanced vocal pitch';
  if (pitch < 0) pitchDescription = 'Deep, low-frequency resonant vocal timbre';
  else if (pitch > 0) pitchDescription = 'Lighter, slightly elevated and bright vocal timbre';

  const selectedDialect = dialectMap[dialect] || dialectMap['msa'];
  const selectedTone = toneMap[toneStyle] || toneMap['professional_news'];

  return [
    selectedTone,
    `Language/Accent: ${selectedDialect}`,
    rateDescription,
    pitchDescription,
    customStylePrompt ? `Note: ${customStylePrompt}` : ''
  ].filter(Boolean).join('. ');
}

/**
 * One single-voice speech call: ElevenLabs when TTS_PROVIDER=elevenlabs, or Gemini TTS through OpenRouter when it is
 * openrouter (Gemini takes over if that fails and Gemini keys are set), otherwise Gemini TTS failing over across API
 * keys. `wav` is null when no audio came back.
 */
async function synthesizeSpeech(text: string, voice: string, style: string): Promise<{ response: any; keyId: number | undefined; wav: Buffer | null }> {
  if (elevenLabsEnabled()) {
    try {
      // No usage metadata here: the callers bill by the seconds of audio, as they do for Gemini
      return { response: { usageMetadata: {} }, keyId: undefined, wav: await synthesizeElevenLabs(text, voice, style) };
    } catch (error: any) {
      if (!hasUsableKeys()) throw error;
      console.error('ElevenLabs failed, using Gemini:', error?.message || error);
    }
  }
  if (openRouterEnabled()) {
    try {
      return { response: { usageMetadata: {} }, keyId: undefined, wav: await synthesizeOpenRouter(text, voice, style) };
    } catch (error: any) {
      if (!hasUsableKeys()) throw error;
      console.error('OpenRouter failed, using Gemini:', error?.message || error);
    }
  }
  const { result: response, keyId } = await withGeminiFailover('tts', client => client.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text, speechMetadata: { style } }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  }));
  const audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
  return { response, keyId, wav: audio?.data ? toWavBuffer(audio.data, audio.mimeType) : null };
}

// Generate speech via Gemini TTS (metered: 1 credit per started second of audio)
app.post('/api/tts/generate', requireAuth, requireVerifiedEmail, async (req, res) => {
  const user = req.user!;
  let held = 0;

  try {
    const {
      text,
      voice = 'Kore',
      language = 'ar',
      dialect = 'msa',
      toneStyle = 'professional_news',
      customStylePrompt = '',
      pitch = 0
    } = req.body;
    // "Clone sample style": reuse the showcase sample's exact delivery direction for the user's text
    const cloneSample = req.body.cloneSample === true && Boolean(VOICE_PREVIEWS[voice]);
    const speed = cloneSample ? 1.0 : (req.body.speed ?? 1.0);

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'النص المطلوب تحويله غير موجود أو فارغ'
      });
    }

    const { maxTextChars } = getSettings();
    if (text.trim().length > maxTextChars) {
      return res.status(400).json({
        success: false,
        error: `النص أطول من الحد المسموح (${maxTextChars} حرف). يرجى تقسيمه إلى أجزاء أصغر.`
      });
    }

    if (!(await passesModeration(req, res, text, 'tts'))) return;

    if (!VOICES.some(v => v.id === voice)) {
      return res.status(400).json({ success: false, error: 'الصوت المختار غير متاح' });
    }

    if (!elevenLabsEnabled() && !openRouterEnabled() && !hasUsableKeys()) {
      return res.status(500).json({
        success: false,
        error: GENERIC_MESSAGE
      });
    }

    if (!generationLimiter(`user:${user.id}`)) {
      return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
    }

    // A greeting card's voice costs the card price (or the voice price if a long text costs more)
    const greetingCard = req.body.purpose === 'greeting' ? { minPoints: getSettings().costGreeting, note: 'بطاقة تهنئة' } : undefined;
    if (serviceBlocked(req, res, greetingCard ? 'greetings' : 'tts')) return;

    try {
      held = reserveCredits(user.id, estimateCredits(text, Number(speed) || 1, greetingCard?.minPoints ?? 0));
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({
          success: false,
          code: 'INSUFFICIENT_CREDITS',
          error: `رصيدك غير كافٍ. يحتاج ${greetingCard ? 'هذا الطلب' : 'هذا النص'} حوالي ${pointsText(err.needed)} ورصيدك ${pointsText(err.balance)}.`,
          needed: err.needed,
          balance: err.balance
        });
      }
      throw err;
    }

    const styleDirective = cloneSample
      ? VOICE_PREVIEWS[voice].style
      : buildStyleDirective({ dialect, toneStyle, customStylePrompt, speed, pitch });

    const { response, keyId, wav } = await synthesizeSpeech(text.trim(), voice, styleDirective);

    if (!wav) {
      releaseCredits(user.id, held);
      held = 0;
      logUsage({ userId: user.id, feature: 'tts', model: TTS_MODEL, voice, chars: text.length, ...usageTokens(response), status: 'failed', apiKeyId: keyId });
      return res.status(503).json({
        success: false,
        error: 'لم يتم استلام مقطع صوتي من النموذج. يرجى تجربة نص آخر أو تعديل النبرة.'
      });
    }

    const audioSeconds = pcmSeconds(wav);
    const tokens = usageTokens(response);

    const { charged, balance } = settleTtsCharge({
      userId: user.id,
      feature: 'tts',
      model: TTS_MODEL,
      voice,
      chars: text.length,
      promptTokens: tokens.promptTokens,
      // Fall back to Google's documented audio token rate if usage metadata is missing
      outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
      audioSeconds,
      apiKeyId: keyId,
    }, held, greetingCard);
    held = 0;

    res.json({
      success: true,
      audioBase64: wav.toString('base64'),
      audioId: keepAudio(user.id, wav),
      mimeType: 'audio/wav',
      voice,
      textLength: text.length,
      durationSeconds: audioSeconds,
      creditsCharged: charged,
      balance,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    if (held > 0) releaseCredits(user.id, held);
    sendFriendlyError(res, error, 'Error generating speech');
  }
});

// ---------- Two-speaker dialogue (podcast / interview) ----------

interface DialogueLine { speaker: string; text: string }

// Validates the speaker setup and script; returns a user-facing error or the cleaned script
function parseDialogueRequest(body: any): { error: string } | { speakers: { name: string; voice: string }[]; lines: DialogueLine[] } {
  const speakers = Array.isArray(body?.speakers) ? body.speakers : [];
  if (speakers.length !== 2) return { error: 'الحوار يحتاج متحدثَين اثنين بالضبط' };

  const cleanSpeakers = speakers.map((s: any) => ({
    name: String(s?.name || '').trim().slice(0, 30),
    voice: String(s?.voice || ''),
  }));
  if (cleanSpeakers.some((s: { name: string }) => !s.name)) return { error: 'يرجى كتابة اسم لكل متحدث' };
  if (cleanSpeakers[0].name === cleanSpeakers[1].name) return { error: 'يجب أن يكون لكل متحدث اسم مختلف' };
  if (cleanSpeakers.some((s: { voice: string }) => !VOICES.some(v => v.id === s.voice))) return { error: 'أحد الأصوات المختارة غير متاح' };

  const names = new Set(cleanSpeakers.map((s: { name: string }) => s.name));
  const lines: DialogueLine[] = (Array.isArray(body?.lines) ? body.lines : [])
    .map((l: any) => ({ speaker: String(l?.speaker || '').trim(), text: String(l?.text || '').trim() }))
    .filter((l: DialogueLine) => l.text);
  if (lines.length === 0) return { error: 'اكتب سطراً واحداً على الأقل في الحوار' };
  const unknown = lines.find(l => !names.has(l.speaker));
  if (unknown) return { error: `اسم المتحدث "${unknown.speaker}" غير معرّف. استخدم: ${[...names].join(' أو ')}` };

  return { speakers: cleanSpeakers, lines };
}

/**
 * A two-voice conversation: Gemini TTS through OpenRouter when TTS_PROVIDER=openrouter (Gemini direct takes over if that
 * fails and Gemini keys are set), otherwise Gemini multi-speaker TTS failing over across API keys.
 */
async function synthesizeDialogue(speakers: { name: string; voice: string }[], lines: DialogueLine[], style: string): Promise<{ response: any; keyId: number | undefined; wav: Buffer | null }> {
  if (openRouterEnabled()) {
    try {
      const voiceOf = new Map(speakers.map(s => [s.name, s.voice]));
      const turns = lines.map(l => ({ text: l.text, voice: voiceOf.get(l.speaker)! }));
      return { response: { usageMetadata: {} }, keyId: undefined, wav: await synthesizeOpenRouterDialogue(turns, style) };
    } catch (error: any) {
      if (!hasUsableKeys()) throw error;
      console.error('OpenRouter dialogue failed, using Gemini:', error?.message || error);
    }
  }
  // Gemini multi-speaker TTS: one part per line, each tagged with its speaker
  const { result: response, keyId } = await withGeminiFailover('dialogue', client => client.models.generateContent({
    model: TTS_MODEL,
    contents: [{
      role: 'user',
      parts: lines.map(l => ({ text: l.text, speechMetadata: { speaker: l.speaker, style } })),
    }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.map(s => ({
            speaker: s.name,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
          })),
        },
      },
    },
  } as Parameters<typeof client.models.generateContent>[0]));
  const audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
  return { response, keyId, wav: audio?.data ? toWavBuffer(audio.data, audio.mimeType) : null };
}

app.post('/api/tts/dialogue', requireAuth, requireVerifiedEmail, async (req, res) => {
  const user = req.user!;
  let held = 0;

  try {
    const parsed = parseDialogueRequest(req.body);
    if ('error' in parsed) return res.status(400).json({ success: false, error: parsed.error });
    const { speakers, lines } = parsed;
    const { dialect = 'msa', toneStyle = 'conversational_warm', customStylePrompt = '', speed = 1.0 } = req.body;

    const fullText = lines.map(l => l.text).join(' ');
    if (!(await passesModeration(req, res, fullText, 'dialogue'))) return;
    const { maxTextChars } = getSettings();
    if (fullText.length > maxTextChars) {
      return res.status(400).json({ success: false, error: `الحوار أطول من الحد المسموح (${maxTextChars} حرف). يرجى تقصيره.` });
    }
    if (!openRouterEnabled() && !hasUsableKeys()) return res.status(500).json({ success: false, error: GENERIC_MESSAGE });
    if (!generationLimiter(`user:${user.id}`)) {
      return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
    }

    try {
      // Conversations include turn-taking pauses, so allow a little extra on the estimate
      held = reserveCredits(user.id, Math.ceil(estimateCredits(fullText, Number(speed) || 1) * 1.1));
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({
          success: false,
          code: 'INSUFFICIENT_CREDITS',
          error: `رصيدك غير كافٍ. يحتاج هذا الحوار حوالي ${pointsText(err.needed)} ورصيدك ${pointsText(err.balance)}.`,
          needed: err.needed,
          balance: err.balance,
        });
      }
      throw err;
    }

    const style = buildStyleDirective({ dialect, toneStyle, customStylePrompt, speed }) +
      '. Natural two-person conversation with realistic turn-taking, reactions and pacing';

    const { response, keyId, wav } = await synthesizeDialogue(speakers, lines, style);

    const voiceLabel = speakers.map(s => s.voice).join('+');
    if (!wav) {
      releaseCredits(user.id, held);
      held = 0;
      logUsage({ userId: user.id, feature: 'dialogue', model: TTS_MODEL, voice: voiceLabel, chars: fullText.length, ...usageTokens(response), status: 'failed', apiKeyId: keyId });
      return res.status(503).json({ success: false, error: 'لم يتم استلام مقطع صوتي من النموذج. يرجى تعديل الحوار والمحاولة مجدداً.' });
    }

    const audioSeconds = pcmSeconds(wav);
    const tokens = usageTokens(response);
    const { charged, balance } = settleTtsCharge({
      userId: user.id,
      feature: 'dialogue',
      model: TTS_MODEL,
      voice: voiceLabel,
      chars: fullText.length,
      promptTokens: tokens.promptTokens,
      outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
      audioSeconds,
      apiKeyId: keyId,
    }, held);
    held = 0;

    res.json({
      success: true,
      audioBase64: wav.toString('base64'),
      audioId: keepAudio(user.id, wav),
      mimeType: 'audio/wav',
      durationSeconds: audioSeconds,
      creditsCharged: charged,
      balance,
    });
  } catch (error: any) {
    if (held > 0) releaseCredits(user.id, held);
    sendFriendlyError(res, error, 'Error generating dialogue');
  }
});

const DIALOGUE_FORMATS: Record<string, string> = {
  podcast: 'a lively podcast episode segment between two co-hosts',
  interview: 'an interview where the first speaker is the host asking questions and the second is the guest expert',
  ad: 'a short, catchy radio advertisement dialogue that ends with a clear call to action',
  support: 'a polite customer-service phone call where the first speaker is the agent and the second is the customer',
  story: 'a short dramatic scene between two characters',
};

const DIALECT_NAMES: Record<string, string> = {
  msa: 'Modern Standard Arabic (فصحى)',
  egyptian: 'Egyptian Arabic dialect',
  gulf: 'Gulf / Saudi Arabic dialect',
  levantine: 'Levantine (Syrian/Lebanese/Palestinian/Jordanian) Arabic dialect',
  maghrebi: 'Maghrebi Arabic dialect',
  en_us: 'American English',
  en_uk: 'British English',
  fr_fr: 'French',
  es_es: 'Spanish',
  de_de: 'German',
  tr_tr: 'Turkish',
};

// AI script writer: turns a topic into a ready-to-edit two-speaker script (text model, free for users, metered for admin)
app.post('/api/tts/write-dialogue', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const topic = String(req.body?.topic || '').trim().slice(0, 300);
    const names = (Array.isArray(req.body?.speakers) ? req.body.speakers : []).map((n: unknown) => String(n || '').trim().slice(0, 30));
    const format = DIALOGUE_FORMATS[req.body?.format] ? req.body.format : 'podcast';
    const turns = Math.min(16, Math.max(4, Number(req.body?.turns) || 8));
    const dialect = DIALECT_NAMES[req.body?.dialect] ? req.body.dialect : 'msa';

    if (topic.length < 3) return res.status(400).json({ success: false, error: 'اكتب موضوع الحوار أولاً' });
    if (!(await passesModeration(req, res, topic, 'script'))) return;
    if (names.length !== 2 || !names[0] || !names[1] || names[0] === names[1]) {
      return res.status(400).json({ success: false, error: 'يرجى تحديد اسمين مختلفين للمتحدثَين' });
    }
    if (!hasUsableKeys()) return res.status(500).json({ success: false, error: GENERIC_MESSAGE });
    if (!textToolLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
    }

    const prompt = `Write ${DIALOGUE_FORMATS[format]} about: "${topic}".
Language: ${DIALECT_NAMES[dialect]}. Write naturally, as people really speak in that language/dialect.
Speakers: "${names[0]}" and "${names[1]}". Alternate between them, starting with "${names[0]}". Exactly ${turns} turns.
Each turn is 1-3 short spoken sentences, suitable for text-to-speech (no stage directions, no emojis, no markdown, no sound effects).
Output ONLY the script, one turn per line, in the exact format:
${names[0]}: ...
${names[1]}: ...`;

    const { result: response, keyId } = await withGeminiFailover('write-dialogue', client => client.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      // Simple rewriting tasks: low thinking keeps latency (and output tokens) down
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        // Text models can take well over a minute under load; give them longer than TTS calls
        httpOptions: { timeout: 120_000 },
      },
    }), { cooldown: false });
    logUsage({ userId: req.user!.id, feature: 'script', model: TEXT_MODEL, chars: topic.length, ...usageTokens(response), apiKeyId: keyId });

    // Keep only well-formed "Name: text" lines for the two speakers
    const script = (response.text || '')
      .split('\n')
      .map(l => l.replace(/^[*\-\s]+|\*+/g, '').trim())
      .filter(l => names.some((n: string) => l.startsWith(`${n}:`) || l.startsWith(`${n} :`)))
      .join('\n');

    if (!script) return res.status(503).json({ success: false, error: 'تعذّرت كتابة الحوار، جرّب موضوعاً آخر' });
    res.json({ success: true, script });
  } catch (err: any) {
    sendFriendlyError(res, err, 'Write dialogue error');
  }
});

// ---------- Voice video (MP4 with image, waveform and synced captions) ----------

const videoLimiter = createRateLimiter(() => 15, 60 * 60 * 1000);

// Only our own domains may appear in the video watermark (the Host header is client-controlled)
const SITE_DOMAINS = [process.env.PUBLIC_URL, ...(process.env.EXTRA_PUBLIC_URLS || '').split(',')]
  .map(u => { try { return new URL((u || '').trim()).hostname; } catch { return ''; } })
  .filter(Boolean);
const watermarkDomain = (host: string) => (SITE_DOMAINS.includes(host) ? host : SITE_DOMAINS[0] || 'tts.smartcloud.ps');
const MAX_VIDEO_SECONDS = 5 * 60;

interface VideoJob {
  id: string;
  userId: number;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  createdAt: number;
  result?: Buffer;
  error?: string;
  /** Reels: length of the video (s), the render time expected for it (s) and when its render started (ms). */
  reelSeconds?: number;
  estimate?: number;
  startedAt?: number;
  /** When the job was first seen finished (done or error), for the clean-up below. */
  finishedAt?: number;
  /** Rendered in AWS Lambda: the MP4 is in S3 under this key (streamed from there), not in `result`. */
  onLambda?: boolean;
  s3Key?: string;
}

// In-memory jobs. A finished video is kept 30 minutes after it is ready (it plays from here and is downloaded from
// here); jobs still waiting in line or rendering are never dropped, except anything older than 3 hours.
const videoJobs = new Map<string, VideoJob>();
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of videoJobs) {
    if ((job.status === 'done' || job.status === 'error') && !job.finishedAt) job.finishedAt = now;
    if ((job.finishedAt && now - job.finishedAt > 30 * 60_000) || now - job.createdAt > 3 * 3600_000) videoJobs.delete(id);
  }
}, 60_000).unref();

app.post('/api/video/render', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const { audioBase64, audioId, text = '', voiceId = '', imageBase64 = '', title = '', captions = true, hd = false } = req.body ?? {};
    // Occasion greeting: themed artwork, always vertical (WhatsApp status / reels)
    const greeting = isGreetingTheme(req.body?.greeting?.occasion)
      ? {
          themeId: req.body.greeting.occasion as string,
          from: String(req.body.greeting.from || '').trim().slice(0, 40),
          template: null as Buffer | null,
          photoBox: clampPhotoBox(req.body.greeting.photoBox),
          textStyle: clampTextStyle(req.body.greeting.textStyle),
        }
      : undefined;
    if (serviceBlocked(req, res, greeting ? 'greetings' : 'tts')) return;
    const format = greeting ? 'vertical' : (req.body?.format ?? 'square');
    // A greeting can use the customer's own 9:16 template as the whole background
    if (greeting && typeof req.body?.templateBase64 === 'string' && req.body.templateBase64) {
      try {
        greeting.template = await normalizeTemplate(Buffer.from(req.body.templateBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'تعذّر قراءة صورة القالب، جرّب صورة JPG أو PNG' });
      }
    }
    // The voice the server just made is kept for a while: the page sends its id instead of uploading it again
    const keptWav = typeof audioId === 'string' ? takeAudio(req.user!.id, audioId) : null;
    if (!keptWav && audioId && !audioBase64) {
      return res.status(410).json({ success: false, code: 'AUDIO_EXPIRED', error: 'انتهت صلاحية المقطع الصوتي، أعد المحاولة.' });
    }
    if (!keptWav && (typeof audioBase64 !== 'string' || !audioBase64)) {
      return res.status(400).json({ success: false, error: 'لا يوجد مقطع صوتي لتحويله' });
    }
    if (!['square', 'vertical', 'landscape'].includes(format)) {
      return res.status(400).json({ success: false, error: 'صيغة الفيديو غير مدعومة' });
    }
    if (!(await passesModeration(req, res, `${title} ${greeting?.from ?? ''} ${text}`, 'video'))) return;
    if (!videoLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
    }

    const wav = keptWav ?? Buffer.from(audioBase64, 'base64');
    if (wav.subarray(0, 4).toString('ascii') !== 'RIFF' || pcmSeconds(wav) > MAX_VIDEO_SECONDS) {
      return res.status(400).json({ success: false, error: 'المقطع الصوتي غير صالح أو أطول من 5 دقائق' });
    }

    // Picture: the user's upload, else (normal videos) the voice's portrait; greetings show the occasion emblem instead
    let image: Buffer | null = null;
    if (typeof imageBase64 === 'string' && imageBase64) {
      try {
        image = await normalizeImage(Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      } catch {
        return res.status(400).json({ success: false, error: 'تعذّر قراءة الصورة، جرّب صورة JPG أو PNG' });
      }
    } else if (!greeting) {
      const firstVoice = String(voiceId).split('+')[0];
      const avatar = VOICES.find(v => v.id === firstVoice)?.avatar;
      image = await fs.readFile(path.join(__dirname, 'public', avatar ?? '/avatars/Kore.webp'));
    }

    // A greeting the customer's browser puts together itself: send what it needs instead of rendering here
    if (req.body?.plan === true) {
      if (!greeting) return res.status(400).json({ success: false, error: 'هذا النوع من الفيديو لا يدعم التجهيز على الجهاز' });
      try {
        const plan = await enqueueRender(() => planGreetingVideo({
          wav, text: String(text).slice(0, 5000), image, format, greeting, title: String(title).trim().slice(0, 60),
          captions: captions !== false, domain: watermarkDomain(req.hostname),
        }));
        return res.json({ success: true, plan });
      } catch (error: any) {
        if (error instanceof RenderBusyError) return res.status(503).json({ success: false, error: 'هناك فيديوهات أخرى قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.' });
        console.error('Video plan failed:', error);
        return res.status(500).json({ success: false, error: 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.' });
      }
    }

    // Rendering runs in the background; the client polls /api/video/jobs/:id for progress
    const job: VideoJob = {
      id: crypto.randomBytes(12).toString('base64url'),
      userId: req.user!.id,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
    };
    videoJobs.set(job.id, job);

    renderVoiceVideo({
      wav,
      text: String(text).slice(0, 5000),
      image,
      format,
      greeting,
      title: String(title).trim().slice(0, 60),
      captions: captions !== false,
      hd: hd === true,
      domain: watermarkDomain(req.hostname),
      onStart: () => { job.status = 'rendering'; },
      onProgress: fraction => { job.progress = fraction; },
    }).then(mp4 => {
      job.status = 'done';
      job.progress = 1;
      job.result = mp4;
    }).catch(error => {
      job.status = 'error';
      if (error instanceof RenderBusyError) {
        job.error = 'هناك فيديوهات أخرى قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.';
      } else if (error?.code === 'ENOENT') {
        console.error('ffmpeg is not installed on this machine');
        job.error = 'ميزة الفيديو غير متاحة حالياً.';
      } else {
        console.error('Video render failed:', error);
        job.error = 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.';
      }
    });

    res.status(202).json({ success: true, jobId: job.id });
  } catch (error: any) {
    console.error('Video request failed:', error);
    res.status(500).json({ success: false, error: 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.' });
  }
});

// Bulk greetings for a member list (background job, see server/greeting-batch.ts)
app.use('/api/greetings/batch', createGreetingBatchRouter({
  voices: VOICES.map(v => v.id),
  ttsModel: TTS_MODEL,
  buildStyle: buildStyleDirective,
  synthesize: synthesizeSpeech,
  usageTokens,
  passesModeration,
  watermarkDomain,
}));

// ---------- Press studio (newsrooms): brand kit, article -> script, branded episode video ----------

app.use('/api/brand', brandRouter);
app.use('/api/press', createPressRouter({
  textModel: TEXT_MODEL,
  dialectNames: DIALECT_NAMES,
  usageTokens,
  passesModeration,
  limiter: key => textToolLimiter(key),
}));

// ---------- Motion graphics (admins + accounts with the "motion" permission): script -> voice -> job for the worker ----------

app.use('/api/motion', createMotionRouter({
  ttsModel: TTS_MODEL,
  textModel: TEXT_MODEL,
  dialectNames: DIALECT_NAMES,
  voices: VOICES,
  synthesizeSpeech,
  buildStyleDirective,
  usageTokens,
  passesModeration,
}));

app.post('/api/press/video', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const body = req.body ?? {};
    // The voice the server just made is kept for a while: the page sends its id instead of uploading it again
    const keptSpeech = typeof body.speechId === 'string' ? takeAudio(req.user!.id, body.speechId) : null;
    if (!keptSpeech && body.speechId && !body.speechBase64) {
      return res.status(410).json({ success: false, code: 'AUDIO_EXPIRED', error: 'انتهت صلاحية المقطع الصوتي، أعد المحاولة.' });
    }
    const speech = keptSpeech ?? (typeof body.speechBase64 === 'string' ? Buffer.from(body.speechBase64, 'base64') : null);
    if (!speech || speech.subarray(0, 4).toString('ascii') !== 'RIFF' || pcmSeconds(speech) > MAX_VIDEO_SECONDS) {
      return res.status(400).json({ success: false, error: 'المقطع الصوتي غير صالح أو أطول من 5 دقائق' });
    }
    const format = ['landscape', 'vertical', 'square'].includes(body.format) ? body.format : 'landscape';
    const speakers = (Array.isArray(body.speakers) ? body.speakers : []).slice(0, 2);
    const lines = (Array.isArray(body.lines) ? body.lines : [])
      .map((l: any) => ({ speaker: Number(l?.speaker) === 1 && speakers.length > 1 ? 1 : 0, text: String(l?.text || '').trim().slice(0, 600) }))
      .filter((l: { text: string }) => l.text)
      .slice(0, 80);
    const headlines = (Array.isArray(body.headlines) ? body.headlines : []).map((h: unknown) => String(h || '').trim().slice(0, 120)).filter(Boolean).slice(0, 8);
    const episodeTitle = String(body.episodeTitle || '').trim().slice(0, 80);
    if (speakers.length === 0 || lines.length === 0) return res.status(400).json({ success: false, error: 'السكربت فارغ' });

    const names = speakers.map((s: any) => String(s?.name || '').trim().slice(0, 30));
    const allText = [episodeTitle, ...names, ...lines.map((l: { text: string }) => l.text), ...headlines].join('\n');
    if (!(await passesModeration(req, res, allText, 'video'))) return;
    if (!videoLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
    }

    // Portraits: the uploaded photo, else the voice's avatar
    const portraits: Buffer[] = [];
    for (const sp of speakers) {
      if (typeof sp?.imageBase64 === 'string' && sp.imageBase64) {
        try {
          portraits.push(await normalizeImage(Buffer.from(sp.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')));
          continue;
        } catch {
          return res.status(400).json({ success: false, error: 'تعذّر قراءة إحدى الصور، جرّب JPG أو PNG' });
        }
      }
      const avatar = VOICES.find(v => v.id === sp?.voiceId)?.avatar ?? '/avatars/Kore.webp';
      portraits.push(await fs.readFile(path.join(__dirname, 'public', avatar)));
    }

    const brand = getBrandKit(req.user!.id);
    const mastered = { wav: speech, introSeconds: 0 };
    const logo = brand?.hasLogo ? await readBrandLogo(req.user!.id) : null;

    const job: VideoJob = { id: crypto.randomBytes(12).toString('base64url'), userId: req.user!.id, status: 'queued', progress: 0, createdAt: Date.now() };
    videoJobs.set(job.id, job);
    renderPressVideo({
      speech,
      audio: mastered.wav,
      introSeconds: mastered.introSeconds,
      format,
      hd: body.hd === true,
      color: brand?.color ?? '#0e7490',
      logo,
      outletName: brand?.outletName ?? '',
      showName: brand?.showName ?? '',
      episodeTitle,
      speakers: names.map((name: string, i: number) => ({ name, image: portraits[i] })),
      lines,
      headlines,
      domain: watermarkDomain(req.hostname),
      onStart: () => { job.status = 'rendering'; },
      onProgress: fraction => { job.progress = fraction; },
    }).then(mp4 => {
      job.status = 'done';
      job.progress = 1;
      job.result = mp4;
    }).catch(error => {
      job.status = 'error';
      if (error instanceof RenderBusyError) job.error = 'هناك فيديوهات أخرى قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.';
      else {
        console.error('Press video failed:', error);
        job.error = 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.';
      }
    });
    res.status(202).json({ success: true, jobId: job.id });
  } catch (error: any) {
    console.error('Press video request failed:', error);
    res.status(500).json({ success: false, error: 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.' });
  }
});

// ---------- Brand your own footage: upload a real video, then render it with on-air graphics ----------

app.post('/api/press/overlay/upload', requireAuth, requireVerifiedEmail, async (req, res) => {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > OVERLAY_MAX_BYTES) return res.status(413).json({ success: false, error: 'الملف أكبر من 95 ميغابايت' });
  const { id, file } = await newUploadPath();
  let received = 0;
  let tooBig = false;
  const out = createWriteStream(file);
  req.on('data', chunk => {
    received += chunk.length;
    if (received > OVERLAY_MAX_BYTES && !tooBig) {
      tooBig = true;
      req.unpipe(out);
      out.destroy();
    }
  });
  req.pipe(out);
  out.on('error', () => {});
  await new Promise<void>(resolve => { out.on('close', () => resolve()); req.on('end', () => setTimeout(resolve, 50)); });
  if (tooBig) {
    await fs.rm(file, { force: true });
    return res.status(413).json({ success: false, error: 'الملف أكبر من 95 ميغابايت' });
  }
  const info = await probeVideo(file);
  if (!info) {
    await fs.rm(file, { force: true });
    return res.status(400).json({ success: false, error: 'تعذّر قراءة الفيديو، جرّب ملف MP4 أو MOV' });
  }
  if (info.duration > OVERLAY_MAX_SECONDS + 1) {
    await fs.rm(file, { force: true });
    return res.status(400).json({ success: false, error: `الفيديو أطول من ${OVERLAY_MAX_SECONDS / 60} دقائق، قصّه ثم ارفعه` });
  }
  res.json({ success: true, uploadId: id, ...info });
});

app.post('/api/press/overlay/render', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const body = req.body ?? {};
    const uploadId = String(body.uploadId || '');
    const src = uploadPath(uploadId);
    if (!src || !(await fs.stat(src).catch(() => null))) {
      return res.status(410).json({ success: false, error: 'انتهت صلاحية الفيديو المرفوع (ساعة)، ارفعه من جديد' });
    }
    const range = (r: any) => ({ from: Math.max(0, Number(r?.from) || 0), to: Math.max(0, Number(r?.to) || 0) });
    const headlines = (Array.isArray(body.ticker?.headlines) ? body.ticker.headlines : [])
      .map((h: unknown) => String(h || '').trim().slice(0, 120)).filter(Boolean).slice(0, 8);
    const lowerName = String(body.lowerThird?.name || '').trim().slice(0, 50);
    const lowerTitle = String(body.lowerThird?.title || '').trim().slice(0, 70);
    const boxTitle = String(body.boxTitle || '').trim().slice(0, 80);
    const introOn = body.intro?.on === true;
    const introText = String(body.intro?.text || '').trim().slice(0, 600);
    const anchorName = String(body.intro?.anchorName || '').trim().slice(0, 40);
    const anchorVoice = VOICES.some(v => v.id === body.intro?.voiceId) ? String(body.intro.voiceId) : 'Orus';
    if (introOn && (!introText || !anchorName)) {
      return res.status(400).json({ success: false, error: 'اكتب اسم المذيع ونص التقديم، أو ألغِ التقديم' });
    }
    const allText = [...headlines, lowerName, lowerTitle, boxTitle, introOn ? `${anchorName} ${introText}` : ''].join('\n');
    if (!(await passesModeration(req, res, allText, 'video'))) return;
    if (!videoLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
    }

    // Anchor hand-over before the footage: the voice is generated now (charged like any generation),
    // so a missing balance is reported straight away instead of failing inside the render
    let intro: Parameters<typeof renderOverlayVideo>[0]['intro'] = null;
    let balance: number | undefined;
    if (introOn) {
      let held = 0;
      try {
        held = reserveCredits(req.user!.id, estimateCredits(introText));
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ لصوت المذيع (يحتاج حوالي ${pointsText(err.needed)}).` });
        }
        throw err;
      }
      try {
        const style = buildStyleDirective({ dialect: 'msa', toneStyle: 'professional_news', customStylePrompt: '', speed: 1, pitch: 0 });
        const { response, keyId, wav } = await synthesizeSpeech(introText, anchorVoice, style);
        if (!wav) throw new Error('No audio');
        const audioSeconds = pcmSeconds(wav);
        const tokens = usageTokens(response);
        ({ balance } = settleTtsCharge({
          userId: req.user!.id, feature: 'tts', model: TTS_MODEL, voice: anchorVoice, chars: introText.length,
          promptTokens: tokens.promptTokens, outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
          audioSeconds, apiKeyId: keyId,
        }, held));
        held = 0;
        let anchorImage: Buffer;
        if (typeof body.intro?.imageBase64 === 'string' && body.intro.imageBase64) {
          anchorImage = await normalizeImage(Buffer.from(body.intro.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        } else {
          anchorImage = await fs.readFile(path.join(__dirname, 'public', VOICES.find(v => v.id === anchorVoice)?.avatar ?? '/avatars/Orus.webp'));
        }
        intro = { wav, text: introText, anchorName, anchorImage };
      } catch (err) {
        if (held > 0) releaseCredits(req.user!.id, held);
        return sendFriendlyError(res, err, 'Overlay intro voice');
      }
    }

    const brand = getBrandKit(req.user!.id);
    const logo = brand?.hasLogo ? await readBrandLogo(req.user!.id) : null;
    const job: VideoJob = { id: crypto.randomBytes(12).toString('base64url'), userId: req.user!.id, status: 'queued', progress: 0, createdAt: Date.now() };
    videoJobs.set(job.id, job);
    renderOverlayVideo({
      uploadId,
      canvas: ['vertical', 'square', 'landscape'].includes(body.canvas) ? body.canvas : 'original',
      layout: body.layout === 'box' ? 'box' : 'full',
      fit: body.fit === 'blur' ? 'blur' : 'crop',
      boxTitle,
      font: isOverlayFont(body.font) ? body.font : 'sans',
      textScale: Math.min(1.5, Math.max(0.7, Number(body.textScale) || 1)),
      intro,
      color: brand?.color ?? '#0e7490',
      logo,
      showName: brand?.showName ?? '',
      outletName: brand?.outletName ?? '',
      domain: watermarkDomain(req.hostname),
      logoOn: body.logoOn !== false,
      showNameOn: body.showNameOn !== false,
      ticker: { on: body.ticker?.on === true, breaking: body.ticker?.breaking === true, headlines, range: range(body.ticker?.range) },
      lowerThird: { on: body.lowerThird?.on === true, name: lowerName, title: lowerTitle, range: range(body.lowerThird?.range) },
      onStart: () => { job.status = 'rendering'; },
      onProgress: fraction => { job.progress = fraction; },
    }).then(mp4 => {
      job.status = 'done';
      job.progress = 1;
      job.result = mp4;
    }).catch(error => {
      job.status = 'error';
      if (error instanceof RenderBusyError) job.error = 'هناك فيديوهات أخرى قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.';
      else {
        console.error('Overlay video failed:', error);
        job.error = 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.';
      }
    });
    res.status(202).json({ success: true, jobId: job.id, balance });
  } catch (error: any) {
    console.error('Overlay request failed:', error);
    res.status(500).json({ success: false, error: 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.' });
  }
});

// ---------- Calm reels: nature footage + a calm voice + captions (see server/calm.ts) ----------

app.use('/api/calm', calmRouter);
app.use('/api/quran', quranRouter);
app.use('/api/medical', createMedicalRouter({ textModel: TEXT_MODEL, usageTokens, passesModeration }));

// Medical reel: the doctor's information read by an AI voice over calm real scenes, with the doctor's identity along
// the bottom and the fixed disclaimer as the closing card (see server/medical.ts)
// Every reel waits in the shared render line; when it is full nothing is charged (calm and Quran reels can still go
// to AWS Lambda when it is on)
const BUSY_TEXT = 'هناك فيديوهات كثيرة قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.';
const lambdaOn = () => lambdaConfigured() && getSettings().reelLambda > 0;

app.post('/api/medical/reel', requireAuth, requireVerifiedEmail, async (req, res) => {
  const body = req.body ?? {};
  const text = String(body.text || '').trim().slice(0, MEDICAL_LIMITS.reelBody);
  const title = String(body.title || '').trim().slice(0, MEDICAL_LIMITS.title);
  const voice = VOICES.some(v => v.id === body.voiceId) ? String(body.voiceId) : 'Charon';
  const dialect = DIALECT_NAMES[body.dialect] ? String(body.dialect) : 'msa';
  // Only clips that passed the medical background check (server/medical.ts)
  const clips = (Array.isArray(body.clipIds) ? body.clipIds : []).slice(0, 3)
    .filter((id: unknown) => backgroundApproved(`v:${Number(id)}`)).map((id: unknown) => vettedClip(Number(id))).filter(Boolean);
  if (text.length < 10) return res.status(400).json({ success: false, error: 'اكتب المعلومة الطبية أولاً' });
  if (clips.length === 0) return res.status(400).json({ success: false, error: 'اختر مشهداً واحداً على الأقل (ابحث من جديد إن مرّ وقت طويل)' });
  if (!(await passesModeration(req, res, `${title}
${text}`, 'video'))) return;
  if (!videoLimiter(`user:${req.user!.id}`)) {
    return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
  }
  if (renderQueueFull()) return res.status(503).json({ success: false, error: BUSY_TEXT });

  // The reel costs its fixed price (or the voice price if a long text costs more)
  const reel = { minPoints: getSettings().costMedicalReel, note: `ريل طبي · ${title || 'معلومة طبية'}` };
  let held = 0;
  try {
    held = reserveCredits(req.user!.id, estimateCredits(text, 0.95, reel.minPoints));
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ. يحتاج الريل حوالي ${pointsText(err.needed)} ورصيدك ${pointsText(err.balance)}.` });
    }
    throw err;
  }
  let wav: Buffer;
  let balance: number;
  try {
    const style = buildStyleDirective({
      dialect, toneStyle: 'educational_tutor', speed: 0.95, pitch: 0,
      customStylePrompt: 'صوت طبيب هادئ وواضح وموثوق، يشرح للمرضى بلطف وبدون تهويل',
    });
    const r = await synthesizeSpeech(text, voice, style);
    if (!r.wav) throw new Error('No audio');
    wav = r.wav;
    const audioSeconds = pcmSeconds(wav);
    const tokens = usageTokens(r.response);
    ({ balance } = settleTtsCharge({
      userId: req.user!.id, feature: 'tts', model: TTS_MODEL, voice, chars: text.length,
      promptTokens: tokens.promptTokens, outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
      audioSeconds, apiKeyId: r.keyId,
    }, held, reel));
    held = 0;
  } catch (err) {
    if (held > 0) releaseCredits(req.user!.id, held);
    return sendFriendlyError(res, err, 'Medical reel voice');
  }

  const profile = getDoctorProfile(req.user!.id);
  const logo = await readDoctorLogo(req.user!.id);
  const lines = identityLines(profile);
  const job: VideoJob = { id: crypto.randomBytes(12).toString('base64url'), userId: req.user!.id, status: 'queued', progress: 0, createdAt: Date.now() };
  videoJobs.set(job.id, job);
  startCalmRender(job, {
    clips: clips as any, voice: wav, text, title, supportCard: MEDICAL_DISCLAIMER, sticker: null, domain: watermarkDomain(req.hostname),
    style: clampCalmStyle({ font: 'cairo', color: '#ffffff', size: 78, y: 740, titleSize: 54 }),
    brand: lines.length || logo ? { logo, lines, color: profile?.color ?? '#0ea5e9' } : undefined,
  });
  res.status(202).json({ success: true, jobId: job.id, balance });
});
app.use('/api/jawwal', jawwalRouter);

// Quran reel (its own service): a reciter's recitation of whole verses over calm scenes, each verse's captions laid
// over the reciter's sound (see server/quran.ts). No AI voice, so only the reel price is charged.
app.post('/api/quran/render', requireAuth, requireVerifiedEmail, async (req, res) => {
  const body = req.body ?? {};
  let title = String(body.title || '').trim().slice(0, 60);
  const supportCard = String(body.supportCard || '').trim().slice(0, 200);
  const dedication = String(body.dedication || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const clips = await vetClips((Array.isArray(body.clipIds) ? body.clipIds : []).slice(0, 3).map(Number));
  const quranPick = body.quran ? await parseQuranPick(body.quran).catch(() => ({ error: 'تعذّر قراءة السورة، حاول بعد قليل' })) : null;
  if (!quranPick) return res.status(400).json({ success: false, error: 'اختر الآيات أولاً' });
  if ('error' in quranPick) return res.status(400).json({ success: false, error: quranPick.error });
  if (clips.length === 0) return res.status(400).json({ success: false, error: 'اختر مشهداً واحداً على الأقل (ابحث من جديد إن مرّ وقت طويل)' });
  const sticker = clampSticker(body.sticker);
  if (!(await passesModeration(req, res, [title, supportCard, dedication, sticker?.label ?? ''].join('\n'), 'video'))) return;
  if (!videoLimiter(`user:${req.user!.id}`)) {
    return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
  }
  if (renderQueueFull() && !lambdaOn()) return res.status(503).json({ success: false, error: BUSY_TEXT });

  let recitation;
  try {
    recitation = await quranRecitation(quranPick);
  } catch (err) {
    if (err instanceof QuranTooLongError) {
      return res.status(400).json({ success: false, error: `التلاوة ${Math.round(err.seconds)} ثانية، والحد 3 دقائق. اختر آيات أقل.` });
    }
    return sendFriendlyError(res, err, 'Quran recitation');
  }
  const text = recitation.captions.map(c => c.text).join(' ');
  if (!title) title = recitation.title;
  // The reciter's name, above the title by default (unless the customer turned it off)
  const reciterName = QURAN_RECITERS.find(r => r.id === quranPick.reciter)?.name;
  const info = body.showReciter !== false && reciterName ? `بصوت الشيخ ${reciterName}` : '';
  const points = getSettings().costQuranReel;
  try {
    chargePoints(req.user!.id, points, `ريل آيات · ${recitation.title}`);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ. يحتاج الريل ${pointsText(err.needed)} ورصيدك ${pointsText(err.balance)}.` });
    }
    throw err;
  }
  // Logged for the admin "ريلز الآيات" tab
  const logId = logQuranReel({
    userId: req.user!.id, surah: quranPick.surah, surahName: recitation.title.split(' • ')[0].replace(/^سورة /, ''),
    start: quranPick.start, end: quranPick.end, reciter: reciterName ?? quranPick.reciter, reelSeconds: recitation.seconds, points,
  });
  const job: VideoJob = { id: crypto.randomBytes(12).toString('base64url'), userId: req.user!.id, status: 'queued', progress: 0, createdAt: Date.now() };
  videoJobs.set(job.id, job);
  startCalmRender(job, {
    clips: clips as any, voice: recitation.wav, verses: recitation.captions, text, title, info, dedication, supportCard, style: clampCalmStyle(body.style), sticker, quality: clampQuality(body.quality), domain: watermarkDomain(req.hostname),
  }, (ok, renderSeconds, error) => {
    finishQuranReel(logId, ok, renderSeconds, error);
    // Nothing to show for the points: they go back to the user
    if (!ok && refundQuranReel(logId) != null) job.error = `${job.error ?? 'تعذّر تجهيز الفيديو.'} أعدنا نقاط الريل إلى رصيدك.`;
  });
  res.status(202).json({ success: true, jobId: job.id, balance: getUserById(req.user!.id)?.credits ?? 0 });
});

app.post('/api/calm/render', requireAuth, requireVerifiedEmail, async (req, res) => {
  const body = req.body ?? {};
  const text = String(body.text || '').trim().slice(0, 1200);
  const title = String(body.title || '').trim().slice(0, 60);
  const supportCard = String(body.supportCard || '').trim().slice(0, 200);
  const dedication = String(body.dedication || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const voice = VOICES.some(v => v.id === body.voiceId) ? String(body.voiceId) : 'Sulafat';
  const dialect = DIALECT_NAMES[body.dialect] ? String(body.dialect) : 'msa';
  const clips = await vetClips((Array.isArray(body.clipIds) ? body.clipIds : []).slice(0, 3).map(Number));
  if (!text) return res.status(400).json({ success: false, error: 'اكتب نص الريل أو اختر قالباً' });
  if (clips.length === 0) return res.status(400).json({ success: false, error: 'اختر مشهداً واحداً على الأقل (ابحث من جديد إن مرّ وقت طويل)' });
  const sticker = clampSticker(body.sticker);
  if (!(await passesModeration(req, res, [title, text, supportCard, dedication, sticker?.label ?? ''].join('\n'), 'video'))) return;
  if (!videoLimiter(`user:${req.user!.id}`)) {
    return res.status(429).json({ success: false, error: 'وصلت للحد الأقصى من الفيديوهات خلال ساعة، يرجى المحاولة لاحقاً.' });
  }
  if (renderQueueFull() && !lambdaOn()) return res.status(503).json({ success: false, error: BUSY_TEXT });

  // The calm voice is generated now so a balance problem is reported immediately; the reel costs its fixed price
  // (or the voice price if a long text costs more)
  const calmReel = { minPoints: getSettings().costCalmReel, note: 'ريل سكينة' };
  let held = 0;
  try {
    held = reserveCredits(req.user!.id, estimateCredits(text, 0.9, calmReel.minPoints));
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDITS', error: `رصيدك غير كافٍ. يحتاج الريل حوالي ${pointsText(err.needed)} ورصيدك ${pointsText(err.balance)}.` });
    }
    throw err;
  }
  let wav: Buffer;
  let balance: number;
  try {
    const style = buildStyleDirective({
      dialect, toneStyle: 'calm_meditation', speed: 0.9, pitch: 0,
      customStylePrompt: 'صوت دافئ هادئ جداً ومطمئن، بطيء، مع وقفات طويلة بين الجمل، كأنك تتحدث بلطف مع شخص متعب',
    });
    const r = await synthesizeSpeech(text, voice, style);
    if (!r.wav) throw new Error('No audio');
    wav = r.wav;
    const audioSeconds = pcmSeconds(wav);
    const tokens = usageTokens(r.response);
    ({ balance } = settleTtsCharge({
      userId: req.user!.id, feature: 'tts', model: TTS_MODEL, voice, chars: text.length,
      promptTokens: tokens.promptTokens, outputTokens: tokens.outputTokens || Math.round(audioSeconds * AUDIO_TOKENS_PER_SECOND),
      audioSeconds, apiKeyId: r.keyId,
    }, held, calmReel));
    held = 0;
  } catch (err) {
    if (held > 0) releaseCredits(req.user!.id, held);
    return sendFriendlyError(res, err, 'Calm reel voice');
  }

  const job: VideoJob = { id: crypto.randomBytes(12).toString('base64url'), userId: req.user!.id, status: 'queued', progress: 0, createdAt: Date.now() };
  videoJobs.set(job.id, job);
  startCalmRender(job, {
    clips: clips as any, voice: wav, text, title, dedication, supportCard, style: clampCalmStyle(body.style), sticker, quality: clampQuality(body.quality), domain: watermarkDomain(req.hostname),
  });
  res.status(202).json({ success: true, jobId: job.id, balance });
});

// Time left for a reel (shown to the customer): every reel's render time is expected from its length and the pace of
// this server, learnt from the reels it finished (render seconds per second of video; 74 s for a 48 s reel when
// measured). Other videos in the shared line count as a minute each.
let renderPace = 1.6;
let lambdaPace = 1.6;
const OTHER_VIDEO_SECONDS = 60;

function remainingSeconds(j: VideoJob) {
  const estimate = j.estimate ?? OTHER_VIDEO_SECONDS;
  if (j.status !== 'rendering') return estimate;
  const ran = (Date.now() - (j.startedAt ?? Date.now())) / 1000;
  // Once ffmpeg reports progress, its own speed is the better guide
  return Math.max(2, j.progress > 0.05 ? ran * (1 - j.progress) / j.progress : estimate - ran);
}

/** Seconds until `job` is ready: the renders before it shared over the render slots, then its own. */
function etaSeconds(job: VideoJob) {
  if (job.status === 'done' || job.status === 'error') return 0;
  if (job.status === 'rendering') return remainingSeconds(job);
  const jobs = [...videoJobs.values()].filter(j => !j.onLambda);
  const before = [
    ...jobs.filter(j => j.status === 'rendering'),
    ...jobs.filter(j => j.status === 'queued' && j.createdAt < job.createdAt).sort((a, b) => a.createdAt - b.createdAt),
  ];
  const lanes = new Array(RENDER_SLOTS).fill(0);
  for (const j of before) {
    const free = lanes.indexOf(Math.min(...lanes));
    lanes[free] += remainingSeconds(j);
  }
  return Math.min(...lanes) + remainingSeconds(job);
}

/** Queues a calm reel and follows it on the job (both the AI-voice and the Quran reel). */
function startCalmRender(job: VideoJob, options: Omit<Parameters<typeof renderCalmReel>[0], 'onStart' | 'onProgress'>, onDone?: (ok: boolean, renderSeconds: number, error?: string) => void) {
  // Length of the reel: the voice, a breath before it and the ending (longer with a support card)
  job.reelSeconds = pcmSeconds(options.voice) + (options.supportCard ? 5.7 : 3);
  job.estimate = job.reelSeconds * renderPace;
  // AWS Lambda (calm and Quran reels; medical reels carry a logo and stay here): always, or when this server is busy
  const mode = getSettings().reelLambda;
  if (!options.brand && lambdaConfigured() && (mode === 2 || (mode === 1 && localRenderBusy()))) {
    job.onLambda = true;
    job.status = 'rendering';
    job.startedAt = Date.now();
    job.estimate = job.reelSeconds * lambdaPace;
    // Lambda reports nothing while it works: the progress follows the expected time
    const timer = setInterval(() => { job.progress = Math.min(0.95, (Date.now() - job.startedAt!) / 1000 / (job.estimate || 60)); }, 1000);
    renderOnLambda(job.id, options).then(r => {
      clearInterval(timer);
      job.s3Key = r.key;
      job.status = 'done';
      job.progress = 1;
      const took = (Date.now() - job.startedAt!) / 1000;
      lambdaPace = Math.min(6, Math.max(0.3, lambdaPace * 0.7 + (took / job.reelSeconds!) * 0.3));
      onDone?.(true, took);
    }).catch(error => {
      // Not lost: the reel is made here instead
      clearInterval(timer);
      console.error('Lambda reel failed, rendering on this server:', error?.message || error);
      job.onLambda = false;
      job.status = 'queued';
      job.progress = 0;
      job.startedAt = undefined;
      job.estimate = job.reelSeconds! * renderPace;
      renderCalmHere(job, options, onDone);
    });
    return;
  }
  renderCalmHere(job, options, onDone);
}

/** The reel on this server, through the shared render line. */
function renderCalmHere(job: VideoJob, options: Omit<Parameters<typeof renderCalmReel>[0], 'onStart' | 'onProgress'>, onDone?: (ok: boolean, renderSeconds: number, error?: string) => void) {
  renderCalmReel({
    ...options,
    onStart: () => { job.status = 'rendering'; job.startedAt = Date.now(); },
    onProgress: f => { job.progress = f; },
  }).then(mp4 => {
    job.status = 'done';
    job.progress = 1;
    job.result = mp4;
    const took = (Date.now() - (job.startedAt ?? Date.now())) / 1000;
    if (job.reelSeconds && took > 1) renderPace = Math.min(6, Math.max(0.5, renderPace * 0.7 + (took / job.reelSeconds) * 0.3));
    onDone?.(true, took);
  }).catch(error => {
    if (error instanceof RenderBusyError) job.error = 'هناك فيديوهات أخرى قيد التجهيز الآن، يرجى المحاولة بعد دقيقة.';
    else {
      console.error('Calm reel failed:', error);
      job.error = 'تعذّر تجهيز الفيديو، يرجى المحاولة لاحقاً.';
    }
    onDone?.(false, job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0, String(error?.message || error));
    job.status = 'error';
  });
}

app.get('/api/video/jobs/:id', requireAuth, (req, res) => {
  const job = videoJobs.get(req.params.id);
  if (!job || job.userId !== req.user!.id) return res.status(404).json({ success: false, error: 'المهمة غير موجودة' });
  // Position in line = queued jobs created before this one, plus one while every render slot is taken
  const jobs = [...videoJobs.values()];
  const ahead = job.status !== 'queued' ? 0 : jobs.filter(j => j.status === 'queued' && j.createdAt < job.createdAt).length
    + (jobs.filter(j => j.status === 'rendering' && !j.onLambda).length >= RENDER_SLOTS ? 1 : 0);
  res.json({ success: true, status: job.status, progress: job.progress, ahead, eta: Math.round(etaSeconds(job)), error: job.error });
});

app.get('/api/video/jobs/:id/file', requireAuth, async (req, res) => {
  const job = videoJobs.get(req.params.id);
  if (!job || job.userId !== req.user!.id || job.status !== 'done' || (!job.result && !job.s3Key)) {
    return res.status(404).json({ success: false, error: 'الفيديو غير جاهز' });
  }
  const name = String(req.query.name || 'reel').replace(/[^\w.-]/g, '') || 'reel';
  // Made in Lambda: straight from S3 through a short-lived link (byte ranges work there too)
  if (job.s3Key) {
    try {
      return res.redirect(302, await reelLink(job.s3Key, req.query.download ? name : undefined));
    } catch (err) {
      console.error('S3 link failed:', err);
      return res.status(503).json({ success: false, error: 'تعذّر جلب الفيديو، حاول بعد قليل.' });
    }
  }
  const file = job.result!;
  // ?download=1 saves it as a file; otherwise the page's video plays it while it streams in (byte ranges)
  if (req.query.download) res.set('Content-Disposition', `attachment; filename="${name}.mp4"`);
  res.set({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=1800' });
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : file.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : file.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, file.length - 1);
    if (start > end) return res.status(416).set('Content-Range', `bytes */${file.length}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) });
    return res.end(file.subarray(start, end + 1));
  }
  res.set('Content-Length', String(file.length));
  res.end(file);
});

// Arabic Tashkeel (Diacritics) helper endpoint
app.post('/api/tts/tashkeel', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'النص مطلوب' });
    }
    if (text.length > getSettings().maxTextChars) {
      return res.status(400).json({ success: false, error: 'النص أطول من الحد المسموح' });
    }
    if (!(await passesModeration(req, res, text, 'text-tool'))) return;
    if (!textToolLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
    }

    if (!hasUsableKeys()) {
      return res.status(500).json({ success: false, error: GENERIC_MESSAGE });
    }

    const prompt = `أنت عالم لغوي وخبير في النحو والصرف وتشكيل النصوص العربية للإلقاء الإذاعي والصوتي الفصيح.
المطلوب: قم بتشكيل النص العربي التالي تشكيلاً تاماً ودقيقاً بالحركات (الفتحة، الضمة، الكسرة، السكون، التنوين، الشدة) مع إعراب أواخر الكلمات إعراباً صحيحاً لضمان أفضل نطق صوتي.
حافظ على نفس الكلمات بالضبط دون أي تعديل أو زيادة أو حذف أو شرح. أعد النص المشكول فقط.

النص:
${text}`;

    const { result: response, keyId } = await withGeminiFailover('tashkeel', client => client.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      // Simple rewriting tasks: low thinking keeps latency (and output tokens) down
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        // Text models can take well over a minute under load; give them longer than TTS calls
        httpOptions: { timeout: 120_000 },
      },
    }), { cooldown: false });
    logUsage({ userId: req.user!.id, feature: 'tashkeel', model: TEXT_MODEL, chars: text.length, ...usageTokens(response), apiKeyId: keyId });

    const formattedText = response.text?.trim() || text;

    res.json({
      success: true,
      tashkeelText: formattedText
    });
  } catch (err: any) {
    sendFriendlyError(res, err, 'Tashkeel error');
  }
});

// Script optimizer for speech pauses and voiceover flow
app.post('/api/tts/optimize-script', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const { text, targetTone = 'professional' } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'النص مطلوب' });
    }
    if (text.length > getSettings().maxTextChars) {
      return res.status(400).json({ success: false, error: 'النص أطول من الحد المسموح' });
    }
    if (!(await passesModeration(req, res, text, 'text-tool'))) return;
    if (!textToolLimiter(`user:${req.user!.id}`)) {
      return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
    }

    if (!hasUsableKeys()) {
      return res.status(500).json({ success: false, error: GENERIC_MESSAGE });
    }

    const prompt = `أنت مهندس تعليق صوتي ومخرج نصوص إذاعية محترف.
المطلوب: حسّن النص التالي ليصبح مثالياً للإلقاء الصوتي المريح والطبيعي بنبرة (${targetTone}).
- ضع علامات الترقيم في مواضع الوقف والتنفس الطبيعي (فواصل ونقاط متوازنة).
- حافظ على المعنى الأصلي تماماً مع تحسين انسيابية الجمل للأذن.
- أعد النص المحسن فقط دون أي شرح أو مقدمات.

النص:
${text}`;

    const { result: response, keyId } = await withGeminiFailover('optimize', client => client.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      // Simple rewriting tasks: low thinking keeps latency (and output tokens) down
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        // Text models can take well over a minute under load; give them longer than TTS calls
        httpOptions: { timeout: 120_000 },
      },
    }), { cooldown: false });
    logUsage({ userId: req.user!.id, feature: 'optimize', model: TEXT_MODEL, chars: text.length, ...usageTokens(response), apiKeyId: keyId });

    const optimized = response.text?.trim() || text;

    res.json({
      success: true,
      optimizedText: optimized
    });
  } catch (err: any) {
    sendFriendlyError(res, err, 'Optimize script error');
  }
});

// ---------- Installable app (PWA) ----------

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').json({
    id: '/',
    name: 'صوتك الذكي',
    short_name: 'صوتك الذكي',
    description: 'استوديو تحويل النص إلى صوت عربي طبيعي، تهاني بالصوت، واستوديو الصحفيين',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/?source=pwa#/studio',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#0891b2',
    background_color: '#f0fdfa',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});
// The service worker must always be fresh so updates reach installed apps right away
app.get('/sw.js', (_req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.sendFile(path.resolve(__dirname, process.env.NODE_ENV === 'production' ? 'dist' : 'public', 'sw.js'));
});

// Vite or Static file serving
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const indexHtml = path.resolve(__dirname, 'dist', 'index.html');

  // The redesign used to live under /new; keep old links working
  app.get(['/new', '/new/'], (_req, res) => res.redirect(301, '/'));
  app.use(express.static(path.resolve(__dirname, 'dist'), { index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TTS Studio Server is running on http://0.0.0.0:${PORT}`);
});
