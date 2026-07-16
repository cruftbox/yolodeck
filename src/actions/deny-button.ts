import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, TOKENS, renderKey } from "../util/svg";
import { dim } from "../util/tokens";
import { animate, pulse, still } from "../util/motion";

@action({ UUID: "com.cruftbox.yolodeck.deny" })
export class DenyButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const s = this.manager?.activeSession;
    if (s?.state === State.AWAITING_PERMISSION) this.manager?.resolvePermission(s.id, false);
  }

  protected render(): void {
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    if (live) animate(this, () => this.render()); else still(this);
    const image = renderKey({
      token: live ? TOKENS.deny : dim(TOKENS.deny),
      glyph: GLYPH.cross,
      lines: [{ text: "Deny" }],
      brightness: live ? pulse() : 1,
    });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
