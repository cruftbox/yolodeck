import { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { INERT_BG, keyImage, type KeyLine } from "../util/svg";

const AGENT_COLORS = ["#1f6feb", "#d29922", "#e16f24", "#da3633"];

function agentColor(count: number): string | null {
  if (count <= 0) return null;
  return AGENT_COLORS[Math.min(count - 1, AGENT_COLORS.length - 1)];
}

@action({ UUID: "com.cruftbox.yolodeck.status" })
export class StatusButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;

    if (!session) {
      const idle = keyImage({ bg: INERT_BG, lines: [{ text: "No session", dim: true }] });
      for (const act of this.actions) act.setImage(idle);
      return;
    }

    const lines: KeyLine[] = [];
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
        lines.push({ text: session.lastError ? "Error" : "Idle", bold: true });
        break;
      default:
        lines.push({ text: session.state, bold: true });
    }

    if (session.activeWork > 0) {
      lines.push({ text: `${session.activeWork} agent${session.activeWork > 1 ? "s" : ""}`, dim: true });
    }

    const isError = session.state === State.IDLE && session.lastError;
    const bg = isError ? "#da3633" : agentColor(session.activeWork) ?? INERT_BG;

    const image = keyImage({ bg, lines });
    for (const act of this.actions) act.setImage(image);
  }
}
