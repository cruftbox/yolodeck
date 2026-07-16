/**
 * Pure colour math for the breathe animation, kept out of the action so it can be
 * tested without the Stream Deck SDK — same split as util/usage.ts and util/model.ts.
 */

/** Parse "#rrggbb" (or "#rgb") to [r,g,b], 0–255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}

/** Scale each channel by `factor` (1 = unchanged, <1 dims, >1 brightens, clamped). */
export function scaleBrightness(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

/**
 * A slow breathe: a brightness factor oscillating smoothly between `min` and `max`.
 *
 * Cosine-eased so it lingers at the extremes rather than crossing them linearly — the
 * difference between breathing and a triangle-wave flicker. Deliberately NOT a blink:
 * a bypassed deck is a patient state (nothing is wrong, the guard is just off), and an
 * alarm-fast pulse three feet from your face gets the key turned off within a week. The
 * point is a reminder you can't un-see, not an emergency.
 *
 * Driven by wall-clock time, so every frame is correct regardless of timer jitter and
 * multiple keys stay in phase for free.
 */
export function breathe(nowMs: number, periodMs: number, min = 0.5, max = 1): number {
  const t = (nowMs % periodMs) / periodMs; // 0..1 through the cycle
  const eased = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); // 0 → 1 → 0, easing at both ends
  return min + (max - min) * eased;
}
