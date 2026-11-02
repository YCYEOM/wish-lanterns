// Shared lake: one always-online room (connect()). Each player publishes their recent lanterns in
// their own player state; everyone spawns what they have not seen yet. Hearts are one-off sends.
// Net model: connect — one ongoing drop-in lake; start: on the title tap; late join: sees everyone's
// recent lanterns; alone: plays fine solo with the virtual lanterns.
// SDKs load lazily so the lake always runs, even where they cannot load.
import { GENEX } from './genex.config.js';

export const BUILD = 'lanterns-mp-4';

const hasSlug = !!(GENEX && GENEX.slug);
let embed = null, mp = null;
const sdkReady = hasSlug ? (async () => {
  try {
    embed = await import('@genex-ai/embed-sdk');
    embed.initEmbed({ slug: GENEX.slug, apiUrl: GENEX.apiUrl, dashboardOrigins: GENEX.dashboardOrigins });
    mp = await import('@genex-ai/multiplayer');
    return true;
  } catch (e) { console.warn('[wish-lanterns] sdk unavailable', e && e.message); return false; }
})() : Promise.resolve(false);

export class Net {
  constructor(hooks) {
    this.hooks = hooks; // { onLantern(entry, owner, fresh), onHeart(netId, fromName), onPresence(n), onStatus(text) }
    this.room = null;
    this.status = 'offline';
    this.lastCause = '-';
    this.lastError = '-';
    this.mine = [];          // [{k,t,c,m}] published in my player state
    this.seen = new Set();   // netIds already spawned
    this.known = new Set();  // player keys already sighted once
    this.intentionalLeave = false;
    this.rejoining = false;
    this.started = false;
    console.info('[wish-lanterns] build', BUILD);
  }

  get myKey() {
    const r = this.room; if (!r) return null;
    const p = r.players.get(r.id);
    return (p && (p.uid || p.id)) || r.id;
  }
  netIdFor(k) { return this.myKey ? `${this.myKey}:${k}` : null; }

  setMine(list) {
    this.mine = list.slice(-6).map(l => ({ k: l.id, t: l.text || '', c: l.color, m: l.mode }));
    this.publish();
  }
  publish() {
    if (this.room && this.status === 'online') {
      try { this.room.me.set({ v: 1, l: this.mine }); } catch (e) { this.lastError = String(e && e.message || e); }
    }
  }

  async start() {
    if (this.started) return; this.started = true;
    if (!hasSlug) { this.status = 'solo'; this.lastCause = 'no slug (local build)'; return; }
    if (!(await sdkReady)) { this.status = 'solo'; this.lastCause = 'sdk unavailable'; return; }
    await this.join();
  }

  async join() {
    this.status = 'connecting';
    try {
      const { user } = await embed.waitForPlayer();
      const room = await mp.connect({ urls: embed.getColyseusUrls(), room: GENEX.slug, name: user.name, auth: () => embed.getColyseusAuth() });
      this.wire(room);
      this.status = 'online'; this.lastCause = 'connected';
      this.publish();
    } catch (e) {
      this.status = 'solo'; this.lastCause = 'connect failed';
      this.lastError = String(e && e.message || e).slice(0, 80);
    }
  }

  wire(room) {
    this.room = room;
    room.on('reconnecting', () => { this.status = 'reconnecting'; this.lastCause = 'reconnecting'; });
    room.on('reconnected', () => { this.status = 'online'; this.lastCause = 'reconnected'; this.publish(); });
    room.on('disconnect', (code) => {
      this.room = null;
      if (code === 4409) { this.status = 'elsewhere'; this.lastCause = 'opened elsewhere'; this.hooks.onStatus('다른 탭에서 열려서 혼자 보기로 바뀌었어요'); return; }
      this.status = 'solo'; this.lastCause = 'disconnect ' + code;
      if (!this.intentionalLeave) this.rejoin();
    });
    room.on('heart', (payload) => {
      if (!payload || typeof payload.id !== 'string' || payload.id.length > 80) return;
      this.hooks.onHeart(payload.id);
    });
    room.on('join', (id) => { if (id !== room.id && this.hooks.onJoin) this.hooks.onJoin(); });
    // keepalive so late joiners always converge, without spamming the player lane
    clearInterval(this.keep); this.keep = setInterval(() => this.publish(), 3000);
  }

  async rejoin() {
    if (this.rejoining) return; this.rejoining = true;
    let delay = 1000;
    try {
      while (!this.intentionalLeave && !this.room) {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, 10000);
        await this.join();
      }
    } finally { this.rejoining = false; }
  }

  sendHeart(netId) {
    if (this.room && this.status === 'online') { try { this.room.send('heart', { id: netId }); } catch {} }
  }

  // called a few times per second: spawn any lantern we have not seen yet
  poll() {
    const r = this.room; if (!r) return;
    const players = r.players;
    let n = 0;
    for (const [id, p] of players) {
      if (p.connected !== false) n++;
      if (id === r.id) continue;
      const key = p.uid || p.id;
      const firstSight = !this.known.has(key);
      this.known.add(key);
      const raw = p.stateRaw;
      const list = raw && Array.isArray(raw.l) ? raw.l.slice(0, 6) : [];
      for (const e of list) {
        if (!e || typeof e.k !== 'string' || e.k.length > 40) continue;
        const netId = `${key}:${e.k}`;
        if (this.seen.has(netId)) continue;
        this.seen.add(netId);
        this.hooks.onLantern({ netId, text: typeof e.t === 'string' ? e.t : '', color: e.c, mode: e.m === 'sky' ? 'sky' : 'water' },
          String(p.name || '누군가').slice(0, 24), !firstSight);
      }
    }
    this.hooks.onPresence(Math.max(1, n));
  }

  statusLine() {
    const r = this.room;
    const seated = r ? r.players.size : 0, conn = r ? r.activePlayers.size : 0;
    const host = r ? (r.host === undefined ? 'pending' : (r.isHost ? 'me' : 'other')) : '-';
    return `${BUILD} · ${seated}/${conn} · ${this.status} · host ${host} · connect · ${this.lastCause} · ${this.lastError}`;
  }
}
