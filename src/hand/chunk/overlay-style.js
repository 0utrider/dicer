/**
 * The throw overlay's styles (lazy hand chunk: players who never throw by hand never load them).
 * openThrowOverlay injects them once, as <style id="dicer-hand-style"> in the document head. The
 * overlay captures the pointer over the stage (above the dice canvas, z 60) while the dice are held;
 * the board stays visible and the roller's area is outlined.
 */
export const OVERLAY_CSS = `
.dicer-hand-overlay {
  position: fixed;
  z-index: 70;
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.dicer-hand-overlay.dicer-hand-grabbing {
  cursor: grabbing;
}
.dicer-hand-overlay.dicer-hand-thrown {
  pointer-events: none;
  cursor: auto;
}
.dicer-hand-overlay.dicer-hand-thrown > * {
  opacity: 0;
  transition: opacity 0.25s;
}
.dicer-hand-overlay .dicer-hand-area {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed rgba(255, 213, 74, 0.7);
  border-radius: 10px;
  background: rgba(255, 213, 74, 0.06);
  /* the shake energy (0..1, set per frame) lights the area up */
  box-shadow: inset 0 0 calc(var(--dicer-shake, 0) * 48px)
    rgba(255, 213, 74, calc(var(--dicer-shake, 0) * 0.6));
  pointer-events: none;
}
.dicer-hand-overlay .dicer-hand-bar {
  position: absolute;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(15, 15, 20, 0.82);
  color: #f0f0f0;
  font-size: 13px;
  white-space: nowrap;
  cursor: auto;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}
.dicer-hand-overlay .dicer-hand-label {
  font-weight: bold;
}
.dicer-hand-overlay .dicer-hand-hint {
  opacity: 0.85;
}
.dicer-hand-overlay .dicer-hand-count {
  min-width: 2.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #ffd54a;
}
.dicer-hand-overlay .dicer-hand-bar button {
  width: auto;
  margin: 0;
  padding: 2px 10px;
  line-height: 22px;
  cursor: pointer;
}
.dicer-hand-overlay .dicer-hand-bar kbd {
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  font-size: 11px;
}
`;
