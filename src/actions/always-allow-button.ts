import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, TOKENS, renderKey } from "../util/svg";
import { dim } from "../util/tokens";
import { animate, pulse, still } from "../util/motion";

@action({ UUID: "com.cruftbox.yolodeck.always-allow" })
export class AlwaysAllowButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const s = this.manager?.activeSession;
    if (s?.state === State.AWAITING_PERMISSION) this.manager?.resolvePermissionAlwaysAllow(s.id);
  }

  protected render(): void {
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    if (live) animate(this, () => this.render()); else still(this);
    const image = renderKey({
      token: live ? TOKENS.approve : dim(TOKENS.approve),
      glyph: GLYPH.doubleCheck,
      lines: [{ text: "Always" }],
      brightness: live ? pulse() : 1,
    });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
