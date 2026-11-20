// Coach-Übersicht: geschätzte Elo, Elo pro Kategorie, Trends, Eröffnungen
import { h, gauge, sparkline, fmtDate, RESULT_LABEL } from '../ui.js';
import { store, getSettings } from '../core/store.js';
import { CATEGORIES, TIME_CLASSES, accuracyToElo, aggregateAccuracy } from '../core/analysis.js';
import { fetchChessComStats, fetchLichessUser } from '../core/importers.js';
import { PATTERNS, PATTERN_VERSION } from '../core/patterns.js';
import { ensurePatterns } from '../core/pipeline.js';

let state = { tc: null, days: 30 };
const PERIODS = [[7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '1 Jahr'], [0, 'Alle']];

export async function render(root) {
  const s = await getSettings();
  const all = (await store.listGames()).filter(g => g.userColor);
  if (!all.length) {
    root.append(h('div.wrap', h('h1', 'Coach'), h('div.card',
      h('h2', 'Noch keine Daten'),
      h('p', 'Lade deine Partien und lass sie analysieren – danach siehst du hier deine geschätzte Elo, deine Elo pro Kategorie (Eröffnung, Taktik, Endspiel …), Trends und Eröffnungsstatistiken.'),
      !(s.chesscom || s.lichess) ? h('p.muted', 'Trag zuerst unter Optionen deinen Benutzernamen ein.') : null,
      h('a.btn.primary', { href: (s.chesscom || s.lichess) ? '#/import' : '#/settings' }, (s.chesscom || s.lichess) ? 'Partien laden' : 'Zu den Optionen'))));
    return;
  }
  // häufigste Bedenkzeit als Standard
  if (!state.tc) {
    const cnt = {}; all.forEach(g => cnt[g.timeClass] = (cnt[g.timeClass] || 0) + 1);
    state.tc = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  }
  // ältere Analysen um Fehlermuster ergänzen
  if (all.some(g => g.patterns?.v !== PATTERN_VERSION)) {
    const msg = h('div.loading', 'Werte Fehlermuster aus …');
    root.append(msg);
    await ensurePatterns(all, p => { msg.textContent = `Werte Fehlermuster aus … ${Math.round(p * 100)} %`; });
    msg.remove();
  }
  const ext = { stats: null, li: null, avatar: null };
  const content = h('div');
  root.append(h('div.wrap', content));
  const draw = () => content.replaceChildren(...build(all, s, ext, draw).filter(Boolean));
  draw();
  // externe Ratings/Avatar im Hintergrund nachladen
  Promise.all([
    s.chesscom ? fetchChessComStats(s.chesscom) : null,
    s.lichess ? fetchLichessUser(s.lichess) : null,
    s.chesscom ? fetch('/api/chesscom/player/' + encodeURIComponent(s.chesscom)).then(r => r.ok ? r.json() : null).catch(() => null) : null,
  ]).then(([stats, li, prof]) => { ext.stats = stats; ext.li = li; ext.avatar = prof?.avatar; draw(); });
  const refresh = async () => { all.splice(0, all.length, ...(await store.listGames()).filter(g => g.userColor)); draw(); };
  window.addEventListener('games-changed', refresh);
  return () => window.removeEventListener('games-changed', refresh);
}

