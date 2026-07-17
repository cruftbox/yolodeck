import streamDeck, {
  action, type DidReceiveSettingsEvent, type KeyDownEvent, type WillAppearEvent,
} from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { TOKENS, renderKey, type KeyLine } from "../util/svg";
import { formatUntil, remaining } from "../util/usage";

const STALE_MS = 15 * 60 * 1000;

export type UsageSettings = { window?: "five_hour" | "seven_day" };

/**
 * Rate-limit remaining, from the statusLine channel (terminal only — the desktop app
 * doesn't run statusLine, so this reads "no data" there). Green >25% left, amber ≤25,
 * red ≤10. Steady — usage isn't an attention state.
 */
@action({ UUID: "com.cruftbox.yolodeck.usage" })
export class UsageButton extends ManagedAction {
  private readonly settings = new Map<string, UsageSettings>();
  private usageBound = false;

  override onWillAppear(ev: WillAppearEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as UsageSettings);
    if (!this.usageBound && this.manager) { this.manager.on("usageUpdated", () => this.render()); this.usageBound = true; }
    super.onWillAppear(ev);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as UsageSettings);
    this.render();
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const cur = this.settings.get(ev.action.id)?.window ?? "five_hour";
    const next: UsageSettings = { window: cur === "five_hour" ? "seven_day" : "five_hour" };
    this.settings.set(ev.action.id, next);
    await ev.action.setSettings(next);
    this.render();
  }

  protected render(): void {
    const usage = this.manager?.usage;
    for (const act of this.actions) {
      const which = this.settings.get(act.id)?.window ?? "five_hour";
      const w = usage?.[which];
      let image: string;
      if (!usage || !w) {
        image = renderKey({ token: TOKENS.idle, lines: [{ text: "usage" }, { text: "no data", dim: true }] });
      } else {
        const pct = remaining(w);
        const stale = Date.now() - usage.receivedAt > STALE_MS;
        const token = stale ? TOKENS.idle : pct <= 10 ? TOKENS.deny : pct <= 25 ? TOKENS.awaiting : TOKENS.approve;
        const lines: KeyLine[] = [
          { text: `${pct}%`, size: 44 },
          { text: stale ? "stale" : formatUntil(w.resets_at), dim: true },
        ];
        image = renderKey({ token, lines });
      }
      act.setImage(image).catch((e) => streamDeck.logger.debug(`${e}`));
    }
  }
}
