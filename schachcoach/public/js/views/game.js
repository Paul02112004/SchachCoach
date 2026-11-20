// Einzelanalyse einer Partie
import { h, toast, classBadge, boardBadgeSvg, evalGraph, fmtDateLong, navBar, bindNavKeys, moveLine, moveNo, evalBar } from '../ui.js';
import { createBoard, arrow, uciToSan, pvToSan, lineFrom } from '../board.js';
import { store } from '../core/store.js';
import { analyzeGame, pending } from '../core/pipeline.js';
import { CLASSES, CLASS_ORDER, BAD, formatEval, TIME_CLASSES } from '../core/analysis.js';
import { engine } from '../core/engine.js';
import { patternOfMove, PATTERNS } from '../core/patterns.js';
import { lineExtender, canExtend } from '../extend.js';

export async function render(root, [id, startPly]) {
  let game;
  try { game = await store.getGame(id); } catch {
    const meta = pending.get(id);
    if (!meta) { root.append(h('div.card.error', 'Partie nicht gefunden.')); return; }
    const bar = h('div.bar', { style: { height: '10px' } }, h('div', { style: { width: '0%' } }));
    const label = h('div.muted', 'Stockfish analysiert …');
    root.append(h('div.wrap', { style: { maxWidth: '520px', marginTop: '80px' } }, h('div.card', h('h2', `${meta.white.name} – ${meta.black.name}`), label, bar)));
    const ctrl = new AbortController();
    try {
      game = await analyzeGame(meta, { signal: ctrl.signal, onProgress: p => { bar.firstChild.style.width = Math.round(p * 100) + '%'; label.textContent = `Stockfish analysiert … ${Math.round(p * 100)} %`; } });
      pending.delete(id);
      window.dispatchEvent(new CustomEvent('games-changed'));
    } catch (e) { label.textContent = 'Fehler: ' + e.message; return; }
    root.replaceChildren();
  }
  return view(root, game, startPly != null ? +startPly : null);
}

