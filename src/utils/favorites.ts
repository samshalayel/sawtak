import { useEffect, useState } from 'react';
import { AuthUser } from '../types/auth';

// Starred voices. Signed-in users keep them on their account (any device); visitors on this device,
// and those are merged into the account on sign-in. Settings only — no content is stored.
const KEY = 'sawtik_fav_voices';

const readLocal = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
};
const writeLocal = (list: string[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage off */ }
};

const save = (list: string[]) =>
  fetch('/api/auth/favorites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voices: list }) }).catch(() => null);

export function useFavoriteVoices(user: AuthUser | null, setUser: (fn: (u: AuthUser | null) => AuthUser | null) => void) {
  const [local, setLocal] = useState<string[]>(readLocal);

  // On sign-in: carry over what the visitor starred before logging in
  useEffect(() => {
    if (!user || local.length === 0) return;
    const merged = [...new Set([...(user.favoriteVoices ?? []), ...local])];
    setLocal([]);
    writeLocal([]);
    if (merged.length !== (user.favoriteVoices ?? []).length) {
      setUser(u => (u ? { ...u, favoriteVoices: merged } : u));
      save(merged);
    }
  }, [user?.id]);

  const favorites = user ? user.favoriteVoices ?? [] : local;

  const toggle = (voiceId: string) => {
    const next = favorites.includes(voiceId) ? favorites.filter(v => v !== voiceId) : [...favorites, voiceId];
    if (user) {
      setUser(u => (u ? { ...u, favoriteVoices: next } : u));
      save(next);
    } else {
      setLocal(next);
      writeLocal(next);
    }
  };

  return { favorites, toggle };
}
