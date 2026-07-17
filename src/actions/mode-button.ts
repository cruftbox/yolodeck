import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { GLYPH, TOKENS, renderKey } from "../util/svg";

// Full, meaningful labels — "Edits" alone is cryptic. These say what the mode does.
const LABELS: Record<string, string> = {
  default: "Asks All", acceptEdits: "Auto Edit", plan: "Plan",
  auto: "Auto", dontAsk: "No Ask", bypassPermissions: "BYPASS",
};
// Modes where Claude won't stop to ask — shown red as a danger signal (steady, no
// motion: per the spec, motion is reserved for working/awaiting).
const UNGUARDED = new Set(["bypassPermissions", "dontAsk", "auto"]);

/** Permission-mode signal. Display-only — the plugin can't set Claude's mode. */
@action({ UUID: "com.cruftbox.yolodeck.mode" })
export class ModeButton extends ManagedAction {
  protected render(): void {
    const mode = this.manager?.activeSession?.permissionMode ?? "";
    const token = UNGUARDED.has(mode) ? TOKENS.deny : TOKENS.permission;
    const image = renderKey({ token, glyph: GLYPH.shield, lines: [{ text: LABELS[mode] ?? mode ?? "—" }] });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