function view(root, g, startPly) {
  const n = g.moves.length;
  let ply = n;            // 0 = Startstellung, i = nach Zug i
  // Variante: { base: Partie-Ply, an dem sie abzweigt, line: [{ fen, san, lastMove, fenBefore, uci }], idx: aktueller Zug, engine: Engine-Linie? }
  let variation = null;
  let stopLive = null;
  const orientation = g.userColor === 'b' ? 'black' : 'white';

  const boardEl = h('div.board');
  const bar = evalBar(orientation);
  const topPlayer = h('div.player'), botPlayer = h('div.player');
  const explain = h('div.explain');
  const engineLine = h('div.engine-line');
  const movesEl = h('div.moves');
  const graphBox = h('div');
  const varBox = h('div');

  // Am Ende einer Variante rechnet die Engine auf Wunsch weiter (▶ / → bzw. „+5 Züge“)
  const ext = lineExtender({
    onStep: step => { if (!variation) return; variation.line.push(step); variation.idx = variation.line.length - 1; update(); },
    onBusy: b => { nav.busy('next', b); if (variation) renderVar(); },
    onDone: () => update(),
  });

  const board = createBoard(boardEl, { orientation, onMove: (uci, chess, mv) => {
    ext.cancel();
    // eigener Zug = nächster Partiezug → einfach in der Partie weitergehen
    if (!variation && g.moves[ply]?.uci === uci) { go(ply + 1); return; }
    const step = { fen: chess.fen(), san: mv.san, lastMove: [mv.from, mv.to], fenBefore: mv.before, uci };
    if (variation) {
      // an früherer Stelle abgezweigt → Rest der Variante abschneiden
      variation.line = variation.line.slice(0, variation.idx + 1).concat(step);
      variation.idx = variation.line.length - 1;
      variation.engine = false;
    } else variation = { base: ply, line: [step], idx: 0, engine: false };
    update();
  } });

  const fenAt = i => i === 0 ? g.moves[0]?.fenBefore || g.evals[0]?.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : g.moves[i - 1].fenAfter;

  function players() {
    const p = (c) => { const pl = c === 'w' ? g.white : g.black; return [h('span.clr', { style: { background: c === 'w' ? '#eee' : '#111' } }), pl.name, pl.rating ? h('span.muted', `(${pl.rating})`) : '']; };
    const top = orientation === 'white' ? 'b' : 'w';
    topPlayer.replaceChildren(...p(top)); botPlayer.replaceChildren(...p(top === 'w' ? 'b' : 'w'));
  }


  /** Kasten mit der aktuellen Variante (Züge klickbar, langer Text bricht um) */
  function renderVar() {
    const baseMv = variation.base > 0 ? g.moves[variation.base - 1] : null;
    const endFen = variation.line[variation.line.length - 1].fen;
    varBox.replaceChildren(h('div.card',
      h('div.row', h('b', variation.engine ? 'Engine-Linie' : 'Eigene Variante'),
        h('span.small.muted', baseMv ? `nach ${moveNo(baseMv.fenBefore)} ${baseMv.san}` : 'ab Startstellung'), h('span.spacer'),
        h('button.btn.small', { onclick: extend5, disabled: ext.busy || !canExtend(endFen), title: 'Die Engine rechnet 5 weitere Halbzüge (abbrechbar durch Navigieren)' }, '+5 Züge'),
        h('button.btn.small', { onclick: () => go(variation.base) }, '↩ Zurück zur Partie')),
      h('div', { style: { marginTop: '6px' } }, moveLine(variation.line, variation.idx, i => { ext.cancel(); variation.idx = i; update(); }))));
  }

  /** 5 Halbzüge ans Ende der Variante anhängen */
  function extend5() {
    if (!variation || ext.busy) return;
    variation.idx = variation.line.length - 1;
    ext.run(variation.line[variation.idx].fen, 5);
    update();
  }

  function update() {
    stopLive?.(); stopLive = null;
    if (variation) {
      const st = variation.line[variation.idx];
      board.show(st.fen, { lastMove: st.lastMove, movable: 'both' });
      renderVar();
      highlightMoves();
      setNav();
      if (ext.busy) { // die Engine rechnet gerade den nächsten Zug – Live-Analyse danach
        explain.replaceChildren(h('span.muted', 'Engine rechnet den nächsten Zug …'));
        engineLine.replaceChildren();
        return;
      }
      explain.replaceChildren(h('span.muted', 'Live-Engine rechnet …'));
      engineLine.replaceChildren();
      const fen = st.fen;
      stopLive = engine.liveAnalyse(fen, (r, final) => {
        bar.set(r);
        board.shapes([arrow(r.best)].filter(Boolean));
        engineLine.replaceChildren(h('b', formatEval(r)), ` · Tiefe ${r.depth} · `, pvToSan(fen, r.pv || []));
        if (final) explain.replaceChildren(h('span', 'Engine: ', h('b', formatEval(r))));
      }, 18);
      return;
    }
    varBox.replaceChildren();
    const fen = fenAt(ply);
    const m = ply > 0 ? g.moves[ply - 1] : null;
    const evBefore = ply > 0 ? g.evals[ply - 1] : null;
    const shapes = [];
    if (m) {
      shapes.push({ orig: m.to, customSvg: { html: boardBadgeSvg(m.cls) } });
      if (evBefore?.best && evBefore.best !== m.uci && (BAD.has(m.cls) || m.cls === 'good')) shapes.push(arrow(evBefore.best, 'best'));
    }
    board.show(fen, { lastMove: m ? [m.from, m.to] : undefined, movable: 'both', shapes });
    bar.set(g.evals[ply]);
    // Erklärung
    if (m) {
      const c = CLASSES[m.cls];
      const PHRASE = { brilliant: 'ist brillant', great: 'ist ein großartiger Zug', best: 'ist der beste Zug', excellent: 'ist exzellent', good: 'ist gut',
        book: 'ist ein Buchzug', inaccuracy: 'ist eine Ungenauigkeit', mistake: 'ist ein Fehler', miss: 'verpasst eine Chance', blunder: 'ist ein Patzer' };
      const parts = [classBadge(m.cls, 26), h('span', h('b', m.san), ' ', h('b', { style: { color: c.color } }, PHRASE[m.cls]))];
      explain.replaceChildren(...parts, h('span.spacer'), h('b.mono', formatEval(g.evals[ply])));
      if (['mistake', 'blunder', 'miss'].includes(m.cls)) {
        const pt = patternOfMove(g.moves, g.evals, ply - 1), P = PATTERNS[pt.type];
        explain.append(h('div.small', { style: { width: '100%', marginTop: '4px' } }, h('span.pill', P.icon + ' ' + P.title), ' ', h('span.muted', pt.detail)));
      }
      if (evBefore?.best && evBefore.best !== m.uci && m.cls !== 'book') {
        explain.append(h('div.small.muted', { style: { width: '100%' } }, 'Besser war ', h('b', { style: { color: '#81b64c' } }, uciToSan(m.fenBefore, evBefore.best)), ` (${formatEval(evBefore)})`));
      }
    } else explain.replaceChildren(h('span.muted', 'Startstellung – mit → oder Klick auf einen Zug durchgehen. Du kannst auch selbst Züge auf dem Brett ausprobieren.'));
    const ev = g.evals[ply];
    engineLine.replaceChildren(...(ev?.pv?.length ? [h('b', 'Beste Linie: '), pvToSan(fen, ev.pv), ' ',
      h('button.btn.small', { onclick: () => playLine(fen, ev.pv), title: 'Engine-Linie als Variante Zug für Zug durchgehen' }, '▶ durchspielen')] : []));
    graphBox.replaceChildren(evalGraph(g.evals, g.moves, ply, i => go(i)));
    highlightMoves();
    setNav();
  }

  /** Engine-Linie ab fen als Variante öffnen */
  function playLine(fen, pv) {
    const line = lineFrom(fen, pv);
    if (!line.length) return;
    variation = { base: ply, line, idx: 0, engine: true };
    update();
  }

  // Navigation: in einer Variante zuerst innerhalb der Variante, sonst in der Partie
  const back = () => {
    if (!variation) return go(ply - 1);
    ext.cancel();
    if (variation.idx > 0) { variation.idx--; update(); } else go(variation.base);
  };
  const fwd = () => {
    if (!variation) return go(ply + 1);
    if (ext.busy) return; // rechnet schon – kein zweiter Auftrag
    if (variation.idx < variation.line.length - 1) { variation.idx++; update(); return; }
    // am Ende der Variante: Engine rechnet den nächsten Zug
    const fen = variation.line[variation.idx].fen;
    if (canExtend(fen)) { ext.run(fen, 1); update(); }
  };
  const first = () => variation ? go(variation.base) : go(0);
  const last = () => {
    if (!variation) return go(n);
    ext.cancel();
    variation.idx = variation.line.length - 1; update();
  };
  const flip = () => { board.flip(); bar.flip(); };
  const nav = navBar({ first, prev: back, next: fwd, last, firstTitle: 'Anfang (Pos1) – in einer Variante: zurück zum Ausgangszug' },
    h('button.btn', { onclick: flip, title: 'Brett drehen (F)', 'aria-label': 'Brett drehen' }, '⇅'));
  function setNav() {
    const canBack = variation ? true : ply > 0;
    const atEnd = variation && variation.idx === variation.line.length - 1;
    const canFwd = variation ? !atEnd || canExtend(variation.line[variation.idx].fen) : ply < n;
    const canLast = variation ? !atEnd : ply < n;
    nav.set({ first: canBack, prev: canBack, next: canFwd, last: canLast });
  }

  function highlightMoves() {
    movesEl.querySelectorAll('.mv').forEach(el => el.classList.toggle('cur', !variation && +el.dataset.ply === ply));
    const cur = movesEl.querySelector('.mv.cur');
    if (cur) { const top = cur.offsetTop - movesEl.offsetTop; if (top < movesEl.scrollTop || top > movesEl.scrollTop + movesEl.clientHeight - 30) movesEl.scrollTop = top - 100; }
  }

  function go(i) { ext.cancel(); variation = null; ply = Math.max(0, Math.min(n, i)); update(); }

  // Zugliste
  for (let i = 0; i < n; i += 2) {
    movesEl.append(h('div.num', (i / 2 + 1) + '.'));
    for (const j of [i, i + 1]) {
      const m = g.moves[j];
      movesEl.append(m ? h('div.mv', { 'data-ply': j + 1, onclick: () => go(j + 1) }, ['best', 'excellent', 'good'].includes(m.cls) ? h('span', { style: { width: '14px' } }) : classBadge(m.cls, 14), m.san) : h('div'));
    }
  }

  // Zusammenfassung
  const s = g.summary;
  const clsTable = h('div.cls-table', h('span'), h('span.n.small.muted', 'W'), h('span.n.small.muted', 'S'),
    ...CLASS_ORDER.flatMap(k => [h('span.c', classBadge(k, 18), CLASSES[k].label), h('span.n', { style: { color: CLASSES[k].color } }, s.counts.w[k]), h('span.n', { style: { color: CLASSES[k].color } }, s.counts.b[k])]));
  const accRow = h('div.acc-row',
    h('span.h', ''), h('span.h', 'Genauigkeit'), h('span.h', 'Partie-Elo'),
    h('span', '⚪ ' + g.white.name), h('span.acc-box.w', s.accuracy.w ?? '–'), h('b', s.elo.w ?? '–'),
    h('span', '⚫ ' + g.black.name), h('span.acc-box.b', s.accuracy.b ?? '–'), h('b', s.elo.b ?? '–'));

  const unbindKeys = bindNavKeys({ first, prev: back, next: fwd, last, extra: { f: flip } });

  const meta = [fmtDateLong(g.date), TIME_CLASSES[g.timeClass] || g.timeClass, g.result, g.opening?.name].filter(Boolean).join(' · ');
  root.append(h('div.wrap', { style: { maxWidth: '1280px' } },
    h('div.row', { style: { marginBottom: '14px' } }, h('h1', { style: { margin: 0 } }, `${g.white.name} – ${g.black.name}`), h('span.spacer'),
      g.url ? h('a.btn.small', { href: g.url, target: '_blank', rel: 'noopener' }, 'Original ↗') : null,
      h('button.btn.small', { onclick: async () => { if (!confirm('Analyse löschen?')) return; await store.deleteGame(g.id); window.dispatchEvent(new CustomEvent('games-changed')); location.hash = '#/games'; } }, 'Löschen')),
    h('p.muted', { style: { marginTop: '-6px' } }, meta, ` · Tiefe ${g.depth}`),
    h('div.analysis',
      h('div', topPlayer, h('div.boardwrap', bar.el, boardEl), botPlayer,
        h('div', { style: { marginTop: '8px' } }, nav.el)),
      h('div.side',
        h('div.card', explain, h('div', { style: { marginTop: '8px' } }, engineLine)),
        varBox,
        h('div.card', graphBox),
        h('div.card', movesEl),
        h('div.card', accRow),
        h('div.card', clsTable))),
  ));
  players();
  go(startPly != null && !isNaN(startPly) ? startPly : 0);
  return () => { ext.cancel(); unbindKeys(); stopLive?.(); board.destroy(); };
}
