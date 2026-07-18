import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { TOKENS, renderKey, type KeyLine } from "../util/svg";
import { contextBand } from "../util/context";

const STALE_MS = 15 * 60 * 1000;

/**
 * The active session's context-window usage, from the statusLine channel (terminal
 * only — same capability wall as `usage`; the desktop app never runs statusLine, so
 * this reads "no data" there). Per-session, unlike `usage`'s account-wide rate limits,
 * so it follows whichever session is active rather than a single manager-level value.
 */
@action({ UUID: "com.cruftbox.yolodeck.context" })
export class ContextButton extends ManagedAction {
  protected render(): void {
    const cw = this.manager?.activeSession?.contextWindow;
    let image: string;
    if (!cw) {
      image = renderKey({ token: TOKENS.idle, lines: [{ text: "context" }, { text: "no data", dim: true }] });
    } else {
      const pct = Math.round(cw.usedPercentage);
      const stale = Date.now() - cw.receivedAt > STALE_MS;
      const token = stale ? TOKENS.idle : TOKENS[contextBand(cw.usedPercentage)];
      const lines: KeyLine[] = [
        { text: `${pct}%`, size: 44 },
        { text: stale ? "stale" : "ctx", dim: true },
      ];
      image = renderKey({ token, lines });
    }
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