function build(all, s, ext, redraw) {
  const now = Date.now();
  const games = all.filter(g => g.timeClass === state.tc && (!state.days || now - g.date <= state.days * 864e5)).sort((a, b) => a.date - b.date);
  const tcs = [...new Set(all.map(g => g.timeClass))];

  const filters = h('div.row', { style: { marginBottom: '18px' } },
    h('div.tabs', { style: { margin: 0 } }, tcs.map(tc => h('button.tab' + (tc === state.tc ? '.active' : ''), { onclick: () => { state.tc = tc; redraw(); } }, TIME_CLASSES[tc] || tc))),
    h('span.spacer'),
    h('select', { onchange: e => { state.days = +e.target.value; redraw(); } }, PERIODS.map(([d, l]) => h('option', { value: d, selected: d === state.days }, l))));

  if (!games.length) return [filters, h('div.card.muted', 'Keine analysierten Partien in diesem Zeitraum. Wähle einen längeren Zeitraum oder lade neue Partien.')];

  const me = g => g.userColor;
  const accs = games.map(g => g.accuracy[me(g)]).filter(x => x != null);
  const avgAcc = accs.reduce((a, b) => a + b, 0) / accs.length;
  const estElo = accuracyToElo(avgAcc);
  const wins = games.filter(g => g.userResult === 'win').length, draws = games.filter(g => g.userResult === 'draw').length, losses = games.filter(g => g.userResult === 'loss').length;
  const winRate = Math.round((wins + draws / 2) / games.length * 100);
  // Rating
  const ratings = games.map(g => g.userRating).filter(Boolean);
  const extRating = currentRating(ext, state.tc);
  const rating = extRating ?? ratings[ratings.length - 1] ?? null;
  const delta = ratings.length > 1 ? (rating - ratings[0]) : null;
  // Trend (gleitender Durchschnitt über 5 Partien)
  const trend = games.map((g, i) => { const w = games.slice(Math.max(0, i - 4), i + 1).map(x => x.accuracy[me(x)]).filter(x => x != null); return accuracyToElo(w.reduce((a, b) => a + b, 0) / w.length); });
  const name = s.chesscom || s.lichess;

  // ---------- Kopf ----------
  const head = h('div.coach-head', { style: { marginBottom: '20px' } },
    h('div.avatar', ext.avatar ? h('img', { src: ext.avatar, alt: '' }) : '♟'),
    h('div', h('div.uname', name), h('div.muted', `${games.length} Partien · ${TIME_CLASSES[state.tc]} · ${PERIODS.find(p => p[0] === state.days)[1]}`)),
    h('span.spacer'),
    h('div.pill', { style: { fontSize: '14px', padding: '8px 14px', background: '#2b2b2b' } }, levelLabel(estElo)));

  // ---------- Wie du spielst ----------
  const how = h('div.card', h('h2', 'So spielst du gerade'),
    h('div.how',
      h('div', { style: { textAlign: 'center' } }, gauge(estElo),
        h('div.muted.small', 'Aus deiner durchschnittlichen Genauigkeit geschätzt – ein Richtwert, keine offizielle Wertung.')),
      h('div',
        h('div.stat', h('div.k', h('span', '🏆 Gewinnquote'), h('div.wlbar', h('div', { style: { flex: wins, background: 'var(--win)' } }), h('div', { style: { flex: draws, background: 'var(--draw)' } }), h('div', { style: { flex: losses, background: 'var(--loss)' } }))), h('div.v', winRate + ' %')),
        h('div.stat', h('div.k', h('span', '🎯 Genauigkeit')), h('div.v', avgAcc.toFixed(1))),
        h('div.stat', h('div.k', h('span', '📈 Rating'), extRating ? h('span.small.muted', 'live') : null),
          h('div.v', rating ?? '–', delta != null ? h('span.delta.' + (delta >= 0 ? 'up' : 'down'), (delta >= 0 ? '↑ +' : '↓ ') + delta) : null))),
      h('div', sparkline(trend), h('div.small', { style: { marginTop: '8px', lineHeight: 1.7 } },
        'Jetzt ', h('b', { style: { color: 'var(--accent)' } }, trend[trend.length - 1]), h('br'),
        'Höchste ', h('b', Math.max(...trend)), h('br'), 'Niedrigste ', h('b', Math.min(...trend))))));

  // ---------- Letzte Partien ----------
  const last = games.slice(-25);
  const strip = h('div.card',
    h('div.row', { style: { marginBottom: '14px' } }, h('h2', { style: { margin: 0 } }, `Deine letzten ${last.length} Partien`), h('span.spacer'),
      h('span.small', h('span', { style: { color: 'var(--win)' } }, '■ '), `${last.filter(g => g.userResult === 'win').length} gewonnen  `,
        h('span', { style: { color: 'var(--draw)' } }, '■ '), `${last.filter(g => g.userResult === 'draw').length} remis  `,
        h('span', { style: { color: 'var(--loss)' } }, '■ '), `${last.filter(g => g.userResult === 'loss').length} verloren`)),
    h('div.squares', last.map(g => h('div.sq.' + (g.userResult || 'draw'), {
      title: `${fmtDate(g.date)} · ${RESULT_LABEL[g.userResult] || g.result} gegen ${g.userColor === 'w' ? g.black.name : g.white.name} · Genauigkeit ${g.accuracy[g.userColor] ?? '–'}`,
      onclick: () => location.hash = '#/game/' + g.id,
    }, (g.counts[g.userColor]?.brilliant ? '!!' : g.accuracy[g.userColor] >= 90 ? '🔥' : '')))));

  const cats = categoryStats(games);
  return [filters, head, verdictCard(games, cats, rating), how, strip, categoryCard(games, rating, cats), patternsCard(games), habitsCard(games), mistakesCard(games), openingsCard(games)];
}

