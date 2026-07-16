import streamDeck, { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { State } from "../types";
import { TOKENS, renderKey, type KeyLine } from "../util/svg";
import { animate, pulse, still } from "../util/motion";

export const YOLODECK_PROFILE = "yolodeck";

/**
 * Front-page key: aggregate session state so you can be pulled into the yolodeck
 * profile when something needs you, while looking at a different profile.
 */
@action({ UUID: "com.cruftbox.yolodeck.overview" })
export class OverviewButton extends ManagedAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const device = (ev.action as KeyAction).device?.id;
    if (!device) return;
    try { await streamDeck.profiles.switchToProfile(device, YOLODECK_PROFILE); }
    catch (e) { streamDeck.logger.warn(`switchToProfile failed: ${e}`); }
  }

  protected render(): void {
    const sessions = this.manager?.getSessions() ?? [];
    const waiting = sessions.filter((s) => s.state === State.AWAITING_PERMISSION || s.state === State.AWAITING_ELICITATION);
    const working = sessions.filter((s) => s.state === State.PROCESSING);

    let token = TOKENS.idle;
    let lines: KeyLine[];
    let moving = false;

    if (waiting.length) {
      token = TOKENS.awaiting; moving = true;
      lines = waiting.length === 1
        ? [{ text: basename(waiting[0].title ?? waiting[0].cwd) || "session" }, { text: "waiting", dim: true }]
        : [{ text: String(waiting.length), size: 40 }, { text: "waiting", dim: true }];
    } else if (working.length) {
      token = TOKENS.working;
      lines = [{ text: "yolodeck" }, { text: `${working.length} working`, dim: true }];
    } else if (sessions.length) {
      lines = [{ text: "yolodeck" }, { text: `${sessions.length} idle`, dim: true }];
    } else {
      lines = [{ text: "yolodeck", dim: true }];
    }

    if (moving) animate(this, () => this.render()); else still(this);
    const image = renderKey({ token, lines, brightness: moving ? pulse() : 1 });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
