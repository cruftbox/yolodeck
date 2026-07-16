import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { basename } from "node:path";
import { ManagedAction } from "./base";
import { normalizePath } from "../session-manager";
import { focusWindowForPid } from "../util/windows";
import { State, type SessionState } from "../types";
import { keyImage, type KeyLine } from "../util/svg";

const STATE_COLORS: Record<State, string> = {
  [State.DISCONNECTED]: "#333333",
  [State.IDLE]: "#1a7f37",
  [State.PROCESSING]: "#1f6feb",
  [State.AWAITING_PERMISSION]: "#d29922",
  [State.AWAITING_ELICITATION]: "#8957e5",
};

/** An empty pinned slot: project name shown dimmed, so the key keeps its identity. */
const EMPTY_PIN_BG = "#26292e";

export type SessionSlotSettings = {
  /** Project directory this key claims, e.g. "C:\\Code\\orbis". Empty means overflow. */
  pin?: string;
  /**
   * Stable display name. Overrides the auto name (basename of the session's cwd).
   *
   * The auto name is volatile — it tracks the session's *current working directory*,
   * which moves during a session: a session can read as "yolodeck", then "micha" (the
   * home dir), then a raw GUID (when a tool runs in the session's temp dir, which is
   * named after the session UUID). A label pins the name so a key always reads the same
   * thing regardless of where the session's cwd wanders.
   */
  label?: string;
};

/**
 * One key, one session.
 *
 * DIVERGES FROM UPSTREAM. agentsd has a single notion of "the active session" and every
 * Session key renders it — place five keys and you get five identical keys, pressing to
 * cycle. That works at one or two sessions and collapses at five. It also means every
 * session started from the home directory renders as an indistinguishable `micha`.
 *
 * Here each key resolves its *own* session:
 *
 *   - **Pinned** (`pin` set to a project path): claims that project's session wherever
 *     it lands, so orbis is always the same physical key. Renders dim with the project
 *     name when nothing is running there, so the slot keeps its identity.
 *   - **Overflow** (no `pin`): claims unpinned sessions first-come, ordered by the key's
 *     own position on the deck. Coordinates are the only stable ordering available —
 *     without it two overflow keys would both claim session #1.
 *
 * Pressing a key targets that session for approve/deny rather than cycling.
 */
@action({ UUID: "com.cruftbox.yolodeck.session" })
export class SessionButton extends ManagedAction {
  /**
   * Per-instance settings, keyed by action id.
   *
   * render() is synchronous and getSettings() is not, so settings are cached as they
   * arrive via WillAppear/DidReceiveSettings rather than fetched during a render.
   */
  private readonly settings = new Map<string, SessionSlotSettings>();

  override onWillAppear(ev: WillAppearEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as SessionSlotSettings);
    super.onWillAppear(ev);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.settings.set(ev.action.id, (ev.payload.settings ?? {}) as SessionSlotSettings);
    this.render();
  }

  /** Offer the Property Inspector the directories we actually know about. */
  override onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent): void {
    this.sendKnownCwds();
  }

  override onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, SessionSlotSettings>): void {
    if (ev.payload?.event === "getSessions") this.sendKnownCwds();
  }

  /**
   * Push the live session directories to the inspector so pinning is a click rather
   * than typing a path from memory. `streamDeck.ui` targets whichever inspector is
   * currently open, which is the only one that can be — Stream Deck shows one at a time.
   */
  private sendKnownCwds(): void {
    const cwds = [...new Set(this.manager?.getSessions().map((s) => s.cwd) ?? [])];
    streamDeck.ui.sendToPropertyInspector({ event: "sessions", cwds }).catch(() => {
      /* inspector closed between request and reply */
    });
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const session = this.resolve(ev.action as KeyAction);
    if (!session) return;

    // Target this session for approve/deny. Upstream cycled the active session here,
    // which stops making sense once each key owns one.
    this.manager?.focusSession(session.id);

    // Also raise this session's window — the "switch to it" half. Each session is its
    // own terminal window, resolved by PID (netstat). In the desktop app every session
    // shares one window, so this raises the app but can't select the conversation —
    // the CLI-vs-GUI difference you can feel by pressing this key in each.
    if (session.pid) {
      try {
        await focusWindowForPid(session.pid);
      } catch (err) {
        streamDeck.logger.debug(`Session focus by PID ${session.pid} failed: ${err}`);
      }
    }
  }

  /** Which session does a given key show? */
  private resolve(act: KeyAction): SessionState | undefined {
    const pin = this.settings.get(act.id)?.pin?.trim();
    if (pin) return this.manager?.findByCwd(pin);

    // Overflow: sessions no pinned key has claimed, handed out by deck position.
    const pinned = new Set(
      [...this.settings.values()].map((s) => normalizePath(s.pin?.trim())).filter(Boolean),
    );
    const unclaimed = (this.manager?.getSessions() ?? []).filter(
      (s) => !pinned.has(normalizePath(s.cwd)),
    );

    const index = this.overflowKeys().findIndex((k) => k.id === act.id);
    return index >= 0 ? unclaimed[index] : undefined;
  }

  /** Unpinned keys in deck order, top-left first. Stable, unlike iteration order. */
  private overflowKeys(): KeyAction[] {
    return [...this.actions]
      .filter((a): a is KeyAction => "coordinates" in a && !this.settings.get(a.id)?.pin?.trim())
      .sort((a, b) => {
        const ac = a.coordinates;
        const bc = b.coordinates;
        if (!ac || !bc) return 0; // multi-action members have no coordinates
        return ac.row - bc.row || ac.column - bc.column;
      });
  }

  protected render(): void {
    const activeId = this.manager?.activeSessionId;

    for (const act of this.actions) {
      if (!("coordinates" in act)) continue;
      const key = act as KeyAction;
      const settings = this.settings.get(key.id);
      const session = this.resolve(key);
      const pin = settings?.pin?.trim();
      const label = settings?.label?.trim();

      let image: string;
      if (session) {
        // Name priority: manual label > session title (customTitle) > cwd basename.
        // The title is the real distinguisher — basename(cwd) shows "micha" for every
        // session started from the home dir. See readTranscriptMeta.
        const name = label || session.title || basename(session.cwd) || session.cwd;
        const lines: KeyLine[] = [{ text: name, bold: true }];
        if (session.currentTool) lines.push({ text: session.currentTool, dim: true });
        image = keyImage({
          bg: STATE_COLORS[session.state],
          lines,
          // Marks which session approve/deny acts on. Implicit with one key; with five,
          // "which agent am I approving?" is a real question.
          active: session.id === activeId,
        });
      } else if (pin || label) {
        // Pinned or labelled but idle: keep the slot's identity rather than going blank.
        image = keyImage({ bg: EMPTY_PIN_BG, lines: [{ text: label || basename(pin!) || pin!, dim: true }] });
      } else {
        image = keyImage({ bg: STATE_COLORS[State.DISCONNECTED], lines: [{ text: "—", dim: true }] });
      }

      key.setImage(image).catch((err) => streamDeck.logger.debug(`setImage failed: ${err}`));
    }
  }
}
