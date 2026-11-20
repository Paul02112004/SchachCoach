import { h, toast, fmtDate, resultFor, RESULT_LABEL, fmtEta, fmtAgo } from '../ui.js';
import { fetchChessCom, fetchLichess, parsePgnText } from '../core/importers.js';
import { store, getSettings, saveSettings } from '../core/store.js';
import { enqueue, pending, onSync, syncApi } from '../core/pipeline.js';
import { TIME_CLASSES } from '../core/analysis.js';

let lastTab = null;
const cache = {};

export async function render(root) {
  const s = await getSettings();
  const tabs = [['chesscom', 'Chess.com'], ['lichess', 'Lichess'], ['pgn', 'PGN einfügen']];
  let tab = lastTab || (s.chesscom ? 'chesscom' : s.lichess ? 'lichess' : 'pgn');
  const body = h('div');
  const tabBar = h('div.tabs');
  const draw = () => {
    lastTab = tab;
    tabBar.replaceChildren(...tabs.map(([k, l]) => h('button.tab' + (k === tab ? '.active' : ''), { onclick: () => { tab = k; draw(); } }, l)));
    body.replaceChildren(tab === 'pgn' ? pgnPane() : sitePane(tab, tab === 'chesscom' ? s.chesscom : s.lichess));
  };
  const syncCard = h('div.card.synccard');
  root.append(h('div.wrap', h('h1', 'Partien laden'), syncCard, h('h2', { style: { margin: '26px 0 12px' } }, 'Einzelne Partien auswählen'), tabBar, body));
  draw();
  const off = onSync(st => drawSync(syncCard, st, s));
  return off;
}

function drawSync(card, st, s) {
  const hasName = st.names.chesscom || st.names.lichess;
  if (!hasName) {
    card.replaceChildren(h('h2', '🔄 Automatischer Import'), h('p', 'Trag unter Optionen deinen Chess.com- oder Lichess-Namen ein. Dann holt SchachCoach deine Partien selbstständig und analysiert sie im Hintergrund.'), h('a.btn.primary', { href: '#/settings' }, 'Zu den Optionen'));
    return;
  }
  const who = [st.names.chesscom && `Chess.com: ${st.names.chesscom}`, st.names.lichess && `Lichess: ${st.names.lichess}`].filter(Boolean).join(' · ');
  const left = st.queued + (st.current ? 1 : 0);
  const auto = h('input', { type: 'checkbox', checked: st.autoSync, onchange: async e => { await saveSettings({ autoSync: e.target.checked }); toast(e.target.checked ? 'Automatischer Import an' : 'Automatischer Import aus', 'ok'); } });
  card.replaceChildren(...[
    h('div.row', h('h2', { style: { margin: 0 } }, '🔄 Automatischer Import'), h('span.spacer'),
      h('label.row', { style: { gap: '8px', cursor: 'pointer' } }, auto, `alle ${s.syncMinutes} min nach neuen Partien schauen`)),
    h('p.muted.small', who, ` · ${st.analyzedTotal} Partien analysiert`, st.lastCheck ? ` · zuletzt geprüft ${fmtAgo(st.lastCheck)}` : '', st.failed ? ` · ${st.failed} nicht lesbar` : ''),
    st.lastError ? h('div.feedback.bad', { style: { fontSize: '14px', marginBottom: '10px' } }, '⚠ ' + st.lastError) : null,
    st.current ? h('div', { style: { margin: '6px 0 12px' } },
      h('div.row', h('span', st.paused ? '⏸ Pausiert: ' : '♟ Analysiert gerade: ', h('b', st.current.label), h('span.muted', ` (${fmtDate(st.current.date)})`)), h('span.spacer'), h('b', Math.round(st.current.progress * 100) + ' %')),
      h('div.bar', { style: { height: '8px' } }, h('div', { style: { width: Math.round(st.current.progress * 100) + '%' } }))) : null,
    left ? h('p', `Warteschlange: `, h('b', st.queuedNew + (st.current && !st.current.history ? 1 : 0)), ' neue', st.queued - st.queuedNew ? [' · ', h('b', st.queued - st.queuedNew), ' aus deiner Historie'] : '',
      st.etaSeconds ? ` · fertig in ≈ ${fmtEta(st.etaSeconds)}` : st.current ? ' · Dauer wird geschätzt …' : '') :
      h('p', st.checking ? '🔎 Suche nach neuen Partien …' : '✓ Alles analysiert.' + (st.autoSync && st.nextCheck ? ` Nächste Prüfung ${new Date(st.nextCheck).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.` : '')),
    h('div.row',
      h('button.btn.primary', { disabled: st.checking, onclick: () => { syncApi.run(); toast('Suche nach neuen Partien …'); } }, 'Jetzt prüfen'),
      st.fullHistory
        ? h('span.pill', { style: { padding: '8px 12px' } }, st.queued - st.queuedNew || st.current?.history ? '📚 Gesamte Historie wird importiert' : '📚 Historie importiert')
        : h('button.btn', { onclick: () => { if (confirm('Alle deine bisherigen Partien holen und analysieren? Das kann je nach Anzahl einige Stunden dauern – neue Partien werden trotzdem immer zuerst analysiert.')) { syncApi.run({ full: true }); toast('Historie wird geladen …', 'ok'); } } }, '📚 Gesamte Historie importieren'),
      left ? (st.paused ? h('button.btn', { onclick: syncApi.resume }, '▶ Fortsetzen') : h('button.btn', { onclick: syncApi.pause }, '⏸ Pausieren')) : null,
      left ? h('button.btn', { onclick: () => { if (confirm('Warteschlange leeren und Historie-Import stoppen?')) syncApi.cancel(); } }, 'Stoppen') : null),
    h('p.muted.small', { style: { marginTop: '12px', marginBottom: 0 } }, 'Läuft auf dem Server – du kannst den Browser schließen, solange das SchachCoach-Fenster (der Server) offen bleibt. Neue Partien kommen immer vor der Historie dran.')].filter(Boolean));
}

