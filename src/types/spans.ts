// One measured stage of a motion video, for the admin performance test (waterfall view).
// The motion worker (sawtik-motion/worker/spans.ts) writes the same shape into status.json.

export type SpanProvider = 'gemini' | 'aws' | 'claude' | 'local' | 'wait';

export interface Span {
  name: string;          // stable key, e.g. 'tts', 'plan-1', 'wait-claude'
  label: string;         // shown to the admin (Arabic)
  provider: SpanProvider;
  start: number;         // epoch ms, server clock (the site and the worker share one machine)
  end: number;
  costUsd?: number;      // missing = not measured
  estimated?: boolean;   // cost is an estimate, or not actually billed (Claude on a subscription)
  error?: string;        // the stage failed (it may have been retried)
  meta?: Record<string, string | number>;
}

export interface BenchmarkRun {
  id: number;
  createdAt: string;
  idea: string;
  jobId: string | null;
  status: 'done' | 'error';
  error: string | null;
  totalMs: number;
  totalCostUsd: number;
  spans: Span[];
}

export const spanMs = (s: Span) => Math.max(0, s.end - s.start);
