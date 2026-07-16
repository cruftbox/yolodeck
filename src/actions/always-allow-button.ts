import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { iconButton } from "../util/svg";

@action({ UUID: "com.cruftbox.yolodeck.always-allow" })
export class AlwaysAllowButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const session = this.manager?.activeSession;
    if (!session || session.state !== State.AWAITING_PERMISSION) return;
    this.manager.resolvePermissionAlwaysAllow(session.id);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const awaiting = session?.state === State.AWAITING_PERMISSION;
    const icon = iconButton(
      awaiting ? "#d29922" : "#555555",
      `<path d="M32 72 L48 88 L80 56" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
       <path d="M64 72 L80 88 L112 56" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    for (const act of this.actions) {
      act.setTitle("Always");
      act.setImage(icon);
    }
  }
}
