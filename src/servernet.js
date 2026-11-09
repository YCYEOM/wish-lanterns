// Shared lake through our own server (server/, one Cloudflare Durable Object per lake). Same face as
// net.js (Net), so main.js uses either: walkers, lanterns, hearts and wishes go through one WebSocket,
// and the server also remembers the day's lanterns and the week's hearts (what board.js does on relays).
// If the server cannot be reached at the start (not deployed, free quota used up, blocked network),
// start() reports it through hooks.onFallback() and main.js switches to the serverless path.
import { ownerKey, invitedLake, LAKE_COUNT } from './net.js';

export const BUILD = 'lanterns-server-1';
const CONNECT_MS = 5000;
const POS_MS = 400;              // at most one position every 0.4 s (each incoming message counts on the free plan)

export class ServerNet {
  constructor(hooks, url) {
    this.hooks = hooks;          // Net's hooks, plus onAwayHeart(netId, h) and onFallback()
    this.url = url;
    this.owner = ownerKey();
    this.lake = null; this.n = 1; this.id = null;
    this.status = 'offline'; this.lastCause = '-'; this.lastError = '-';
    this.ws = null; this.everOn = false; this.started = false;
    this.ids = new Set();
    this.mine = [];
    this.retry = 0;
    this.scarf = 0;
    this.since = 0;
    console.info('[wish-lanterns] build', BUILD);
  }

  get myKey() { return this.owner; }
  get peers() { return Math.max(0, this.n - 1); }
  netIdFor(k) { return `${this.owner}:${k}`; }
  setMine(list) { this.mine = list.slice(-6); }

  async start() {
    if (this.started) return; this.started = true;
    this.status = 'connecting';
    const inv = invitedLake();
    if (inv) { if (!(await this.connect(inv, true))) this.fallback(); return; }
    for (let n = 1; n <= LAKE_COUNT; n++) {
      const r = await this.connect(n, false);
      if (r === 'full') { this.lastCause = `lake ${n} full`; continue; }
      if (!r) this.fallback();
      return;
    }
    if (!(await this.connect(LAKE_COUNT, true))) this.fallback();
  }

  fallback() {
    this.status = 'solo'; this.lastCause = 'server unreachable';
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null; this.dead = true;
    this.hooks.onFallback && this.hooks.onFallback();
  }

