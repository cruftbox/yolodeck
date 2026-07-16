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
