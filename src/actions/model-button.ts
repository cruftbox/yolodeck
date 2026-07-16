import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { INERT_BG, keyImage } from "../util/svg";
import { shortenModel } from "../util/model";

/**
 * The active session's model, on its own key.
 *
 * Split out of the mode key: that key was carrying two unrelated facts — permission
 * mode and model — and on a 72px key the auto-fit shrank the model line to something
 * unreadable to make both fit. Two facts, one key, is one too many. Each is legible
 * on its own.
 *
 * `model` is already tracked on the session and backfilled from the transcript when a
 * payload omits it (see SessionManager.handleEvent), so this just renders it large.
 */
@action({ UUID: "com.cruftbox.yolodeck.model" })
export class ModelButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;
    const model = session?.model ? shortenModel(session.model) : null;

    // A model name is two words ("Opus 4.8"); split so each half gets its own line and
    // reads large, instead of one long string auto-shrinking to fit the width.
    const [name, version] = model ? splitModel(model) : [null, null];

    const image = keyImage({
      bg: INERT_BG,
      lines: model
        ? [
            { text: name!, bold: true, size: 26 },
            ...(version ? [{ text: version, dim: true, size: 22 }] : []),
          ]
        : [{ text: "model", bold: true }, { text: "—", dim: true }],
    });
    for (const act of this.actions) {
      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}

/** "Opus 4.8" -> ["Opus", "4.8"]; a single-token name stays whole with no version line. */
function splitModel(short: string): [string, string | null] {
  const i = short.lastIndexOf(" ");
  return i < 0 ? [short, null] : [short.slice(0, i), short.slice(i + 1)];
}
