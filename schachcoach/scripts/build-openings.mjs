// Baut public/data/openings.json aus dem Lichess-Eröffnungsdatensatz (CC0)
// Quelle: https://github.com/lichess-org/chess-openings
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const epd = fen => fen.split(' ').slice(0, 4).join(' ');
const lines = [];
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(new URL(`../data-src/${f}.tsv`, import.meta.url), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const moves = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
    lines.push({ eco, name, moves });
  }
}

// positions: epd -> {n: name, e: eco, d: depth}; named positions win over intermediate ones
const positions = {};
for (const l of lines) {
  const c = new Chess();
  l.moves.forEach((m, i) => {
    c.move(m);
    const k = epd(c.fen());
    const isEnd = i === l.moves.length - 1;
    const cur = positions[k];
    if (isEnd) {
      if (!cur || !cur.named || l.moves.length < cur.d) positions[k] = { n: l.name, e: l.eco, d: l.moves.length, named: true };
    } else if (!cur) {
      positions[k] = { n: null, e: l.eco, d: i + 1, named: false };
    }
  });
}
// fill unnamed intermediate positions with the name of a shortest line through it
for (const l of lines) {
  const c = new Chess();
  for (const m of l.moves) {
    c.move(m);
    const p = positions[epd(c.fen())];
    if (!p.named && !p.n) p.n = l.name;
  }
}
const pos = {};
for (const [k, v] of Object.entries(positions)) pos[k] = [v.n, v.e];

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/openings.json', import.meta.url),
  JSON.stringify({ lines: lines.map(l => [l.eco, l.name, l.moves.join(' ')]), positions: pos }));
console.log(`${lines.length} Linien, ${Object.keys(pos).length} Buchstellungen`);
