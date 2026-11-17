// The Golden Lantern: a durable Genex store item (a look, nothing more). Only on Genex's own pages does the game
// load @genex-ai/embed-sdk; on the game's other sites nothing here runs and the gold swatch never shows.
//
//   shop.onGenex   this page is a Genex host (or local test mode)
//   shop.item      the store's listing (name, iconUrl, priceCoins, priceDisplayUsdCents) or null
//   shop.owned     getEntitlements() lists it
//   shop.canBuy    the shell has a purchase surface (not the Genex app, not local test)
//   initShop()     boot: init the SDK, read the shop and what this player owns
//   buyGold()      call straight from a click: opens Genex's confirmation, resolves with the status
import { GENEX } from './genex.config.js';

const host = location.hostname;
const localTest = /^(localhost|127\.0\.0\.1)$/.test(host) && /[?&]genex_local_test=1/.test(location.search);
export const shop = {
  onGenex: /(^|\.)genex\.(technology|games)$/.test(host) || localTest,
  item: null, owned: false, shell: '', canBuy: false, onChange: null,
};
const isGold = (x) => !!x && ((x.tags || []).includes('gold-lantern') || /golden lantern|금빛 등불/i.test(x.name || ''));
let sdk = null;

export async function initShop() {
  if (!shop.onGenex) return;
  try {
    sdk = await import('@genex-ai/embed-sdk');
    sdk.initEmbed(GENEX);
    shop.shell = sdk.getShell();
    shop.canBuy = shop.shell !== 'app' && shop.shell !== 'local';
    await refresh();
  } catch (e) { console.warn('[shop]', e && e.message); }
}

async function refresh() {
  if (!sdk) return;
  try { shop.item = (await sdk.getShop()).find(isGold) || shop.item; } catch {}
  try {
    const owned = await sdk.getEntitlements({ excludeConsumed: true });
    shop.owned = owned.some((e) => (shop.item && e.skuId === shop.item.id) || isGold(e));
  } catch {}
  if (shop.onChange) shop.onChange();
}

export function buyGold() {
  if (!sdk || !shop.item) return Promise.resolve('unavailable');
  const p = sdk.buy({ skuId: shop.item.id });   // the first call in the click: keeps the gesture for the popup
  return p.then(async (r) => { await refresh(); return shop.owned ? 'owned' : r.status; }, async () => { await refresh(); return 'failed'; });
}

// test hook: pretend a shop answer (local test mode has no store)
export function fakeShop(o) { Object.assign(shop, o); if (shop.onChange) shop.onChange(); }
