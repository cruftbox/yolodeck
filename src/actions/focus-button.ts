import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { focusAppByName, focusWindowForPid } from "../util/windows";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";

/**
 * Bring the active session's window to the front.
 *
 * WINDOWS PORT. Upstream activated a hardcoded app by name via AppleScript
 * ("Ghostty", falling back to "Claude") and never used the PID it had already
 * resolved — its own comment called the focus best-effort.
 *
 * We try the PID first, which actually targets the window hosting *this* session, and
 * only fall back to by-name when no PID has been resolved yet (the plugin may have
 * started after the session, in which case the first event registers it lazily and the
 * PID lands a moment later).
 *
 * Upstream also extended SingletonAction, so the key never rendered. It extends
 * ManagedAction here to dim when there's no session to focus.
 */
@action({ UUID: "com.cruftbox.yolodeck.focus" })
export class FocusButton extends ManagedAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const session = this.manager?.activeSession;

    if (session?.pid) {
      try {
        await focusWindowForPid(session.pid);
        return;
      } catch (err) {
        streamDeck.logger.debug(`Focus by PID ${session.pid} failed, falling back: ${err}`);
      }
    }

    // Fallback: raise a terminal by process name. Can't distinguish one session's
    // window from another's — best effort, same as upstream. Add your terminal here
    // if it isn't listed.
    try {
      await focusAppByName("WindowsTerminal", "Claude", "Code", "wezterm-gui", "alacritty");
    } catch (err) {
      streamDeck.logger.warn(`Failed to focus any window: ${err}`);
    }
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    // Dim when there's nothing to focus, so the key reads as inert rather than broken.
    const image = keyImage({
      bg: session ? "#30363d" : INERT_BG,
      glyph: GLYPH.window,
      lines: [{ text: "Focus", bold: true }],
    });
    for (const act of this.actions) act.setImage(image);
  }
}
