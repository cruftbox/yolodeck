/**
 * Shorten a Claude model id for a 72px key.
 *
 * Kept out of the action file so it can be tested without the Stream Deck SDK and its
 * decorators — the same split as util/usage.ts.
 *
 * Handles the id shapes Claude Code actually emits:
 *   claude-opus-4-8            -> Opus 4.8
 *   claude-sonnet-5            -> Sonnet 5
 *   claude-haiku-4-5-20251001  -> Haiku 4.5   (trailing date dropped)
 *   claude-fable-5             -> Fable 5
 * Anything unrecognised falls back to the id with the "claude-" prefix stripped.
 */
export function shortenModel(model: string): string {
  // name, major, and an optional minor — the date suffix on some ids is left unmatched.
  const m = model.match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/i);
  if (m) {
    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
    return `${name} ${version}`;
  }
  return model.replace(/^claude-/, "").slice(0, 14);
}
