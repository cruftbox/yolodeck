import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.always-allow" })
export class AlwaysAllowButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermissionAlwaysAllow(session.id);
  }

  protected render(): void {
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    const image = keyImage({
      bg: live ? "#d29922" : INERT_BG,
      glyph: GLYPH.doubleCheck,
      lines: [{ text: "Always", bold: true }],
    });
    for (const act of this.actions) act.setImage(image);
  }
}
