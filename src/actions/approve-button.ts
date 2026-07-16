import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { GLYPH, TOKENS, renderKey } from "../util/svg";
import { dim } from "../util/tokens";
import { animate, pulse, still } from "../util/motion";

@action({ UUID: "com.cruftbox.yolodeck.approve" })
export class ApproveButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    const s = this.manager?.activeSession;
    if (s?.state === State.AWAITING_PERMISSION) this.manager?.resolvePermission(s.id, true);
  }

  protected render(): void {
    // Lit + pulsing only when there's a request to answer; dim and steady otherwise.
    const live = this.manager?.activeSession?.state === State.AWAITING_PERMISSION;
    if (live) animate(this, () => this.render()); else still(this);
    const image = renderKey({
      token: live ? TOKENS.approve : dim(TOKENS.approve),
      glyph: GLYPH.check,
      lines: [{ text: "Approve" }],
      brightness: live ? pulse() : 1,
    });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
