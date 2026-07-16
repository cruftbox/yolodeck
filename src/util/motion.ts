/**
 * One global animation ticker — §5/§7 of the spec.
 *
 * Stream Deck has no CSS animation; motion is frames pushed on a timer. Rather than a
 * timer per action, a single ~20fps interval re-renders only the keys that are
 * currently animating, and stops entirely when nothing is (CPU + LED wear).
 *
 * Contract: an action calls `animate(self)` from its render() while it's in a moving
 * state, and `still(self)` when it isn't. The ticker calls each animating action's
 * render() ~20x/s; that render recomputes its own brightness from the eased curves
 * below. When the set empties, the interval clears.
 */

const FRAME_MS = 50; // ~20 fps
const BREATHE_MS = 2400; // slow — Claude is working
const PULSE_MS = 1100; // fast — needs you

/** Keyed by the action instance; value is its render closure. */
const active = new Map<object, () => void>();
let timer: ReturnType<typeof setInterval> | null = null;
// Monotonic clock. performance.now if present; else a frame counter (Date.now is
// unavailable in some sandboxes and jumps on clock changes anyway).
const clock: () => number =
  typeof performance !== "undefined" && performance.now ? () => performance.now() : (() => { let t = 0; return () => (t += FRAME_MS); })();

function tick(): void {
  for (const render of active.values()) render();
  if (active.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Mark `key` as animating with its render closure, and ensure the ticker runs. */
export function animate(key: object, render: () => void): void {
  active.set(key, render);
  if (!timer) timer = setInterval(tick, FRAME_MS);
}

/** Mark `key` as steady; stops the ticker if it was the last one. */
export function still(key: object): void {
  if (!active.delete(key)) return;
  if (active.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

const now = () => clock();

/** Slow breathe brightness, 0.62↔1.0, sine ease-in-out. "Claude is working." */
export function breathe(): number {
  const t = (now() % BREATHE_MS) / BREATHE_MS;
  return 0.62 + 0.38 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
}

/** Fast pulse brightness, 0.55↔1.0. "Needs you." */
export function pulse(): number {
  const t = (now() % PULSE_MS) / PULSE_MS;
  return 0.55 + 0.45 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
}

/** Test-only: stop the ticker and clear the set. */
export function _reset(): void {
  if (timer) clearInterval(timer);
  timer = null;
  active.clear();
}
