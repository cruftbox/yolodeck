import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { iconButton } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.approve" })
export class ApproveButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermission(session.id, true);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const awaiting = session?.state === State.AWAITING_PERMISSION;
    const icon = iconButton(
      awaiting ? "#1a7f37" : "#555555",
      `<path d="M40 72 L62 94 L104 52" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Approve");
      act.setImage(icon);
    }
  }
}
