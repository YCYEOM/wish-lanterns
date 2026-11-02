// Shared lake over serverless WebRTC (Trystero, Nostr signalling): works from any static host such as
// GitHub Pages, with no server or account. Players are spread over small "lakes" (rooms lake-1..N):
// a newcomer tries lake 1, listens for a few seconds, and moves on if it already holds LAKE_CAP people.
// A ?lake=N link (the invite button) joins that lake directly, full or not.
// Each player sends their recent lanterns to every peer that joins, and broadcasts new ones as they
// launch; hearts are one-off messages. Nothing persists beyond the people currently on the lake.
// The library loads lazily so the lake always runs solo if it cannot load or connect.

export const BUILD = 'lanterns-p2p-2';
const APP_ID = 'ycyeom-wish-lanterns-v1';
// people per lake before newcomers are sent to the next one (?lakecap=N overrides it, for testing overflow)
export const LAKE_CAP = (() => { try { const n = parseInt(new URLSearchParams(location.search).get('lakecap'), 10); return n >= 1 ? n : 10; } catch { return 10; } })();
export const LAKE_COUNT = 30;
const SETTLE_MS = 6000;          // how long a newcomer listens before deciding a lake is full

export function invitedLake() {
  try {
    const n = parseInt(new URLSearchParams(location.search).get('lake'), 10);
    return n >= 1 && n <= LAKE_COUNT ? n : null;
  } catch { return null; }
}

function ownerKey() { // stable per browser, so a reload does not duplicate your lanterns for others
  try {
    let k = localStorage.getItem('wishLanterns.owner');
    if (!k) { const a = new Uint32Array(2); crypto.getRandomValues(a); k = 'o' + a[0].toString(36) + a[1].toString(36); localStorage.setItem('wishLanterns.owner', k); }
    return k;
  } catch { return 'o' + Date.now().toString(36); }
}

export class Net {
  constructor(hooks) {
    this.hooks = hooks; // { onLantern(entry, who, fresh), onHeart(netId), onPresence(n), onJoin(), onLake(n), onStatus(text) }
    this.lake = null;
    this.room = null;
    this.status = 'offline';
    this.lastCause = '-';
    this.lastError = '-';
    this.mine = [];
    this.seen = new Set();
    this.known = new Set();
    this.peers = 0;
    this.started = false;
    this.owner = ownerKey();
    console.info('[wish-lanterns] build', BUILD);
  }

  get myKey() { return this.owner; }
  netIdFor(k) { return `${this.owner}:${k}`; }

  setMine(list) {
    this.mine = list.slice(-6).map(l => ({ k: l.id, t: l.text || '', c: l.color, m: l.mode }));
    if (this.sendLanterns && this.peers > 0) {
      try { this.sendLanterns.send({ o: this.owner, l: this.mine }); } catch (e) { this.lastError = String(e && e.message || e).slice(0, 80); }
    }
  }

  async start() {
    if (this.started) return; this.started = true;
    this.status = 'connecting';
    try {
      this.joinRoom = (await import('trystero')).joinRoom;
    } catch (e) {
      this.status = 'solo'; this.lastCause = 'p2p unavailable';
      this.lastError = String(e && e.message || e).slice(0, 80);
      return;
    }
    const invited = invitedLake();
    if (invited) { this.joinLake(invited); this.lastCause = 'invited'; return; }
    // auto: fill lakes in order so people actually meet, skipping ones already at capacity
    for (let n = 1; n <= LAKE_COUNT; n++) {
      this.joinLake(n);
      await new Promise(r => setTimeout(r, SETTLE_MS));
      this.refreshPeers();
      if (this.peers + 1 <= LAKE_CAP || n === LAKE_COUNT) { this.lastCause = 'settled'; return; }
      this.lastCause = `lake ${n} full`;
    }
  }

  joinLake(n) {
    if (this.room) { try { this.room.leave(); } catch {} this.room = null; }
    this.seen.clear(); this.known.clear(); this.peers = 0;
    this.lake = n;
    this.hooks.onLake && this.hooks.onLake(n);
    try {
      const room = this.room = this.joinRoom({ appId: APP_ID }, `lake-${n}`, {
        onJoinError: (d) => { this.lastError = String(d && (d.error || d.message) || 'join error').slice(0, 80); },
      });
      this.sendLanterns = room.makeAction('lanterns');
      this.sendHeartAction = room.makeAction('heart');
      this.sendLanterns.onMessage = (data, meta) => { if (room === this.room) this.receiveLanterns(data, meta && meta.peerId); };
      this.sendHeartAction.onMessage = (data) => {
        if (room !== this.room || !data || typeof data.id !== 'string' || data.id.length > 80) return;
        this.hooks.onHeart(data.id);
      };
      room.onPeerJoin = (peerId) => {
        if (room !== this.room) return;
        this.refreshPeers();
        try { this.sendLanterns.send({ o: this.owner, l: this.mine }, { target: peerId }); } catch {}
        // greet only people who stay (a newcomer passing through a full lake leaves within seconds)
        setTimeout(() => {
          try { if (room === this.room && this.room.getPeers()[peerId]) this.hooks.onJoin && this.hooks.onJoin(); } catch {}
        }, SETTLE_MS + 2000);
        this.lastCause = 'peer joined';
      };
      room.onPeerLeave = () => { if (room === this.room) { this.refreshPeers(); this.lastCause = 'peer left'; } };
      this.status = 'online';
      this.refreshPeers();
    } catch (e) {
      this.status = 'solo'; this.lastCause = 'join failed';
      this.lastError = String(e && e.message || e).slice(0, 80);
    }
  }

  inviteUrl() {
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('lake', String(this.lake || 1));
    return u.toString();
  }

  refreshPeers() {
    try { this.peers = Object.keys(this.room.getPeers() || {}).length; } catch { this.peers = 0; }
    this.hooks.onPresence(this.peers + 1);
  }

  receiveLanterns(data, peerId) {
    if (!data || typeof data.o !== 'string' || data.o.length > 40 || data.o === this.owner) return;
    const key = data.o;
    const firstSight = !this.known.has(key);
    this.known.add(key);
    const list = Array.isArray(data.l) ? data.l.slice(0, 6) : [];
    for (const e of list) {
      if (!e || typeof e.k !== 'string' || e.k.length > 40) continue;
      const netId = `${key}:${e.k}`;
      if (this.seen.has(netId)) continue;
      this.seen.add(netId);
      this.hooks.onLantern({ netId, text: typeof e.t === 'string' ? e.t.slice(0, 30) : '', color: e.c, mode: e.m === 'sky' ? 'sky' : 'water' }, '', !firstSight);
    }
  }

  sendHeart(netId) {
    if (this.sendHeartAction && this.peers > 0) { try { this.sendHeartAction.send({ id: netId }); } catch {} }
  }

  poll() { if (this.room) this.refreshPeers(); }

  statusLine() {
    return `${BUILD} · lake ${this.lake || '-'} · peers ${this.peers} · ${this.status} · ${this.lastCause} · ${this.lastError}`;
  }
}
