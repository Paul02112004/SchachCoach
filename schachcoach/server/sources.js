// Partien direkt von Chess.com / Lichess holen (serverseitig)
import { timeClassFromControl } from '../public/js/core/analysis.js';

const UA = 'SchachCoach/1.0 (private self-hosted chess review)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, accept = 'application/json') {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    if (r.status === 429) { await sleep(60000); continue; }      // Rate-Limit: eine Minute warten
    if (r.status === 404) throw Object.assign(new Error('nicht gefunden: ' + url), { status: 404 });
    if (!r.ok) throw new Error(`HTTP ${r.status} bei ${url}`);
    return r;
  }
  throw new Error('Rate-Limit bei ' + url);
}

export function chessComMeta(g) {
  const w = g.white, b = g.black;
  return {
    id: 'cc-' + (g.uuid || g.url.split('/').pop()), source: 'chesscom', url: g.url, pgn: g.pgn,
    white: { name: w.username, rating: w.rating }, black: { name: b.username, rating: b.rating },
    result: w.result === 'win' ? '1-0' : b.result === 'win' ? '0-1' : '1/2-1/2',
    date: g.end_time * 1000, timeClass: g.time_class || timeClassFromControl(g.time_control),
    timeControl: g.time_control, rated: g.rated,
  };
}

export async function chessComArchives(user) {
  const r = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
  return (await r.json()).archives || [];
}
export async function chessComMonth(url) {
  const r = await get(url);
  return ((await r.json()).games || []).filter(g => g.rules === 'chess' && g.pgn).map(chessComMeta);
}

export function lichessMeta(g) {
  const pw = g.players.white, pb = g.players.black;
  return {
    id: 'li-' + g.id, source: 'lichess', url: 'https://lichess.org/' + g.id, pgn: g.pgn,
    white: { name: pw.user?.name || (pw.aiLevel ? 'Stockfish ' + pw.aiLevel : 'Anonym'), rating: pw.rating },
    black: { name: pb.user?.name || (pb.aiLevel ? 'Stockfish ' + pb.aiLevel : 'Anonym'), rating: pb.rating },
    result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2',
    date: g.lastMoveAt || g.createdAt, createdAt: g.createdAt,
    timeClass: g.speed === 'correspondence' ? 'daily' : g.speed,
    timeControl: g.clock ? `${g.clock.initial}+${g.clock.increment}` : '-', rated: g.rated,
  };
}

/** Lichess-Partien (ndjson). since = Zeitstempel in ms (nur neuere), max = Anzahl */
export async function lichessGames(user, { since, max } = {}) {
  const q = new URLSearchParams({ pgnInJson: 'true', opening: 'true', clocks: 'true', moves: 'true' });
  if (since) q.set('since', since);
  if (max) q.set('max', max);
  const r = await get(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?${q}`, 'application/x-ndjson');
  const text = await r.text();
  return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(g => g.variant === 'standard' && g.pgn && g.moves && g.status !== 'aborted' && g.status !== 'noStart')
    .map(lichessMeta);
}
