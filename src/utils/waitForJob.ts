/** One answer of GET /api/video/jobs/:id. */
export interface JobStatus {
  success?: boolean;
  status?: 'queued' | 'rendering' | 'done' | 'error';
  progress?: number;
  ahead?: number;
  eta?: number;
  error?: string;
}

/**
 * Follows a background video job until it is done. Instead of waiting forever it stops with a clear message when the
 * server no longer knows the job (it restarted: jobs live in its memory), when the server cannot be reached for about
 * half a minute, or after `timeoutMs`. Resolves true when the video is ready, false if `isCancelled` turned true.
 */
export async function waitForJob(
  jobId: string,
  { onUpdate, isCancelled, intervalMs = 1500, timeoutMs = 15 * 60_000 }: {
    onUpdate?: (s: JobStatus) => void; isCancelled?: () => boolean; intervalMs?: number; timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const started = Date.now();
  let misses = 0;
  while (!isCancelled?.()) {
    await new Promise(r => setTimeout(r, intervalMs));
    if (isCancelled?.()) return false;
    if (Date.now() - started > timeoutMs) throw new Error('استغرق تجهيز الفيديو أطول من المتوقع، يرجى المحاولة مرة أخرى بعد قليل.');
    let res: Response;
    let s: JobStatus;
    try {
      res = await fetch(`/api/video/jobs/${jobId}`, { signal: AbortSignal.timeout(20_000) });
      s = await res.json();
    } catch {
      // A moment without the server (a restart, the phone changing networks): keep asking for about half a minute
      if (++misses * intervalMs > 30_000) throw new Error('انقطع الاتصال بالخادم أثناء تجهيز الفيديو. تحقق من الإنترنت وحاول مرة أخرى.');
      continue;
    }
    misses = 0;
    if (res.status === 404) throw new Error('توقف تجهيز الفيديو على الخادم، يرجى المحاولة مرة أخرى.');
    if (!res.ok || s.status === 'error' || s.success === false) throw new Error(s.error || 'تعذّر تجهيز الفيديو');
    onUpdate?.(s);
    if (s.status === 'done') return true;
  }
  return false;
}
