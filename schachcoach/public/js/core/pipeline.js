// Einzelpartie im Browser analysieren; Stapel- und Hintergrundanalyse übernimmt der Server
import { parsePgn } from './analysis.js';
import { engine, defaultWorkers } from './engine.js';
import { loadOpenings } from './openings.js';
import { store, getSettings, myNames } from './store.js';
import { buildRecord, addPatterns } from './record.js';
import { PATTERN_VERSION } from './patterns.js';

export async function analyzeGame(meta, { onProgress, signal } = {}) {
  const settings = await getSettings();
  const { positions } = await loadOpenings();
  const { moves, startFen } = parsePgn(meta.pgn);
  const fens = [startFen, ...moves.map(m => m.fenAfter)];
  const evals = await engine.evaluateAll(fens, { depth: settings.depth, workers: settings.workers || defaultWorkers(), onProgress, signal });
  const game = buildRecord(meta, moves, evals, positions, await myNames(), settings.depth);
  await store.saveGame(game);
  return game;
}

/** Ältere Analysen um Fehlermuster ergänzen (ohne neue Engine-Analyse) */
export async function ensurePatterns(index, onProgress) {
  const todo = index.filter(g => g.userColor && g.patterns?.v !== PATTERN_VERSION);
  let n = 0;
  for (const s of todo) {
    try {
      const game = await store.getGame(s.id);
      addPatterns(game);
      await store.saveGame(game);
      Object.assign(s, { patterns: game.summary.patterns, puzzles: game.summary.puzzles });
    } catch (e) { console.warn('Muster für', s.id, e); }
    onProgress?.(++n / todo.length);
  }
  return todo.length;
}

/** Partien, die beim Öffnen direkt analysiert werden sollen */
export const pending = new Map();

// ---------- Server-Warteschlange ----------
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
/** Partien an den Server zur Analyse geben (front = ganz vorne einreihen) */
export const enqueue = (metas, front = true) => post('/api/sync/queue', { games: metas, front });
export const syncApi = {
  status: () => fetch('/api/sync/status').then(r => r.json()),
  run: (opts) => post('/api/sync/run', opts),
  pause: () => post('/api/sync/pause'),
  resume: () => post('/api/sync/resume'),
  cancel: () => post('/api/sync/cancel'),
};

const listeners = new Set();
export const onSync = l => { listeners.add(l); if (lastStatus) l(lastStatus); return () => listeners.delete(l); };
let lastStatus = null, lastDone = -1;
async function poll() {
  try {
    const s = await syncApi.status();
    if (lastDone >= 0 && s.analyzedTotal !== lastDone) window.dispatchEvent(new CustomEvent('games-changed'));
    lastDone = s.analyzedTotal;
    lastStatus = s;
    listeners.forEach(l => l(s));
  } catch {}
  setTimeout(poll, lastStatus?.current ? 2000 : 5000);
}
poll();