function currentRating(ext, tc) {
  const key = { bullet: 'chess_bullet', blitz: 'chess_blitz', rapid: 'chess_rapid', daily: 'chess_daily' }[tc];
  if (ext.stats && key && ext.stats[key]?.last?.rating) return ext.stats[key].last.rating;
  const lk = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence' }[tc];
  if (ext.li?.perfs?.[lk]?.rating) return ext.li.perfs[lk].rating;
  return null;
}

function levelLabel(elo) {
  if (elo == null) return '–';
  if (elo < 600) return '🌱 Einsteiger'; if (elo < 1000) return '♟ Fortgeschrittener Anfänger'; if (elo < 1400) return '😎 Durchschnitt';
  if (elo < 1800) return '💪 Stark'; if (elo < 2200) return '🔥 Experte'; return '👑 Meisterniveau';
}

// ---------- Elo pro Kategorie ----------
function categoryStats(games) {
  const pooled = Object.fromEntries(Object.keys(CATEGORIES).map(k => [k, []]));
  games.forEach(g => { for (const k in pooled) pooled[k].push(...(g.categories?.[k] || [])); });
  return Object.entries(CATEGORIES).map(([k, c]) => {
    const n = pooled[k].length;
    const acc = n >= 8 ? aggregateAccuracy(pooled[k]) : null;
    return { k, ...c, n, acc, elo: accuracyToElo(acc) };
  });
}

