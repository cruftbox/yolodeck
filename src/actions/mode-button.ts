import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { TOKENS, renderKey, type KeyLine } from "../util/svg";

/**
 * Permission-mode labels using the *desktop app's own wording*, so they're recognizable
 * (you set them in the app). Two-word modes render on two big lines — no shield glyph,
 * so the text fills the key and stays legible on the 72px hardware.
 */
const LABELS: Record<string, string[]> = {
  default: ["Manual"],
  acceptEdits: ["Accept", "Edits"],
  plan: ["Plan"],
  auto: ["Auto"],
  dontAsk: ["Don't", "Ask"],
  bypassPermissions: ["Bypass", "Perms"],
};

// Modes where Claude won't stop to ask — shown red as a danger signal.
const UNGUARDED = new Set(["bypassPermissions", "dontAsk", "auto"]);

/** Permission-mode signal. Display-only — the plugin can't set Claude's mode. */
@action({ UUID: "com.cruftbox.yolodeck.mode" })
export class ModeButton extends ManagedAction {
  protected render(): void {
    const mode = this.manager?.activeSession?.permissionMode ?? "";
    const label = LABELS[mode] ?? [mode || "—"];
    const token = UNGUARDED.has(mode) ? TOKENS.deny : TOKENS.permission;
    const lines: KeyLine[] = label.map((text) => ({ text }));
    const image = renderKey({ token, lines });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
