import streamDeck, { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { TOKENS, renderKey } from "../util/svg";
import { shortenModel } from "../util/model";

/** The active session's model on its own key — family big, version dimmed. Info-sky. */
@action({ UUID: "com.cruftbox.yolodeck.model" })
export class ModelButton extends ManagedAction {
  protected render(): void {
    const m = this.manager?.activeSession?.model;
    const short = m ? shortenModel(m) : null;
    const i = short ? short.lastIndexOf(" ") : -1;
    const [name, version] = short ? (i < 0 ? [short, null] : [short.slice(0, i), short.slice(i + 1)]) : [null, null];

    const image = renderKey({
      token: TOKENS.info,
      lines: name
        ? [{ text: name, size: 30 }, ...(version ? [{ text: version, dim: true }] : [])]
        : [{ text: "model" }, { text: "—", dim: true }],
    });
    for (const act of this.actions) act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
  }
}
