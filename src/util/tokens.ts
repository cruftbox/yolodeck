/**
 * Color system — the §3 state tokens from the design spec.
 *
 * Each token is a top→bottom gradient: `top` is the listed hex (brighter top edge sells
 * the "lit plastic" look), `bottom` is that hex at ~82% lightness. renderKey builds the
 * linearGradient from these.
 */
export interface Token {
  top: string;
  bottom: string;
}

/** Darken a hex toward black by `factor` (0.82 ≈ the spec's "82% lightness" bottom). */
function grad(top: string, factor = 0.82): Token {
  const n = parseInt(top.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return { top, bottom: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}` };
}

export const TOKENS = {
  idle: grad("#3E4756"), // slate — nothing happening
  working: grad("#D97757"), // Claude clay — thinking (breathes)
  awaiting: grad("#F5A623"), // amber — needs you (pulses)
  approve: grad("#22C55E"), // emerald
  deny: grad("#EF4444"), // red — deny / danger / armed
  info: grad("#4AA3F0"), // sky — model, focus, nav
  permission: grad("#9B6BE8"), // violet — accept-edits / plan
  empty: grad("#14171C", 1), // near-black — unassigned keys (no gradient)
} as const;

/**
 * Disabled/dim variant of an action color: same hue at ~28% saturation and 40%
 * brightness. Used for action keys with no pending request so lit keys stand out.
 * Approximated by heavy darkening + desaturation toward the idle slate.
 */
export function dim(token: Token): Token {
  const n = parseInt(token.top.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const gray = (r + g + b) / 3;
  const mix = (c: number) => Math.round((c * 0.28 + gray * 0.72) * 0.5);
  const top = `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return grad(top);
}
