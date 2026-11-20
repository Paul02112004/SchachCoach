// Brett (chessground) mit legalen Zügen aus chess.js
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';

export function legalDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}
const turnColor = fen => fen.split(' ')[1] === 'w' ? 'white' : 'black';

/**
 * createBoard(el, { orientation, onMove(uci, chessAfter, moveObj) })
 * board.show(fen, { lastMove: [from,to], movable: 'white'|'black'|'both'|false, shapes })
 */
export function createBoard(el, { orientation = 'white', onMove } = {}) {
  let chess = new Chess();
  const cg = Chessground(el, {
    orientation, coordinates: true, animation: { duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, showDests: true, events: { after: (from, to) => handleMove(from, to) } },
    premovable: { enabled: false },
    drawable: { enabled: true, brushes: {
      green: { key: 'g', color: '#15781B', opacity: 0.8, lineWidth: 10 },
      best: { key: 'bst', color: '#5cb85c', opacity: 0.85, lineWidth: 11 },
      blue: { key: 'b', color: '#003088', opacity: 0.8, lineWidth: 10 },
      red: { key: 'r', color: '#d9534f', opacity: 0.8, lineWidth: 10 },
      yellow: { key: 'y', color: '#e68f00', opacity: 0.8, lineWidth: 10 },
      paleBlue: { key: 'pb', color: '#4a90d9', opacity: 0.55, lineWidth: 12 },
    } },
  });
  // Chessground berechnet Maße beim Einhängen in die Seite / bei Größenänderung neu
  let sized = false, queued = null;
  const ro = new ResizeObserver(() => {
    if (!el.clientWidth) return;
    cg.redrawAll();
    if (!sized) { sized = true; if (queued) cg.setAutoShapes(queued); queued = null; }
  });
  const setShapes = s => { if (sized) cg.setAutoShapes(s); else queued = s; };
  ro.observe(el);
  function handleMove(from, to) {
    const piece = chess.get(from);
    const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
    let mv;
    try { mv = chess.move({ from, to, promotion: promo }); } catch { mv = null; }
    if (!mv) { api.show(chess.fen()); return; }
    onMove?.(from + to + (promo || ''), chess, mv);
  }
  const api = {
    cg,
    get chess() { return chess; },
    show(fen, { lastMove, movable = false, shapes = [], check } = {}) {
      chess = new Chess(fen);
      const color = movable === 'both' ? 'both' : movable || undefined;
      const canMove = !!movable && (movable === 'both' || movable === turnColor(fen));
      cg.set({
        fen, lastMove, turnColor: turnColor(fen), check: check ?? chess.inCheck(),
        movable: { color: canMove ? (movable === 'both' ? turnColor(fen) : movable) : undefined, dests: canMove ? legalDests(chess) : new Map() },
      });
      setShapes(shapes);
    },
    shapes(s) { setShapes(s); },
    orientation(o) { cg.set({ orientation: o }); },
    flip() { cg.toggleOrientation(); },
    get orient() { return cg.state.orientation; },
    /** Zug programmatisch ausführen (mit Animation) */
    play(uci) {
      const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      cg.move(uci.slice(0, 2), uci.slice(2, 4));
      cg.set({ fen: chess.fen(), turnColor: turnColor(chess.fen()), check: chess.inCheck(), lastMove: [uci.slice(0, 2), uci.slice(2, 4)] });
      return mv;
    },
    shake() { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); },
    destroy() { ro.disconnect(); cg.destroy(); },
  };
  return api;
}

export const arrow = (uci, brush = 'best') => uci ? { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush } : null;

export function uciToSan(fen, uci) {
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; }
}
export function pvToSan(fen, pv, max = 8) {
  const c = new Chess(fen), out = [];
  for (const u of pv.slice(0, max)) {
    try {
      const num = c.turn() === 'w' ? c.moveNumber() + '. ' : (out.length === 0 ? c.moveNumber() + '… ' : '');
      out.push(num + c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch { break; }
  }
  return out.join(' ');
}