function categoryCard(games, rating, cats) {
  const valid = cats.filter(c => c.elo != null);
  const best = valid.length > 1 ? valid.reduce((a, b) => a.elo >= b.elo ? a : b) : null;
  const worst = valid.length > 1 ? valid.reduce((a, b) => a.elo <= b.elo ? a : b) : null;
  const top = Math.max(2000, ...valid.map(c => c.elo + 200), (rating || 0) + 300);
  const cols = h('div.elo-cols',
    cats.map(c => h('div.elo-col' + (c === best ? '.best' : c === worst ? '.worst' : ''), { title: `${c.hint}\n${c.n} Züge · Genauigkeit ${c.acc ? c.acc.toFixed(1) : '–'}` },
      h('div.val', c.elo ?? '–'),
      h('div.tube', h('div.fill', { style: { height: (c.elo ? c.elo / top * 100 : 0) + '%' } })),
      h('div.lbl', c.label),
      h('div.sub', c.elo ? `${c.acc.toFixed(1)} % · ${c.n} Züge` : 'zu wenig Daten'))));
  if (rating) {
    // Linie auf Höhe des aktuellen Ratings (Bezug: Röhrenbereich)
    const line = h('div.ratingline', h('span', `Rating ${rating}`));
    cols.append(line);
    requestAnimationFrame(() => {
      const tube = cols.querySelector('.tube'); if (!tube) return;
      const y = tube.offsetTop + tube.offsetHeight * (1 - rating / top);
      line.style.top = y + 'px';
    });
  }
  const tips = {
    opening: ['Eröffnung', '#/openings'], middlegame: ['Mittelspiel-Fehler', '#/train/middlegame'], endgame: ['Endspiel-Fehler', '#/train/endgame'],
    tactics: ['Taktik-Fehler', '#/train/tactics'], conversion: ['Verwertung', '#/train/conversion'], defense: ['Verteidigung', '#/train/defense'],
  };
  return h('div.card',
    h('h2', 'Deine Elo pro Kategorie'),
    h('p.muted.small', { style: { marginTop: '-6px' } }, 'Geschätzt aus der Genauigkeit deiner Züge in der jeweiligen Situation. Fahre über eine Säule für Details.'),
    h('div', { style: { paddingLeft: rating ? '110px' : 0, position: 'relative' } }, cols),
    best && worst ? h('div.insight',
      h('span', { style: { fontSize: '26px' } }, '💡'),
      h('div', 'Stärke: ', h('b', { style: { color: 'var(--win)' } }, `${best.label} (${best.elo})`), ' · Baustelle: ', h('b', { style: { color: 'var(--loss)' } }, `${worst.label} (${worst.elo})`),
        h('div.small.muted', worst.k === 'opening' ? 'Übe deine Eröffnungen im Eröffnungstrainer.' : `Trainiere gezielt Stellungen aus deinen Partien, in denen dir das schwerfällt.`)),
      h('span.spacer'),
      h('a.btn.primary', { href: tips[worst.k][1] }, 'Jetzt trainieren')) : null);
}

// ---------- Fehlerprofil ----------
function mistakesCard(games) {
  const n = games.length;
  const sum = k => games.reduce((a, g) => a + (g.counts[g.userColor]?.[k] || 0), 0);
  const per = k => (sum(k) / n).toFixed(1);
  const phases = ['opening', 'middlegame', 'endgame'].map(p => {
    const bad = games.reduce((a, g) => a + (g.categories?.[p] || []).filter(x => x < 40).length, 0);
    return { p, label: CATEGORIES[p].label, bad };
  });
  const maxBad = Math.max(1, ...phases.map(x => x.bad));
  const box = (label, v, color) => h('div', { style: { textAlign: 'center', flex: 1 } }, h('div.big', { style: { color } }, v), h('div.muted.small', label));
  return h('div.grid2',
    h('div.card', h('h2', 'Fehler pro Partie'),
      h('div.row', { style: { gap: '4px' } }, box('Ungenauigkeiten', per('inaccuracy'), '#f7c631'), box('Fehler', per('mistake'), '#ffa459'), box('Verpasst', per('miss'), '#ff7769'), box('Patzer', per('blunder'), '#fa412d')),
      h('div.row', { style: { marginTop: '14px', gap: '4px' } }, box('Brillant', sum('brilliant'), '#1baca6'), box('Großartig', sum('great'), '#5c8bb0'), box('Beste Züge / Partie', per('best'), '#81b64c'))),
    h('div.card', h('h2', 'Wo deine groben Fehler passieren'),
      phases.map(x => h('div', { style: { margin: '10px 0' } },
        h('div.row', h('span', x.label), h('span.spacer'), h('b', x.bad), h('span.muted.small', `(${(x.bad / n).toFixed(1)} / Partie)`)),
        h('div.bar', { style: { height: '10px' } }, h('div', { style: { width: (x.bad / maxBad * 100) + '%', background: '#ee5f5f' } }))))));
}

