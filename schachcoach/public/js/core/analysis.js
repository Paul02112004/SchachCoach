// Reine Logik: Gewinnwahrscheinlichkeit, Zugbewertung, Genauigkeit, Spielphasen, Elo-Schätzung
import { Chess } from 'chess.js';

export const CLASSES = {
  brilliant:  { label: 'Brillant',       sym: '!!', color: '#1baca6' },
  great:      { label: 'Großartig',      sym: '!',  color: '#5c8bb0' },
  best:       { label: 'Bester Zug',     sym: '★',  color: '#81b64c' },
  excellent:  { label: 'Exzellent',      sym: '✓',  color: '#96bc4b' },
  good:       { label: 'Gut',            sym: '✓',  color: '#95b776' },
  book:       { label: 'Buchzug',        sym: '≡',  color: '#a88865' },
  inaccuracy: { label: 'Ungenauigkeit',  sym: '?!', color: '#f7c631' },
  mistake:    { label: 'Fehler',         sym: '?',  color: '#ffa459' },
  miss:       { label: 'Verpasst',       sym: '✕',  color: '#ff7769' },
  blunder:    { label: 'Patzer',         sym: '??', color: '#fa412d' },
};
export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

export const CATEGORIES = {
  opening:    { label: 'Eröffnung',   hint: 'Deine Züge in den ersten 12 Zügen' },
  middlegame: { label: 'Mittelspiel', hint: 'Deine Züge zwischen Eröffnung und Endspiel' },
  endgame:    { label: 'Endspiel',    hint: 'Deine Züge, wenn nur noch wenige Figuren auf dem Brett sind' },
  tactics:    { label: 'Taktik',      hint: 'Stellungen mit nur einem guten Zug oder nach einem Fehler deines Gegners' },
  conversion: { label: 'Verwertung',  hint: 'Deine Züge in klar gewonnenen Stellungen' },
  defense:    { label: 'Verteidigung', hint: 'Deine Züge in klar schlechteren Stellungen' },
};

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Bewertung (Sicht Weiß) -> Gewinnchance Weiß in % */
export function winPct(ev) {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 ? 100 : ev.mate < 0 ? 0 : (ev.winner === 'w' ? 100 : 0);
  const cp = Math.max(-1000, Math.min(1000, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
/** Gewinnchance aus Sicht einer Farbe */
export const wpFor = (ev, color) => color === 'w' ? winPct(ev) : 100 - winPct(ev);

export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669));
}

/** Aggregation wie bei Lichess (vereinfacht): Mittel aus gewichtetem und harmonischem Mittel */
export function aggregateAccuracy(accs, weights) {
  if (!accs.length) return null;
  const w = weights || accs.map(() => 1);
  const sw = w.reduce((a, b) => a + b, 0);
  const weighted = accs.reduce((s, a, i) => s + a * w[i], 0) / sw;
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 5), 0);
  return (weighted + harmonic) / 2;
}

// Genauigkeit -> geschätzte Elo (grobe Kalibrierung, Stützpunkte linear interpoliert)
const ELO_TABLE = [[0, 100], [40, 250], [50, 450], [60, 700], [65, 830], [70, 960], [75, 1100], [80, 1300], [85, 1550], [90, 1850], [93, 2100], [96, 2450], [98, 2750], [100, 3000]];
export function accuracyToElo(acc) {
  if (acc == null || isNaN(acc)) return null;
  for (let i = 1; i < ELO_TABLE.length; i++) {
    const [a1, e1] = ELO_TABLE[i - 1], [a2, e2] = ELO_TABLE[i];
    if (acc <= a2) return Math.round(e1 + (e2 - e1) * (acc - a1) / (a2 - a1));
  }
  return 3000;
}

export function formatEval(ev) {
  if (!ev) return '';
  if (ev.mate != null) return ev.mate === 0 ? '#' : (ev.mate > 0 ? '+M' : '-M') + Math.abs(ev.mate);
  const v = ev.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}

export function phaseOf(fen, ply) {
  const board = fen.split(' ')[0];
  const pieces = (board.match(/[nbrqNBRQ]/g) || []).length;
  if (pieces <= 6) return 'endgame';
  if (ply < 24) return 'opening';
  return 'middlegame';
}

/** Parsen eines PGN in Züge mit Stellungen */
export function parsePgn(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const headers = c.getHeaders ? c.getHeaders() : c.header();
  const comments = {};
  try { for (const { fen, comment } of c.getComments()) comments[fen] = comment; } catch {}
  const hist = c.history({ verbose: true });
  const moves = hist.map((m, i) => {
    const clk = /\[%clk\s+([\d:.]+)\]/.exec(comments[m.after] || '');
    return {
      ply: i, color: m.color, san: m.san, uci: m.from + m.to + (m.promotion || ''),
      from: m.from, to: m.to, piece: m.piece, captured: m.captured || null, promotion: m.promotion || null,
      fenBefore: m.before, fenAfter: m.after, clock: clk ? clk[1] : null,
    };
  });
  return { headers, moves, startFen: hist.length ? hist[0].before : c.fen() };
}