function sitePane(site, defaultUser) {
  const user = h('input', { value: defaultUser || '', placeholder: 'Benutzername' });
  const max = h('select', [25, 50, 100, 200].map(n => h('option', { value: n, selected: n === 50 }, `${n} Partien`)));
  const tc = h('select', h('option', { value: '' }, 'Alle Bedenkzeiten'), ...['bullet', 'blitz', 'rapid', 'daily'].map(k => h('option', { value: k }, TIME_CLASSES[k])));
  const out = h('div');
  const load = async () => {
    const name = user.value.trim(); if (!name) return toast('Bitte einen Namen eingeben', 'err');
    out.replaceChildren(h('div.loading', 'Lade Partien …'));
    try {
      const key = site + name.toLowerCase() + max.value;
      const games = cache[key] || (cache[key] = site === 'chesscom' ? await fetchChessCom(name, +max.value) : await fetchLichess(name, +max.value));
      const filtered = games.filter(g => !tc.value || g.timeClass === tc.value);
      const done = new Set((await store.listGames()).map(g => g.id));
      out.replaceChildren(gameTable(filtered, done, name));
    } catch (e) { out.replaceChildren(h('div.card.error', 'Fehler: ' + e.message)); }
  };
  tc.onchange = load;
  user.onkeydown = e => e.key === 'Enter' && load();
  if (defaultUser) setTimeout(load, 0);
  return h('div', h('div.card', h('div.row', user, max, tc, h('button.btn.primary', { onclick: load }, 'Laden'))), out);
}

function gameTable(games, done, me) {
  if (!games.length) return h('div.card.muted', 'Keine Partien gefunden.');
  const lower = me.toLowerCase();
  const todo = games.filter(g => !done.has(g.id));
  const rows = games.map(g => {
    const color = g.white.name.toLowerCase() === lower ? 'w' : g.black.name.toLowerCase() === lower ? 'b' : null;
    const opp = color === 'b' ? g.white : g.black;
    const r = color ? resultFor(g, color) : null;
    const analyzed = done.has(g.id);
    const open = () => { if (!analyzed) pending.set(g.id, { ...g, userColor: color }); location.hash = '#/game/' + g.id; };
    return h('tr.click', { onclick: open },
      h('td', fmtDate(g.date)),
      h('td', color ? (color === 'w' ? '⚪ ' : '⚫ ') : '', 'vs ', h('b', opp.name), opp.rating ? h('span.muted', ` (${opp.rating})`) : ''),
      h('td', r ? h('span.pill.' + r, RESULT_LABEL[r]) : g.result),
      h('td.muted', TIME_CLASSES[g.timeClass] || g.timeClass),
      h('td', analyzed ? h('span.pill', '✓ analysiert') : h('button.btn.small', { onclick: e => { e.stopPropagation(); enqueue([{ ...g, userColor: color }]); e.target.disabled = true; e.target.textContent = 'In Warteschlange'; } }, 'Analysieren')));
  });
  return h('div.card',
    h('div.row', { style: { marginBottom: '12px' } },
      h('b', `${games.length} Partien`), h('span.muted', `· ${games.length - todo.length} bereits analysiert`), h('span.spacer'),
      todo.length ? h('button.btn.primary', { onclick: async e => {
        enqueue(todo.map(g => ({ ...g, userColor: g.white.name.toLowerCase() === lower ? 'w' : g.black.name.toLowerCase() === lower ? 'b' : null })));
        e.target.disabled = true; e.target.textContent = 'In der Warteschlange';
        toast('Analyse läuft im Hintergrund – Fortschritt oben bzw. links unten.', 'ok');
      } }, `Alle ${todo.length} analysieren`) : null),
    h('p.muted.small', 'Ein Klick auf eine Zeile öffnet die Partie (noch nicht analysierte werden dann sofort im Browser analysiert).'),
    h('table.list', h('tr', h('th', 'Datum'), h('th', 'Gegner'), h('th', 'Ergebnis'), h('th', 'Zeit'), h('th', '')), rows));
}

function pgnPane() {
  const ta = h('textarea', { placeholder: '[Event "..."]\n1. e4 e5 2. Nf3 ...' });
  const side = h('select', h('option', { value: '' }, 'Meine Farbe: automatisch'), h('option', { value: 'w' }, 'Ich hatte Weiß'), h('option', { value: 'b' }, 'Ich hatte Schwarz'));
  return h('div.card',
    h('p.muted.small', 'Eine oder mehrere Partien im PGN-Format einfügen.'),
    ta, h('div.row', { style: { marginTop: '12px' } }, side, h('button.btn.primary', { onclick: () => {
      try {
        const games = parsePgnText(ta.value).map(g => ({ ...g, userColor: side.value || undefined }));
        if (games.length === 1) { pending.set(games[0].id, games[0]); location.hash = '#/game/' + games[0].id; }
        else { enqueue(games); toast(`${games.length} Partien in der Warteschlange`, 'ok'); }
      } catch (e) { toast(e.message, 'err'); }
    } }, 'Analysieren')));
}