// ---------- Eröffnungen ----------
function openingsCard(games) {
  const groups = {};
  for (const g of games) {
    const fam = g.opening?.name ? g.opening.name.split(':')[0] : 'Unbekannt';
    const key = g.userColor + '|' + fam;
    (groups[key] ||= { color: g.userColor, fam, games: [] }).games.push(g);
  }
  const rows = Object.values(groups).sort((a, b) => b.games.length - a.games.length).slice(0, 12).map(x => {
    const n = x.games.length;
    const score = x.games.reduce((a, g) => a + (g.userResult === 'win' ? 1 : g.userResult === 'draw' ? 0.5 : 0), 0) / n * 100;
    const oAccs = x.games.flatMap(g => g.categories?.opening || []);
    const oElo = oAccs.length >= 5 ? accuracyToElo(aggregateAccuracy(oAccs)) : null;
    return h('tr',
      h('td', x.color === 'w' ? '⚪' : '⚫'), h('td', h('b', x.fam)), h('td', n),
      h('td', h('span', { style: { color: score >= 55 ? 'var(--win)' : score <= 45 ? 'var(--loss)' : '' } }, Math.round(score) + ' %')),
      h('td', oElo ?? '–'),
      h('td', x.fam !== 'Unbekannt' ? h('a.btn.small', { href: `#/openings/${x.color}/${encodeURIComponent(x.fam)}` }, 'Trainieren') : ''));
  });
  return h('div.card', h('h2', 'Deine Eröffnungen'),
    h('table.list', h('tr', h('th', ''), h('th', 'Eröffnung'), h('th', 'Partien'), h('th', 'Punkte'), h('th', 'Eröffnungs-Elo'), h('th', '')), rows));
}

// ---------- Fehlermuster ----------
function patternStats(games) {
  const stats = {};
  for (const g of games) for (const m of g.patterns?.mistakes || []) {
    const s = (stats[m.type] ||= { type: m.type, n: 0, games: new Set(), blunders: 0, examples: [], phases: {}, tt: 0 });
    s.n++; s.games.add(g.id); if (m.cls === 'blunder') s.blunders++; if (m.timeTrouble) s.tt++;
    s.phases[m.phase] = (s.phases[m.phase] || 0) + 1;
    s.examples.push({ g, m });
  }
  // „Ungenauer Plan“ ist am wenigsten konkret und kommt deshalb immer ans Ende
  return Object.values(stats).map(s => ({ ...s, weight: s.n + s.blunders })).sort((a, b) => (a.type === 'positional') - (b.type === 'positional') || b.weight - a.weight);
}

function patternsCard(games) {
  const list = patternStats(games);
  if (!list.length) return h('div.card', h('h2', 'Deine Fehlermuster'), h('p.muted', 'Keine groben Fehler gefunden – stark!'));
  const total = list.reduce((a, s) => a + s.n, 0);
  return h('div.card',
    h('h2', 'Deine Fehlermuster'),
    h('p.muted.small', { style: { marginTop: '-6px' } }, `${total} Fehler, Patzer und verpasste Chancen in ${games.length} Partien – sortiert nach Häufigkeit und Schwere.`),
    list.map((s, idx) => {
      const P = PATTERNS[s.type] || { icon: '•', title: s.type, tip: '' };
      const phase = Object.entries(s.phases).sort((a, b) => b[1] - a[1])[0];
      const ex = s.examples.sort((a, b) => b.g.date - a.g.date).slice(0, 4);
      return h('div.pattern' + (idx === 0 ? '.top' : ''),
        h('div.pattern-icon', P.icon),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div.row', { style: { gap: '8px' } }, h('b', P.title),
            h('span.pill', `${s.n}× · in ${s.games.size} von ${games.length} Partien`),
            s.blunders ? h('span.pill.loss', `${s.blunders} Patzer`) : null,
            s.tt ? h('span.pill', `⏱ ${s.tt}× in Zeitnot`) : null),
          h('div.bar', { style: { height: '6px', margin: '8px 0' } }, h('div', { style: { width: (s.n / list[0].n * 100) + '%', background: idx === 0 ? 'var(--loss)' : 'var(--accent)' } })),
          h('div.small', P.tip),
          h('div.small.muted', { style: { marginTop: '4px' } }, `Meist im ${CATEGORIES[phase[0]].label}. Beispiele: `,
            ex.map(({ g, m }, i) => [i ? ' · ' : '', h('a', { href: `#/game/${g.id}/${m.ply + 1}`, title: m.detail }, m.label)]))),
        h('a.btn.small', { href: '#/train/p:' + s.type, style: { alignSelf: 'center' } }, 'Üben'));
    }));
}

