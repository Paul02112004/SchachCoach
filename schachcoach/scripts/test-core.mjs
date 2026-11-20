// Testet Klassifizierung in Node mit echtem Stockfish
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parsePgn, classifyGame, summarizeSide, categoryMoves, formatEval } from '../public/js/core/analysis.js';
import { Chess } from 'chess.js';
const require = createRequire(import.meta.url);
const openings = JSON.parse(readFileSync(new URL('../public/data/openings.json', import.meta.url)));

const pgn = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : `[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const depth = +process.env.DEPTH || 14;
const sf = await new Promise(res => { const e = require('stockfish')('lite-single', l => e._l?.(l)); e._l = null; res(e); });
const send = c => sf.processCommand(c);
const until = (cmd, t) => new Promise(r => { sf._l = l => { if (t(l)) r(l); }; send(cmd); });
await until('uci', l => l === 'uciok'); send('setoption name MultiPV value 2'); await until('isready', l => l === 'readyok');

function analyse(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return Promise.resolve({ mate: 0, winner: c.turn() === 'w' ? 'b' : 'w', best: null, pv: [] });
  const white = fen.split(' ')[1] === 'w'; const lines = [];
  return new Promise(r => {
    sf._l = line => {
      if (line.startsWith('info') && line.includes(' pv ') && line.includes('score')) {
        const k = +(/ multipv (\d+)/.exec(line) || [0, 1])[1]; const sc = / score (cp|mate) (-?\d+)/.exec(line);
        let v = +sc[2]; if (!white) v = -v; lines[k - 1] = { [sc[1]]: v, pv: line.split(' pv ')[1].split(' ') };
      } else if (line.startsWith('bestmove')) {
        const a = lines[0], b = lines[1]; const pick = x => x.mate != null ? { mate: x.mate } : { cp: x.cp };
        r({ ...pick(a), best: line.split(' ')[1], pv: a.pv, second: b ? { ...pick(b), uci: b.pv[0] } : null });
      }
    };
    send('position fen ' + fen); send('go depth ' + depth);
  });
}
const { moves, startFen } = parsePgn(pgn);
const fens = [startFen, ...moves.map(m => m.fenAfter)];
const t = Date.now(); const evals = [];
for (const f of fens) evals.push(await analyse(f));
console.log(`${fens.length} Stellungen in ${(Date.now() - t) / 1000}s`);
const cls = classifyGame(moves, evals, openings.positions);
moves.forEach((m, i) => console.log(String(Math.floor(i / 2) + 1).padStart(3), m.color, m.san.padEnd(7), cls[i].cls.padEnd(11), 'loss', String(cls[i].loss).padEnd(5), formatEval(evals[i + 1]).padEnd(6), cls[i].phase));
console.log('W', summarizeSide(moves, cls, evals, 'w'));
console.log('B', summarizeSide(moves, cls, evals, 'b'));
const cm = categoryMoves(moves, cls, 'w'); console.log(Object.fromEntries(Object.entries(cm).map(([k, v]) => [k, v.length])));
sf.terminate?.(); process.exit(0);
