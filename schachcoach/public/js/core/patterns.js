// Fehlermuster & Gewohnheiten aus einer analysierten Partie erkennen
import { Chess } from 'chess.js';
import { wpFor } from './analysis.js';

export const PATTERN_VERSION = 2;
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
const PIECE_ACC = { p: 'einen Bauern', n: 'einen Springer', b: 'einen Läufer', r: 'einen Turm', q: 'die Dame', k: 'den König' };

export const PATTERNS = {
  hungMoved:    { icon: '🎯', title: 'Figur auf unsicheres Feld gezogen', tip: 'Frag dich vor jedem Zug: Kann der Gegner die gezogene Figur schlagen – und ist sie ausreichend gedeckt?' },
  hungLeft:     { icon: '⚠️', title: 'Angegriffene Figur stehen gelassen', tip: 'Schau dir nach jedem gegnerischen Zug an, welche deiner Figuren jetzt angegriffen oder nicht mehr gedeckt sind.' },
  fork:         { icon: '🍴', title: 'Gabel zugelassen', tip: 'Achte auf Springer- und Bauerngabeln: Stehen zwei wertvolle Figuren (oder Figur + König) im Springerabstand oder auf einer Linie?' },
  matedThreat:  { icon: '☠️', title: 'Mattdrohung übersehen', tip: 'Prüfe nach jedem Zug, ob der Gegner Schachs oder Schläge Richtung deines Königs hat – besonders auf der Grundreihe.' },
  missedMate:   { icon: '👑', title: 'Eigenes Matt verpasst', tip: 'Wenn der gegnerische König offen steht: erst alle Schachs durchrechnen, dann alle Schläge, dann Drohungen.' },
  missedPunish: { icon: '🎁', title: 'Gegnerfehler nicht bestraft', tip: 'Nach einem gegnerischen Zug zuerst fragen: Was hat sich verändert? Hängt jetzt etwas – kann ich etwas schlagen?' },
  missedTactic: { icon: '⚡', title: 'Taktik verpasst', tip: 'Suche in jeder Stellung zuerst nach forcierenden Zügen: Schachs, Schläge, Drohungen (in dieser Reihenfolge).' },
  tacticAgainst:{ icon: '🪤', title: 'Gegnerische Kombination übersehen', tip: 'Bevor du ziehst: Welche Schachs, Schläge und Drohungen hat der Gegner nach deinem Zug? Rechne seine beste Antwort zwei Züge tief.' },
  kingSafety:   { icon: '🏰', title: 'Königssicherheit vernachlässigt', tip: 'Rochiere früh und öffne die Stellung vor deinem eigenen König nicht ohne Grund.' },
  positional:   { icon: '🧭', title: 'Ungenauer Plan', tip: 'Keine direkte Taktik – eher ein schlechter Plan. Frag dich: Welche ist meine schlechteste Figur, und wie verbessere ich sie?' },
};

const sideOf = fen => fen.split(' ')[1];
function tryMove(fen, uci) {
  try { const c = new Chess(fen); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); return { c, m }; } catch { return null; }
}
function clockSecs(s) { if (!s) return null; const p = s.split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); }
const sq = (fen, ply) => Math.floor(ply / 2) + 1 + (sideOf(fen) === 'w' ? '. ' : '… ');

/** Erkennt das Muster eines einzelnen eigenen Fehlers (Zug i) */
export function patternOfMove(moves, evals, i) {
  const m = moves[i], me = m.color, opp = me === 'w' ? 'b' : 'w';
  const before = evals[i], after = evals[i + 1];
  const mateFor = (ev, color) => ev && ev.mate != null && ev.mate !== 0 && ((ev.mate > 0) === (color === 'w'));
  // 1. Eigenes Matt verpasst
  if (mateFor(before, me) && !mateFor(after, me)) return { type: 'missedMate', detail: `Matt in ${Math.abs(before.mate)} war möglich` };
  // 2. Mattdrohung übersehen
  if (mateFor(after, opp) && !mateFor(before, opp)) return { type: 'matedThreat', detail: `Danach Matt in ${Math.abs(after.mate)} für den Gegner` };
  // Antwort des Gegners laut Engine
  const reply = after?.best ? tryMove(m.fenAfter, after.best) : null;
  const start = material(m.fenBefore, me) - material(m.fenBefore, opp);
  const lostShort = start - balanceAlongPv(m.fenAfter, after?.pv, me, 4);   // nach Abtausch-Folge
  const lostLong = start - balanceAlongPv(m.fenAfter, after?.pv, me, 8);
  if (reply) {
    const r = reply.m;
    // 3. Gabel
    const fork = forkTargets(reply.c, r, me);
    if (fork && lostLong >= 2 && (!r.captured || VAL[r.captured] < 3)) return { type: 'fork', detail: `${PIECE[r.piece]} auf ${r.to} greift ${fork.map(t => PIECE[t]).join(' und ')} an` };
    // 4. Figur eingestellt
    if (r.captured && VAL[r.captured] >= 3 && lostShort >= 2) {
      if (r.to === m.to) return { type: 'hungMoved', detail: `Gegner schlägt ${PIECE_ACC[r.captured]} mit ${r.san}` };
      return { type: 'hungLeft', detail: `Gegner schlägt ${PIECE_ACC[r.captured]} auf ${r.to} (${r.san})` };
    }
  }
  // 5. Kombination des Gegners (Material geht einige Züge später verloren)
  if (lostLong >= 2 && reply) return { type: 'tacticAgainst', detail: `Nach ${reply.m.san} verlierst du Material` };
  // 6. Gegnerfehler nicht bestraft / Taktik verpasst
  const bestMv = before?.best ? tryMove(m.fenBefore, before.best) : null;
  if (bestMv) {
    const b = bestMv.m;
    const forcing = b.captured || b.san.includes('+');
    if (m.cls === 'miss') return { type: 'missedPunish', detail: b.captured ? `${b.san} hätte ${PIECE_ACC[b.captured]} gewonnen` : `${b.san} hätte den Fehler bestraft` };
    if (forcing && (b.captured ? VAL[b.captured] >= 3 : true) && m.loss >= 10) return { type: 'missedTactic', detail: `${b.san} war stark` };
  }
  // 6. Königssicherheit: Gegner bekommt Schach / Angriff auf den König
  if (reply && (reply.m.san.includes('+') || kingZoneAttack(reply.c, me) >= 3)) return { type: 'kingSafety', detail: `Gegner greift mit ${reply.m.san} deinen König an` };
  return { type: 'positional', detail: bestMv ? `Besser war ${bestMv.m.san}` : '' };
}

