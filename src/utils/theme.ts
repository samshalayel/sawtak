export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'sawtik_theme';

// index.html applies the saved theme before first paint; this keeps React in sync with it
export function getTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore (private mode)
  }
}
