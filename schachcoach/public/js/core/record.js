// Aus Zügen + Engine-Bewertungen den gespeicherten Partie-Datensatz bauen (Browser und Server)
import { classifyGame, summarizeSide, categoryMoves } from './analysis.js';
import { detectOpening } from './openings.js';
import { detectPatterns } from './patterns.js';

export function buildRecord(meta, moves, evals, positions, names, depth) {
  const cls = classifyGame(moves, evals, positions);
  const userColor = meta.userColor || (names.includes(meta.white.name.toLowerCase()) ? 'w' : names.includes(meta.black.name.toLowerCase()) ? 'b' : null);
  const opening = detectOpening(moves, positions);
  const w = summarizeSide(moves, cls, evals, 'w'), b = summarizeSide(moves, cls, evals, 'b');
  const userResult = !userColor || meta.result === '*' ? null : meta.result === '1/2-1/2' ? 'draw' : (meta.result === '1-0') === (userColor === 'w') ? 'win' : 'loss';
  const game = {
    ...meta, userColor, opening, depth, analyzedAt: Date.now(),
    moves: moves.map((m, i) => ({ ...m, ...cls[i] })), evals,
    summary: {
      white: meta.white, black: meta.black, result: meta.result, date: meta.date, timeClass: meta.timeClass, source: meta.source,
      userColor, userResult, opening, plies: moves.length, depth,
      accuracy: { w: w.accuracy, b: b.accuracy }, elo: { w: w.elo, b: b.elo }, counts: { w: w.counts, b: b.counts },
      categories: userColor ? categoryMoves(moves, cls, userColor) : null,
      userRating: userColor ? (userColor === 'w' ? meta.white.rating : meta.black.rating) : null,
    },
  };
  addPatterns(game);
  return game;
}

/** Fehlermuster berechnen und Aufgaben damit markieren */
export function addPatterns(game) {
  game.summary.patterns = detectPatterns(game);
  const byPly = new Map((game.summary.patterns?.mistakes || []).map(x => [x.ply, x.type]));
  game.summary.puzzles = buildPuzzles(game).map(p => ({ ...p, pattern: byPly.get(p.ply) || null }));
}

/** Trainingsaufgaben aus eigenen Fehlern */
function buildPuzzles(game) {
  if (!game.userColor) return [];
  const out = [];
  game.moves.forEach((m, i) => {
    if (m.color !== game.userColor) return;
    if (!['mistake', 'blunder', 'miss'].includes(m.cls)) return;
    const ev = game.evals[i];
    if (!ev.best) return;
    const pick = e => e.mate != null ? { mate: e.mate } : { cp: e.cp };
    out.push({
      id: `${game.id}-${i}`, gameId: game.id, ply: i, fen: m.fenBefore, played: m.uci, playedSan: m.san, best: ev.best, pv: (ev.pv || []).slice(0, 12),
      ev: pick(ev), second: ev.second, cls: m.cls, phase: m.phase, loss: m.loss, date: game.date, timeClass: game.timeClass,
      tactical: m.tactical, wpBefore: Math.round(m.wpBefore),
    });
  });
  return out;
}
