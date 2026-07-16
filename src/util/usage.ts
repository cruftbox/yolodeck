import type { RateLimitWindow } from "../types";

/**
 * Pure rate-limit presentation logic, kept out of the action file so it can be tested
 * without dragging in the Stream Deck SDK and its decorators.
 */

/** Remaining, not used — "23% left" is the number you act on. */
export function remaining(w: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - w.used_percentage)));
}

/**
 * "3d05h" / "2h14m" / "48m".
 *
 * The countdown is the actionable half of a rate limit: 8% left matters far less if it
 * resets in nine minutes.
 *
 * Three scales, because the two windows differ by two orders of magnitude. The 7-day
 * window resets up to 168 hours out, and "168h00m" on a 72px key is both unreadable and
 * useless — nobody counts in hours at that range.
 *
 * `resets_at` is epoch **seconds** while Date.now() is ms; mixing them puts the reset
 * roughly 55 years out.
 */
export function formatUntil(epochSeconds: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((epochSeconds * 1000 - now) / 60000));
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, "0")}m`;

  return `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, "0")}h`;
}

/** Green while there's room, amber when it's worth knowing, red when it's nearly gone. */
export function usageColor(pctRemaining: number): string {
  if (pctRemaining <= 10) return "#da3633";
  if (pctRemaining <= 25) return "#d29922";
  return "#1a7f37";
}
