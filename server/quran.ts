// Quran verses for calm reels: the verse text and the recitation of a real reciter (never the AI voice), always
// whole verses. Text comes from api.quran.com and audio from everyayah.com; each is downloaded once and kept in
// DATA_DIR/quran, so later reels with the same verses do not touch the internet.
import express from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { requireAuth } from './auth.ts';
import { QURAN_MAX_SECONDS, QURAN_MAX_VERSES, QURAN_RECITERS, QURAN_TOPICS, DEFAULT_RECITER } from '../src/data/quran.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const QURAN_DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'quran');
const QURAN_API = 'https://api.quran.com/api/v4';
const AUDIO_BASE = 'https://everyayah.com/data';
const RATE = 24000; // same PCM format as the TTS voice, so the reel's timing code reads it unchanged
const GAP_SECONDS = 0.45; // silence between two verses

export interface QuranSurah { number: number; name: string; verses: number }
export interface QuranPick { surah: number; start: number; end: number; reciter: string }

const pad3 = (n: number) => String(n).padStart(3, '0');

async function fetchJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** Writes through a temporary name so a half-written file is never read as complete. */
async function writeAtomic(file: string, data: Buffer | string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

let surahsMemo: QuranSurah[] | null = null;
export async function quranSurahs(): Promise<QuranSurah[]> {
  if (surahsMemo) return surahsMemo;
  const file = path.join(QURAN_DIR, 'surahs.json');
  if (existsSync(file)) return (surahsMemo = JSON.parse(await fs.readFile(file, 'utf8')));
  const data = await fetchJson(`${QURAN_API}/chapters?language=ar`);
  const list: QuranSurah[] = (data.chapters ?? []).map((c: any) => ({ number: c.id, name: c.name_arabic, verses: c.verses_count }));
  if (list.length !== 114) throw new Error(`Unexpected surah list (${list.length})`);
  await writeAtomic(file, JSON.stringify(list));
  return (surahsMemo = list);
}

/** The whole surah in Uthmani script, verse 1 at index 0 (one request per surah, then cached). */
async function surahText(surah: number): Promise<string[]> {
  const file = path.join(QURAN_DIR, 'text', `${pad3(surah)}.json`);
  if (existsSync(file)) return JSON.parse(await fs.readFile(file, 'utf8'));
  const { verses: count } = (await quranSurahs())[surah - 1];
  const data = await fetchJson(`${QURAN_API}/quran/verses/uthmani?chapter_number=${surah}`);
  const verses: string[] = (data.verses ?? []).map((v: any) => String(v.text_uthmani ?? '').trim());
  if (verses.length !== count || verses.some(v => !v)) throw new Error(`Incomplete text for surah ${surah}`);
  await writeAtomic(file, JSON.stringify(verses));
  return verses;
}

/** One verse's recitation as an MP3 on disk (downloaded the first time). */
export async function verseAudio(reciter: string, surah: number, verse: number): Promise<string> {
  const file = path.join(QURAN_DIR, 'audio', reciter, `${pad3(surah)}${pad3(verse)}.mp3`);
  if (existsSync(file)) return file;
  const res = await fetch(`${AUDIO_BASE}/${reciter}/${pad3(surah)}${pad3(verse)}.mp3`, { signal: AbortSignal.timeout(30_000) });
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok || body.length < 1024) throw new Error(`Recitation ${reciter} ${surah}:${verse} unavailable (${res.status})`);
  await writeAtomic(file, body);
  return file;
}

/** Validates a requested passage: a known reciter, an existing surah and at most QURAN_MAX_VERSES whole verses. */
export async function parseQuranPick(raw: any): Promise<QuranPick | { error: string }> {
  const surah = Number(raw?.surah);
  const start = Number(raw?.start);
  const end = Number(raw?.end ?? raw?.start);
  const reciter = QURAN_RECITERS.some(r => r.id === raw?.reciter) ? String(raw.reciter) : DEFAULT_RECITER;
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return { error: 'رقم السورة غير صحيح' };
  const { verses } = (await quranSurahs())[surah - 1];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > verses) {
    return { error: `أرقام الآيات غير صحيحة (عدد آيات السورة ${verses})` };
  }
  if (end - start + 1 > QURAN_MAX_VERSES) return { error: `الحد الأقصى ${QURAN_MAX_VERSES} آيات في الريل الواحد` };
  return { surah, start, end, reciter };
}

