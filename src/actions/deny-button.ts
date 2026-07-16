import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { iconButton } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.deny" })
export class DenyButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermission(session.id, false);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const awaiting = session?.state === State.AWAITING_PERMISSION;
    const icon = iconButton(
      awaiting ? "#da3633" : "#555555",
      `<path d="M44 44 L100 100 M100 44 L44 100" stroke="white" stroke-width="10" stroke-linecap="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Deny");
      act.setImage(icon);
    }
  }
}
