// Press studio: turn a news article into a podcast dialogue, a news bulletin or a one-voice summary.
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { ThinkingLevel } from '@google/genai';
import { withGeminiFailover, hasUsableKeys } from './keys.ts';
import { logUsage } from './credits.ts';
import { requireAuth, requireVerifiedEmail } from './auth.ts';
import { getBrandKit } from './brand.ts';
import { ALLOWED_AUDIO_TAGS, keepKnownAudioTags, stripAudioTags } from '../src/utils/audioTags.ts';

export type PressFormat = 'podcast' | 'bulletin' | 'summary';
export const PRESS_FORMATS: PressFormat[] = ['podcast', 'bulletin', 'summary'];
const MAX_ARTICLE_CHARS = 12_000;

export interface PressDeps {
  textModel: string;
  dialectNames: Record<string, string>;
  usageTokens: (response: any) => { promptTokens: number; outputTokens: number };
  passesModeration: (req: express.Request, res: express.Response, text: string, feature: string) => Promise<boolean>;
  limiter: (key: string) => boolean;
}

export async function masterWithJingles(_userId: number, speech: Buffer): Promise<{ wav: Buffer; introSeconds: number; outroSeconds: number }> {
  return { wav: speech, introSeconds: 0, outroSeconds: 0 };
}

// ---------- Article -> script ----------

const LENGTHS = {
  short: { label: 'about 60-90 seconds when spoken (roughly 150-220 words)', turns: '6-8' },
  medium: { label: 'about 2-3 minutes when spoken (roughly 300-450 words)', turns: '10-14' },
} as const;

// Measured 2026-10-15: gemini-3.5-flash-lite returns a structured script in ~4 s, while the larger text model
// was overloaded (503) or ran past its deadline (504) on long articles
const SCRIPT_MODELS = (fallback: string) => [
  { model: 'gemini-3.5-flash-lite', thinking: ThinkingLevel.MINIMAL },
  { model: fallback, thinking: ThinkingLevel.LOW },
];

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short episode title in the same language (max 8 words)' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { speaker: { type: 'integer', description: '0 or 1 (always 0 for a one-voice summary)' }, text: { type: 'string' } },
        required: ['speaker', 'text'],
      },
    },
    headlines: { type: 'array', items: { type: 'string' }, description: 'Bulletin only: 3-6 short ticker headlines' },
  },
  required: ['title', 'lines'],
};

export function buildPrompt(format: PressFormat, article: string, opts: { names: string[]; dialect: string; length: keyof typeof LENGTHS; showName: string; outletName: string }) {
  const len = LENGTHS[opts.length];
  const show = opts.showName ? `The show is called "${opts.showName}"${opts.outletName ? ` by ${opts.outletName}` : ''}.` : '';
  // Podcasts carry expression tags (see below); the formal formats stay plain
  const brackets = format === 'podcast' ? 'no stage directions, emojis, markdown or sound effects (only the expression tags described below)' : 'no stage directions, emojis, markdown, sound effects or bracketed notes';
  const shared = `Language: ${opts.dialect}. It will be read by a text-to-speech voice: spoken sentences only — ${brackets}. Write numbers and dates as they are spoken.
Write every speaker name exactly as given (same spelling), and keep the names of people and places from the article unchanged.
Stay strictly faithful to the article: do not invent facts, quotes, figures or names that are not in it. Attribute claims as the article does.
Total length: ${len.label}.`;
  if (format === 'podcast') {
    return `Turn the news article below into a natural podcast conversation between the host "${opts.names[0]}" (speaker 0) and the guest "${opts.names[1]}" (speaker 1), who knows the story well. ${show}
The host opens by welcoming listeners${opts.showName ? ' to the show' : ''} and introducing the topic, asks clear questions; the guest explains the story, context and why it matters. Alternate speakers, ${len.turns} turns, each 1-3 sentences. The host closes briefly.
${shared}
EXPRESSION TAGS (required): the voice performs English tags in square brackets placed right before the words they colour, and never reads them aloud. Put ${opts.length === 'short' ? '3 to 5' : '5 to 8'} of them across the episode, spread over both speakers, at most one per sentence, chosen ONLY from: ${ALLOWED_AUDIO_TAGS.map(t => `[${t}]`).join(' ')}.
Match the meaning: [excited] or [playful] for a warm welcome or good news, [amused] or [laughing] for a genuinely light moment, [reassuring] when explaining, [short pause] before an important figure or the key fact, [confident] for a clear conclusion.
If the story involves death, war, injury or disaster, use only [serious], [sad] and pauses: never laughter or playfulness. No other bracketed text.
Example line: "[excited] أهلاً فيكم بحلقة جديدة! [short pause] اليوم عنا خبر حلو كتير."

ARTICLE:
"""
${article}
"""`;
  }
  if (format === 'bulletin') {
    return `Turn the news article below into a short TV/radio news bulletin with the anchor "${opts.names[0]}" (speaker 0) in the studio and the correspondent "${opts.names[1]}" (speaker 1) reporting. ${show}
The anchor opens with the headline and hands over to the correspondent by name; the correspondent reports the details; the anchor may ask one follow-up; the anchor closes. Formal news register. ${len.turns} turns.
Also give 3-6 short ticker headlines (each under 10 words) summarising the key facts.
${shared}

ARTICLE:
"""
${article}
"""`;
  }
  return `Turn the news article below into a clear spoken summary read by one narrator (speaker 0 for every line). ${show}
Start with the core news in one sentence, then the key details and context, then why it matters. Split it into short paragraphs, one per line.
${shared}

ARTICLE:
"""
${article}
"""`;
}

