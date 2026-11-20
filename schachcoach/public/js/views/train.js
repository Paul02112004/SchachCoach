// Training: Aufgaben aus deinen eigenen Fehlern (Leitner-Wiederholung)
import { h, toast, classBadge, navBar, bindNavKeys, moveLine, moveNo, evalBar } from '../ui.js';
import { createBoard, arrow, uciToSan, lineFrom } from '../board.js';
import { store } from '../core/store.js';
import { engine } from '../core/engine.js';
import { CLASSES, wpFor, formatEval } from '../core/analysis.js';
import { lineExtender, canExtend } from '../extend.js';
import { PATTERNS, PATTERN_VERSION } from '../core/patterns.js';
import { ensurePatterns } from '../core/pipeline.js';

const FILTERS = {
  all: ['Alle', () => true],
  blunder: ['Patzer', p => p.cls === 'blunder'],
  mistake: ['Fehler', p => p.cls === 'mistake'],
  miss: ['Verpasst', p => p.cls === 'miss'],
  opening: ['Eröffnung', p => p.phase === 'opening'],
  middlegame: ['Mittelspiel', p => p.phase === 'middlegame'],
  endgame: ['Endspiel', p => p.phase === 'endgame'],
  tactics: ['Taktik', p => p.tactical],
  conversion: ['Verwertung', p => p.wpBefore >= 75],
  defense: ['Verteidigung', p => p.wpBefore <= 25],
};
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export async function render(root, [filterKey = 'all']) {
  const index = await store.listGames();
  if (index.some(g => g.userColor && g.patterns?.v !== PATTERN_VERSION)) await ensurePatterns(index);
  const all = index.flatMap(g => g.puzzles || []);
  for (const [k, P] of Object.entries(PATTERNS)) FILTERS['p:' + k] = [P.icon + ' ' + P.title, p => p.pattern === k];
  const progress = (await store.getKv('puzzles')) || {};
  let filter = FILTERS[filterKey] ? filterKey : 'all';
  if (!all.length) {
    root.append(h('div.wrap', h('h1', 'Training'), h('div.card', h('p', 'Noch keine Aufgaben. Aufgaben entstehen automatisch aus deinen Fehlern, Patzern und verpassten Chancen in analysierten Partien.'), h('a.btn.primary', { href: '#/import' }, 'Partien analysieren'))));
    return;
  }

  const boardEl = h('div.board');
  const prompt = h('div.feedback');
  const info = h('div');
  const actions = h('div.row');
  const stats = h('div.small.muted');
  const chips = h('div.chips');
  const posInfo = h('span');
  const backHint = h('span.navhint', 'Zurück zur Aufgabe mit ⏭');
  const solBox = h('div.small', { style: { marginTop: '8px' } });
  let puzzle = null, fails = 0, solved = false, checking = false, hinted = false, showPlayed = false, session = { ok: 0, bad: 0 };
  let myColor = 'white', seq = 0;
  // Stellungen: pos[0] = Partieanfang, pos[i] = nach dem i-ten Zug { fen, san, lastMove, fenBefore, uci }.
  // pos[base] = Aufgabenstellung; nach dem Lösen hängt dahinter die Lösungslinie (engineTail = Engine-Linie).
  // Nach dem Lösen sind eigene Züge erlaubt: explore = { from } → pos[from+1…] ist eine eigene Variante,
  // solutionPos hält solange die Lösungslinie (ohne Variante ist solutionPos === pos).
  let pos = [], base = 0, cur = 0, engineTail = false, solutionPos = null, explore = null;
  const board = createBoard(boardEl, { onMove: (uci, chess, mv) => onUserMove(uci, chess, mv) });

  // Bewertungsbalken + Text unter dem Brett – erst nach dem Lösen, damit nichts verraten wird
  const bar = evalBar();
  const evalInfo = h('div.evalinfo');
  let stopLive = null;
  const stopAnalysis = () => { stopLive?.(); stopLive = null; };
  const inExplore = () => !!explore && cur > explore.from;

  // Am Ende der Linie rechnet die Engine auf Wunsch weiter (▶ / → bzw. „+5 Züge“)
  const plus5Btn = h('button.btn.small', { onclick: () => extend5(), title: 'Die Engine rechnet 5 weitere Halbzüge (abbrechbar durch Navigieren)' }, '+5 Züge');
  const ext = lineExtender({
    onStep: step => { pos.push(step); cur = pos.length - 1; render(); },
    onBusy: b => { nav.busy('next', b); plus5Btn.disabled = b || !pos.length || !canExtend(pos[pos.length - 1].fen); },
    onDone: () => render(),
  });
  const canGrow = () => solved && !showPlayed && cur === pos.length - 1 && canExtend(pos[cur].fen);
  function extend5() {
    if (!puzzle || !solved || ext.busy) return;
    clearTimers();
    showPlayed = false;
    cur = pos.length - 1;
    ext.run(pos[cur].fen, 5);
    render();
  }

  // laufende Timeouts (Rücksetzen nach Fehlversuch) – werden beim Navigieren abgebrochen
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  // Partien pro gameId zwischenspeichern
  const games = new Map();
  const getGame = id => {
    if (!games.has(id)) games.set(id, store.getGame(id).catch(e => { games.delete(id); throw e; }));
    return games.get(id);
  };

  function goTo(i) {
    if (!puzzle || !pos.length) return;
    ext.cancel();
    clearTimers();
    showPlayed = false;
    cur = Math.max(0, Math.min(pos.length - 1, i));
    render();
  }
  function next() {
    if (!puzzle || ext.busy) return; // rechnet schon – kein zweiter Auftrag
    if (showPlayed || cur < pos.length - 1) return goTo(cur + 1);
    if (canGrow()) { ext.run(pos[cur].fen, 1); render(); } // Ende der Linie: Engine rechnet den nächsten Zug
  }
  const navActs = { first: () => goTo(0), prev: () => goTo(cur - 1), next, last: () => goTo(pos.length - 1) };
  const nav = navBar({ ...navActs, firstTitle: 'Partieanfang (Pos1)', lastTitle: 'Zur Aufgabe bzw. ans Ende der Lösung (Ende)' });
  const unbindKeys = bindNavKeys(navActs);

  const isDue = p => { const s = progress[p.id]; return !s || s.due <= Date.now(); };
  function pool() { return all.filter(FILTERS[filter][1]); }
  function nextPuzzle() {
    const list = pool();
    const due = list.filter(isDue);
    // zuerst fällige Wiederholungen (niedrige Box), dann neue – zufällig gemischt
    const reviews = due.filter(p => progress[p.id]).sort((a, b) => progress[a.id].box - progress[b.id].box);
    const fresh = due.filter(p => !progress[p.id]);
    const pickFrom = reviews.length ? reviews.slice(0, 5) : fresh;
    return pickFrom.length ? pickFrom[Math.floor(Math.random() * pickFrom.length)] : null;
  }
  function drawChips() {
    chips.replaceChildren(...Object.entries(FILTERS).map(([k, [label, fn]]) => {
      const n = all.filter(fn).length, d = all.filter(p => fn(p) && isDue(p)).length;
      return n ? h('span.chip' + (k === filter ? '.active' : ''), { onclick: () => { filter = k; history.replaceState(null, '', '#/train/' + k); load(); } }, `${label} ${d}/${n}`) : null;
    }).filter(Boolean));
    const learned = all.filter(p => progress[p.id]?.box >= 3).length;
    stats.replaceChildren(`${all.length} Aufgaben · ${learned} sicher gelernt · diese Sitzung: ${session.ok} ✓ / ${session.bad} ✗`);
  }

  /** Partiezüge bis zur Aufgabenstellung; ohne passende Partie nur die Aufgabenstellung selbst */
  function gamePositions(p, game) {
    const ms = game?.moves;
    if (!ms || ms[p.ply]?.fenBefore !== p.fen) return [{ fen: p.fen }];
    return [{ fen: ms[0].fenBefore }, ...ms.slice(0, p.ply).map(m => ({ fen: m.fenAfter, san: m.san, lastMove: [m.from, m.to], fenBefore: m.fenBefore, uci: m.uci }))];
  }

  async function load() {
    const my = ++seq;
    clearTimers();
    ext.cancel();
    stopAnalysis();
    drawChips();
    const next = nextPuzzle();
    let game = null;
    if (next) { try { game = await getGame(next.gameId); } catch { /* ohne Partie: nur Aufgabenstellung */ } }
    if (my !== seq) return;
    puzzle = next; fails = 0; solved = false; checking = false; hinted = false; showPlayed = false; engineTail = false;
    solutionPos = null; explore = null;
    solBox.replaceChildren();
    bar.neutral(); evalInfo.replaceChildren();
    if (!puzzle) {
      pos = []; cur = base = 0;
      board.show('8/8/8/8/8/8/8/8 w - - 0 1');
      prompt.className = 'feedback ok'; prompt.textContent = '🎉 Alles erledigt in dieser Kategorie!';
      info.replaceChildren(h('p.muted', 'Fällige Wiederholungen kommen in den nächsten Tagen wieder. Analysiere neue Partien für neue Aufgaben.'));
      actions.replaceChildren();
      renderNav();
      return;
    }
    pos = gamePositions(puzzle, game);
    base = cur = pos.length - 1;
    myColor = puzzle.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    board.orientation(myColor);
    bar.orient(myColor);
    prompt.className = 'feedback';
    prompt.replaceChildren(`${myColor === 'white' ? '⚪ Weiß' : '⚫ Schwarz'} am Zug – finde den besten Zug!`);
    const c = CLASSES[puzzle.cls];
    const P = PATTERNS[puzzle.pattern];
    info.replaceChildren(P ? h('div.small', { style: { marginBottom: '8px' } }, h('span.pill', P.icon + ' ' + P.title)) : '', h('div.row', classBadge(puzzle.cls, 22), h('span', 'In deiner Partie hast du ', h('b', puzzle.playedSan), ' gespielt – ', h('b', { style: { color: c.color } }, c.label), '.')),
      h('div.small.muted', { style: { marginTop: '6px' } }, new Date(puzzle.date).toLocaleDateString('de-DE'), ' · ', h('a', { href: '#/game/' + puzzle.gameId }, 'Partie öffnen')));
    actions.replaceChildren(
      h('button.btn', { onclick: hint }, '💡 Tipp'),
      h('button.btn', { onclick: reveal }, 'Lösung zeigen'),
      h('button.btn', { onclick: () => { record(false); load(); } }, 'Überspringen'));
    render();
  }

  function render() {
    if (!puzzle) return;
    stopAnalysis();
    const p = pos[cur];
    const atTask = cur === base && !inExplore();
    let fen, shapes;
    if (showPlayed) {
      const m = lineFrom(puzzle.fen, [puzzle.played])[0];
      fen = m?.fen || puzzle.fen;
      shapes = [arrow(puzzle.played, 'red')];
      board.show(fen, { lastMove: m?.lastMove, shapes });
    } else {
      fen = p.fen;
      shapes = [];
      if (atTask && !solved && hinted) shapes.push({ orig: puzzle.best.slice(0, 2), brush: 'paleBlue' });
      if (atTask && solved && pos[base + 1] && !(explore && explore.from <= base)) shapes.push(arrow(pos[base + 1].uci));
      // nach dem Lösen ist jede Stellung frei bespielbar (beide Farben)
      const movable = solved ? 'both' : atTask && !checking ? myColor : false;
      board.show(fen, { lastMove: p.lastMove, movable, shapes });
    }
    renderNav();
    if (solved) { renderSolution(); liveEval(fen, shapes); }
  }

  /** Live-Bewertung der angezeigten Stellung (nur nach dem Lösen); ohne feste Pfeile zeigt ein Pfeil den besten Zug */
  function liveEval(fen, shapes) {
    if (ext.busy) { evalInfo.replaceChildren(h('span', 'Engine rechnet den nächsten Zug …')); return; }
    evalInfo.replaceChildren(h('span', 'Engine rechnet …'));
    const withArrow = !shapes.length;
    stopLive = engine.liveAnalyse(fen, r => {
      bar.set(r);
      const txt = r.mate === 0 ? 'Matt' : r.depth === 0 && !r.best ? 'Remis' : null;
      evalInfo.replaceChildren(txt ? h('b', txt) : h('span', h('b', formatEval(r)), ` · Tiefe ${r.depth}`));
      if (withArrow) board.shapes([arrow(r.best)].filter(Boolean));
    }, 18);
  }

  function renderNav() {
    const end = pos.length - 1;
    nav.set({ first: cur > 0, prev: cur > 0, next: cur < end || showPlayed || canGrow(), last: cur < end });
    if (!puzzle) { posInfo.replaceChildren(); backHint.hidden = true; return; }
    const p = showPlayed ? { san: puzzle.playedSan, fenBefore: puzzle.fen } : pos[cur];
    const where = showPlayed ? 'dein Partiezug' : inExplore() ? 'eigene Variante' : cur === base ? 'Aufgabenstellung' : cur > base ? 'Lösungslinie' : 'Partieverlauf';
    posInfo.replaceChildren(p.san ? h('b', 'Zug ' + moveNo(p.fenBefore) + ' ' + p.san) : h('b', cur === base ? 'Aufgabe' : 'Startstellung'),
      pos[end].fenBefore ? ' von ' + moveNo(pos[end].fenBefore) : '', ' · ' + where);
    backHint.hidden = solved || cur >= base;
  }

  /** Lösungslinie (Züge nach der Aufgabenstellung) setzen */
  function setLine(ucis, isEngine) {
    const src = explore ? solutionPos : pos; // eine eigene Variante kann den Partieverlauf schon verändert haben
    pos = solutionPos = src.slice(0, base + 1).concat(lineFrom(puzzle.fen, ucis));
    explore = null;
    engineTail = isEngine;
  }
  const engineUcis = () => puzzle.pv?.[0] === puzzle.best ? puzzle.pv : [puzzle.best];

  /** Eigene Variante verwerfen, Lösungslinie wiederherstellen */
  function restoreSolution() { if (explore) { pos = solutionPos; explore = null; } }
  function backToSolution() {
    if (!explore) return;
    const from = explore.from;
    ext.cancel();
    restoreSolution();
    goTo(from > base ? from : base + 1);
  }

  function renderSolution() {
    const sol = explore ? solutionPos : pos;
    const onSol = !showPlayed && !inExplore() && cur > base;
    const tailIdx = onSol ? cur - base - 1 : -1;
    const pickSol = i => { restoreSolution(); goTo(base + 1 + i); };
    const kids = [];
    if (!engineTail && sol[base + 1]) kids.push(h('div', h('b', 'Dein Zug: '), moveLine(sol.slice(base + 1), tailIdx, pickSol)));
    const pickEngine = i => { if (!engineTail) setLine(engineUcis(), true); else restoreSolution(); goTo(base + 1 + i); };
    const engLine = engineTail ? sol.slice(base + 1) : lineFrom(puzzle.fen, engineUcis());
    kids.push(h('div', h('b', 'Engine-Linie: '), moveLine(engLine, engineTail ? tailIdx : -1, pickEngine)));
    if (explore) {
      const fromSt = pos[explore.from];
      kids.push(h('div', { style: { marginTop: '6px' } }, h('b', 'Eigene Variante'),
        h('span.muted', fromSt.san ? ` (nach ${moveNo(fromSt.fenBefore)} ${fromSt.san})` : ' (ab Startstellung)'), h('b', ': '),
        moveLine(pos.slice(explore.from + 1), inExplore() && !showPlayed ? cur - explore.from - 1 : -1, i => goTo(explore.from + 1 + i))));
    }
    plus5Btn.disabled = ext.busy || !canExtend(pos[pos.length - 1].fen);
    kids.push(h('div.row', { style: { marginTop: '8px', gap: '8px' } }, plus5Btn,
      explore ? h('button.btn.small', { onclick: backToSolution }, '↺ Zurück zur Lösung') : null,
      h('span.muted', 'Tipp: Du kannst jetzt selbst Züge ausprobieren.')));
    if (P_tip()) kids.push(h('div', { style: { marginTop: '6px' } }, '💡 ', P_tip()));
    solBox.replaceChildren(...kids);
    playedBtn.textContent = showPlayed ? 'Lösung zeigen' : 'Partiezug zeigen';
  }

  const playedBtn = h('button.btn', { onclick: () => {
    clearTimers();
    ext.cancel();
    // der Partiezug zweigt von der Aufgabenstellung ab – eine Variante davor wird verworfen
    if (explore && explore.from < base) restoreSolution();
    showPlayed = !showPlayed;
    // der Partiezug zweigt von der Aufgabenstellung ab: ◀ geht von dort zurück, ▶ in die Lösung
    cur = showPlayed ? base : Math.min(base + 1, pos.length - 1);
    render();
  } }, 'Partiezug zeigen');

  function afterSolve() {
    actions.replaceChildren(h('button.btn.primary', { onclick: load }, 'Nächste Aufgabe →'), playedBtn);
    info.append(solBox);
    showPlayed = false;
    cur = Math.min(base + 1, pos.length - 1);
    render();
  }

  const P_tip = () => PATTERNS[puzzle?.pattern]?.tip;
  function hint() {
    if (!puzzle || solved) return;
    hinted = true;
    fails = Math.max(fails, 1);
    if (!checking) goTo(base);
  }

  /** Nach dem Lösen: eigener Zug → Variante ab der aktuellen Stellung (ohne Einfluss auf die Bewertung) */
  function exploreMove(uci, chess, mv) {
    ext.cancel();
    clearTimers();
    if (showPlayed) return render();
    if (pos[cur + 1]?.uci === uci) return goTo(cur + 1); // gleicher Zug wie in der Linie → einfach weiter
    if (!explore || cur < explore.from) explore = { from: cur };
    pos = pos.slice(0, cur + 1).concat({ fen: chess.fen(), san: mv.san, lastMove: [mv.from, mv.to], fenBefore: mv.before, uci });
    cur = pos.length - 1;
    render();
  }

  async function onUserMove(uci, chess, mv) {
    if (puzzle && solved) return exploreMove(uci, chess, mv);
    if (!puzzle || solved || checking || cur !== base) return;
    const my = seq;
    let ok = uci === puzzle.best;
    let note = '';
    if (!ok && uci.slice(0, 4) === puzzle.best.slice(0, 4)) ok = true; // Umwandlung
    if (!ok) {
      prompt.className = 'feedback'; prompt.textContent = 'Prüfe deinen Zug …';
      checking = true;
      renderNav();
      let ev = null;
      try { ev = await engine.quick(chess.fen(), 13); } catch { ev = null; }
      if (my !== seq) return;
      checking = false;
      if (solved) return; // inzwischen „Lösung zeigen“ gedrückt
      if (ev) {
        const me = puzzle.fen.split(' ')[1];
        const wpBest = wpFor(puzzle.ev, me), wpMine = wpFor(ev, me);
        if (wpMine >= wpBest - 4 && uci !== puzzle.played) { ok = true; note = ' (auch stark – Engine bevorzugt ' + uciToSan(puzzle.fen, puzzle.best) + ')'; }
      }
    }
    if (ok) {
      solved = true;
      record(fails === 0);
      clearTimers();
      prompt.className = 'feedback ok';
      prompt.textContent = (fails === 0 ? '✓ Richtig!' : '✓ Gelöst') + note;
      const isEngine = engineUcis()[0] === uci;
      setLine(isEngine ? engineUcis() : [uci], isEngine);
      afterSolve();
    } else {
      fails++;
      if (fails >= 2) hinted = true;
      prompt.className = 'feedback bad';
      prompt.textContent = uci === puzzle.played ? '✗ Das war dein Partiezug – versuch etwas anderes.' : '✗ Nicht ganz – versuch es nochmal.';
      // falls während der Prüfung navigiert wurde, zeigt das Brett schon eine andere Stellung
      if (cur === base && !showPlayed) { board.shake(); later(render, 700); } else render();
    }
  }

  function reveal() {
    if (!puzzle || solved) return;
    solved = true; record(false);
    clearTimers();
    prompt.className = 'feedback bad';
    prompt.textContent = 'Lösung: ' + uciToSan(puzzle.fen, puzzle.best);
    setLine(engineUcis(), true);
    afterSolve();
  }

  function record(success) {
    const s = progress[puzzle.id] || { box: 0, tries: 0, ok: 0 };
    s.tries++; if (success) { s.ok++; s.box = Math.min(5, s.box + 1); } else s.box = 0;
    s.due = Date.now() + INTERVAL_DAYS[s.box] * 864e5 + (success ? 0 : 10 * 60e3);
    progress[puzzle.id] = s;
    success ? session.ok++ : session.bad++;
    store.setKv('puzzles', progress).catch(() => toast('Fortschritt konnte nicht gespeichert werden', 'err'));
    drawChips();
  }

  root.append(h('div.wrap', { style: { maxWidth: '1200px' } },
    h('h1', 'Training aus deinen Fehlern'),
    h('div.card', { style: { padding: '14px 18px' } }, chips, h('div', { style: { marginTop: '8px' } }, stats)),
    h('div.train',
      h('div', h('div.boardwrap', bar.el, boardEl), evalInfo, h('div', { style: { marginTop: '8px' } }, nav.el), h('div.navinfo', posInfo, backHint)),
      h('div.side', prompt, h('div.card', info), actions))));
  load();
  return () => { seq++; clearTimers(); ext.cancel(); stopAnalysis(); unbindKeys(); board.destroy(); };
}
