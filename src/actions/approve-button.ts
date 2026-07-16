import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.approve" })
export class ApproveButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermission(session.id, true);
  }

  protected render(): void {
    // Dark and inert unless something is actually pending — a live approve key is
    // exactly how you approve a command you never read.
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    const image = keyImage({
      bg: live ? "#1a7f37" : INERT_BG,
      glyph: GLYPH.check,
      lines: [{ text: "Approve", bold: true }],
    });
    for (const act of this.actions) act.setImage(image);
  }
}
