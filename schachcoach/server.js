// SchachCoach – lokaler Server
// Liefert die Web-App aus, holt Partien von Chess.com/Lichess, analysiert im Hintergrund und speichert alles in ./data
import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDb } from './server/db.js';
import { createSync } from './server/sync.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const UA = 'SchachCoach/1.0 (private self-hosted chess review)';
const db = createDb(path.join(ROOT, 'data'));
const sync = createSync({ db, root: ROOT });

const STATIC = [
  ['/vendor/chess.js', 'node_modules/chess.js/dist/esm/chess.js'],
  ['/vendor/chessground.js', 'node_modules/chessground/dist/chessground.min.js'],
  ['/vendor/chessground.base.css', 'node_modules/chessground/assets/chessground.base.css'],
  ['/vendor/chessground.cburnett.css', 'node_modules/chessground/assets/chessground.cburnett.css'],
  ['/vendor/chessground.brown.css', 'node_modules/chessground/assets/chessground.brown.css'],
  ['/engine/stockfish.js', 'node_modules/stockfish/bin/stockfish-19-lite-single.js'],
  ['/engine/stockfish.wasm', 'node_modules/stockfish/bin/stockfish-19-lite-single.wasm'],
].map(([u, f]) => [u, path.join(ROOT, f)]);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const safeId = s => /^[A-Za-z0-9_.-]{1,120}$/.test(s) ? s : null;
const readBody = req => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 50e6) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

async function serveFile(res, file) {
  try {
    const st = await stat(file);
    if (!st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch { send(res, 404, { error: 'not found' }); }
}

async function proxy(res, url, accept = 'application/json') {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    send(res, r.status, await r.text(), r.headers.get('content-type') || 'application/json');
  } catch (e) { send(res, 502, { error: 'Verbindung fehlgeschlagen: ' + e.message }); }
}

async function api(req, res, url) {
  const p = url.pathname.split('/').filter(Boolean).slice(1);
  const m = req.method;

  // ---- Weiterleitung an Chess.com / Lichess (für Listen & Profile im Browser) ----
  if (p[0] === 'chesscom') {
    const user = encodeURIComponent((p[2] || '').toLowerCase());
    if (p[1] === 'archive') {
      const target = url.searchParams.get('url') || '';
      if (!/^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(target)) return send(res, 400, { error: 'ungültige URL' });
      return proxy(res, target);
    }
    if (p[1] === 'player' && p[3] === 'archives') return proxy(res, `https://api.chess.com/pub/player/${user}/games/archives`);
    if (p[1] === 'player' && p[3] === 'stats') return proxy(res, `https://api.chess.com/pub/player/${user}/stats`);
    if (p[1] === 'player' && !p[3]) return proxy(res, `https://api.chess.com/pub/player/${user}`);
  }
  if (p[0] === 'lichess') {
    const user = encodeURIComponent(p[2] || '');
    if (p[1] === 'user' && !p[3]) return proxy(res, `https://lichess.org/api/user/${user}`);
    if (p[1] === 'user' && p[3] === 'games') {
      const q = new URLSearchParams({ max: Math.min(Number(url.searchParams.get('max')) || 30, 300), pgnInJson: 'true', opening: 'true', clocks: 'true', moves: 'true' });
      return proxy(res, `https://lichess.org/api/games/user/${user}?${q}`, 'application/x-ndjson');
    }
  }

  // ---- Partien ----
  if (p[0] === 'games') {
    if (!p[1] && m === 'GET') return send(res, 200, await db.listGames());
    const id = safeId(p[1] || '');
    if (!id) return send(res, 400, { error: 'ungültige ID' });
    if (m === 'GET') { const g = await db.getGame(id); return g ? send(res, 200, g) : send(res, 404, { error: 'nicht gefunden' }); }
    if (m === 'PUT') { const raw = await readBody(req); await db.saveGame(id, JSON.parse(raw), raw); return send(res, 200, { ok: true }); }
    if (m === 'DELETE') { await db.deleteGame(id); return send(res, 200, { ok: true }); }
  }

  // ---- Einstellungen & Fortschritt ----
  if (p[0] === 'kv') {
    const key = safeId(p[1] || '');
    if (!key) return send(res, 400, { error: 'ungültiger Schlüssel' });
    if (m === 'GET') return send(res, 200, await db.getKv(key));
    if (m === 'PUT') {
      const prev = key === 'settings' ? await db.getKv('settings') : null;
      await db.setKv(key, JSON.parse(await readBody(req)));
      if (key === 'settings') sync.settingsChanged(prev);
      return send(res, 200, { ok: true });
    }
  }

  // ---- Automatischer Import / Hintergrundanalyse ----
  if (p[0] === 'sync') {
    if (p[1] === 'status') return send(res, 200, await sync.status());
    if (m === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (p[1] === 'run') { sync.check({ full: body.full }); return send(res, 200, { ok: true }); }
      if (p[1] === 'queue') return send(res, 200, { added: sync.enqueue(body.games || [], body.front !== false) });
      if (p[1] === 'pause') { sync.pause(); return send(res, 200, { ok: true }); }
      if (p[1] === 'resume') { sync.resume(); return send(res, 200, { ok: true }); }
      if (p[1] === 'cancel') { sync.cancel(); return send(res, 200, { ok: true }); }
    }
  }

  send(res, 404, { error: 'unbekannter Endpunkt' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const vendor = STATIC.find(([u]) => u === url.pathname);
    if (vendor) return serveFile(res, vendor[1]);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(ROOT, 'public', rel));
    if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'verboten' });
    return serveFile(res, file);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`\n  ♞ SchachCoach läuft:  http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`    im WLAN (z.B. iPad): http://${n.address}:${PORT}`);
  console.log('\n  Neue Partien werden automatisch geholt und analysiert, solange dieses Fenster offen ist.');
  console.log('  Beenden mit Strg+C\n');
  await sync.start();
});
const stop = () => { sync.shutdown(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
