// Kleine UI-Helfer
import { CLASSES, winPct, formatEval } from './core/analysis.js';

/** h('div.card#x', {onclick}, ...children) */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [, tag = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(sel);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return el;
}
export const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

export function classBadge(cls, size = 18) {
  const c = CLASSES[cls]; if (!c) return h('span');
  return h('span.badge', { title: c.label, style: { background: c.color, width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.55) + 'px' } }, c.sym);
}
/** Badge als SVG für das Brett (customSvg; Koordinaten 0..100 je Feld) */
export function boardBadgeSvg(cls) {
  const c = CLASSES[cls]; if (!c) return '';
  return `<g><circle cx="86" cy="14" r="15" fill="${c.color}" stroke="#fff" stroke-width="2.5"/><text x="86" y="15" text-anchor="middle" dominant-baseline="central" font-size="${c.sym.length > 1 ? 15 : 19}" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">${c.sym}</text></g>`;
}

export const fmtDate = ms => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
export const fmtDateLong = ms => new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
export const resultFor = (g, color) => g.result === '1/2-1/2' ? 'draw' : g.result === '*' ? null : (g.result === '1-0') === (color === 'w') ? 'win' : 'loss';
export const RESULT_LABEL = { win: 'Sieg', loss: 'Niederlage', draw: 'Remis' };

export function toast(msg, type = '') {
  const el = h('div.toast' + (type ? '.' + type : ''), msg);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

/** Bewertungsgraph (Sicht Weiß), klickbar */
export function evalGraph(evals, moves, current, onPick) {
  const W = 600, H = 110, n = evals.length - 1 || 1;
  const pts = evals.map((e, i) => [i / n * W, H - winPct(e) / 100 * H]);
  const area = `M0,${H} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  const marks = moves.map((m, i) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.cls)
    ? `<circle cx="${pts[i + 1][0].toFixed(1)}" cy="${pts[i + 1][1].toFixed(1)}" r="3.5" fill="${CLASSES[m.cls].color}" stroke="#222" stroke-width="1"/>` : '').join('');
  const cx = (current / n * W).toFixed(1);
  const el = svg(`<svg class="evalgraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <rect width="${W}" height="${H}" fill="#3a3937"/><path d="${area}" fill="#f0f0f0"/>
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#888" stroke-width="1" stroke-dasharray="4 4"/>
    <line class="cur" x1="${cx}" x2="${cx}" y1="0" y2="${H}" stroke="#ffb400" stroke-width="2"/>${marks}</svg>`);
  el.addEventListener('click', e => {
    const r = el.getBoundingClientRect();
    onPick(Math.round((e.clientX - r.left) / r.width * n));
  });
  return el;
}

/** Halbkreis-Tacho für Elo (0..3000) */
export function gauge(value, max = 3000) {
  const R = 120, cx = 150, cy = 150, a0 = -225, a1 = 45;
  const ang = v => (a0 + (a1 - a0) * Math.max(0, Math.min(1, v / max))) * Math.PI / 180;
  const pt = (a, r = R) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arc = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); const large = to - from > Math.PI ? 1 : 0; return `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2}`; };
  const ticks = [0, 500, 1000, 1500, 2000, 2500, 3000].map(v => {
    const a = ang(v), [x, y] = pt(a, R + 26), [tx1, ty1] = pt(a, R + 12), [tx2, ty2] = pt(a, R + 6);
    return `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#777" stroke-width="2"/><text x="${x}" y="${y}" fill="#999" font-size="12" text-anchor="middle" dominant-baseline="middle">${v}</text>`;
  }).join('');
  const v = value ?? 0, [nx, ny] = pt(ang(v), R);
  return svg(`<svg class="gauge" viewBox="-28 -14 356 270">
    <path d="${arc(ang(0), ang(max))}" stroke="#2a2a2a" stroke-width="22" fill="none" stroke-linecap="round"/>
    ${value != null ? `<path d="${arc(ang(0), ang(v))}" stroke="#ffbf1f" stroke-width="22" fill="none" stroke-linecap="round"/>
    <circle cx="${nx}" cy="${ny}" r="9" fill="#fff"/>` : ''}
    ${ticks}
    <text x="150" y="158" fill="#fff" font-size="54" font-weight="800" text-anchor="middle">${value ?? '–'}</text>
    <text x="150" y="196" fill="#aaa" font-size="15" text-anchor="middle">Geschätzte Elo</text></svg>`);
}

/** Kleine Linie (Sparkline) */
export function sparkline(values, { w = 220, h = 120, color = '#ffbf1f' } = {}) {
  const vals = values.filter(v => v != null);
  if (vals.length < 2) return h_('div.muted.small', 'Zu wenig Daten');
  const min = Math.min(...vals), max = Math.max(...vals), pad = (max - min) * 0.15 || 20;
  const lo = min - pad, hi = max + pad;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 50) + 45, h - 10 - (v - lo) / (hi - lo) * (h - 20)]);
  const ylabels = [hi - pad, (hi + lo) / 2, lo + pad].map(v => { const y = h - 10 - (v - lo) / (hi - lo) * (h - 20); return `<text x="0" y="${y}" fill="#888" font-size="11" dominant-baseline="middle">${Math.round(v)}</text><line x1="40" x2="${w}" y1="${y}" y2="${y}" stroke="#333"/>`; }).join('');
  const last = pts[pts.length - 1];
  return svg(`<svg class="spark" viewBox="0 0 ${w} ${h}">${ylabels}
    <polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#fff"/></svg>`);
}
const h_ = h;

