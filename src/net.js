// Shared lake over serverless WebRTC (Trystero, Nostr signalling): works from any static host such as
// GitHub Pages, with no server or account. Everyone who opens the game joins one room ("lake").
// Each player sends their recent lanterns to every peer that joins, and broadcasts new ones as they
// launch; hearts are one-off messages. Nothing persists beyond the people currently on the lake.
// The library loads lazily so the lake always runs solo if it cannot load or connect.

export const BUILD = 'lanterns-p2p-1';
const APP_ID = 'ycyeom-wish-lanterns-v1';
const ROOM = 'lake';

function ownerKey() { // stable per browser, so a reload does not duplicate your lanterns for others
  try {
    let k = localStorage.getItem('wishLanterns.owner');
    if (!k) { const a = new Uint32Array(2); crypto.getRandomValues(a); k = 'o' + a[0].toString(36) + a[1].toString(36); localStorage.setItem('wishLanterns.owner', k); }
    return k;
  } catch { return 'o' + Date.now().toString(36); }
}

export class Net {
  constructor(hooks) {
    this.hooks = hooks; // { onLantern(entry, who, fresh), onHeart(netId), onPresence(n), onJoin(), onStatus(text) }
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
      const { joinRoom } = await import('trystero');
      const room = this.room = joinRoom({ appId: APP_ID }, ROOM, {
        onJoinError: (d) => { this.lastError = String(d && (d.error || d.message) || 'join error').slice(0, 80); },
      });
      this.sendLanterns = room.makeAction('lanterns');
      this.sendHeartAction = room.makeAction('heart');
      this.sendLanterns.onMessage = (data, meta) => this.receiveLanterns(data, meta && meta.peerId);
      this.sendHeartAction.onMessage = (data) => {
        if (!data || typeof data.id !== 'string' || data.id.length > 80) return;
        this.hooks.onHeart(data.id);
      };
      room.onPeerJoin = (peerId) => {
        this.refreshPeers();
        try { this.sendLanterns.send({ o: this.owner, l: this.mine }, { target: peerId }); } catch {}
        this.hooks.onJoin && this.hooks.onJoin();
        this.lastCause = 'peer joined';
      };
      room.onPeerLeave = () => { this.refreshPeers(); this.lastCause = 'peer left'; };
      this.status = 'online'; this.lastCause = 'joined room';
      this.refreshPeers();
    } catch (e) {
      this.status = 'solo'; this.lastCause = 'p2p unavailable';
      this.lastError = String(e && e.message || e).slice(0, 80);
    }
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
    return `${BUILD} · peers ${this.peers} · ${this.status} · ${this.lastCause} · ${this.lastError}`;
  }
}
