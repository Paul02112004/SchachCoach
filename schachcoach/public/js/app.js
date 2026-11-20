// Router + globale Warteschlangen-Anzeige
import { h, fmtEta } from './ui.js';
import { onSync } from './core/pipeline.js';
import { getSettings } from './core/store.js';

const routes = {
  coach: () => import('./views/coach.js'),
  import: () => import('./views/import.js'),
  games: () => import('./views/games.js'),
  game: () => import('./views/game.js'),
  train: () => import('./views/train.js'),
  openings: () => import('./views/openings.js'),
  settings: () => import('./views/settings.js'),
};
const view = document.getElementById('view');
let cleanup = null, seq = 0;

async function route() {
  const [name = 'coach', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const key = routes[name] ? name : 'coach';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key || (key === 'game' && a.dataset.route === 'games')));
  const my = ++seq;
  try { cleanup?.(); } catch {}
  cleanup = null;
  view.replaceChildren(h('div.loading', 'Lädt …'));
  try {
    const mod = await routes[key]();
    if (my !== seq) return;
    view.replaceChildren();
    view.scrollTop = 0;
    cleanup = await mod.render(view, params) || null;
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('div.card.error', h('h2', 'Fehler'), h('p', e.message)));
  }
}
window.addEventListener('hashchange', route);

// Hintergrundanalyse unten in der Navigation
const qEl = document.getElementById('queue');
onSync(st => {
  if (!st.current && !st.queued && !st.checking) { qEl.replaceChildren(); return; }
  const left = st.queued + (st.current ? 1 : 0);
  qEl.replaceChildren(h('a.qbox', { href: '#/import', style: { display: 'block', textDecoration: 'none' } },
    h('div.small', st.checking && !st.current ? 'Suche Partien …' : st.paused ? `Pausiert · ${left}` : `Analyse · noch ${left}`),
    st.current ? h('div.bar', h('div', { style: { width: Math.round(st.current.progress * 100) + '%' } })) : null,
    st.etaSeconds ? h('div.small.muted', '≈ ' + fmtEta(st.etaSeconds)) : null));
});

(async () => {
  const s = await getSettings();
  if (!location.hash) location.hash = (s.chesscom || s.lichess) ? '#/coach' : '#/settings';
  route();
})();
