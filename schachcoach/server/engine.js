// Stockfish als Kindprozesse (UCI über stdin/stdout) für die Hintergrundanalyse
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const ENGINE = require('stockfish').findEngine('lite-single');

class Proc {
  constructor() {
    this.p = spawn(process.execPath, [ENGINE], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = '';
    this.listeners = new Set();
    this.p.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        this.listeners.forEach(l => l(line));
      }
    });
    this.p.on('exit', () => { this.dead = true; });
    this.ready = this.until('uci', l => l === 'uciok').then(() => {
      this.send('setoption name Hash value 32');
      this.send('setoption name MultiPV value 2');
      return this.until('isready', l => l === 'readyok');
    });
  }
  send(c) { if (!this.dead) this.p.stdin.write(c + '\n'); }
  until(cmd, test) {
    return new Promise(res => { const l = line => { if (test(line)) { this.listeners.delete(l); res(line); } }; this.listeners.add(l); this.send(cmd); });
  }
  analyse(fen, depth) {
    const white = fen.split(' ')[1] === 'w';
    const lines = [];
    return new Promise(resolve => {
      const l = line => {
        if (line.startsWith('info') && line.includes(' pv ') && line.includes('score')) {
          const k = +(/ multipv (\d+)/.exec(line) || [0, 1])[1];
          const sc = / score (cp|mate) (-?\d+)/.exec(line);
          let v = +sc[2]; if (!white) v = -v;
          lines[k - 1] = { depth: +/ depth (\d+)/.exec(line)[1], [sc[1]]: v, pv: line.split(' pv ')[1].trim().split(' ') };
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(l);
          const a = lines[0] || {}, b = lines[1];
          const pick = x => (x.mate != null ? { mate: x.mate } : { cp: x.cp ?? 0 });
          const bm = line.split(' ')[1];
          resolve({ ...pick(a), depth: a.depth || 0, best: bm && bm !== '(none)' ? bm : a.pv?.[0] || null, pv: (a.pv || []).slice(0, 12), second: b?.pv ? { ...pick(b), uci: b.pv[0] } : null });
        }
      };
      this.listeners.add(l);
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
    });
  }
  kill() { try { this.p.kill(); } catch {} }
}

function terminal(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mate: 0, winner: c.turn() === 'w' ? 'b' : 'w', depth: 0, best: null, pv: [], second: null };
  if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, depth: 0, best: null, pv: [], second: null };
  return null;
}

export const defaultServerWorkers = () => Math.max(1, Math.min(4, (os.availableParallelism?.() || os.cpus().length) - 1));

export class EnginePool {
  constructor() { this.procs = []; }
  resize(n) {
    n = Math.max(1, Math.min(8, n | 0));
    while (this.procs.length > n) this.procs.pop().kill();
    while (this.procs.length < n) this.procs.push(new Proc());
    this.procs = this.procs.map(p => p.dead ? new Proc() : p);
  }
  async evaluateAll(fens, depth, onProgress, shouldStop) {
    await Promise.all(this.procs.map(p => p.ready));
    const out = new Array(fens.length);
    let next = 0, done = 0;
    await Promise.all(this.procs.map(async p => {
      while (next < fens.length && !shouldStop?.()) {
        const i = next++;
        out[i] = terminal(fens[i]) || await p.analyse(fens[i], depth);
        onProgress?.(++done / fens.length);
      }
    }));
    if (shouldStop?.()) throw new Error('abgebrochen');
    return out;
  }
  shutdown() { this.procs.forEach(p => p.kill()); this.procs = []; }
}
