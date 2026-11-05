// Wish Lanterns server: a Cloudflare Worker (free plan) with one Durable Object per lake.
//
//   GET /ws?lake=N&o=<owner>&s=<scarf>&since=<unix s>[&inv=1]   WebSocket into lake N
//   GET /health                                                 "ok"
//   POST /admin/delete?lake=N&o=<owner>&k=<key>  (Bearer ADMIN_TOKEN secret)   remove a lantern
//
// Wire protocol (JSON, short keys to keep messages small):
//   client -> server  {t:'p',x,z,cer,s}  {t:'l',k,tx,c,m}  {t:'h',id,h}  {t:'w',s,h}
//   (lantern text is tx: t is always the message type)
//   server -> client  {t:'hi',lake,id,n,lanterns,peers,away}  {t:'full',lake}
//                     {t:'j',id} {t:'x',id} {t:'n',n} {t:'p',id,x,z,cer,s}
//                     {t:'l',id,o,k,tx,c,m} {t:'h',id,h} {t:'w',s,h}
import { DurableObject } from 'cloudflare:workers';
import { cleanMessage, COLORS as COLOR_LIST } from '../../src/data.js';

const LAKES = 30;
const CAP = 10;                         // people per lake before the auto-join moves a newcomer on
const LANTERN_TTL = 24 * 3600 * 1000;
const HEART_TTL = 7 * 24 * 3600 * 1000;
const LATEST = 30, LOVED = 20;          // a newcomer gets the newest lanterns and the day's most-hearted ones
const COLORS = new Set(COLOR_LIST.map((c) => c.id));

const cors = { 'Access-Control-Allow-Origin': '*' };
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok', { headers: cors });
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426, headers: cors });
      const lake = parseInt(url.searchParams.get('lake'), 10);
      if (!(lake >= 1 && lake <= LAKES)) return new Response('bad lake', { status: 400, headers: cors });
      return env.LAKE.get(env.LAKE.idFromName('lake-' + lake)).fetch(req);
    }
    if (url.pathname === '/admin/delete' && req.method === 'POST') {
      if (!env.ADMIN_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return new Response('no', { status: 403 });
      const lake = parseInt(url.searchParams.get('lake'), 10);
      if (!(lake >= 1 && lake <= LAKES)) return new Response('bad lake', { status: 400 });
      return env.LAKE.get(env.LAKE.idFromName('lake-' + lake)).fetch(req);
    }
    return new Response('not found', { status: 404, headers: cors });
  },
};