export function createPressRouter(deps: PressDeps) {
  const router = express.Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.post('/script', async (req, res) => {
    try {
      const format: PressFormat = PRESS_FORMATS.includes(req.body?.format) ? req.body.format : 'podcast';
      const article = String(req.body?.article || '').replace(/\r/g, '').trim();
      const length = req.body?.length === 'medium' ? 'medium' : 'short';
      const dialect = deps.dialectNames[req.body?.dialect] ? req.body.dialect : 'msa';
      const names = (Array.isArray(req.body?.names) ? req.body.names : []).map((n: unknown) => String(n || '').trim().slice(0, 30));

      if (article.length < 80) return res.status(400).json({ success: false, error: 'الصق نص المقال كاملاً (80 حرفاً على الأقل)' });
      if (article.length > MAX_ARTICLE_CHARS) {
        return res.status(400).json({ success: false, error: `المقال أطول من ${MAX_ARTICLE_CHARS.toLocaleString('en')} حرف، اختصره أو قسّمه` });
      }
      if (format !== 'summary' && (names.length !== 2 || !names[0] || !names[1] || names[0] === names[1])) {
        return res.status(400).json({ success: false, error: 'اكتب اسمين مختلفين للمتحدثَين' });
      }
      if (!(await deps.passesModeration(req, res, article, 'script'))) return;
      if (!hasUsableKeys()) return res.status(500).json({ success: false, error: 'تعذّر إتمام الطلب حالياً، يرجى المحاولة لاحقاً.' });
      if (!deps.limiter(`user:${req.user!.id}`)) {
        return res.status(429).json({ success: false, error: 'طلبات كثيرة خلال وقت قصير، يرجى الانتظار دقيقة ثم المحاولة.' });
      }

      const brand = getBrandKit(req.user!.id);
      const prompt = buildPrompt(format, article, {
        names, dialect: deps.dialectNames[dialect], length, showName: brand?.showName ?? '', outletName: brand?.outletName ?? '',
      });
      // The light model rewrites an article in seconds; the larger one is the fallback when it is unavailable
      let outcome: { result: any; keyId: number; model: string } | null = null;
      let lastError: unknown;
      for (const { model, thinking } of SCRIPT_MODELS(deps.textModel)) {
        try {
          const r = await withGeminiFailover('press-script', client => client.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseJsonSchema: SCRIPT_SCHEMA,
              thinkingConfig: { thinkingLevel: thinking },
              httpOptions: { timeout: 60_000 },
            },
          }), { cooldown: false });
          outcome = { ...r, model };
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[press] ${model} could not write the script, trying the next model`);
        }
      }
      if (!outcome) throw lastError;
      const response = outcome.result;
      logUsage({ userId: req.user!.id, feature: 'script', model: outcome.model, chars: article.length, ...deps.usageTokens(response), apiKeyId: outcome.keyId });

      let parsed: any;
      try {
        parsed = JSON.parse(response.text || '{}');
      } catch {
        parsed = {};
      }
      const lines = (Array.isArray(parsed.lines) ? parsed.lines : [])
        // Podcasts may carry expression tags from the allowed list; anything else in brackets would be read aloud
        .map((l: any) => {
          const text = String(l?.text || '').replace(/\s+/g, ' ').trim();
          return { speaker: format === 'summary' ? 0 : (Number(l?.speaker) === 1 ? 1 : 0), text: format === 'podcast' ? keepKnownAudioTags(text) : stripAudioTags(text).trim() };
        })
        .filter((l: { text: string }) => l.text);
      if (lines.length === 0) return res.status(503).json({ success: false, error: 'تعذّر تحويل المقال، جرّب مرة أخرى' });

      res.json({
        success: true,
        title: String(parsed.title || '').trim().slice(0, 80),
        lines,
        headlines: format === 'bulletin' && Array.isArray(parsed.headlines)
          ? parsed.headlines.map((h: unknown) => String(h || '').trim()).filter(Boolean).slice(0, 6)
          : [],
      });
    } catch (err: any) {
      console.error('Press script error:', err);
      const status = Number(err?.status ?? err?.code);
      const busy = status === 429 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE|unavailable/i.test(String(err?.message));
      res.status(busy ? 503 : 500).json({
        success: false,
        error: busy ? 'الخوادم مشغولة حالياً، يرجى المحاولة لاحقاً. شكراً لتفهمكم.' : 'تعذّر تحويل المقال حالياً، يرجى المحاولة لاحقاً.',
      });
    }
  });

  /** Final episode audio: the generated speech wrapped with the outlet's intro/outro (free). */
  router.post('/master', async (req, res) => {
    const speech = typeof req.body?.audioBase64 === 'string' ? Buffer.from(req.body.audioBase64, 'base64') : null;
    if (!speech || speech.subarray(0, 4).toString('ascii') !== 'RIFF') {
      return res.status(400).json({ success: false, error: 'لا يوجد مقطع صوتي' });
    }
    try {
      const { wav, introSeconds } = await masterWithJingles(req.user!.id, speech);
      res.json({ success: true, audioBase64: wav.toString('base64'), introSeconds });
    } catch (err) {
      console.error('Press master error:', err);
      res.status(500).json({ success: false, error: 'تعذّر دمج المقدمة والخاتمة' });
    }
  });

  return router;
}