/** Sacrifice-Heuristik: gezogene Figur steht danach angegriffen und ist nicht ausreichend gedeckt */
function isSacrifice(move) {
  if (move.piece === 'p' || move.piece === 'k' || move.promotion) return false;
  const c = new Chess(move.fenAfter);
  if (c.isCheckmate()) return false;
  const opp = move.color === 'w' ? 'b' : 'w';
  const attackers = c.attackers(move.to, opp);
  if (!attackers.length) return false;
  const gain = VAL[move.piece] - (move.captured ? VAL[move.captured] : 0);
  if (gain < 2) return false;
  const defended = c.attackers(move.to, move.color).length > 0;
  const minAtt = Math.min(...attackers.map(sq => VAL[c.get(sq).type] || 9));
  return !defended || minAtt < VAL[move.piece];
}

/**
 * Bewertet alle Züge.
 * evals[i] = Engine-Ergebnis für die Stellung VOR Zug i (evals[n] = Endstellung)
 * evals[i] = { cp|mate (Sicht Weiß), best, pv, second: {cp|mate, uci} }
 */
export function classifyGame(moves, evals, bookPositions) {
  const res = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const before = evals[i], after = evals[i + 1];
    const wpBefore = wpFor(before, m.color);
    const wpAfter = wpFor(after, m.color);
    const isBest = before.best === m.uci;
    let loss = isBest ? 0 : Math.max(0, wpBefore - wpAfter);
    const acc = moveAccuracy(loss);
    const phase = phaseOf(m.fenBefore, i);
    const epd = m.fenAfter.split(' ').slice(0, 4).join(' ');
    const inBook = i < 30 && bookPositions && bookPositions[epd];
    const prev = res[i - 1];
    const wpSecond = before.second ? wpFor(before.second, m.color) : null;
    const onlyMove = wpSecond != null && wpBefore - wpSecond >= 15;

    let cls;
    if (inBook && loss < 10) cls = 'book';
    else if (isBest) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';

    if (cls !== 'book' && loss < 2) {
      const prevMove = moves[i - 1];
      const recapture = prevMove && prevMove.captured && prevMove.to === m.to;
      const clearlyBest = wpSecond == null || wpBefore - wpSecond >= 8;
      if (wpAfter >= 50 && wpBefore < 90 && clearlyBest && isSacrifice(m)) cls = 'brilliant';
      else if (onlyMove && !recapture && wpBefore < 90 && wpAfter > 30) cls = 'great';
    }
    if ((cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy') && prev && prev.loss >= 10 && wpBefore >= 60 && wpAfter < wpBefore - 10) cls = 'miss';

    res.push({
      cls, loss: Math.round(loss * 10) / 10, acc: Math.round(acc * 10) / 10, phase,
      wpBefore, wpAfter, tactical: onlyMove || (prev ? prev.loss >= 10 : false),
    });
  }
  return res;
}

/** Gewichte nach Volatilität (wie Lichess) */
function volatilityWeights(wps, color, moves) {
  const n = wps.length;
  const win = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const w = [];
  for (let i = 0; i < n - 1; i++) {
    if (moves[i].color !== color) continue;
    const s = Math.max(0, i - win + 1), seg = wps.slice(s, i + 2);
    const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mean) ** 2, 0) / seg.length);
    w.push(Math.max(0.5, Math.min(12, sd)));
  }
  return w;
}

export function summarizeSide(moves, cls, evals, color) {
  const idx = moves.map((m, i) => i).filter(i => moves[i].color === color);
  const accs = idx.map(i => cls[i].acc);
  const wps = evals.map(e => winPct(e));
  const acc = aggregateAccuracy(accs, volatilityWeights(wps, color, moves));
  const counts = Object.fromEntries(CLASS_ORDER.map(k => [k, 0]));
  idx.forEach(i => counts[cls[i].cls]++);
  return { accuracy: acc == null ? null : Math.round(acc * 10) / 10, elo: accuracyToElo(acc), counts };
}

/** Rohdaten pro Kategorie (Züge eines Spielers) – werden über Partien hinweg zusammengefasst */
export function categoryMoves(moves, cls, color) {
  const out = Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, []]));
  moves.forEach((m, i) => {
    if (m.color !== color) return;
    const c = cls[i];
    out[c.phase].push(c.acc);
    if (c.tactical) out.tactics.push(c.acc);
    if (c.wpBefore >= 75 && c.wpBefore < 99.9) out.conversion.push(c.acc);
    if (c.wpBefore <= 25 && c.wpBefore > 0.1) out.defense.push(c.acc);
  });
  return out;
}

export function timeClassFromControl(tc) {
  if (!tc || tc === '-') return 'unknown';
  if (tc.includes('/')) return 'daily';
  const [base, inc] = tc.split('+').map(Number);
  const total = (base || 0) + 40 * (inc || 0);
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}
export const TIME_CLASSES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Klassisch', daily: 'Täglich', unknown: 'Unbekannt' };
