import streamDeck, { action, type WillDisappearEvent } from "@elgato/streamdeck";
import { ManagedAction } from "./base";
import { GLYPH, INERT_BG, keyImage } from "../util/svg";
import { breathe, scaleBrightness } from "../util/color";

const MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  auto: "Auto",
  dontAsk: "Don't Ask",
  bypassPermissions: "Bypass",
};

/**
 * Modes where Claude is NOT going to stop and ask. The key breathes purple to say so
 * loudly: the failure mode of a bypassed deck is not pressing the wrong thing, it's
 * forgetting the safety is off — and a silent deck looks identical to a working one.
 * Motion is the one thing you can't fail to notice out of the corner of your eye.
 */
const UNGUARDED = new Set(["bypassPermissions", "dontAsk", "auto"]);

const UNGUARDED_BG = "#8957e5";
const BREATHE_PERIOD_MS = 2800; // one calm breath; see util/color.ts on why not faster
const FRAME_MS = 150; // ~7fps — smooth enough for a slow fade, trivial for one key

/**
 * Permission mode. The model moved to its own key — two facts on one 72px key made both
 * unreadable.
 *
 * Breathes while the mode is unguarded. A single interval runs only while such a key is
 * actually on the deck; it's driven by wall-clock time, so it needs no per-frame state
 * and multiple mode keys stay in phase.
 */
@action({ UUID: "com.cruftbox.yolodeck.mode" })
export class ModeButton extends ManagedAction {
  private timer: ReturnType<typeof setInterval> | null = null;

  override onWillDisappear(_ev: WillDisappearEvent): void {
    // Base class has no onWillDisappear. `this.actions` still includes the departing
    // instance during this event, so re-check on the next tick; if none remain, stop
    // the timer rather than paint into the void.
    queueMicrotask(() => {
      if (this.actions.length === 0) this.stopBreathing();
    });
  }

  protected render(): void {
    this.paint();
  }

  private paint(): void {
    const session = this.manager?.activeSession;
    const mode = session?.permissionMode ?? "";
    const label = MODE_LABELS[mode] ?? mode ?? "—";
    const unguarded = UNGUARDED.has(mode);

    if (unguarded) this.startBreathing();
    else this.stopBreathing();

    // Wall-clock phase: correct regardless of timer jitter, no accumulated state.
    const bg = unguarded ? scaleBrightness(UNGUARDED_BG, breathe(Date.now(), BREATHE_PERIOD_MS)) : INERT_BG;

    // No visible instance → nothing to animate.
    if (this.actions.length === 0) {
      this.stopBreathing();
      return;
    }

    const image = keyImage({ bg, glyph: GLYPH.shield, lines: [{ text: label || "—", bold: true }] });
    for (const act of this.actions) {
      act.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }

  private startBreathing(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.paint(), FRAME_MS);
  }

  private stopBreathing(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
