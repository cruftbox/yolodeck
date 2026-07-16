import { action, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { State } from "../types";
import { keyImage, type KeyLine } from "../util/svg";

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
    const color = session ? STATE_COLORS[session.state] : STATE_COLORS[State.DISCONNECTED];
    const count = this.manager?.sessionCount ?? 0;

    const lines: KeyLine[] = [{ text: session ? basename(session.cwd) : "No Session", bold: true }];
    if (count > 1) {
      lines.push({ text: `${(this.manager?.activeIndex ?? 0) + 1}/${count}`, dim: true });
    }

    const image = keyImage({ bg: color, lines });
    for (const act of this.actions) act.setImage(image);
  }
}
