import { useState } from 'react';

// Tema chiaro (predefinito) o scuro, scelto dall'utente e ricordato nel browser.
type Theme = 'light' | 'dark';
const KEY = 'd-academy:theme';
const read = (): Theme => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
export const applyTheme = (t: Theme = read()) => { document.documentElement.dataset.theme = t; };

export function useTheme() {
  const [theme, setTheme] = useState(read);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* solo comodità */ }
    applyTheme(next);
    setTheme(next);
  };
  return { theme, toggle };
}
