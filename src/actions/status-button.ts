import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { INERT_BG, keyImage, type KeyLine } from "../util/svg";

/**
 * Colour by *state*, matching the session key's palette.
 *
 * Previously this coloured by subagent count, so a single session that was Working with
 * no subagents rendered grey — identical to Idle. The state you most want at a glance
 * had no colour. State is the signal; the subagent count is a detail line.
 */
const STATE_COLORS: Record<State, string> = {
  [State.DISCONNECTED]: INERT_BG,
  [State.IDLE]: "#1a7f37", // green — connected, your turn
  [State.PROCESSING]: "#1f6feb", // blue — working
  [State.AWAITING_PERMISSION]: "#d29922", // gold — needs you
  [State.AWAITING_ELICITATION]: "#8957e5", // purple — asking a question
};

@action({ UUID: "com.cruftbox.yolodeck.status" })
export class StatusButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;

    let bg: string;
    let lines: KeyLine[];

    if (!session) {
      bg = INERT_BG;
      lines = [{ text: "No session", dim: true }];
    } else {
      const isError = session.state === State.IDLE && !!session.lastError;
      bg = isError ? "#da3633" : STATE_COLORS[session.state];
      lines = [];

      switch (session.state) {
        case State.PROCESSING:
          lines.push({ text: "Working", bold: true });
          if (session.currentTool) lines.push({ text: session.currentTool, dim: true });
          break;
        case State.AWAITING_PERMISSION:
          lines.push({ text: "Permission?", bold: true });
          break;
        case State.AWAITING_ELICITATION:
          lines.push({ text: "Question?", bold: true });
          break;
        case State.IDLE:
          lines.push({ text: isError ? "Error" : "Idle", bold: true });
          break;
        default:
          lines.push({ text: session.state, bold: true });
      }

      if (session.activeWork > 0) {
        lines.push({ text: `${session.activeWork} agent${session.activeWork > 1 ? "s" : ""}`, dim: true });
      }
    }

    const image = keyImage({ bg, lines });
    for (const act of this.actions) {
      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}
