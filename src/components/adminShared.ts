// Formatting helpers and styles shared by the admin dashboard tabs

export const num = (n: number) => Math.round(n).toLocaleString('en-US');
export const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
// SQLite datetime('now') is UTC without a zone marker
export const date = (s: string | null) =>
  s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  // Without a reason from our server (a gateway timeout, a page instead of JSON…) the status code at least tells what happened
  if (!res.ok || !data.success) throw new Error(data.error || `تعذّر إتمام الطلب (HTTP ${res.status})`);
  return data as T;
}

export const card = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4';
export const th = 'text-right font-semibold text-slate-400 px-3 py-2 whitespace-nowrap';
export const td = 'px-3 py-2 whitespace-nowrap';
