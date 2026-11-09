// season.js — the season of the lake follows today's date in Seoul (KST, UTC+9).
//   seoulSeason(now?)   -> 'spring' | 'summer' | 'autumn' | 'winter'
//   SEASONS[name]       -> { name (Korean), emoji, weights [spring, summer, autumn, winter] for the shaders,
//                           ff (share of fireflies lit), snow (ground cover 0..1), fall ('petal' | 'leaf' | null) }
import { L } from './i18n.js';

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

export const SEASONS = {
  spring: { name: L('봄', 'spring'), emoji: '🌸', weights: [1, 0, 0, 0], ff: 0.25, snow: 0, fall: 'petal' },
  summer: { name: L('여름', 'summer'), emoji: '🌿', weights: [0, 1, 0, 0], ff: 1.0, snow: 0, fall: null },
  autumn: { name: L('가을', 'autumn'), emoji: '🍂', weights: [0, 0, 1, 0], ff: 0.18, snow: 0, fall: 'leaf' },
  winter: { name: L('겨울', 'winter'), emoji: '❄️', weights: [0, 0, 0, 1], ff: 0, snow: 0.9, fall: null },
};

export function seoulSeason(now = Date.now()) {
  const m = new Date(now + 9 * 3600 * 1000).getUTCMonth() + 1;   // 1..12 in Seoul
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