/** Decodes an MP3 to 16-bit mono PCM at RATE. */
function decodePcm(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), 'pipe:1']);
    const chunks: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => { err = (err + d).slice(-500); });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}: ${err}`))));
  });
}

function wavFromPcm(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export interface QuranRecitation {
  wav: Buffer;
  /** One caption per verse, in seconds from the start of the recitation. */
  captions: { text: string; start: number; end: number }[];
  title: string;
  seconds: number;
}

/** The passage as one WAV (verses joined with a short pause) and the exact time span of each verse. */
export async function quranRecitation(p: QuranPick): Promise<QuranRecitation> {
  const [text, surahs] = await Promise.all([surahText(p.surah), quranSurahs()]);
  const gap = Buffer.alloc(Math.round(GAP_SECONDS * RATE) * 2);
  const parts: Buffer[] = [];
  const captions: QuranRecitation['captions'] = [];
  let t = 0;
  for (let v = p.start; v <= p.end; v++) {
    const pcm = await decodePcm(await verseAudio(p.reciter, p.surah, v));
    if (parts.length) { parts.push(gap); t += GAP_SECONDS; }
    const seconds = pcm.length / 2 / RATE;
    captions.push({ text: text[v - 1], start: t, end: t + seconds });
    parts.push(pcm);
    t += seconds;
  }
  if (t > QURAN_MAX_SECONDS) throw new QuranTooLongError(t);
  const name = surahs[p.surah - 1].name;
  // A range in words: after Arabic letters, "1-4" (or "1–4") is laid out right to left and reads as "4-1"
  const title = p.start === p.end ? `سورة ${name} • الآية ${p.start}` : `سورة ${name} • الآيات ${p.start} إلى ${p.end}`;
  return { wav: wavFromPcm(Buffer.concat(parts)), captions, title, seconds: t };
}

export class QuranTooLongError extends Error {
  constructor(readonly seconds: number) { super(`Recitation is ${Math.round(seconds)} s`); }
}

// ---------- API for the verse picker ----------

export const quranRouter = express.Router();
quranRouter.use(requireAuth);

quranRouter.get('/options', async (_req, res) => {
  try {
    res.json({ success: true, surahs: await quranSurahs(), reciters: QURAN_RECITERS, topics: QURAN_TOPICS });
  } catch (err: any) {
    console.error('Quran surahs failed:', err?.message);
    res.status(503).json({ success: false, error: 'تعذّر جلب قائمة السور، حاول بعد قليل' });
  }
});

/** Verse texts of a passage (the picker shows them before the reel is made). */
quranRouter.get('/verses', async (req, res) => {
  const pick = await parseQuranPick(req.query).catch(() => ({ error: 'تعذّر قراءة السورة' }));
  if ('error' in pick) return res.status(400).json({ success: false, error: pick.error });
  try {
    const text = await surahText(pick.surah);
    const name = (await quranSurahs())[pick.surah - 1].name;
    const verses = [];
    for (let v = pick.start; v <= pick.end; v++) verses.push({ verse: v, text: text[v - 1] });
    res.json({ success: true, surah: pick.surah, surahName: name, verses });
  } catch (err: any) {
    console.error('Quran verses failed:', err?.message);
    res.status(503).json({ success: false, error: 'تعذّر جلب الآيات، حاول بعد قليل' });
  }
});

/** One verse's recitation, to listen before choosing (served from the local copy). */
quranRouter.get('/audio/:reciter/:surah/:verse', async (req, res) => {
  const surah = Number(req.params.surah);
  const verse = Number(req.params.verse);
  if (!QURAN_RECITERS.some(r => r.id === req.params.reciter) || !(surah >= 1 && surah <= 114) || !(verse >= 1 && verse <= 286)) {
    return res.status(400).json({ success: false, error: 'طلب غير صحيح' });
  }
  try {
    res.type('audio/mpeg').set('Cache-Control', 'private, max-age=86400').sendFile(await verseAudio(req.params.reciter, surah, verse));
  } catch (err: any) {
    console.error('Quran audio failed:', err?.message);
    res.status(503).json({ success: false, error: 'تعذّر تحميل التلاوة' });
  }
});