  // resolves true when the lake welcomed us, 'full' when it sent us on, false on failure
  connect(n, invited) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const q = new URLSearchParams({ lake: String(n), o: this.owner, s: String(this.scarf), since: String(this.since | 0) });
      if (invited) q.set('inv', '1');
      let ws;
      try { ws = new WebSocket(`${this.url}?${q}`); } catch (e) { this.lastError = String(e.message || e).slice(0, 80); finish(false); return; }
      const timer = setTimeout(() => { try { ws.close(); } catch {} finish(false); }, CONNECT_MS);
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(m.data); } catch { return; }
        if (d.t === 'full') { finish('full'); return; }
        if (d.t === 'hi') { this.ws = ws; this.welcome(d, invited); finish(true); return; }
        if (ws === this.ws) this.receive(d);
      };
      ws.onerror = () => { this.lastError = 'socket error'; };
      ws.onclose = () => {
        finish(false);
        if (ws !== this.ws || this.dead) return;
        // dropped mid-visit: the others vanish, then we come back to the same lake
        this.ws = null; this.status = 'reconnecting';
        for (const id of this.ids) this.hooks.onLeave && this.hooks.onLeave(id);
        this.ids.clear(); this.n = 1; this.hooks.onPresence(1);
        const wait = Math.min(30000, 1500 * 2 ** this.retry++);
        setTimeout(async () => { if (!this.dead && !this.ws && !(await this.connect(this.lake, true))) this.lastCause = 'retrying'; }, wait);
      };
    });
  }

  welcome(d, invited) {
    const sameLake = this.lake === d.lake;
    this.lake = d.lake; this.id = d.id; this.n = d.n | 0 || 1; this.retry = 0;
    this.status = 'online'; this.lastCause = invited ? 'invited' : 'settled'; this.everOn = true;
    this.since = Math.floor(Date.now() / 1000);
    if (!sameLake) this.hooks.onLake && this.hooks.onLake(d.lake);
    this.hooks.onPresence(this.n);
    this.lastPos = null;
    for (const p of d.peers || []) { this.ids.add(p.id); this.hooks.onPos && this.hooks.onPos(p.id, { x: p.x, z: p.z, cer: null, s: p.s | 0, sit: !!p.sit }); }
    for (const l of (d.lanterns || []).slice().reverse()) {
      if (!l || l.o === this.owner) continue;
      this.hooks.onLantern({ netId: `${l.o}:${l.k}`, text: l.tx || '', color: l.c, mode: l.m === 'sky' ? 'sky' : 'water', hearts: l.hearts | 0 }, '', false);
    }
    for (const a of d.away || []) this.hooks.onAwayHeart && this.hooks.onAwayHeart(a.id, a.h);
  }

  receive(d) {
    switch (d.t) {
      case 'j':
        this.ids.add(d.id); this.n = d.n | 0 || this.n + 1; this.hooks.onPresence(this.n);
        this.lastPos = null;              // the newcomer needs to see where we stand
        setTimeout(() => { if (this.ids.has(d.id)) this.hooks.onJoin && this.hooks.onJoin(); }, 4000);
        break;
      case 'x':
        this.ids.delete(d.id); this.n = Math.max(1, d.n | 0); this.hooks.onPresence(this.n);
        this.hooks.onLeave && this.hooks.onLeave(d.id);
        break;
      case 'p':
        if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) return;
        this.ids.add(d.id);
        this.hooks.onPos && this.hooks.onPos(d.id, { x: d.x, z: d.z, cer: d.cer === 'water' || d.cer === 'sky' ? d.cer : null, s: d.s | 0, sit: !!d.sit });
        break;
      case 'l':
        if (typeof d.o !== 'string' || typeof d.k !== 'string' || d.o === this.owner) return;
        this.hooks.onLantern({ netId: `${d.o}:${d.k}`, text: d.tx || '', color: d.c, mode: d.m === 'sky' ? 'sky' : 'water' }, '', true, d.id);
        break;
      case 'h': if (typeof d.id === 'string') this.hooks.onHeart(d.id, typeof d.h === 'string' ? d.h : null); break;
      case 'n': if (Number.isInteger(d.i)) this.hooks.onNote && this.hooks.onNote(d.id, d.i); break;
      case 'rm': if (typeof d.id === 'string') this.hooks.onRemove && this.hooks.onRemove(d.id); break;
      case 'e': if (typeof d.id === 'string' && typeof d.k === 'string') this.hooks.onEmote && this.hooks.onEmote(d.id, d.k); break;
      case 'w': if (Number.isFinite(d.s) && typeof d.h === 'string') this.hooks.onWish && this.hooks.onWish(d.s, d.h); break;
    }
  }

  send(o) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(o)); } catch {} } }
  post(l) { this.send({ t: 'l', k: l.k, tx: l.t || '', c: l.c, m: l.m }); }
  sendHeart(netId, h) { this.send({ t: 'h', id: netId, h }); }        // kept for an owner who is away, so sent even when alone
  sendWish(slot, h) { if (this.n > 1) this.send({ t: 'w', s: slot, h }); }
  poll() {}

  sendNote(i) { if (this.n > 1) this.send({ t: 'n', i }); }
  report(netId) { this.send({ t: 'r', id: netId }); return true; }
  sendEmote(k) { if (this.n > 1) this.send({ t: 'e', k }); }
  sendPos(x, z, cer, scarf, sit = false) {
    this.scarf = scarf | 0;
    if (!this.ws || this.n < 2) return;
    const t = Date.now(), L = this.lastPos;
    if (L && L.sit !== !!sit) { this.lastPos = { x, z, t, sit: !!sit }; this.send({ t: 'p', x: +x.toFixed(2), z: +z.toFixed(2), cer: cer || 0, s: this.scarf, sit: sit ? 1 : 0 }); return; }
    // the server keeps where everyone last stood (newcomers get it on joining), so standing still needs only
    // a rare refresh; while walking ~2.5 a second is plenty, the others' characters walk smoothly to each point
    if (L && !cer && Math.hypot(x - L.x, z - L.z) < 0.25 && t - L.t < 15000) return;
    if (L && !cer && t - L.t < POS_MS) return;
    this.lastPos = { x, z, t, sit: !!sit };
    this.send({ t: 'p', x: +x.toFixed(2), z: +z.toFixed(2), cer: cer || 0, s: this.scarf, sit: sit ? 1 : 0 });
  }

  // the head count of every lake, for the lake chooser (null if the server cannot say)
  async lakeCounts() {
    try {
      const u = new URL(this.url); u.protocol = u.protocol === 'ws:' ? 'http:' : 'https:'; u.pathname = '/lakes';
      const r = await fetch(u.toString(), { cache: 'no-store' }); if (!r.ok) return null;
      const d = await r.json(); return Array.isArray(d.lakes) ? d : null;
    } catch { return null; }
  }
  // go to another lake by choice: leave this one quietly and join that one (full or not)
  async switchLake(n) {
    if (!this.started || this.dead || n === this.lake) return false;
    const old = this.ws; this.ws = null;
    for (const id of this.ids) this.hooks.onLeave && this.hooks.onLeave(id);
    this.ids.clear(); this.n = 1;
    try { old && old.close(); } catch {}
    const ok = await this.connect(n, true);
    if (!ok) { this.lastCause = 'switch failed'; if (this.lake) await this.connect(this.lake, true); }
    return !!ok;
  }
  inviteUrl() {
    const u = new URL(location.href);
    const keep = new URLSearchParams(u.search).get('server');
    u.search = ''; u.hash = '';
    u.searchParams.set('lake', String(this.lake || 1));
    if (keep) u.searchParams.set('server', keep);
    return u.toString();
  }

  statusLine() { return `${BUILD} · lake ${this.lake || '-'} · people ${this.n} · ${this.status} · ${this.lastCause} · ${this.lastError}`; }
}