// ---------- Gewohnheiten ----------
function habitsCard(games) {
  const withP = games.filter(g => g.patterns);
  if (!withP.length) return null;
  const n = withP.length, pct = x => Math.round(x / n * 100);
  const cnt = f => withP.filter(f).length;
  const hadWin = withP.filter(g => g.patterns.hadWinning), thrown = hadWin.filter(g => g.patterns.thrown);
  const losing = withP.filter(g => g.patterns.wasLosing), comeback = losing.filter(g => g.patterns.comeback);
  const allMist = withP.reduce((a, g) => a + g.patterns.mistakes.length, 0);
  const clockGames = withP.filter(g => g.patterns.hasClock);
  const ttMist = clockGames.reduce((a, g) => a + g.patterns.timeTroubleMistakes, 0), clockMist = clockGames.reduce((a, g) => a + g.patterns.mistakes.length, 0);
  const tilt = withP.reduce((a, g) => a + g.patterns.tilt, 0);
  const item = (icon, title, value, text, bad) => h('div.habit', h('div.habit-icon', icon),
    h('div', { style: { flex: 1 } }, h('div.row', h('b', title), h('span.spacer'), h('b', { style: { color: bad == null ? '' : bad ? 'var(--loss)' : 'var(--win)' } }, value)), h('div.small.muted', text)));
  const items = [
    hadWin.length ? item('🏁', 'Verwertung', `${hadWin.length - thrown.length}/${hadWin.length}`,
      `Du hattest in ${hadWin.length} Partien eine klar gewonnene Stellung und hast ${thrown.length ? `${thrown.length} davon nicht gewonnen` : 'alle gewonnen'}.`, thrown.length / hadWin.length > 0.25) : null,
    losing.length ? item('🛡️', 'Kampfgeist', `${comeback.length}/${losing.length}`,
      `In ${losing.length} klar verlorenen Stellungen hast du ${comeback.length}× noch gewonnen oder remis gehalten.`, null) : null,
    item('📖', 'Raus aus der Eröffnung', `${pct(cnt(g => g.patterns.habits.goodOpening))} % gut · ${pct(cnt(g => g.patterns.habits.badOpening))} % schlecht`,
      'Stellung nach Zug 12: klar besser (> 65 % Gewinnchance) bzw. klar schlechter (< 35 %).', cnt(g => g.patterns.habits.badOpening) > cnt(g => g.patterns.habits.goodOpening)),
    item('👸', 'Dame früh unterwegs', `${pct(cnt(g => g.patterns.habits.earlyQueen))} %`, 'Anteil Partien, in denen deine Dame in den ersten 5 Zügen (außerhalb der Theorie) zieht.', pct(cnt(g => g.patterns.habits.earlyQueen)) > 30),
    item('🏰', 'Spät oder gar nicht rochiert', `${pct(cnt(g => g.patterns.habits.notCastled))} %`, 'Partien mit Damen auf dem Brett, in denen du bis Zug 13 nicht rochiert hast.', pct(cnt(g => g.patterns.habits.notCastled)) > 30),
    item('🔁', 'Gleiche Figur mehrfach gezogen', `${pct(cnt(g => g.patterns.habits.samePiece))} %`, 'Eine Figur in der Eröffnung zweimal gezogen, statt neue zu entwickeln.', pct(cnt(g => g.patterns.habits.samePiece)) > 30),
    clockMist ? item('⏱', 'Fehler in Zeitnot', `${Math.round(ttMist / clockMist * 100)} %`, 'Anteil deiner Fehler mit weniger als 10 % der Bedenkzeit (oder < 30 s) auf der Uhr.', ttMist / clockMist > 0.3) : null,
    allMist ? item('🌀', 'Fehlerserien', `${tilt}×`, 'Wie oft auf einen Fehler innerhalb von 2 Zügen gleich der nächste folgte. Nach einem Fehler: kurz durchatmen, neu bewerten.', tilt / n > 0.5) : null,
  ];
  return h('div.card', h('h2', 'Deine Gewohnheiten'), h('div.habits', items));
}

