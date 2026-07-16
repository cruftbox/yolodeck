import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { State } from "../types";
import { TOKENS, renderKey, type KeyLine } from "../util/svg";
import { animate, breathe, pulse, still } from "../util/motion";

/**
 * The heartbeat — the single most-glanced key. Color is the primary read; motion
 * follows the spec's rule (breathe = working, pulse = needs you, steady otherwise).
 */
@action({ UUID: "com.cruftbox.yolodeck.status" })
export class StatusButton extends ManagedAction {
  protected render(): void {
    const s = this.manager?.activeSession;
    let token = TOKENS.idle;
    let lines: KeyLine[] = [{ text: "No session", dim: true }];
    let motion: "breathe" | "pulse" | null = null;

    if (s) {
      const isError = s.state === State.IDLE && !!s.lastError;
      switch (s.state) {
        case State.PROCESSING:
          token = TOKENS.working; motion = "breathe";
          lines = [{ text: "Working" }, ...(s.currentTool ? [{ text: s.currentTool, dim: true }] : [])];
          break;
        case State.AWAITING_PERMISSION:
          token = TOKENS.awaiting; motion = "pulse"; lines = [{ text: "Waiting" }];
          break;
        case State.AWAITING_ELICITATION:
          token = TOKENS.permission; motion = "pulse"; lines = [{ text: "Question" }];
          break;
        default:
          token = isError ? TOKENS.deny : TOKENS.idle;
          lines = [{ text: isError ? "Error" : "Idle" }];
      }
      if (s.activeWork > 0) lines.push({ text: `${s.activeWork} agent${s.activeWork > 1 ? "s" : ""}`, dim: true });
    }

    if (motion) animate(this, () => this.render()); else still(this);
    const brightness = motion === "breathe" ? breathe() : motion === "pulse" ? pulse() : 1;
    const image = renderKey({ token, lines, brightness });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
