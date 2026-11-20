// Eröffnungstrainer: Lernen & Abfragen von Eröffnungsbäumen (Lichess-Eröffnungsdaten)
import { h, toast } from '../ui.js';
import { createBoard } from '../board.js';
import { Chess } from 'chess.js';
import { loadOpenings, epdOf } from '../core/openings.js';
import { store } from '../core/store.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export async function render(root, [colorParam, famParam]) {
  const { lines, positions } = await loadOpenings();
  const progress = (await store.getKv('openings')) || {};
  const index = await store.listGames();

  const families = new Map();
  for (const l of lines) { if (!families.has(l.family)) families.set(l.family, []); families.get(l.family).push(l); }
  const famList = [...families.keys()].sort((a, b) => families.get(b).length - families.get(a).length);

  let color = colorParam === 'b' ? 'b' : 'w';
  let family = famParam && families.has(famParam) ? famParam : null;
  let variation = '';
  let mode = 'learn';
  let query = '';

  // Meine Eröffnungen aus den Partien
  const mine = { w: new Map(), b: new Map() };
  for (const g of index) if (g.userColor && g.opening?.name) { const f = g.opening.name.split(':')[0]; mine[g.userColor].set(f, (mine[g.userColor].get(f) || 0) + 1); }

  // ---- Linke Spalte: Auswahl ----
  const colorTabs = h('div.tabs');
  const mineBox = h('div');
  const search = h('input', { placeholder: 'Eröffnung suchen (englische Namen, z.B. Sicilian, Italian)', style: { width: '100%', marginBottom: '10px' }, oninput: e => { query = e.target.value.toLowerCase(); drawList(); } });
  const listEl = h('div.list-scroll');
  // ---- Trainer ----
  const boardEl = h('div.board');
  const title = h('h2', { style: { margin: '0 0 4px' } });
  const subtitle = h('div.muted.small');
  const varChips = h('div.chips', { style: { margin: '10px 0' } });
  const modeTabs = h('div.tabs', { style: { margin: '6px 0 0' } });
  const feedback = h('div.feedback');
  const nameEl = h('div.small.muted', { style: { minHeight: '18px' } });
  const movesEl = h('div.mono.small', { style: { minHeight: '20px', lineHeight: 1.6 } });
  const progEl = h('div');
  const actions = h('div.row');

  let tree = null, run = null;
  const board = createBoard(boardEl, { onMove: (uci, chess, mv) => userMove(mv) });

  const lineKey = l => color + '|' + l.moves.join(' ');
  const mastered = key => (progress[key]?.streak || 0) >= 2;

  function selectedLines() {
    if (!family) return [];
    return families.get(family).filter(l => !variation || l.variation === variation || l.name.split(':')[1]?.trim().startsWith(variation));
  }

  function buildTree(ls) {
    const nodes = new Map(); // key(prefix) -> Map(san -> leafKeys[])
    const leafOf = new Map();
    // Blätter: Linien, die nicht Präfix einer anderen ausgewählten Linie sind
    const strs = ls.map(l => l.moves.join(' '));
    const leaves = ls.filter((l, i) => !strs.some((s, j) => j !== i && s.startsWith(strs[i] + ' ')));
    for (const l of leaves) {
      const key = lineKey(l);
      leafOf.set(key, l);
      for (let i = 0; i < l.moves.length; i++) {
        const pre = l.moves.slice(0, i).join(' ');
        if (!nodes.has(pre)) nodes.set(pre, new Map());
        const ch = nodes.get(pre);
        if (!ch.has(l.moves[i])) ch.set(l.moves[i], []);
        ch.get(l.moves[i]).push(key);
      }
    }
    return { nodes, leaves, leafOf };
  }

  function drawColor() {
    colorTabs.replaceChildren(
      h('button.tab' + (color === 'w' ? '.active' : ''), { onclick: () => { color = 'w'; refreshAll(); } }, '⚪ Ich spiele Weiß'),
      h('button.tab' + (color === 'b' ? '.active' : ''), { onclick: () => { color = 'b'; refreshAll(); } }, '⚫ Ich spiele Schwarz'));
    const fams = [...mine[color].entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    mineBox.replaceChildren(fams.length ? h('div', { style: { marginBottom: '12px' } }, h('div.small.muted', { style: { marginBottom: '6px' } }, 'Aus deinen Partien:'),
      h('div.chips', fams.filter(([f]) => families.has(f)).map(([f, n]) => h('span.chip' + (f === family ? '.active' : ''), { onclick: () => pick(f) }, `${f} (${n})`)))) : '');
  }

  const leafCache = new Map();
  function famProgress(f) {
    if (!leafCache.has(f)) leafCache.set(f, buildTree(families.get(f)).leaves);
    const leaves = leafCache.get(f);
    return [leaves.filter(l => mastered(lineKey(l))).length, leaves.length];
  }

  function drawList() {
    const items = famList.filter(f => !query || f.toLowerCase().includes(query)).slice(0, 120);
    listEl.replaceChildren(...items.map(f => {
      const [d, t] = famProgress(f);
      return h('div.op-item' + (f === family ? '.active' : ''), { onclick: () => pick(f) },
        h('div', h('div', f), h('div.small.muted', `${families.get(f).length} Varianten · ${d}/${t} gelernt`)),
        h('div.progress', h('div', { style: { width: (t ? d / t * 100 : 0) + '%' } })));
    }));
  }

  function pick(f) { family = f; variation = ''; history.replaceState(null, '', `#/openings/${color}/${encodeURIComponent(f)}`); refreshAll(); if (window.innerWidth < 1000) boardEl.scrollIntoView({ behavior: 'smooth' }); }
  function refreshAll() { drawColor(); drawList(); setupTrainer(); }

  function setupTrainer() {
    if (!family) {
      title.textContent = 'Eröffnungstrainer';
      subtitle.textContent = 'Wähle links eine Eröffnung. Im Lernmodus zeigen Pfeile die Buchzüge, im Abfragemodus spielst du sie aus dem Kopf. Der Gegner wählt zufällig unter den Hauptvarianten.';
      varChips.replaceChildren(); modeTabs.replaceChildren(); progEl.replaceChildren(); actions.replaceChildren();
      board.orientation(color === 'w' ? 'white' : 'black'); board.show(START);
      feedback.className = 'feedback'; feedback.textContent = 'Keine Eröffnung gewählt';
      return;
    }
    const vars = [...new Set(families.get(family).map(l => l.variation).filter(Boolean))];
    title.textContent = family;
    subtitle.textContent = `${families.get(family).length} Varianten im Buch · du spielst ${color === 'w' ? 'Weiß' : 'Schwarz'}`;
    varChips.replaceChildren(
      h('span.chip' + (!variation ? '.active' : ''), { onclick: () => { variation = ''; setupTrainer(); } }, 'Alle Varianten'),
      ...vars.slice(0, 40).map(v => h('span.chip' + (v === variation ? '.active' : ''), { onclick: () => { variation = v; setupTrainer(); } }, v)));
    modeTabs.replaceChildren(
      h('button.tab' + (mode === 'learn' ? '.active' : ''), { onclick: () => { mode = 'learn'; modeTabsRefresh(); newRun(); } }, '📘 Lernen'),
      h('button.tab' + (mode === 'quiz' ? '.active' : ''), { onclick: () => { mode = 'quiz'; modeTabsRefresh(); newRun(); } }, '🧠 Abfragen'));
    tree = buildTree(selectedLines());
    newRun();
  }
  const modeTabsRefresh = () => [...modeTabs.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === (mode === 'learn')));

  function drawProgress() {
    const total = tree.leaves.length, done = tree.leaves.filter(l => mastered(lineKey(l))).length;
    progEl.replaceChildren(h('div.row', h('span.small', `Fortschritt: ${done}/${total} Linien sicher`), h('span.spacer'),
      h('button.link.small', { onclick: () => { if (!confirm('Fortschritt für diese Auswahl zurücksetzen?')) return; tree.leaves.forEach(l => delete progress[lineKey(l)]); save(); drawProgress(); drawList(); } }, 'zurücksetzen')),
      h('div.bar', { style: { height: '8px' } }, h('div', { style: { width: (total ? done / total * 100 : 0) + '%', background: 'var(--win)' } })));
  }

  function newRun() {
    run = { moves: [], chess: new Chess(), errors: 0, errorsHere: 0 };
    board.orientation(color === 'w' ? 'white' : 'black');
    actions.replaceChildren(h('button.btn', { onclick: newRun }, '↻ Neue Linie'));
    drawProgress();
    step();
  }

  function children() { return tree.nodes.get(run.moves.join(' ')) || new Map(); }

  function showPos(shapes = []) {
    const myTurn = run.chess.turn() === color;
    const last = run.chess.history({ verbose: true }).slice(-1)[0];
    board.show(run.chess.fen(), { movable: myTurn ? (color === 'w' ? 'white' : 'black') : false, shapes, lastMove: last ? [last.from, last.to] : undefined });
    const p = positions[epdOf(run.chess.fen())];
    nameEl.textContent = p?.[0] ? `${p[1]} · ${p[0]}` : '';
    const hist = run.chess.history();
    movesEl.textContent = hist.map((m, i) => (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + m).join(' ');
  }

  function arrowsForChildren() {
    const c = new Chess(run.chess.fen());
    return [...children().keys()].map(san => { const m = c.move(san); c.undo(); return { orig: m.from, dest: m.to, brush: 'green' }; });
  }

  function step() {
    const ch = children();
    if (!ch.size) return finish();
    if (run.chess.turn() === color) {
      run.errorsHere = 0;
      showPos(mode === 'learn' ? arrowsForChildren() : []);
      feedback.className = 'feedback';
      feedback.textContent = mode === 'learn' ? (ch.size > 1 ? `Spiele einen der ${ch.size} Buchzüge (Pfeile).` : 'Spiele den Buchzug (Pfeil).') : 'Dein Zug – was spielst du hier?';
    } else {
      showPos();
      feedback.className = 'feedback'; feedback.textContent = 'Gegner überlegt …';
      // Gegnerzug: bevorzugt Varianten mit noch nicht gelernten Linien
      const opts = [...ch.entries()].map(([san, keys]) => [san, keys.filter(k => !mastered(k)).length * 3 + 1]);
      let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), san = opts[0][0];
      for (const [s, w] of opts) { if ((r -= w) <= 0) { san = s; break; } }
      setTimeout(() => {
        const mv = run.chess.move(san); run.moves.push(san);
        board.play(mv.from + mv.to + (mv.promotion || ''));
        setTimeout(step, 250);
      }, run.moves.length ? 450 : 300);
    }
  }

  function userMove(mv) {
    if (!run || run.chess.turn() !== color) return;
    const ch = children();
    if (ch.has(mv.san)) {
      run.chess.move(mv.san); run.moves.push(mv.san);
      const others = [...ch.keys()].filter(s => s !== mv.san);
      feedback.className = 'feedback ok';
      feedback.textContent = '✓ ' + mv.san + (others.length ? ` (auch Buch: ${others.slice(0, 3).join(', ')})` : '');
      setTimeout(step, 350);
    } else {
      run.errors++; run.errorsHere++;
      board.shake();
      feedback.className = 'feedback bad';
      const p = positions[epdOf(board.chess.fen())];
      feedback.textContent = `✗ ${mv.san} ist hier nicht in deinem Repertoire` + (p?.[0] ? ` (führt zu: ${p[0]})` : '') + '.';
      setTimeout(() => showPos(run.errorsHere >= 2 || mode === 'learn' ? arrowsForChildren() : []), 600);
    }
  }

  function finish() {
    const key = color + '|' + run.moves.join(' ');
    const line = tree.leafOf.get(key);
    showPos();
    if (line) {
      const s = progress[key] || { ok: 0, fail: 0, streak: 0 };
      if (mode === 'quiz') { if (run.errors === 0) { s.ok++; s.streak++; } else { s.fail++; s.streak = 0; } }
      else if (run.errors > 0) s.streak = 0;
      s.last = Date.now(); progress[key] = s; save();
    }
    feedback.className = 'feedback ' + (run.errors ? 'bad' : 'ok');
    feedback.textContent = (run.errors ? `Linie beendet – ${run.errors} Fehler.` : '🎉 Linie fehlerfrei gespielt!') +
      (mode === 'learn' && !run.errors ? ' Wechsle zu „Abfragen“, um sie zu festigen.' : '');
    if (line) nameEl.textContent = `${line.eco} · ${line.name}`;
    actions.replaceChildren(h('button.btn.primary', { onclick: newRun }, 'Nächste Linie →'));
    drawProgress(); drawList();
  }

  function save() { store.setKv('openings', progress).catch(() => toast('Fortschritt konnte nicht gespeichert werden', 'err')); }

  root.append(h('div.wrap', { style: { maxWidth: '1280px' } },
    h('h1', 'Eröffnungstrainer'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '20px', alignItems: 'start' }, class: 'op-grid' },
      h('div.card', colorTabs, mineBox, search, listEl),
      h('div.train', h('div', boardEl, h('div', { style: { marginTop: '8px' } }, movesEl)),
        h('div.side', h('div.card', title, subtitle, varChips, modeTabs), feedback, nameEl, actions, h('div.card', progEl))))));
  refreshAll();
  return () => board.destroy();
}
