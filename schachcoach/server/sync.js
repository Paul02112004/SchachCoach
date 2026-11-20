// Automatischer Import + Hintergrundanalyse
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePgn } from '../public/js/core/analysis.js';
import { buildRecord } from '../public/js/core/record.js';
import { EnginePool, defaultServerWorkers } from './engine.js';
import { chessComArchives, chessComMonth, lichessGames } from './sources.js';

export const SYNC_DEFAULTS = { autoSync: true, syncMinutes: 10, fullHistory: false, depth: 14, historyDepth: 12, workers: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const monthOf = url => url.split('/').slice(-2).join('/');   // "2026/11"
const nowMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export function createSync({ db, root, log = console.log }) {
  const openings = JSON.parse(readFileSync(path.join(root, 'public/data/openings.json'), 'utf8'));
  const pool = new EnginePool();
  const stateFile = path.join(root, 'data', 'sync-state.json');
  let state = null, settings = null;
  const queue = [];                 // { meta, depth, history }
  const queued = new Set();
  let current = null, paused = false, checking = false, working = false, timer = null, nextCheck = null;
  let doneSession = 0, durations = [], lastError = null, lastCheck = null, foundLast = 0, cancelCurrent = false;

  async function loadSettings() { settings = { ...SYNC_DEFAULTS, ...(await db.getKv('settings') || {}) }; return settings; }
  async function loadState() { state = { ccDone: [], liHistoryDone: false, liLastTs: 0, failed: {}, ...(await db.readJson(stateFile, {})) }; }
  const saveState = () => db.writeJson(stateFile, state);
  const names = () => [settings.chesscom, settings.lichess].filter(Boolean).map(x => x.toLowerCase());

  function add(meta, { front = false, history = false } = {}) {
    if (queued.has(meta.id) || current?.meta.id === meta.id) {
      if (front) { const i = queue.findIndex(q => q.meta.id === meta.id); if (i > 0) queue.unshift(...queue.splice(i, 1)); }
      return false;
    }
    const item = { meta, depth: history ? settings.historyDepth : settings.depth, history };
    front ? queue.unshift(item) : queue.push(item);
    queued.add(meta.id);
    return true;
  }

  /** Neue (und bei voller Historie auch alte) Partien suchen */
  async function check({ full } = {}) {
    if (checking) return;
    checking = true; lastError = null;
    let found = 0;
    try {
      await loadSettings();
      if (full != null && full !== settings.fullHistory) { settings.fullHistory = full; await db.setKv('settings', settings); }
      const have = await db.ids();
      const fresh = m => !have.has(m.id) && !state.failed[m.id];
      // ---- Chess.com ----
      if (settings.chesscom) {
        const archives = await chessComArchives(settings.chesscom);
        const cur = nowMonth();
        const historyQueued = queue.some(q => q.history && q.meta.source === 'chesscom');
        const months = archives.slice().reverse()
          .filter((u, i) => i < 2 || (settings.fullHistory && !historyQueued && !state.ccDone.includes(monthOf(u))));
        for (const url of months) {
          const games = await chessComMonth(url);
          const todo = games.filter(fresh).sort((a, b) => b.date - a.date);
          const isRecent = months.indexOf(url) < 2;
          for (const g of todo) if (add(g, { front: isRecent, history: !isRecent })) found++;
          if (!todo.length && monthOf(url) !== cur && !state.ccDone.includes(monthOf(url))) state.ccDone.push(monthOf(url));
          await sleep(400);
        }
      }
      // ---- Lichess ----
      if (settings.lichess) {
        const recent = await lichessGames(settings.lichess, state.liLastTs ? { since: state.liLastTs + 1 } : { max: 60 });
        for (const g of recent.filter(fresh)) if (add(g, { front: true })) found++;
        for (const g of recent) state.liLastTs = Math.max(state.liLastTs, g.createdAt || g.date);
        if (settings.fullHistory && !state.liHistoryDone && !queue.some(q => q.history && q.meta.source === 'lichess')) {
          const all = await lichessGames(settings.lichess);
          const todo = all.filter(fresh);
          for (const g of todo) if (add(g, { history: true })) found++;
          if (!todo.length) state.liHistoryDone = true;
        }
      }
      // Warteschlange: neueste zuerst innerhalb der Historie
      const recentPart = queue.filter(q => !q.history), histPart = queue.filter(q => q.history).sort((a, b) => b.meta.date - a.meta.date);
      queue.splice(0, queue.length, ...recentPart, ...histPart);
      lastCheck = Date.now(); foundLast = found;
      await saveState();
      if (found) log(`  ↻ ${found} neue Partien gefunden – Analyse läuft im Hintergrund`);
    } catch (e) {
      lastError = e.message;
      log('  ⚠ Sync-Fehler: ' + e.message);
    } finally {
      checking = false;
      work();
    }
  }

  async function work() {
    if (working) return;
    working = true;
    try {
      while (queue.length && !paused) {
        const item = queue.shift();
        queued.delete(item.meta.id);
        if (await db.hasGame(item.meta.id)) continue;
        current = { meta: item.meta, progress: 0, started: Date.now(), history: item.history };
        cancelCurrent = false;
        try {
          await loadSettings();
          pool.resize(settings.workers || defaultServerWorkers());
          const { moves, startFen } = parsePgn(item.meta.pgn);
          const fens = [startFen, ...moves.map(m => m.fenAfter)];
          const evals = await pool.evaluateAll(fens, item.depth, p => { current.progress = p; }, () => cancelCurrent || paused);
          const game = buildRecord(item.meta, moves, evals, openings.positions, names(), item.depth);
          await db.saveGame(game.id, game);
          doneSession++; durations.push((Date.now() - current.started) / 1000); if (durations.length > 8) durations.shift();
        } catch (e) {
          if (paused || cancelCurrent) { if (!cancelCurrent) { queue.unshift(item); queued.add(item.meta.id); } }
          else { state.failed[item.meta.id] = e.message; await saveState(); log(`  ⚠ ${item.meta.id}: ${e.message}`); }
        }
        current = null;
      }
    } finally { working = false; }
  }

  function schedule() {
    clearInterval(timer); timer = null; nextCheck = null;
    if (!settings.autoSync || !(settings.chesscom || settings.lichess)) return;
    const ms = Math.max(2, settings.syncMinutes) * 60e3;
    nextCheck = Date.now() + ms;
    timer = setInterval(() => { nextCheck = Date.now() + ms; check(); }, ms);
  }

  return {
    async start() {
      await loadSettings(); await loadState();
      schedule();
      if (settings.autoSync && (settings.chesscom || settings.lichess)) setTimeout(() => check(), 1500);
    },
    async settingsChanged(prev) {
      await loadSettings();
      schedule();
      const changedName = (prev?.chesscom || '') !== (settings.chesscom || '') || (prev?.lichess || '') !== (settings.lichess || '');
      if (changedName) { state.ccDone = []; state.liHistoryDone = false; state.liLastTs = 0; await saveState(); }
      if (settings.autoSync && (changedName || !lastCheck)) check();
    },
    check,
    enqueue(metas, front = true) { let n = 0; for (const m of (front ? metas.slice().reverse() : metas)) if (add(m, { front })) n++; work(); return n; },
    pause() { paused = true; },
    resume() { paused = false; work(); },
    cancel() { queue.length = 0; queued.clear(); cancelCurrent = true; settings.fullHistory = false; db.setKv('settings', settings); },
    async status() {
      const idx = await db.listGames();
      const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      return {
        autoSync: settings.autoSync, fullHistory: settings.fullHistory, paused, checking,
        names: { chesscom: settings.chesscom, lichess: settings.lichess },
        current: current && { id: current.meta.id, label: `${current.meta.white.name} – ${current.meta.black.name}`, date: current.meta.date, progress: current.progress, history: current.history },
        queued: queue.length, queuedNew: queue.filter(q => !q.history).length,
        analyzedTotal: idx.length, doneSession, avgSeconds: avg && Math.round(avg),
        etaSeconds: avg ? Math.round(avg * (queue.length + (current ? 1 - current.progress : 0))) : null,
        lastCheck, nextCheck, foundLast, lastError, failed: Object.keys(state.failed).length,
        workers: settings.workers || defaultServerWorkers(),
      };
    },
    shutdown() { pool.shutdown(); clearInterval(timer); },
  };
}
