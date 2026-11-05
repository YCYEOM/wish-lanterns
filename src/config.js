// Where the shared-lake server lives (server/, a Cloudflare Worker). Empty: no server, the lake uses
// serverless P2P (net.js) and public relays (board.js) as before.
// ?server=<url> overrides it (local testing: ?server=http://localhost:8787); ?p2p forces the serverless path.
const DEFAULT_SERVER = 'https://wish-lanterns.ycyeom.workers.dev';

export function serverUrl() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('p2p')) return '';
    const s = q.get('server') || DEFAULT_SERVER;
    if (!s) return '';
    const u = new URL(s, location.href);
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
    u.pathname = '/ws'; u.search = ''; u.hash = '';
    return u.toString();
  } catch { return ''; }
}
