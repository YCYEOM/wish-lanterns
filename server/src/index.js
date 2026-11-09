// Wish Lanterns server: a Cloudflare Worker (free plan) with one Durable Object per lake.
//
//   GET /ws?lake=N&o=<owner>&s=<scarf>&since=<unix s>[&inv=1]   WebSocket into lake N
//   GET /health                                                 "ok"
//   GET /lakes   {lakes:[n1..n30], cap}   people in each lake (from the Lobby object, cached 10 s at the edge)
//   GET /online  {online: total}          the same, summed (for listings such as metatrip)
//   GET  /admin                     the moderation page (asks for the admin token)
//   GET  /admin/list                 every lake's lanterns with their reports, and the blocked writers  (Bearer ADMIN_TOKEN)
//   POST /admin/delete?lake=N&o=&k=  remove a lantern now (everyone on the lake drops it)
//   POST /admin/dismiss?lake=N&o=&k= clear a lantern's reports (it was fine)
//   POST /admin/ban?o=&days=7        hide a writer's new lanterns from others in every lake; /admin/unban?o= undoes it
// Reports: {t:'r', id:'owner:key'} from a player; 3 different reporters remove the lantern for everyone, and a
// writer with 3 lanterns removed that way is blocked for 7 days (their lanterns then reach only themselves).
//
// Wire protocol (JSON, short keys to keep messages small):
//   client -> server  {t:'p',x,z,cer,s}  {t:'l',k,tx,c,m}  {t:'h',id,h}  {t:'w',s,h}
//   (lantern text is tx: t is always the message type)
//   server -> client  {t:'hi',lake,id,n,lanterns,peers,away}  {t:'full',lake}
//                     {t:'j',id} {t:'x',id} {t:'n',n} {t:'p',id,x,z,cer,s}
//                     {t:'l',id,o,k,tx,c,m} {t:'h',id,h} {t:'w',s,h} {t:'e',id,k}
//   client -> server also {t:'e',k} (a gesture: wave/bow/jump/heart); 'p' carries sit (0/1)
import { DurableObject } from 'cloudflare:workers';
import { cleanMessage, COLORS as COLOR_LIST } from '../../src/data.js';

const LAKES = 30;
const CAP = 10;                         // people per lake before the auto-join moves a newcomer on
const LANTERN_TTL = 24 * 3600 * 1000;
const HEART_TTL = 7 * 24 * 3600 * 1000;
const LATEST = 30, LOVED = 20;          // a newcomer gets the newest lanterns and the day's most-hearted ones
const COLORS = new Set(COLOR_LIST.map((c) => c.id));
const GESTURES = new Set(['wave', 'bow', 'jump', 'heart']);
const REPORTS_TO_REMOVE = 3, STRIKES_TO_BAN = 3, BAN_DAYS = 7;
const REPORT_TTL = 7 * 24 * 3600 * 1000;

