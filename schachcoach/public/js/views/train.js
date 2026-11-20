// Training: Aufgaben aus deinen eigenen Fehlern (Leitner-Wiederholung)
import { h, toast, classBadge } from '../ui.js';
import { createBoard, arrow, uciToSan, pvToSan } from '../board.js';
import { store } from '../core/store.js';
import { engine } from '../core/engine.js';
import { CLASSES, wpFor } from '../core/analysis.js';
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
  let puzzle = null, fails = 0, solved = false, session = { ok: 0, bad: 0 };
  const board = createBoard(boardEl, { onMove: (uci, chess) => onUserMove(uci, chess) });

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

  function load() {
    drawChips();
    puzzle = nextPuzzle(); fails = 0; solved = false;
    if (!puzzle) {
      board.show('8/8/8/8/8/8/8/8 w - - 0 1');
      prompt.className = 'feedback ok'; prompt.textContent = '🎉 Alles erledigt in dieser Kategorie!';
      info.replaceChildren(h('p.muted', 'Fällige Wiederholungen kommen in den nächsten Tagen wieder. Analysiere neue Partien für neue Aufgaben.'));
      actions.replaceChildren();
      return;
    }
    const color = puzzle.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    board.orientation(color);
    board.show(puzzle.fen, { movable: color });
    prompt.className = 'feedback';
    prompt.replaceChildren(`${color === 'white' ? '⚪ Weiß' : '⚫ Schwarz'} am Zug – finde den besten Zug!`);
    const c = CLASSES[puzzle.cls];
    const P = PATTERNS[puzzle.pattern];
    info.replaceChildren(P ? h('div.small', { style: { marginBottom: '8px' } }, h('span.pill', P.icon + ' ' + P.title)) : '', h('div.row', classBadge(puzzle.cls, 22), h('span', 'In deiner Partie hast du ', h('b', puzzle.playedSan), ' gespielt – ', h('b', { style: { color: c.color } }, c.label), '.')),
      h('div.small.muted', { style: { marginTop: '6px' } }, new Date(puzzle.date).toLocaleDateString('de-DE'), ' · ', h('a', { href: '#/game/' + puzzle.gameId }, 'Partie öffnen')));
    actions.replaceChildren(
      h('button.btn', { onclick: hint }, '💡 Tipp'),
      h('button.btn', { onclick: () => reveal(false) }, 'Lösung zeigen'),
      h('button.btn', { onclick: () => { record(false); load(); } }, 'Überspringen'));
  }

  const P_tip = () => PATTERNS[puzzle?.pattern]?.tip;
  function hint() {
    if (!puzzle || solved) return;
    board.shapes([{ orig: puzzle.best.slice(0, 2), brush: 'paleBlue' }]);
    fails = Math.max(fails, 1);
  }

  async function onUserMove(uci, chess) {
    if (!puzzle || solved) return;
    let ok = uci === puzzle.best;
    let note = '';
    if (!ok && uci.slice(0, 4) === puzzle.best.slice(0, 4)) ok = true; // Umwandlung
    if (!ok) {
      prompt.className = 'feedback'; prompt.textContent = 'Prüfe deinen Zug …';
      const ev = await engine.quick(chess.fen(), 13);
      const me = puzzle.fen.split(' ')[1];
      const wpBest = wpFor(puzzle.ev, me), wpMine = wpFor(ev, me);
      if (wpMine >= wpBest - 4 && uci !== puzzle.played) { ok = true; note = ' (auch stark – Engine bevorzugt ' + uciToSan(puzzle.fen, puzzle.best) + ')'; }
    }
    if (ok) {
      solved = true;
      record(fails === 0);
      prompt.className = 'feedback ok';
      prompt.textContent = (fails === 0 ? '✓ Richtig!' : '✓ Gelöst') + note;
      const line = puzzle.pv?.[0] === uci ? puzzle.pv.slice(1, 4) : [];
      let delay = 500;
      for (const u of line) { setTimeout(() => { try { board.play(u); } catch {} }, delay); delay += 650; }
      actions.replaceChildren(h('button.btn.primary', { onclick: load }, 'Nächste Aufgabe →'));
      if (P_tip()) info.append(h('div.small', { style: { marginTop: '8px' } }, '💡 ', P_tip()));
      if (puzzle.pv?.length) info.append(h('div.small', { style: { marginTop: '8px' } }, h('b', 'Engine-Linie: '), pvToSan(puzzle.fen, puzzle.pv)));
    } else {
      fails++;
      prompt.className = 'feedback bad';
      prompt.textContent = uci === puzzle.played ? '✗ Das war dein Partiezug – versuch etwas anderes.' : '✗ Nicht ganz – versuch es nochmal.';
      board.shake();
      setTimeout(() => { if (!solved) { board.show(puzzle.fen, { movable: board.orient }); if (fails >= 2) hint(); } }, 700);
    }
  }

  function reveal() {
    if (!puzzle || solved) return;
    solved = true; record(false);
    board.show(puzzle.fen, { shapes: [arrow(puzzle.best)] });
    prompt.className = 'feedback bad';
    prompt.textContent = 'Lösung: ' + uciToSan(puzzle.fen, puzzle.best);
    info.append(h('div.small', { style: { marginTop: '8px' } }, h('b', 'Engine-Linie: '), pvToSan(puzzle.fen, puzzle.pv || [])));
    actions.replaceChildren(h('button.btn.primary', { onclick: load }, 'Nächste Aufgabe →'));
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
    h('div.train', h('div', boardEl), h('div.side', prompt, h('div.card', info), actions))));
  load();
  return () => board.destroy();
}
