import { h, toast } from '../ui.js';
import { getSettings, saveSettings } from '../core/store.js';
import { defaultWorkers } from '../core/engine.js';

export async function render(root) {
  const s = await getSettings();
  const f = {
    chesscom: h('input', { value: s.chesscom, placeholder: 'z.B. paulo21104' }),
    lichess: h('input', { value: s.lichess, placeholder: 'Lichess-Name (optional)' }),
    depth: h('input', { type: 'number', min: 8, max: 22, value: s.depth }),
    workers: h('input', { type: 'number', min: 0, max: 8, value: s.workers }),
    historyDepth: h('input', { type: 'number', min: 8, max: 22, value: s.historyDepth }),
    lineDepth: h('input', { type: 'number', min: 8, max: 24, value: s.lineDepth }),
    autoSync: h('input', { type: 'checkbox', checked: s.autoSync }),
    syncMinutes: h('input', { type: 'number', min: 2, max: 240, value: s.syncMinutes }),
  };
  const field = (label, el, hint) => h('label.field', { style: { display: 'grid', gap: '6px', marginBottom: '16px' } }, h('b', label), el, hint && h('span.muted.small', hint));
  root.append(h('div.wrap', { style: { maxWidth: '640px' } },
    h('h1', 'Einstellungen'),
    h('div.card',
      h('h2', 'Deine Konten'),
      h('p.muted.small', 'Damit der Coach weiß, welche Seite in einer Partie du bist. Mindestens ein Name wird gebraucht.'),
      field('Chess.com-Benutzername', f.chesscom),
      field('Lichess-Benutzername', f.lichess)),
    h('div.card',
      h('h2', 'Engine'),
      field('Analysetiefe für neue Partien', f.depth, 'Höher = genauer, aber langsamer. 12–16 ist ein guter Bereich (Standard 14).'),
      field('Analysetiefe für die Historie', f.historyDepth, 'Für den Import alter Partien – etwas niedriger ist deutlich schneller (Standard 12).'),
      field('Tiefe beim Weiterrechnen von Linien', f.lineDepth, 'Wenn du mit ▶ über das Ende einer Engine-Linie hinaus vorspulst, rechnet die Engine jeden Zug mit dieser Tiefe (Standard 16).'),
      field('Parallele Engines', f.workers, `0 = automatisch (Browser: ${defaultWorkers()}, Server: Kerne − 1, max. 4). Mehr Engines = schneller, braucht aber mehr CPU.`)),
    h('div.card',
      h('h2', 'Automatischer Import'),
      h('label.row', { style: { gap: '10px', marginBottom: '16px', cursor: 'pointer' } }, f.autoSync, h('b', 'Neue Partien automatisch holen und analysieren')),
      field('Wie oft prüfen (Minuten)', f.syncMinutes, 'Hinweis: Chess.com aktualisiert seine öffentlichen Daten laut Doku teils nur alle paar Stunden – meist erscheinen Partien aber nach wenigen Minuten.')),
    h('button.btn.primary', { onclick: async () => {
      await saveSettings({ chesscom: f.chesscom.value.trim(), lichess: f.lichess.value.trim(), depth: +f.depth.value || 14, historyDepth: +f.historyDepth.value || 12, lineDepth: +f.lineDepth.value || 16,
        workers: +f.workers.value || 0, autoSync: f.autoSync.checked, syncMinutes: Math.max(2, +f.syncMinutes.value || 10) });
      toast('Gespeichert', 'ok');
      if (f.chesscom.value.trim() || f.lichess.value.trim()) location.hash = '#/import';
    } }, 'Speichern')));
}
