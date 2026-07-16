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
      try { await focusWindowForPid(s.pid); return; } catch (e) { streamDeck.logger.debug(`${e}`); }
    }
    try { await focusAppByName("WindowsTerminal", "Claude", "Code", "wezterm-gui", "alacritty"); }
    catch (e) { streamDeck.logger.warn(`Failed to focus any window: ${e}`); }
  }

  protected render(): void {
    const live = !!this.manager?.activeSession;
    const image = renderKey({ token: live ? TOKENS.info : dim(TOKENS.info), glyph: GLYPH.window, lines: [{ text: "Focus" }] });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
