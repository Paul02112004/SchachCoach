// Eröffnungsdaten (Lichess chess-openings, CC0)
let data = null, loading = null;
export async function loadOpenings() {
  if (data) return data;
  if (!loading) loading = fetch('/data/openings.json').then(r => r.json()).then(d => {
    data = {
      positions: d.positions,
      lines: d.lines.map(([eco, name, moves]) => ({ eco, name, moves: moves.split(' '), family: name.split(':')[0].trim(), variation: (name.split(':')[1] || '').split(',')[0].trim() })),
    };
    return data;
  });
  return loading;
}
export const epdOf = fen => fen.split(' ').slice(0, 4).join(' ');

/** Name der Eröffnung: tiefste benannte Buchstellung der Partie */
export function detectOpening(moves, positions) {
  let found = null;
  for (let i = 0; i < Math.min(moves.length, 40); i++) {
    const p = positions[epdOf(moves[i].fenAfter)];
    if (p && p[0]) found = { name: p[0], eco: p[1], ply: i + 1 };
  }
  return found;
}
