// Per-service on/off switches (admin settings). A stopped service refuses new work for customers; viewing and
// downloading what is already made keeps working, and admins can still use it to test before turning it back on.
import express from 'express';
import { AppSettings, getSettings } from './db.ts';

export const SERVICES = ['tts', 'dialogue', 'greetings', 'calm', 'quran', 'motion', 'press', 'payments', 'medical'] as const;
export type ServiceId = (typeof SERVICES)[number];

/** The setting behind each switch (1 = on, 0 = off). */
export const SERVICE_SETTING: Record<ServiceId, keyof AppSettings> = {
  tts: 'serviceTts',
  dialogue: 'serviceDialogue',
  greetings: 'serviceGreetings',
  calm: 'serviceCalm',
  quran: 'serviceQuran',
  motion: 'serviceMotion',
  press: 'servicePress',
  payments: 'servicePayments',
  medical: 'serviceMedical',
};

export const SERVICE_OFF_MESSAGE = 'هذه الخدمة متوقفة مؤقتاً، يرجى المحاولة لاحقاً.';

export const serviceOn = (id: ServiceId) => getSettings()[SERVICE_SETTING[id]] !== 0;

/** Every switch, for the browser (so stopped services are hidden). */
export const serviceStatus = (): Record<ServiceId, boolean> =>
  Object.fromEntries(SERVICES.map(id => [id, serviceOn(id)])) as Record<ServiceId, boolean>;

/** Inside a handler: answers 503 and returns true when `id` is stopped for this account. */
export function serviceBlocked(req: express.Request, res: express.Response, id: ServiceId): boolean {
  if (serviceOn(id) || req.user?.role === 'admin') return false;
  res.status(503).json({ success: false, code: 'SERVICE_DISABLED', service: id, error: SERVICE_OFF_MESSAGE });
  return true;
}

/**
 * The service a request starts new work in, from its path alone. /api/tts/generate and /api/video/render serve both
 * the studio and greeting cards, so those two decide in their handlers once the body is read.
 */
function serviceOf(method: string, path: string): ServiceId | null {
  if (method !== 'POST') return null;
  if (path === '/api/tts/dialogue' || path === '/api/tts/write-dialogue') return 'dialogue';
  if (path === '/api/tts/tashkeel' || path === '/api/tts/optimize-script') return 'tts';
  if (path === '/api/greetings/batch' || path === '/api/greetings/batch/') return 'greetings';
  if (path === '/api/calm/render') return 'calm';
  if (path === '/api/quran/render') return 'quran';
  if (path === '/api/motion/script' || path === '/api/motion/jobs') return 'motion';
  if (path.startsWith('/api/press/')) return 'press';
  if (path === '/api/jawwal/otp' || path === '/api/jawwal/pay') return 'payments';
  if (path === '/api/medical/review' || path === '/api/medical/card' || path === '/api/medical/reel') return 'medical';
  return null;
}

/** Global gate, mounted after loadUser and before the routes. */
export function serviceGate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const id = serviceOf(req.method, req.path);
  if (id && serviceBlocked(req, res, id)) return;
  next();
}
