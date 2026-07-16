import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";

const MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  auto: "Auto",
  dontAsk: "Don't Ask",
  bypassPermissions: "Bypass",
};

/**
 * Modes where Claude is NOT going to stop and ask. The key is coloured to say so
 * loudly: the failure mode of a bypassed deck is not pressing the wrong thing, it's
 * forgetting the safety is off — a silent deck looks identical to a working one.
 */
const UNGUARDED = new Set(["bypassPermissions", "dontAsk", "auto"]);

/**
 * Permission mode only. The model moved to its own key (ModelButton) — two unrelated
 * facts on one 72px key made both unreadable.
 */
@action({ UUID: "com.cruftbox.yolodeck.mode" })
export class ModeButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;
    const mode = session?.permissionMode ?? "";
    const label = MODE_LABELS[mode] ?? mode ?? "—";
    const unguarded = UNGUARDED.has(mode);

    const image = keyImage({
      bg: unguarded ? "#8957e5" : INERT_BG,
      glyph: GLYPH.shield,
      lines: [{ text: label || "—", bold: true }],
    });
    for (const act of this.actions) {
      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}
