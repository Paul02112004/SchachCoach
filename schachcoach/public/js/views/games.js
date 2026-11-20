import { h, fmtDate, RESULT_LABEL } from '../ui.js';
import { store } from '../core/store.js';
import { TIME_CLASSES } from '../core/analysis.js';

export async function render(root) {
  const games = await store.listGames();
  const out = h('div');
  let tc = '', q = '';
  const draw = () => {
    const list = games.filter(g => (!tc || g.timeClass === tc) && (!q || `${g.white.name} ${g.black.name} ${g.opening?.name || ''}`.toLowerCase().includes(q)));
    if (!games.length) return out.replaceChildren(h('div.card', h('p', 'Noch keine analysierten Partien.'), h('a.btn.primary', { href: '#/import' }, 'Partien laden')));
    out.replaceChildren(h('div.card', h('table.list',
      h('tr', h('th', 'Datum'), h('th', 'Partie'), h('th', 'Ergebnis'), h('th', 'Genauigkeit'), h('th', 'Eröffnung'), h('th', 'Zeit')),
      list.map(g => {
        const me = g.userColor;
        const accMe = me ? g.accuracy[me] : null;
        return h('tr.click', { onclick: () => location.hash = '#/game/' + g.id },
          h('td', fmtDate(g.date)),
          h('td', h('span', { style: { fontWeight: me === 'w' ? 700 : 400 } }, g.white.name), ' – ', h('span', { style: { fontWeight: me === 'b' ? 700 : 400 } }, g.black.name)),
          h('td', g.userResult ? h('span.pill.' + g.userResult, RESULT_LABEL[g.userResult]) : g.result),
          h('td', me ? h('b', accMe ?? '–') : `${g.accuracy.w ?? '–'} / ${g.accuracy.b ?? '–'}`),
          h('td.muted.small', g.opening?.name || ''),
          h('td.muted', TIME_CLASSES[g.timeClass] || ''));
      }))));
  };
  const tcSel = h('select', { onchange: e => { tc = e.target.value; draw(); } }, h('option', { value: '' }, 'Alle Bedenkzeiten'), ...Object.entries(TIME_CLASSES).map(([k, v]) => h('option', { value: k }, v)));
  const search = h('input', { placeholder: 'Suchen (Gegner, Eröffnung)', oninput: e => { q = e.target.value.toLowerCase(); draw(); } });
  root.append(h('div.wrap', h('div.row', { style: { marginBottom: '16px' } }, h('h1', { style: { margin: 0 } }, `Analysierte Partien (${games.length})`), h('span.spacer'), search, tcSel), out));
  draw();
  const refresh = async () => { games.splice(0, games.length, ...await store.listGames()); draw(); };
  window.addEventListener('games-changed', refresh);
  return () => window.removeEventListener('games-changed', refresh);
}