const cors = { 'Access-Control-Allow-Origin': '*' };
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok', { headers: cors });
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426, headers: cors });
      const lake = parseInt(url.searchParams.get('lake'), 10);
      if (!(lake >= 1 && lake <= LAKES)) return new Response('bad lake', { status: 400, headers: cors });
      return env.LAKE.get(env.LAKE.idFromName('lake-' + lake)).fetch(req);
    }
    if (url.pathname === '/lakes' || url.pathname === '/online') {
      // one cached answer per 10 s per data centre: lake rooms are never woken for this, the Lobby at most once
      const cache = caches.default, key = new Request('https://lobby.cache/lakes');
      let res = await cache.match(key), lakes;
      if (res) lakes = await res.json();
      else {
        try { lakes = await (await env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/get')).json(); }
        catch { lakes = Array(LAKES).fill(0); }
        ctx.waitUntil(cache.put(key, new Response(JSON.stringify(lakes), { headers: { 'Cache-Control': 'max-age=10', 'Content-Type': 'application/json' } })));
      }
      const body = url.pathname === '/online' ? { online: lakes.reduce((a, b) => a + b, 0) } : { lakes, cap: CAP };
      return new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' } });
    }
    if (url.pathname === '/admin') return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (url.pathname.startsWith('/admin/')) {
      if (!env.ADMIN_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return new Response('no', { status: 403 });
      const lakeObj = (n) => env.LAKE.get(env.LAKE.idFromName('lake-' + n));
      const all = (path) => Promise.all(Array.from({ length: LAKES }, (_, i) => lakeObj(i + 1).fetch(`https://lake${path}${path.includes('?') ? '&' : '?'}lake=${i + 1}`, { method: 'POST' }).then((r) => r.json()).catch(() => null)));
      const json = (d) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      const op = url.pathname.slice(7);
      if (op === 'list') return json((await all('/admin/list')).filter(Boolean));
      if (op === 'ban' || op === 'unban') {
        const o = str(url.searchParams.get('o'), 40); if (!o) return new Response('no owner', { status: 400 });
        await all(`/admin/${op}?o=${encodeURIComponent(o)}&days=${num(url.searchParams.get('days')) || BAN_DAYS}`);
        return json({ ok: true });
      }
      if ((op === 'delete' || op === 'dismiss') && req.method === 'POST') {
        const lake = parseInt(url.searchParams.get('lake'), 10);
        if (!(lake >= 1 && lake <= LAKES)) return new Response('bad lake', { status: 400 });
        return lakeObj(lake).fetch(req);
      }
      return new Response('unknown', { status: 404 });
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
    // moderation: who reported which lantern, how many of a writer's lanterns were taken down, who is blocked
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (id TEXT, by TEXT, at INTEGER, PRIMARY KEY (id, by))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS strikes (owner TEXT PRIMARY KEY, n INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bans (owner TEXT PRIMARY KEY, until INTEGER)`);
    this.lake = 0;
    this.rate = new Map();               // socket id -> { l: last lantern ms, h: hearts this minute, hm: minute }
  }

  async fetch(req) {
    const url = new URL(req.url);
    this.lake = parseInt(url.searchParams.get('lake'), 10) || this.lake;
    if (url.pathname.startsWith('/admin/')) return this.admin(url);
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
    for (const ws of others) { const a = ws.deserializeAttachment(); if (a && a.x !== null) peers.push({ id: a.id, x: a.x, z: a.z, s: a.s, sit: a.sit | 0, b: a.b | 0 }); }
    server.send(JSON.stringify({ t: 'hi', lake: this.lake, id, n: others.length + 1, lanterns, peers, away, now }));
    this.broadcast({ t: 'j', id, n: others.length + 1 }, server);
    this.report(others.length + 1);
    return new Response(null, { status: 101, webSocket: client });
  }

  prune(now) {
    this.sql.exec('DELETE FROM lanterns WHERE at < ?', now - LANTERN_TTL);
    this.sql.exec('DELETE FROM hearts WHERE at < ?', now - HEART_TTL);
    this.sql.exec('DELETE FROM reports WHERE at < ?', now - REPORT_TTL);
    this.sql.exec('DELETE FROM bans WHERE until < ?', now);
  }

  banned(owner) { return this.sql.exec('SELECT until FROM bans WHERE owner = ? AND until > ?', owner, Date.now()).toArray().length > 0; }

  // take a lantern off the lake for everyone: gone from the store, dropped from every screen here now
  remove(o, k, strike) {
    this.sql.exec('DELETE FROM lanterns WHERE o = ? AND k = ?', o, k);
    this.sql.exec('DELETE FROM reports WHERE id = ?', o + ':' + k);
    this.broadcast({ t: 'rm', id: o + ':' + k });
    if (!strike) return;
    this.sql.exec('INSERT INTO strikes (owner, n) VALUES (?, 1) ON CONFLICT(owner) DO UPDATE SET n = n + 1', o);
    const n = this.sql.exec('SELECT n FROM strikes WHERE owner = ?', o).one().n;
    if (n >= STRIKES_TO_BAN) this.sql.exec('INSERT OR REPLACE INTO bans (owner, until) VALUES (?, ?)', o, Date.now() + BAN_DAYS * 86400000);
  }

  admin(url) {
    const op = url.pathname.slice(7), o = str(url.searchParams.get('o'), 40), k = str(url.searchParams.get('k'), 40);
    const json = (d) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
    if (op === 'list') {
      this.prune(Date.now());
      const lanterns = this.sql.exec(`SELECT l.o, l.k, l.t AS tx, l.c, l.m, l.at, l.hearts, (SELECT COUNT(*) FROM reports r WHERE r.id = l.o || ':' || l.k) AS reports
        FROM lanterns l ORDER BY reports DESC, l.at DESC LIMIT 60`).toArray();
      const bans = this.sql.exec('SELECT owner, until FROM bans').toArray();
      if (!lanterns.length && !bans.length) return json(null);
      return json({ lake: this.lake, lanterns, bans, people: this.ctx.getWebSockets().length });
    }
    if (op === 'delete') { this.remove(o, k, false); return json({ ok: true }); }
    if (op === 'dismiss') { this.sql.exec('DELETE FROM reports WHERE id = ?', o + ':' + k); return json({ ok: true }); }
    if (op === 'ban') { this.sql.exec('INSERT OR REPLACE INTO bans (owner, until) VALUES (?, ?)', o, Date.now() + (num(url.searchParams.get('days')) || BAN_DAYS) * 86400000); return json({ ok: true }); }
    if (op === 'unban') { this.sql.exec('DELETE FROM bans WHERE owner = ?', o); this.sql.exec('DELETE FROM strikes WHERE owner = ?', o); return json({ ok: true }); }
    return new Response('unknown', { status: 404 });
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
        me.x = Math.round(x * 100) / 100; me.z = Math.round(z * 100) / 100; me.cer = cer; me.s = num(d.s) | 0; me.sit = d.sit ? 1 : 0; me.b = d.b ? 1 : 0;
        ws.serializeAttachment(me);
        this.broadcast({ t: 'p', id: me.id, x: me.x, z: me.z, cer, s: me.s, sit: me.sit, b: me.b }, ws);
        return;
      }
      case 'l': {                                    // a new lantern: kept a day, sent to everyone here now
        if (now - r.l < 4000) return;                // no flooding the lake
        r.l = now;
        const k = str(d.k, 40); if (!k) return;
        if (this.banned(me.o)) return;               // a blocked writer's lantern reaches only themselves
        const l = { o: me.o, k, tx: cleanMessage(str(d.tx, 40)), c: COLORS.has(d.c) ? d.c : 'amber', m: d.m === 'sky' ? 'sky' : 'water', at: now };
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
      case 'r': {                                    // a report: enough different people and the lantern goes
        const hr = Math.floor(now / 3600000); if (r.rh !== hr) { r.rh = hr; r.rn = 0; }
        if (++r.rn > 20) return;
        const id = str(d.id, 80), i = id.indexOf(':'); if (i < 1) return;
        const o = id.slice(0, i), k = id.slice(i + 1);
        if (o === me.o) return;                      // not your own
        this.sql.exec('INSERT OR IGNORE INTO reports (id, by, at) VALUES (?, ?, ?)', id, me.o, now);
        const n = this.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE id = ?', id).one().n;
        if (n >= REPORTS_TO_REMOVE) this.remove(o, k, true);
        return;
      }
      case 'e': {                                    // a little gesture, shown to everyone here
        if (now - (r.e || 0) < 700) return; r.e = now;
        if (!GESTURES.has(d.k)) return;
        this.broadcast({ t: 'e', id: me.id, k: d.k }, ws);
        return;
      }
      case 'n': {                                    // a singing stone rung: everyone here hears it (a few a second at most)
        const s = Math.floor(now / 1000); if (r.ns !== s) { r.ns = s; r.nn = 0; }
        if (++r.nn > 6 || !Number.isInteger(d.i) || d.i < 0 || d.i > 6) return;
        this.broadcast({ t: 'n', id: me.id, i: d.i }, ws);
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
    const n = this.ctx.getWebSockets().filter((w) => w !== ws && w.deserializeAttachment()?.id).length;
    this.broadcast({ t: 'x', id: me.id, n }, ws);
    this.report(n);
  }

  // tell the Lobby how many people are here now (one request on each arrival and departure)
  report(n) {
    if (!this.lake) return;
    const p = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')).fetch(`https://lobby/set?lake=${this.lake}&n=${n}`).catch(() => {});
    this.ctx.waitUntil ? this.ctx.waitUntil(p) : null;
  }
}

// the head count of every lake, kept by the lakes themselves (they report on each arrival and departure)
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS lakes (n INTEGER PRIMARY KEY, c INTEGER, at INTEGER)');
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/set') {
      const n = parseInt(url.searchParams.get('lake'), 10), c = Math.max(0, parseInt(url.searchParams.get('n'), 10) || 0);
      if (n >= 1 && n <= LAKES) this.sql.exec('INSERT OR REPLACE INTO lakes (n, c, at) VALUES (?, ?, ?)', n, c, Date.now());
      return new Response('ok');
    }
    const out = Array(LAKES).fill(0), stale = Date.now() - 6 * 3600 * 1000;   // a lake silent for 6 h is surely empty
    for (const r of this.sql.exec('SELECT n, c, at FROM lakes').toArray()) if (r.at > stale) out[r.n - 1] = r.c;
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  }
}

