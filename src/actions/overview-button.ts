import streamDeck, { action, type KeyAction, type KeyDownEvent } from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { State } from "../types";
import { keyImage, type KeyLine } from "../util/svg";

/** The profile bundled with this plugin. Must match the manifest's Profiles entry. */
export const YOLODECK_PROFILE = "yolodeck";

const IDLE_BG = "#26292e";
const ACTIVE_BG = "#1f6feb";
const WAITING_BG = "#d29922";

/**
 * The one key that lives on your existing front page.
 *
 * NOT IN UPSTREAM. It exists because of an SDK constraint:
 *
 *   "Plugins do not have access to user-defined profiles, and therefore cannot switch
 *    to them. Plugins can only switch to profiles distributed with the plugin."
 *
 * So the plugin can jump *to* its own bundled profile but can never send you back to
 * your hand-made front page. The way around that asymmetry: this key lives on your
 * page and pushes you into ours; the return trip is the *built-in* Switch Profile
 * action (baked into the bundled profile), which has no such restriction.
 *
 * Cost to an existing layout: exactly one key.
 *
 * It earns that key by being the thing that tells you something needs attention while
 * you are looking at a completely different profile. Deliberately NOT an auto-switch:
 * hijacking the deck mid-task gets old immediately, and the no-return-path constraint
 * above means we could shove you into our profile and not bring you home.
 */
@action({ UUID: "com.cruftbox.yolodeck.overview" })
export class OverviewButton extends ManagedAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const device = (ev.action as KeyAction).device?.id;
    if (!device) return;
    try {
      await streamDeck.profiles.switchToProfile(device, YOLODECK_PROFILE);
    } catch (err) {
      // Fails if the user declined the profile's install prompt. Nothing to recover.
      streamDeck.logger.warn(`Could not switch to the ${YOLODECK_PROFILE} profile: ${err}`);
    }
  }

  protected render(): void {
    const sessions = this.manager?.getSessions() ?? [];
    const waiting = sessions.filter(
      (s) => s.state === State.AWAITING_PERMISSION || s.state === State.AWAITING_ELICITATION,
    );
    const working = sessions.filter((s) => s.state === State.PROCESSING);

    let bg: string;
    let lines: KeyLine[];

    if (waiting.length > 0) {
      // The whole reason this key exists. Name the project when there's only one —
      // "orbis is waiting" is actionable in a way that "1 waiting" isn't.
      bg = WAITING_BG;
      lines =
        waiting.length === 1
          ? [{ text: basename(waiting[0].cwd) || "session", bold: true }, { text: "waiting", dim: true }]
          : [{ text: String(waiting.length), bold: true, size: 34 }, { text: "waiting", dim: true }];
    } else if (working.length > 0) {
      bg = ACTIVE_BG;
      lines = [{ text: "yolodeck", bold: true }, { text: `${working.length} working`, dim: true }];
    } else if (sessions.length > 0) {
      bg = IDLE_BG;
      lines = [{ text: "yolodeck", bold: true }, { text: `${sessions.length} idle`, dim: true }];
    } else {
      bg = IDLE_BG;
      lines = [{ text: "yolodeck", dim: true }];
    }

    const image = keyImage({ bg, lines });
    for (const act of this.actions) {
      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}
