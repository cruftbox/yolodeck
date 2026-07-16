import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { INERT_BG, keyImage, type KeyLine } from "../util/svg";
import { formatUntil, remaining, usageColor } from "../util/usage";

/** How old a reading can be before the key stops presenting it as current. */
const STALE_MS = 15 * 60 * 1000;

export type UsageSettings = {
  /** Which rate-limit window this key shows. Toggled by pressing it. */
  window?: "five_hour" | "seven_day";
};

/**
 * Rate limit remaining, from the statusLine channel.
 *
 * Not fed by hooks: hook payloads carry no usage data at all, and `claude usage --json`
 * is an open feature request, so the statusLine JSON is the only programmatic source
 * that currently exists. See scripts/statusline.mjs.
 *
 * The number is **account-wide**, so it doesn't matter which session reported it — and
 * the statusLine goes quiet when every session is idle, which is why staleness is shown
 * rather than hidden. A number that stopped updating an hour ago should not look live.
 */
@action({ UUID: "com.cruftbox.yolodeck.usage" })
export class UsageButton extends ManagedAction {
  private readonly settings = new Map<string, UsageSettings>();

  override onWillAppear(ev: WillAppearEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as UsageSettings);
    if (!this.usageBound && this.manager) {
      this.manager.on("usageUpdated", () => this.render());
      this.usageBound = true;
    }
    super.onWillAppear(ev);
  }

  private usageBound = false;

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as UsageSettings);
    this.render();
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const current = this.settings.get(ev.action.id)?.window ?? "five_hour";
    const next: UsageSettings = { window: current === "five_hour" ? "seven_day" : "five_hour" };
    this.settings.set(ev.action.id, next);
    await ev.action.setSettings(next);
    this.render();
  }

  protected render(): void {
    const usage = this.manager?.usage;

    for (const act of this.actions) {
      const which = this.settings.get(act.id)?.window ?? "five_hour";
      const label = which === "five_hour" ? "5h" : "7d";
      const w = usage?.[which];

      let image: string;
      if (!usage || !w) {
        // Never reported. Almost always means the statusLine isn't installed —
        // say which key it is rather than showing a blank.
        image = keyImage({ bg: INERT_BG, lines: [{ text: "usage", bold: true }, { text: "no data", dim: true }] });
      } else {
        const pct = remaining(w);
        const stale = Date.now() - usage.receivedAt > STALE_MS;
        const lines: KeyLine[] = [{ text: `${pct}%`, bold: true, size: 34 }];
        lines.push({ text: stale ? `${label} · stale` : `${label} · ${formatUntil(w.resets_at)}`, dim: true });
        // A stale reading goes grey: it is no longer a claim about right now.
        image = keyImage({ bg: stale ? INERT_BG : usageColor(pct), lines });
      }

      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}