function material(fen, color) {
  let n = 0;
  for (const ch of fen.split(' ')[0]) { const t = ch.toLowerCase(); if (VAL[t] && t !== 'k' && ((ch === t) === (color === 'b'))) n += VAL[t]; }
  return n;
}
/** Materialbilanz (eigene minus gegnerische) nach `plies` Halbzügen der Engine-Linie */
function balanceAlongPv(fen, pv, me, plies) {
  const c = new Chess(fen);
  for (const u of (pv || []).slice(0, plies)) { try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; } }
  const opp = me === 'w' ? 'b' : 'w';
  return material(c.fen(), me) - material(c.fen(), opp);
}

function forkTargets(c, r, me) {
  const targets = [];
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== me) continue;
    if (p.type !== 'k' && VAL[p.type] < 3) continue;
    if (!c.attackers(p.square, r.color).includes(r.to)) continue;
    const defended = c.attackers(p.square, me).length > 0;
    if (p.type === 'k' || VAL[p.type] > VAL[r.piece] || !defended) targets.push(p.type);
  }
  return targets.length >= 2 ? targets.sort((a, b) => VAL[b] - VAL[a]) : null;
}
function kingZoneAttack(c, me) {
  let king = null;
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === me) king = p.square;
  if (!king) return 0;
  const f = king.charCodeAt(0), r = +king[1], opp = me === 'w' ? 'b' : 'w';
  let n = 0;
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    const ff = f + df, rr = r + dr;
    if (ff < 97 || ff > 104 || rr < 1 || rr > 8) continue;
    n += c.attackers(String.fromCharCode(ff) + rr, opp).length;
  }
  return n;
}

/** Alle Muster + Gewohnheiten einer Partie (aus Sicht des Spielers `me`) */
export function detectPatterns(game) {
  const me = game.userColor;
  if (!me) return null;
  const { moves, evals } = game;
  const mistakes = [];
  const myIdx = moves.map((m, i) => i).filter(i => moves[i].color === me);
  // Zeitnot: < 10 % der Grundzeit oder < 30 s
  const base = +(String(game.timeControl || '').split('+')[0]) || null;
  const ttLimit = base ? Math.max(30, base * 0.1) : 30;
  let prevBad = -99, tilt = 0;
  myIdx.forEach((i, k) => {
    const m = moves[i];
    if (!['mistake', 'blunder', 'miss'].includes(m.cls)) return;
    const p = patternOfMove(moves, evals, i);
    const secs = clockSecs(m.clock);
    const timeTrouble = secs != null && game.timeClass !== 'daily' && secs < ttLimit;
    if (k - prevBad <= 2) tilt++;
    prevBad = k;
    mistakes.push({ ply: i, san: m.san, label: sq(m.fenBefore, i) + m.san, cls: m.cls, phase: m.phase, piece: m.piece, timeTrouble, ...p });
  });
  // Gewohnheiten in der Eröffnung
  const first = myIdx.slice(0, 8).map(i => moves[i]);
  const earlyQueen = first.slice(0, 5).some(m => m.piece === 'q' && m.cls !== 'book' && !m.captured);
  const castledAt = myIdx.find(i => moves[i].san.startsWith('O-O'));
  const longGame = moves.length >= 30;
  const boardAt12 = moves[Math.min(23, moves.length - 1)].fenAfter.split(' ')[0];
  const queensOn = longGame && boardAt12.includes('Q') && boardAt12.includes('q');
  const notCastled = longGame && queensOn && (castledAt == null || castledAt > 26);
  const samePiece = (() => { const seen = {}; let n = 0; for (const m of first.slice(0, 6)) { if (m.cls === 'book') continue; if (m.piece !== 'p' && seen[m.from]) n++; seen[m.to] = true; } return n >= 2; })();
  const ply12 = Math.min(24, moves.length);
  const afterOpeningWp = moves.length >= 20 ? wpFor(evals[ply12], me) : null;
  // Verlauf
  const wps = evals.map(e => wpFor(e, me));
  const maxWp = Math.max(...wps.slice(1)), minWp = Math.min(...wps.slice(1));
  const won = game.result === (me === 'w' ? '1-0' : '0-1'), drawn = game.result === '1/2-1/2';
  return {
    v: PATTERN_VERSION,
    mistakes,
    habits: { earlyQueen, notCastled, samePiece, badOpening: afterOpeningWp != null && afterOpeningWp < 35, goodOpening: afterOpeningWp != null && afterOpeningWp > 65 },
    hadWinning: maxWp >= 85, thrown: maxWp >= 85 && !won, wasLosing: minWp <= 15, comeback: minWp <= 15 && (won || drawn),
    tilt, timeTroubleMistakes: mistakes.filter(x => x.timeTrouble).length, hasClock: moves.some(m => m.clock),
  };
}
