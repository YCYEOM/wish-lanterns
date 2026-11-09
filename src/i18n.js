// Language: Korean when the browser asks for it, English otherwise. ?lang=ko / ?lang=en forces one.
// Strings live where they are used as L('한국어', 'English') pairs, so each line keeps both versions together.
// (Imported by data.js, which the server bundle also uses: there is no browser there, so it stays Korean.)
function pick() {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'en' || q === 'ko') return q; } catch {}
  try { const l = (navigator.languages && navigator.languages[0]) || navigator.language || ''; return /^ko\b/i.test(l) || !l ? 'ko' : 'en'; } catch { return 'ko'; }
}
export const LANG = typeof location === 'undefined' || typeof document === 'undefined' ? 'ko' : pick();
export const EN = LANG === 'en';
export const L = (ko, en) => (EN ? en : ko);
