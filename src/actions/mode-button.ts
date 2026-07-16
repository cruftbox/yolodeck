import { action } from "@elgato/streamdeck";
import { ManagedAction } from "./base";

const MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept\nEdits",
  plan: "Plan",
  auto: "Auto",
  dontAsk: "Don't\nAsk",
  bypassPermissions: "Bypass",
};

/** Shorten model ID for button display, e.g. "claude-sonnet-4-6" → "Sonnet 4.6" */
function shortenModel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (m) {
    const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return `${name} ${m[2]}.${m[3]}`;
  }
  return model.replace(/^claude-/, "").slice(0, 12);
}

@action({ UUID: "com.cruftbox.yolodeck.mode" })
export class ModeButton extends ManagedAction {
  protected render(): void {
    const session = this.manager?.activeSession;
    const modeLabel = MODE_LABELS[session?.permissionMode ?? ""] ?? session?.permissionMode ?? "—";
    const modelLabel = session?.model ? shortenModel(session.model) : "";
    const title = modelLabel ? `${modeLabel}\n${modelLabel}` : modeLabel;
    for (const act of this.actions) {
      act.setTitle(title);
    }
  }
}
