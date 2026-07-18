/**
 * Pure context-window presentation logic, kept out of the action file so it can be
 * tested without dragging in the Stream Deck SDK and its decorators — same split as
 * util/usage.ts's remaining()/formatUntil().
 */

/**
 * Which design-token band a context reading falls into. Banded by what's USED, not
 * what's left — the opposite direction from the usage key's thresholds. A filling
 * context window is the thing to notice; "73% left" reads as fine right up until
 * compaction, "73% used" doesn't.
 */
export function contextBand(usedPercentage: number): "approve" | "awaiting" | "deny" {
  if (usedPercentage >= 80) return "deny";
  if (usedPercentage >= 50) return "awaiting";
  return "approve";
}
