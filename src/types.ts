import type { IncomingMessage, ServerResponse } from "node:http";

export enum State {
  DISCONNECTED = "DISCONNECTED",
  IDLE = "IDLE",
  PROCESSING = "PROCESSING",
  AWAITING_PERMISSION = "AWAITING_PERMISSION",
  AWAITING_ELICITATION = "AWAITING_ELICITATION",
}

export type HookEventName =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop"
  | "StopFailure"
  | "PermissionRequest"
  | "Notification"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCreated"
  | "TaskCompleted"
  | "Elicitation"
  | "ElicitationResult";

/**
 * A permission rule Claude Code suggests when raising a PermissionRequest.
 *
 * NOT IN UPSTREAM. Observed in the Stage 0.5 spike (see PLAN.md): the payload carries
 * a ready-made rule already scoped to the request — reading
 * `C:\Windows\System32\drivers\etc\hosts` suggests `//c/Windows/System32/drivers/etc/**`,
 * while a file one level up suggests `//c/Windows/System32/**`.
 *
 * This is the shape `decision.updatedPermissions` expects, so it can be echoed straight
 * back. See SessionManager.resolvePermissionAlwaysAllow.
 */
export interface PermissionSuggestion {
  type: "addRules";
  rules: Array<{ toolName: string; ruleContent: string }>;
  behavior: "allow" | "deny";
  /** "session" scopes the rule to this session only — it dies with the session. */
  destination: "session" | "localSettings" | "projectSettings" | "userSettings";
}

export interface HookPayload {
  /** Unique session identifier */
  session_id: string;
  /** Working directory of the Claude Code session */
  cwd?: string;
  /** Permission mode (e.g. "default", "acceptEdits", "plan", "bypassPermissions") */
  permission_mode?: string;
  /** Tool name for PreToolUse/PostToolUse events */
  tool_name?: string;
  /** Tool arguments — the payload we render on the pending key so a command is never approved blind. */
  tool_input?: Record<string, unknown>;
  /** Error message for PostToolUseFailure */
  error?: string;
  /** Notification text */
  message?: string;
  /** Model identifier (present on SessionStart) */
  model?: string;
  /** Path to the session transcript JSONL file */
  transcript_path?: string;
  /** UUID of the prompt currently being processed. */
  prompt_id?: string;
  /** Live reasoning effort. Absent when the model doesn't support the effort parameter. */
  effort?: { level: "low" | "medium" | "high" | "xhigh" | "max" };
  /** Pre-scoped rules Claude Code offers for this request. Present on PermissionRequest. */
  permission_suggestions?: PermissionSuggestion[];
}

/** One rate-limit window as reported by the statusLine JSON. */
export interface RateLimitWindow {
  /** 0–100. */
  used_percentage: number;
  /** Unix epoch *seconds* when the window resets. */
  resets_at: number;
}

/**
 * Metrics from the statusLine channel.
 *
 * Hooks do not carry usage data at all — `claude usage --json` is an open feature
 * request (anthropics/claude-code#40793), so the statusLine JSON is currently the only
 * programmatic source for rate limits. It's a separate settings key and a separate
 * mechanism, and it's `type: "command"` only, hence scripts/statusline.mjs.
 *
 * Rate limits are **account-wide**, not per-session: whichever session's statusLine
 * delivered them, the numbers are the same.
 */
export interface UsageMetrics {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
  /** Epoch ms this arrived. statusLine goes quiet when every session is idle, so the
   *  key needs to know how old its number is rather than show a stale one as current. */
  receivedAt: number;
}

export interface PendingPermission {
  req: IncomingMessage;
  res: ServerResponse;
  toolName?: string;
  /** Tool arguments, rendered on the pending key. */
  toolInput?: Record<string, unknown>;
  /** Rules Claude Code suggested for this request, echoed back by always-allow. */
  suggestions?: PermissionSuggestion[];
  /** Timeout handle — cleared on resolution or cleanup. */
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionState {
  id: string;
  state: State;
  cwd: string;
  permissionMode: string;
  currentTool: string | null;
  activeWork: number;
  lastError: string | null;
  model: string | null;
  /** Human session title from the transcript (`customTitle`), the reliable name. */
  title: string | null;
  pendingPermission: PendingPermission | null;
  /** PID of the Claude Code process, resolved from hook connection. */
  pid: number | null;
  /** Epoch ms of last hook event, used for stale-session pruning. */
  lastActivity: number;
}

/**
 * Serializable view of a session for the /debug/sessions endpoint.
 * Strips the PendingPermission's live req/res/timer references.
 */
export interface SessionSnapshot {
  id: string;
  state: State;
  cwd: string;
  permissionMode: string;
  currentTool: string | null;
  activeWork: number;
  lastError: string | null;
  model: string | null;
  pid: number | null;
  lastActivity: number;
  hasPendingPermission: boolean;
  pendingPermissionToolName: string | null;
}

/**
 * The subset of Claude Code's statusLine stdin JSON that we consume.
 *
 * The full payload also carries cost, context_window, effort.level, session_id,
 * transcript_path and model — see scripts/statusline.mjs, which renders some of it
 * into the terminal on the way past.
 */
export interface StatusLinePayload {
  rate_limits?: {
    five_hour?: RateLimitWindow;
    seven_day?: RateLimitWindow;
  };
  session_id?: string;
}
