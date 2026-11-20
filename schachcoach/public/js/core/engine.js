// Stockfish (WASM) im Browser: Worker-Pool für die Partieanalyse + Live-Engine
import { Chess } from 'chess.js';

const ENGINE_URL = '/engine/stockfish.js';

class EngineWorker {
  constructor() {
    this.w = new Worker(ENGINE_URL);
    this.listeners = new Set();
    this.w.onmessage = e => { const line = typeof e.data === 'string' ? e.data : String(e.data); this.listeners.forEach(l => l(line)); };
    this.ready = this.cmdUntil('uci', l => l === 'uciok').then(() => {
      this.send('setoption name Hash value 32');
      this.send('setoption name MultiPV value 2');
      return this.cmdUntil('isready', l => l === 'readyok');
    });
    this.busy = false;
    this.multipv = 2;
  }
  send(cmd) { this.w.postMessage(cmd); }
  cmdUntil(cmd, test) {
    return new Promise(resolve => {
      const l = line => { if (test(line)) { this.listeners.delete(l); resolve(line); } };
      this.listeners.add(l);
      this.send(cmd);
    });
  }
  setMultiPv(n) { if (n !== this.multipv) { this.multipv = n; this.send(`setoption name MultiPV value ${n}`); } }

  /** Analysiert eine Stellung bis Tiefe `depth`. onInfo erhält Zwischenstände. Ergebnis: Sicht Weiß */
  analyse(fen, { depth = 14, movetime, multipv = 2, onInfo } = {}) {
    const white = fen.split(' ')[1] === 'w';
    const lines = [];
    return new Promise(resolve => {
      const l = line => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes('score')) {
          const d = +/ depth (\d+)/.exec(line)[1];
          const k = +(/ multipv (\d+)/.exec(line) || [0, 1])[1];
          const sc = / score (cp|mate) (-?\d+)/.exec(line);
          const pv = line.split(' pv ')[1].trim().split(' ');
          let v = +sc[2]; if (!white) v = -v;
          lines[k - 1] = { depth: d, [sc[1]]: v, pv };
          if (onInfo && k === 1) onInfo(toResult(lines, d));
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(l);
          this.busy = false;
          resolve(toResult(lines, lines[0]?.depth || 0, line.split(' ')[1]));
        }
      };
      this.busy = true;
      this.listeners.add(l);
      this.setMultiPv(multipv);
      this.send('position fen ' + fen);
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    });
  }
  stop() { this.send('stop'); }
  terminate() { this.w.terminate(); }
}

function toResult(lines, depth, bestmove) {
  const a = lines[0] || {}, b = lines[1];
  const pick = x => (x.mate != null ? { mate: x.mate } : { cp: x.cp ?? 0 });
  return {
    ...pick(a), depth, best: (bestmove && bestmove !== '(none)') ? bestmove : a.pv?.[0] || null, pv: (a.pv || []).slice(0, 12),
    second: b && b.pv ? { ...pick(b), uci: b.pv[0] } : null,
  };
}

/** Terminalstellungen ohne Engine bewerten */
export function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mate: 0, winner: c.turn() === 'w' ? 'b' : 'w', depth: 0, best: null, pv: [], second: null };
  if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, depth: 0, best: null, pv: [], second: null };
  return null;
}

class Pool {
  constructor() { this.workers = []; this.size = 0; this.live = null; }
  configure(size) {
    size = Math.max(1, Math.min(8, size | 0));
    while (this.workers.length > size) this.workers.pop().terminate();
    while (this.workers.length < size) this.workers.push(new EngineWorker());
    this.size = size;
  }
  evaluateAll(fens, opts = {}) {
    // nacheinander ausführen, damit sich Analysen nicht die Worker teilen
    const run = (this.lock || Promise.resolve()).then(() => this._evaluateAll(fens, opts));
    this.lock = run.catch(() => {});
    return run;
  }
  async _evaluateAll(fens, { depth = 14, workers, onProgress, signal } = {}) {
    this.configure(workers || this.size || defaultWorkers());
    await Promise.all(this.workers.map(w => w.ready));
    const out = new Array(fens.length);
    let next = 0, done = 0;
    const run = async w => {
      while (next < fens.length) {
        if (signal?.aborted) return;
        const i = next++;
        out[i] = terminalEval(fens[i]) || await w.analyse(fens[i], { depth, multipv: 2 });
        done++;
        onProgress?.(done / fens.length);
      }
    };
    await Promise.all(this.workers.map(run));
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    return out;
  }
  /** Live-Analyse einer Stellung (eigener Worker); gibt stop-Funktion zurück */
  liveAnalyse(fen, onInfo, depth = 20) {
    if (!this.live) this.live = new EngineWorker();
    const w = this.live;
    const term = terminalEval(fen);
    if (term) { onInfo(term, true); return () => {}; }
    let stopped = false;
    const start = async () => {
      await w.ready;
      if (w.busy) { w.stop(); await new Promise(r => { const t = setInterval(() => { if (!w.busy) { clearInterval(t); r(); } }, 10); }); }
      if (stopped) return;
      const r = await w.analyse(fen, { depth, multipv: 1, onInfo: x => { if (!stopped) onInfo(x, false); } });
      if (!stopped) onInfo(r, true);
    };
    start();
    return () => { stopped = true; if (w.busy) w.stop(); };
  }
  /** Schnelle Einzelbewertung (z.B. für Trainingsaufgaben) */
  async quick(fen, depth = 12) {
    if (!this.live) this.live = new EngineWorker();
    const w = this.live; await w.ready;
    if (w.busy) { w.stop(); await new Promise(r => { const t = setInterval(() => { if (!w.busy) { clearInterval(t); r(); } }, 10); }); }
    return terminalEval(fen) || w.analyse(fen, { depth, multipv: 1 });
  }
}

export function defaultWorkers() {
  const c = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(4, c - 1));
}

export const engine = new Pool();