// the moderation page: paste the admin token once (kept in this browser), then see every lake's lanterns,
// reported ones first, and delete / clear / block
const ADMIN_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>소원 등불 · 관리</title><meta name="robots" content="noindex">
<style>
body{margin:0;background:#0b0e26;color:#f2e4cf;font:14px/1.5 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
header{position:sticky;top:0;background:#141838;padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #2c2f5a}
h1{font-size:17px;margin:0 12px 0 0}input{background:#0b0e26;border:1px solid #3a3d6a;color:#fff;border-radius:8px;padding:7px 10px;min-width:220px}
button{background:#2a2e62;border:1px solid #474b8a;color:#fff;border-radius:8px;padding:6px 11px;cursor:pointer;font:inherit}
button.del{background:#7a2a2a;border-color:#a44}button.ok{background:#245a3a;border-color:#3a8}button.ban{background:#5a3a14;border-color:#a73}
main{padding:12px 16px;max-width:980px}section{margin:14px 0;padding:12px;border:1px solid #2c2f5a;border-radius:12px;background:#11143a}
h2{font-size:15px;margin:0 0 8px}.row{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid #23264d;flex-wrap:wrap}
.row:first-of-type{border-top:none}.tx{flex:1;min-width:200px}.meta{color:#a99b86;font-size:12px}.rep{color:#ff8b8b;font-weight:700}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}.muted{color:#8f86a0}#msg{color:#ffd28a}
</style></head><body>
<header><h1>🏮 소원 등불 관리</h1><input id="tok" type="password" placeholder="관리자 토큰"><button id="save">저장</button><button id="reload">새로고침</button><span id="msg"></span></header>
<main id="out"><p class="muted">관리자 토큰을 넣고 저장을 누르세요.</p></main>
<script>
const $=(i)=>document.getElementById(i);const C={amber:'#ffa24a',rose:'#f0809c',sky:'#5fa6ee',mint:'#92d65c',lilac:'#a66cf2'};
$('tok').value=localStorage.getItem('wlAdmin')||'';
$('save').onclick=()=>{localStorage.setItem('wlAdmin',$('tok').value.trim());load()};$('reload').onclick=load;
const api=(p,m='GET')=>fetch(p,{method:m,headers:{Authorization:'Bearer '+localStorage.getItem('wlAdmin')}});
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ago=(t)=>{const m=Math.round((Date.now()-t)/60000);return m<60?m+'분 전':Math.round(m/60)+'시간 전'};
async function act(p,ask){if(ask&&!confirm(ask))return;const r=await api(p,'POST');$('msg').textContent=r.ok?'완료':'실패 '+r.status;load()}
async function load(){
  if(!localStorage.getItem('wlAdmin'))return;$('msg').textContent='불러오는 중…';
  const r=await api('/admin/list');if(!r.ok){$('msg').textContent=r.status===403?'토큰이 맞지 않아요':'오류 '+r.status;return}
  const lakes=await r.json();$('msg').textContent='';
  const reported=lakes.flatMap(l=>l.lanterns.filter(x=>x.reports>0).map(x=>({...x,lake:l.lake})));
  const bans=[...new Map(lakes.flatMap(l=>l.bans).map(b=>[b.owner,b])).values()];
  const row=(x,lake)=>'<div class="row"><span class="dot" style="background:'+(C[x.c]||'#ccc')+'"></span><span class="tx">'+(x.tx?'「'+esc(x.tx)+'」':'<span class="muted">(말없이 띄운 등불)</span>')+
    '<div class="meta">호수 '+lake+' · '+ago(x.at)+' · '+(x.m==='sky'?'하늘':'물')+' · ♡'+x.hearts+' · 작성자 '+esc(x.o.slice(0,8))+'</div></span>'+
    (x.reports?'<span class="rep">신고 '+x.reports+'</span><button class="ok" onclick="act(\\'/admin/dismiss?lake='+lake+'&o='+encodeURIComponent(x.o)+'&k='+encodeURIComponent(x.k)+'\\')">문제없음</button>':'')+
    '<button class="del" onclick="act(\\'/admin/delete?lake='+lake+'&o='+encodeURIComponent(x.o)+'&k='+encodeURIComponent(x.k)+'\\',\\'이 등불을 지울까요?\\')">삭제</button>'+
    '<button class="ban" onclick="act(\\'/admin/ban?o='+encodeURIComponent(x.o)+'&days=7\\',\\'이 작성자의 새 등불을 7일 동안 다른 사람에게 보이지 않게 할까요?\\')">작성자 차단</button></div>';
  let h='<section><h2>🚩 신고된 등불 ('+reported.length+')</h2>'+(reported.length?reported.map(x=>row(x,x.lake)).join(''):'<p class="muted">신고된 등불이 없어요.</p>')+'</section>';
  h+='<section><h2>⛔ 차단된 작성자 ('+bans.length+')</h2>'+(bans.length?bans.map(b=>'<div class="row"><span class="tx">'+esc(b.owner)+'<div class="meta">'+new Date(b.until).toLocaleString('ko-KR')+'까지</div></span><button onclick="act(\\'/admin/unban?o='+encodeURIComponent(b.owner)+'\\')">차단 해제</button></div>').join(''):'<p class="muted">없어요.</p>')+'</section>';
  for(const l of lakes){if(!l.lanterns.length)continue;h+='<section><h2>🌙 호수 '+l.lake+' · 지금 '+l.people+'명 · 오늘 등불 '+l.lanterns.length+'</h2>'+l.lanterns.map(x=>row(x,l.lake)).join('')+'</section>'}
  $('out').innerHTML=h;
}
load();
</script></body></html>`;
