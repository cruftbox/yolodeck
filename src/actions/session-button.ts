import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { State } from "../types";
import { escapeXml, svgDataUri } from "../util/svg";

const STATE_COLORS: Record<State, string> = {
  [State.DISCONNECTED]: "#333333",
  [State.IDLE]: "#1a7f37",
  [State.PROCESSING]: "#1f6feb",
  [State.AWAITING_PERMISSION]: "#d29922",
  [State.AWAITING_ELICITATION]: "#8957e5",
};

@action({ UUID: "com.cruftbox.yolodeck.session" })
export class SessionButton extends ManagedAction {
  override onKeyDown(_ev: KeyDownEvent): void {
    this.manager?.cycleSession(1);
  }

  protected render(): void {
    const session = this.manager?.activeSession;
    const title = session ? basename(session.cwd) : "No Session";
    const color = session ? STATE_COLORS[session.state] : STATE_COLORS[State.DISCONNECTED];
    const count = this.manager?.sessionCount ?? 0;
    const suffix = count > 1 ? `(${(this.manager?.activeIndex ?? 0) + 1}/${count})` : "";

    let textSvg: string;
    if (suffix) {
      textSvg =
        `<text x="72" y="58" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="22" font-weight="bold" fill="white">${escapeXml(title)}</text>` +
        `<text x="72" y="86" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="18" fill="white">${escapeXml(suffix)}</text>`;
    } else {
      textSvg =
        `<text x="72" y="72" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="22" font-weight="bold" fill="white">${escapeXml(title)}</text>`;
    }

    const image = svgDataUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
      `<rect width="144" height="144" rx="16" fill="${escapeXml(color)}"/>` +
      `${textSvg}</svg>`,
    );

    for (const act of this.actions) {
      act.setTitle("");
      act.setImage(image);
    }
  }
}