// ---------- Fazit ----------
function verdictCard(games, cats, rating) {
  const out = [];
  const pats = patternStats(games);
  if (pats[0]) {
    const top = pats[0], P = PATTERNS[top.type];
    const share = Math.round(top.n / pats.reduce((a, x) => a + x.n, 0) * 100);
    out.push(['🔴', h('span', 'Dein häufigstes konkretes Fehlermuster: ', h('b', P.title), ` – ${top.n}× in ${top.games.size} von ${games.length} Partien (${share} % deiner Fehler). `, P.tip), '#/train/p:' + top.type]);
  }
  const valid = cats.filter(c => c.elo != null);
  if (valid.length > 1) {
    const ref = rating || Math.round(valid.reduce((a, c) => a + c.elo, 0) / valid.length);
    const worst = valid.reduce((a, b) => a.elo <= b.elo ? a : b), best = valid.reduce((a, b) => a.elo >= b.elo ? a : b);
    const link = worst.k === 'opening' ? '#/openings' : '#/train/' + worst.k;
    out.push(['🟠', h('span', 'Schwächste Kategorie: ', h('b', worst.label), ` mit ${worst.elo} – ${Math.abs(best.elo - worst.elo)} Punkte unter deiner besten (${best.label}, ${best.elo}). `, worst.hint + '.'), link]);
  }
  const hadWin = games.filter(g => g.patterns?.hadWinning), thrown = hadWin.filter(g => g.patterns.thrown);
  if (hadWin.length >= 3 && thrown.length / hadWin.length > 0.25)
    out.push(['🟡', h('span', 'Du verschenkst Siege: ', h('b', `${thrown.length} von ${hadWin.length}`), ' klar gewonnenen Partien hast du nicht gewonnen. Vereinfache, wenn du vorne bist – tausche Figuren, nicht Bauern.'), '#/train/conversion']);
  const clockMist = games.reduce((a, g) => a + (g.patterns?.hasClock ? g.patterns.mistakes.length : 0), 0);
  const tt = games.reduce((a, g) => a + (g.patterns?.timeTroubleMistakes || 0), 0);
  if (clockMist >= 5 && tt / clockMist > 0.3)
    out.push(['🟡', h('span', h('b', `${Math.round(tt / clockMist * 100)} %`), ' deiner Fehler passieren in Zeitnot. Spiele die Eröffnung zügiger und investiere Zeit in kritische Momente.'), null]);
  const strongest = valid.length > 1 ? valid.reduce((a, b) => a.elo >= b.elo ? a : b) : null;
  if (strongest) out.push(['🟢', h('span', 'Deine Stärke: ', h('b', strongest.label), ` (${strongest.elo})` + (rating && strongest.elo > rating ? ` – ${strongest.elo - rating} Punkte über deinem Rating.` : '.')), null]);
  if (!out.length) return null;
  return h('div.card.verdict', h('h2', '🧠 Coach-Fazit'),
    out.slice(0, 4).map(([dot, text, link]) => h('div.verdict-row', h('span', dot), h('div', { style: { flex: 1 } }, text), link ? h('a.btn.small', { href: link }, 'Trainieren') : null)));
}