export class Lake extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hearts (h TEXT PRIMARY KEY, owner TEXT, id TEXT, at INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lanterns (o TEXT, k TEXT, t TEXT, c TEXT, m TEXT, at INTEGER, hearts INTEGER DEFAULT 0, PRIMARY KEY (o, k))`);
    // indexes so a join reads only the rows it sends (rows read are what the free plan counts), and pruning
    // touches only the rows it deletes
    this.sql.exec(`CREATE INDEX IF NOT EXISTS lanterns_at ON lanterns (at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS lanterns_hearts ON lanterns (hearts)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hearts_at ON hearts (at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS hearts_owner ON hearts (owner, at)`);
    this.lake = 0;
    this.rate = new Map();               // socket id -> { l: last lantern ms, h: hearts this minute, hm: minute }
  }

  async fetch(req) {
    const url = new URL(req.url);
    this.lake = parseInt(url.searchParams.get('lake'), 10) || this.lake;
    if (url.pathname === '/admin/delete') {
      this.sql.exec('DELETE FROM lanterns WHERE o = ? AND k = ?', str(url.searchParams.get('o'), 40), str(url.searchParams.get('k'), 40));
      return new Response('deleted');
    }
    const now = Date.now();
    const owner = str(url.searchParams.get('o'), 40) || 'anon';
    const invited = url.searchParams.get('inv') === '1';
    const others = this.ctx.getWebSockets();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if (!invited && others.length >= CAP) {           // full: tell the client to try the next lake
      server.send(JSON.stringify({ t: 'full', lake: this.lake }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID().slice(0, 12);
    const me = { id, o: owner, s: num(url.searchParams.get('s')) | 0, x: null, z: null, cer: 0 };
    server.serializeAttachment(me);

    this.prune(now);
    const cols = 'SELECT o, k, t AS tx, c, m, at, hearts FROM lanterns';
    const latest = this.sql.exec(`${cols} ORDER BY at DESC LIMIT ?`, LATEST).toArray();
    const loved = this.sql.exec(`${cols} WHERE hearts > 0 ORDER BY hearts DESC LIMIT ?`, LOVED).toArray();
    const seen = new Set(latest.map((l) => l.o + ':' + l.k));
    const lanterns = latest.concat(loved.filter((l) => !seen.has(l.o + ':' + l.k)));
    const since = Math.max(num(url.searchParams.get('since')) * 1000, now - HEART_TTL);
    const away = this.sql.exec('SELECT id, h FROM hearts WHERE owner = ? AND at > ? LIMIT 200', owner, since).toArray();
    const peers = [];
    for (const ws of others) { const a = ws.deserializeAttachment(); if (a && a.x !== null) peers.push({ id: a.id, x: a.x, z: a.z, s: a.s }); }
    server.send(JSON.stringify({ t: 'hi', lake: this.lake, id, n: others.length + 1, lanterns, peers, away, now }));
    this.broadcast({ t: 'j', id, n: others.length + 1 }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  prune(now) {
    this.sql.exec('DELETE FROM lanterns WHERE at < ?', now - LANTERN_TTL);
    this.sql.exec('DELETE FROM hearts WHERE at < ?', now - HEART_TTL);
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { if (ws !== except) { try { ws.send(s); } catch {} } }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 600) return;
    let d; try { d = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    if (!me || !d) return;
    const now = Date.now();
    let r = this.rate.get(me.id); if (!r) { r = { l: 0, h: 0, hm: 0, w: 0 }; this.rate.set(me.id, r); }
    switch (d.t) {
      case 'p': {                                    // where someone stands, and whether they kneel / lift a lantern
        const x = num(d.x), z = num(d.z);
        if (Math.abs(x) > 400 || Math.abs(z) > 400) return;
        const cer = d.cer === 'water' || d.cer === 'sky' ? d.cer : 0;
        me.x = Math.round(x * 100) / 100; me.z = Math.round(z * 100) / 100; me.cer = cer; me.s = num(d.s) | 0;
        ws.serializeAttachment(me);
        this.broadcast({ t: 'p', id: me.id, x: me.x, z: me.z, cer, s: me.s }, ws);
        return;
      }
      case 'l': {                                    // a new lantern: kept a day, sent to everyone here now
        if (now - r.l < 4000) return;                // no flooding the lake
        r.l = now;
        const k = str(d.k, 40); if (!k) return;
        const l = { o: me.o, k, tx: cleanMessage(str(d.tx, 30)), c: COLORS.has(d.c) ? d.c : 'amber', m: d.m === 'sky' ? 'sky' : 'water', at: now };
        this.sql.exec('INSERT OR REPLACE INTO lanterns (o, k, t, c, m, at) VALUES (?, ?, ?, ?, ?, ?)', l.o, l.k, l.tx, l.c, l.m, l.at);
        this.broadcast({ t: 'l', id: me.id, ...l }, ws);
        return;
      }
      case 'h': {                                    // a heart: relayed now, kept a week for an owner who is away
        const m = Math.floor(now / 60000); if (r.hm !== m) { r.hm = m; r.h = 0; }
        if (++r.h > 30) return;
        const id = str(d.id, 80), h = str(d.h, 60); if (!id || !h) return;
        const owner = id.includes(':') ? id.split(':')[0] : '';
        if (owner) {
          const fresh = this.sql.exec('INSERT OR IGNORE INTO hearts (h, owner, id, at) VALUES (?, ?, ?, ?)', h, owner, id, now).rowsWritten > 0;
          if (fresh) this.sql.exec('UPDATE lanterns SET hearts = hearts + 1 WHERE o = ? AND k = ?', owner, id.slice(owner.length + 1));
        }
        this.broadcast({ t: 'h', id, h }, ws);
        return;
      }
      case 'w': {                                    // a wish on a shared shooting star
        if (now - r.w < 3000) return; r.w = now;
        const h = str(d.h, 60); if (!h || !Number.isFinite(d.s)) return;
        this.broadcast({ t: 'w', s: d.s, h }, ws);
        return;
      }
    }
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const me = ws.deserializeAttachment();
    try { ws.close(1000, 'bye'); } catch {}
    if (!me || !me.id) return;
    this.rate.delete(me.id);
    const n = this.ctx.getWebSockets().filter((w) => w !== ws).length;
    this.broadcast({ t: 'x', id: me.id, n }, ws);
  }
}
