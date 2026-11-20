// Engine-Linien beliebig verlängern: die Engine rechnet Zug für Zug weiter (abbrechbar)
import { Chess } from 'chess.js';
import { engine } from './core/engine.js';
import { getSettings } from './core/store.js';
import { lineFrom } from './board.js';

/** Kann aus dieser Stellung noch weitergespielt werden? (nicht Matt / Patt / Remis) */
export function canExtend(fen) {
  try { return !new Chess(fen).isGameOver(); } catch { return false; }
}

/**
 * lineExtender({ onStep(step), onBusy(bool), onDone() })
 *  .run(fen, n)  rechnet n Halbzüge ab fen und meldet jeden als step { uci, san, lastMove, fenBefore, fen }
 *  .cancel()     bricht ab (z.B. beim Navigieren); onDone wird dann nicht aufgerufen
 *  .busy         läuft gerade eine Berechnung? Weitere run()-Aufrufe werden solange ignoriert.
 */
export function lineExtender({ onStep, onBusy, onDone }) {
  let ctrl = null;
  const setBusy = b => onBusy?.(b);
  return {
    get busy() { return !!ctrl; },
    cancel() { if (!ctrl) return; ctrl.abort(); ctrl = null; setBusy(false); },
    async run(fen, n = 1) {
      if (ctrl || !canExtend(fen)) return;
      const my = ctrl = new AbortController();
      setBusy(true);
      try {
        const depth = (await getSettings()).lineDepth || 16;
        for (let i = 0; i < n && !my.signal.aborted && canExtend(fen); i++) {
          const ev = await engine.quick(fen, depth, { signal: my.signal });
          if (my.signal.aborted || !ev?.best) break;
          const step = lineFrom(fen, [ev.best])[0];
          if (!step) break;
          onStep(step, ev);
          fen = step.fen;
        }
      } catch { /* Engine-Fehler: einfach aufhören */ }
      if (ctrl === my) { ctrl = null; setBusy(false); onDone?.(); }
    },
  };
}
