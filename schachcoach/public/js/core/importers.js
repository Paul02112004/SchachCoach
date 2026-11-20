// Partien von Chess.com, Lichess oder als PGN laden -> einheitliches Format
import { Chess } from 'chess.js';
import { timeClassFromControl } from './analysis.js';

const get = async url => {
  const r = await fetch(url);
  if (r.status === 404) throw new Error('Benutzer nicht gefunden');
  if (!r.ok) { let t = ''; try { t = (await r.json()).error || ''; } catch {} throw new Error(t || 'Fehler ' + r.status); }
  return r;
};
const RESULT_CC = { win: 'win', checkmated: 'loss', resigned: 'loss', timeout: 'loss', abandoned: 'loss', lose: 'loss',
  agreed: 'draw', repetition: 'draw', stalemate: 'draw', insufficient: 'draw', '50move': 'draw', timevsinsufficient: 'draw' };

export async function fetchChessCom(user, max = 50) {
  const { archives = [] } = await (await get(`/api/chesscom/player/${encodeURIComponent(user)}/archives`)).json();
  const games = [];
  for (const url of archives.slice().reverse()) {
    const data = await (await get('/api/chesscom/archive?url=' + encodeURIComponent(url))).json();
    const list = (data.games || []).filter(g => g.rules === 'chess' && g.pgn).reverse();
    for (const g of list) {
      const w = g.white, b = g.black;
      const result = w.result === 'win' ? '1-0' : b.result === 'win' ? '0-1' : '1/2-1/2';
      games.push({
        id: 'cc-' + (g.uuid || g.url.split('/').pop()), source: 'chesscom', url: g.url, pgn: g.pgn,
        white: { name: w.username, rating: w.rating }, black: { name: b.username, rating: b.rating },
        result, date: g.end_time * 1000, timeClass: g.time_class || timeClassFromControl(g.time_control),
        timeControl: g.time_control, rated: g.rated, termination: RESULT_CC[w.result] ? (w.result === 'win' ? b.result : w.result) : '',
      });
      if (games.length >= max) return games;
    }
  }
  return games;
}

export async function fetchChessComStats(user) {
  try { return await (await get(`/api/chesscom/player/${encodeURIComponent(user)}/stats`)).json(); } catch { return null; }
}
export async function fetchLichessUser(user) {
  try { return await (await get(`/api/lichess/user/${encodeURIComponent(user)}`)).json(); } catch { return null; }
}

export async function fetchLichess(user, max = 50) {
  const text = await (await get(`/api/lichess/user/${encodeURIComponent(user)}/games?max=${max}`)).text();
  return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(g => g.variant === 'standard' && g.pgn && g.moves)
    .map(g => {
      const pw = g.players.white, pb = g.players.black;
      const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
      const tc = g.clock ? `${g.clock.initial}+${g.clock.increment}` : '-';
      return {
        id: 'li-' + g.id, source: 'lichess', url: 'https://lichess.org/' + g.id, pgn: g.pgn,
        white: { name: pw.user?.name || (pw.aiLevel ? 'Stockfish ' + pw.aiLevel : 'Anonym'), rating: pw.rating },
        black: { name: pb.user?.name || (pb.aiLevel ? 'Stockfish ' + pb.aiLevel : 'Anonym'), rating: pb.rating },
        result, date: g.lastMoveAt || g.createdAt, timeClass: g.speed === 'correspondence' ? 'daily' : g.speed,
        timeControl: tc, rated: g.rated, termination: g.status,
      };
    });
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/** Ein oder mehrere PGNs (aneinandergehängt) einlesen */
export function parsePgnText(text) {
  const chunks = text.replace(/\r/g, '').split(/\n(?=\[Event )/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const pgn of chunks) {
    const c = new Chess();
    try { c.loadPgn(pgn); } catch (e) { throw new Error('PGN konnte nicht gelesen werden: ' + e.message); }
    const h = c.getHeaders ? c.getHeaders() : c.header();
    if (!c.history().length) continue;
    const d = (h.UTCDate || h.Date || '').replace(/\?/g, '01');
    const date = /^\d{4}\.\d{2}\.\d{2}$/.test(d) ? Date.parse(d.replace(/\./g, '-') + 'T' + (h.UTCTime || h.EndTime || '12:00:00').slice(0, 8) + 'Z') : Date.now();
    out.push({
      id: 'pgn-' + hash(pgn), source: 'pgn', url: h.Link || h.Site?.startsWith('http') && h.Site || null, pgn,
      white: { name: h.White || 'Weiß', rating: +h.WhiteElo || null }, black: { name: h.Black || 'Schwarz', rating: +h.BlackElo || null },
      result: h.Result || '*', date: isNaN(date) ? Date.now() : date, timeClass: timeClassFromControl(h.TimeControl), timeControl: h.TimeControl || '-',
    });
  }
  if (!out.length) throw new Error('Keine Partie im PGN gefunden');
  return out;
}
