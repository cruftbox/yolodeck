import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { focusAppByName, focusWindowForPid } from "../util/windows";
import { GLYPH, TOKENS, renderKey } from "../util/svg";
import { dim } from "../util/tokens";

/** Bring the active session's window forward (info-sky; dim when nothing to focus). */
@action({ UUID: "com.cruftbox.yolodeck.focus" })
export class FocusButton extends ManagedAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const s = this.manager?.activeSession;
    if (s?.pid) {
      const r = await focusWindowForPid(s.pid);
      streamDeck.logger.info(`Focus by PID ${s.pid}: ok=${r.ok}\n${r.log}`);
      if (r.ok) return;
    }
    const r = await focusAppByName("WindowsTerminal", "Claude", "Code", "wezterm-gui", "alacritty");
    streamDeck.logger.info(`Focus by name: ok=${r.ok}\n${r.log}`);
  }

  protected render(): void {
    const live = !!this.manager?.activeSession;
    const image = renderKey({ token: live ? TOKENS.info : dim(TOKENS.info), glyph: GLYPH.window, lines: [{ text: "Focus" }] });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
