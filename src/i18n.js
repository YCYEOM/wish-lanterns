// Language: Korean unless nothing says so. Order: ?lang=ko|en, then the player's own choice (the 🌐 toggle on
// the title, saved), then Korean if any of the browser's languages is Korean or the clock is set to Seoul
// (many Korean setups list English first, and app web views often report en-US), else English.
// Strings live where they are used as L('한국어', 'English') pairs.
// (Imported by data.js, which the server bundle also uses: there is no browser there, so it stays Korean.)
const KEY = 'wishLanterns.lang';
function pick() {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'en' || q === 'ko') return q; } catch {}
  try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ko') return s; } catch {}
  try {
    const langs = [...(navigator.languages || []), navigator.language || ''];
    if (langs.some((l) => /^ko\b/i.test(l))) return 'ko';
    if (/^Asia\/Seoul$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '')) return 'ko';
    return langs.filter(Boolean).length ? 'en' : 'ko';
  } catch { return 'ko'; }
}
export const LANG = typeof location === 'undefined' || typeof document === 'undefined' ? 'ko' : pick();
export const EN = LANG === 'en';
export const L = (ko, en) => (EN ? en : ko);
// switch and remember (the page reloads in the other language)
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  try { const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.toString()); } catch { location.reload(); }
}