export const evalText = formatEval;
export const icon = name => ICONS[name] || '';
const ICONS = {
  coach: '🧠', home: '⬇️', games: '📚', train: '🎯', openings: '📖', settings: '⚙️',
};

export function fmtEta(s) { if (s < 90) return Math.max(1, Math.round(s)) + ' s'; if (s < 5400) return Math.round(s / 60) + ' min'; const hh = Math.floor(s / 3600); return `${hh} h ${Math.round((s - hh * 3600) / 60)} min`; }
export const fmtAgo = ms => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'gerade eben'; if (s < 3600) return `vor ${Math.round(s / 60)} min`; if (s < 86400) return `vor ${Math.round(s / 3600)} h`; return fmtDate(ms); };

/** Zugnummer für einen Zug aus Stellung fenBefore: „12.“ (Weiß) bzw. „12…“ (Schwarz) */
export const moveNo = fenBefore => { const p = fenBefore.split(' '); return p[5] + (p[1] === 'w' ? '.' : '…'); };

/** Navigationsleiste ⏮ ◀ ▶ ⏭ (+ weitere Knöpfe); set({ first, prev, next, last }) schaltet die Knöpfe an/aus */
export function navBar(acts, ...extra) {
  const mk = (sym, title, fn) => h('button.btn', { onclick: fn, title, 'aria-label': title }, sym);
  const b = { first: mk('⏮', acts.firstTitle || 'Anfang (Pos1)', acts.first), prev: mk('◀', 'Zurück (←)', acts.prev),
    next: mk('▶', 'Vor (→)', acts.next), last: mk('⏭', acts.lastTitle || 'Ende (Ende)', acts.last) };
  return { el: h('div.navbtns', b.first, b.prev, b.next, b.last, ...extra),
    set(en) { for (const k in b) b[k].disabled = !en[k]; },
    /** Ladezustand eines Knopfs (z.B. ▶, während die Engine den nächsten Zug rechnet) */
    busy(k, on) { b[k].classList.toggle('loading', !!on); b[k].setAttribute('aria-busy', on ? 'true' : 'false'); } };
}

/**
 * Bewertungsbalken (Sicht Weiß) links neben dem Brett.
 * evalBar(orientation) → { el, set(ev), orient('white'|'black'), flip(), neutral() }
 * neutral(): grau ohne Zahl (z.B. im Training, solange die Aufgabe nicht gelöst ist)
 */
export function evalBar(orientation = 'white') {
  const fill = h('div.white'), num = h('div.num');
  const el = h('div.evalbar', fill, num);
  let orient = orientation, last = null;
  const api = {
    el,
    set(ev) {
      last = ev;
      el.classList.remove('neutral');
      el.classList.toggle('flipped', orient === 'black');
      const wp = winPct(ev);
      fill.style.height = wp + '%';
      num.textContent = formatEval(ev).replace('+', '');
      const whiteBetter = wp >= 50;
      const atBottom = (orient === 'white') === whiteBetter; // Zahl auf der Seite des Besseren
      Object.assign(num.style, atBottom ? { bottom: '4px', top: '' } : { top: '4px', bottom: '' });
      num.style.color = whiteBetter ? '#222' : '#eee';
    },
    orient(o) { orient = o; el.classList.toggle('flipped', o === 'black'); if (last) api.set(last); },
    flip() { api.orient(orient === 'white' ? 'black' : 'white'); },
    neutral() { last = null; el.classList.add('neutral'); fill.style.height = '50%'; num.textContent = ''; },
  };
  return api;
}

/** Tastatur: ← → zurück/vor, Pos1/↑ Anfang, Ende/↓ Ende (+ extra: { taste: fn }). Gibt die Aufräumfunktion zurück. */
export function bindNavKeys({ first, prev, next, last, extra = {} }) {
  const fn = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const a = { ArrowLeft: prev, ArrowRight: next, ArrowUp: first, Home: first, ArrowDown: last, End: last, ...extra }[e.key];
    if (!a) return;
    e.preventDefault();
    a();
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

/** Klickbare Zugfolge; items: [{ san, fenBefore }], cur = Index des aktuellen Zugs (−1 = keiner) */
export function moveLine(items, cur, onPick) {
  return h('span.pvline', items.map((m, i) => {
    const white = m.fenBefore.split(' ')[1] === 'w';
    return [white || i === 0 ? h('span.muted', moveNo(m.fenBefore) + ' ') : null,
      h('span.pm' + (i === cur ? '.cur' : ''), { onclick: () => onPick(i) }, m.san), ' '];
  }));
}
