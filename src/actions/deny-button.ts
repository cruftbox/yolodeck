import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.deny" })
export class DenyButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermission(session.id, false);
  }

  protected render(): void {
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    const image = keyImage({
      bg: live ? "#da3633" : INERT_BG,
      glyph: GLYPH.cross,
      lines: [{ text: "Deny", bold: true }],
    });
    for (const act of this.actions) act.setImage(image);
  }
}
