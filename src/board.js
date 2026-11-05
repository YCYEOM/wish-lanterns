// board.js — the lake remembers: lanterns are posted to a few public Nostr relays (free, keyless, no server
// of our own) and stay there for a day, so someone arriving at an empty lake still finds the lanterns
// launched before them. It also carries new lanterns and hearts live through the relays, so people
// whose networks block the direct WebRTC link (net.js) still see each other's lanterns.
//
//   const board = new Board({ onLantern(entry, fresh), onHeart(netId) })
//   board.join(lakeNo)                       fetch the last day's lanterns of that lake, then listen live
//   board.post(owner, { k, t, c, m })        remember a lantern for 24 h (and tell everyone listening now)
//   board.heart(netId)                       a one-off heart, relayed live, never stored
//   board.status                             'off' | 'connecting' | 'on' (some relay answered)
//
// Events: kind 30078 (NIP-78 application data, addressable by its "d" tag, one per lantern) with a NIP-40
// expiration a day out; hearts are ephemeral kind 21078. Both carry a "t" tag naming the lake.
import { schnorr, utils } from '@noble/secp256k1';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr.mom', 'wss://relay.primal.net', 'wss://offchain.pub'];
// hearts are kept a week (kind 1078, tagged w=<lantern owner>) so the owner hears about them on the next visit
const KIND_LANTERN = 30078, KIND_HEART = 1078, KIND_WISH = 21079;
const HEART_TTL = 7 * 24 * 3600;
const TTL = 24 * 3600;          // seconds a lantern stays on the board
const MAX_FETCH = 80;
const TAG = (lake) => `wishlanterns-v1-lake-${lake}`;

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const now = () => Math.floor(Date.now() / 1000);

function secretKey() {           // one signing key per browser, kept like the owner key in net.js
  try {
    let k = localStorage.getItem('wishLanterns.nsk');
    if (!k || k.length !== 64) { k = hex(utils.randomSecretKey()); localStorage.setItem('wishLanterns.nsk', k); }
    return unhex(k);
  } catch { return utils.randomSecretKey(); }
}

export class Board {
  constructor(hooks) {
    this.hooks = hooks;
    this.sk = secretKey();
    this.pk = hex(schnorr.getPublicKey(this.sk));
    this.sockets = [];
    this.lake = null;
    this.seen = new Set();        // event ids
    this.hearts = new Set();
    this.status = 'off';
    this.joinedAt = 0;
    this.subN = 0;
  }

  async sign(kind, tags, content) {
    const ev = { pubkey: this.pk, created_at: now(), kind, tags, content };
    const ser = new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
    const id = new Uint8Array(await crypto.subtle.digest('SHA-256', ser));
    ev.id = hex(id);
    ev.sig = hex(await schnorr.signAsync(id, this.sk));
    return ev;
  }

  // me: our owner key; since: unix seconds of our last visit (hearts for our lanterns after it are fetched)
  join(lake, me, since) {
    if (typeof WebSocket === 'undefined') return;
    this.leave();
    this.lake = lake; this.joinedAt = now(); this.status = 'connecting';
    const tag = TAG(lake);
    for (const url of RELAYS) {
      let ws;
      try { ws = new WebSocket(url); } catch { continue; }
      const sub = 'wl' + (++this.subN) + Date.now().toString(36);
      ws.onopen = () => {
        const filters = [{ kinds: [KIND_LANTERN], '#t': [tag], since: now() - TTL, limit: MAX_FETCH },
          { kinds: [KIND_HEART, KIND_WISH], '#t': [tag], since: now() }];
        if (me) filters.push({ kinds: [KIND_HEART], '#w': [me], since: Math.max(since || 0, now() - HEART_TTL), limit: 200 });
        ws.send(JSON.stringify(['REQ', sub, ...filters]));
      };
      ws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg[0] === 'EOSE' || msg[0] === 'EVENT') this.status = 'on';
        if (msg[0] === 'EVENT' && msg[1] === sub && msg[2]) this.receive(msg[2], lake);
      };
      ws.onerror = () => {};
      this.sockets.push(ws);
    }
  }

  leave() {
    for (const ws of this.sockets) { try { ws.close(); } catch {} }
    this.sockets = []; this.seen.clear();
  }

  receive(ev, lake) {
    if (lake !== this.lake || !ev || typeof ev.id !== 'string' || this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    if (ev.pubkey === this.pk) return;                       // our own come back from the relays
    const exp = (ev.tags || []).find((t) => t[0] === 'expiration');
    if (exp && +exp[1] < now()) return;
    if (ev.kind === KIND_WISH) {
      let d; try { d = JSON.parse(ev.content); } catch { return; }
      if (d && Number.isFinite(d.s) && typeof d.h === 'string' && d.h.length < 60) this.hooks.onWish && this.hooks.onWish(d.s, d.h);
      return;
    }
    if (ev.kind === KIND_HEART) {
      let d; try { d = JSON.parse(ev.content); } catch { return; }
      if (!d || typeof d.id !== 'string' || d.id.length > 80 || typeof d.h !== 'string' || this.hearts.has(d.h)) return;
      this.hearts.add(d.h);
      if (ev.created_at < this.joinedAt - 2) this.hooks.onAwayHeart && this.hooks.onAwayHeart(d.id, d.h);   // while we were away
      else this.hooks.onHeart(d.id, d.h);
      return;
    }
    if (ev.kind !== KIND_LANTERN) return;
    let d; try { d = JSON.parse(ev.content); } catch { return; }
    if (!d || typeof d.o !== 'string' || d.o.length > 40 || typeof d.k !== 'string' || d.k.length > 40) return;
    const fresh = ev.created_at >= this.joinedAt - 5;           // launched while we are here: it comes in from the shore
    this.hooks.onLantern({ netId: `${d.o}:${d.k}`, text: typeof d.t === 'string' ? d.t.slice(0, 30) : '',
      color: typeof d.c === 'string' ? d.c : 'amber', mode: d.m === 'sky' ? 'sky' : 'water' }, fresh);
  }

  async publish(ev) {
    const msg = JSON.stringify(['EVENT', ev]);
    this.seen.add(ev.id);
    for (const ws of this.sockets) {
      if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
      else if (ws.readyState === 0) ws.addEventListener('open', () => { try { ws.send(msg); } catch {} }, { once: true });
    }
  }

  async post(owner, l) {
    if (!this.lake) return;
    try {
      const ev = await this.sign(KIND_LANTERN,
        [['d', `wl:${owner}:${l.k}`], ['t', TAG(this.lake)], ['expiration', String(now() + TTL)]],
        JSON.stringify({ o: owner, k: l.k, t: l.t || '', c: l.c, m: l.m }));
      this.publish(ev);
    } catch {}
  }

  async heart(netId, h) {
    if (!this.lake) return;
    this.hearts.add(h);
    const owner = netId.includes(':') ? netId.split(':')[0] : null;
    const tags = [['t', TAG(this.lake)], ['expiration', String(now() + HEART_TTL)]];
    if (owner) tags.push(['w', owner]);
    try { this.publish(await this.sign(KIND_HEART, tags, JSON.stringify({ id: netId, h }))); } catch {}
  }

  async wish(slot, h) {
    if (!this.lake) return;
    try { this.publish(await this.sign(KIND_WISH, [['t', TAG(this.lake)]], JSON.stringify({ s: slot, h }))); } catch {}
  }
}
