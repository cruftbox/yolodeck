import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionManager } from "../src/session-manager";
import { State, type HookEventName, type PendingPermission } from "../src/types";

const SESSION_A = "sess-aaaa-1111";
const SESSION_B = "sess-bbbb-2222";

function makePendingPermission(
  toolName = "Bash",
  suggestions?: PendingPermission["suggestions"],
): PendingPermission {
  const res = {
    writableEnded: false,
    writeHead: vi.fn(),
    end: vi.fn(function (this: any) {
      this.writableEnded = true;
    }),
  } as unknown as ServerResponse;
  const req = {} as IncomingMessage;
  return {
    req,
    res,
    toolName,
    suggestions,
    timer: setTimeout(() => {}, 0),
  };
}

/** A real payload shape, copied from the Stage 0.5 spike log. */
const READ_SUGGESTION: PendingPermission["suggestions"] = [
  {
    type: "addRules",
    rules: [{ toolName: "Read", ruleContent: "//c/Windows/System32/**" }],
    behavior: "allow",
    destination: "session",
  },
];

function startedManager() {
  const m = new SessionManager();
  m.start();
  return m;
}

describe("SessionManager state transitions", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("auto-creates a session on first event with IDLE state, then transitions to PROCESSING", () => {
    m = new SessionManager();
    const s = m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    expect(s?.state).toBe(State.PROCESSING);
    expect(s?.currentTool).toBe("Bash");
    expect(m.sessionCount).toBe(1);
  });

  it("SessionStart → IDLE, PreToolUse → PROCESSING, Stop → IDLE", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.IDLE);

    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Read" });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.currentTool).toBe("Read");

    m.handleEvent("PostToolUse", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.currentTool).toBeNull();

    m.handleEvent("Stop", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.IDLE);
  });

  it("PermissionRequest → AWAITING_PERMISSION, tool events do not kick out while permission held", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    m.setPendingPermission(SESSION_A, makePendingPermission());
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);

    // PreToolUse should NOT transition the session out of AWAITING_PERMISSION
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);
  });

  it("PostToolUse moves AWAITING_PERMISSION → PROCESSING when there is no plugin-held pending permission (terminal approval)", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    // No setPendingPermission call: simulates user approving in terminal
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);

    m.handleEvent("PostToolUse", { session_id: SESSION_A });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
  });

  it("SessionEnd removes the session and emits a final sessionUpdated event", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.sessionCount).toBe(1);

    const updates: Array<HookEventName> = [];
    m.on("sessionUpdated", (_s, e) => updates.push(e));
    m.handleEvent("SessionEnd", { session_id: SESSION_A });

    expect(m.sessionCount).toBe(0);
    expect(updates.at(-1)).toBe("SessionEnd");
  });

  it("Elicitation auto-foregrounds the session", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.handleEvent("Elicitation", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_B);
    expect(m.activeSession?.state).toBe(State.AWAITING_ELICITATION);
  });

  it("StopFailure records lastError and returns to IDLE", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    m.handleEvent("StopFailure", { session_id: SESSION_A, error: "ENOENT" });
    expect(m.activeSession?.state).toBe(State.IDLE);
    expect(m.activeSession?.lastError).toBe("ENOENT");
  });

  it("PostToolUseFailure records lastError without changing PROCESSING state", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });
    m.handleEvent("PostToolUseFailure", { session_id: SESSION_A, error: "exit 1" });
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.lastError).toBe("exit 1");
    expect(m.activeSession?.currentTool).toBeNull();
  });
});

describe("SessionManager active work counter", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("SubagentStart and TaskCreated increment, SubagentStop and TaskCompleted decrement", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });

    m.handleEvent("SubagentStart", { session_id: SESSION_A });
    m.handleEvent("TaskCreated", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(2);

    m.handleEvent("SubagentStop", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(1);

    m.handleEvent("TaskCompleted", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(0);
  });

  it("never drops below zero", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SubagentStop", { session_id: SESSION_A });
    expect(m.activeSession?.activeWork).toBe(0);
  });
});

describe("SessionManager permission queue", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("clearPendingPermissionById clears state and returns to PROCESSING", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission();
    m.setPendingPermission(SESSION_A, pending);
    expect(m.activeSession?.state).toBe(State.AWAITING_PERMISSION);

    m.clearPendingPermissionById(SESSION_A);
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    expect(m.activeSession?.pendingPermission).toBeNull();
  });

  it("resolvePermission writes allow response on approve", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission();
    m.setPendingPermission(SESSION_A, pending);

    const ok = m.resolvePermission(SESSION_A, true);
    expect(ok).toBe(true);
    expect(pending.res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("resolvePermission writes deny response on reject", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission();
    m.setPendingPermission(SESSION_A, pending);

    m.resolvePermission(SESSION_A, false, "user denied");
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(body.hookSpecificOutput.decision.message).toBe("user denied");
  });

  it("resolvePermissionAlwaysAllow writes addRules response with tool name", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission("Edit");
    m.setPendingPermission(SESSION_A, pending);

    const ok = m.resolvePermissionAlwaysAllow(SESSION_A);
    expect(ok).toBe(true);
    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(body.hookSpecificOutput.decision.updatedPermissions[0].rules[0].toolName).toBe("Edit");
  });

  it("queue: second pending permission focuses session A while A is held; advances to B when A resolves", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    m.setPendingPermission(SESSION_A, makePendingPermission());
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.handleEvent("PermissionRequest", { session_id: SESSION_B });
    m.setPendingPermission(SESSION_B, makePendingPermission());
    // Active stays on A while A is pending
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.resolvePermission(SESSION_A, true);
    // Now B should be foregrounded
    expect(m.activeSession?.id).toBe(SESSION_B);
  });
});

describe("SessionManager session cycling and PID", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("cycleSession rotates the active index forward and backward", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.cycleSession(1);
    expect(m.activeSession?.id).toBe(SESSION_B);

    m.cycleSession(1);
    expect(m.activeSession?.id).toBe(SESSION_A);

    m.cycleSession(-1);
    expect(m.activeSession?.id).toBe(SESSION_B);
  });

  it("setSessionPid stores the PID on the session", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setSessionPid(SESSION_A, 12345);
    expect(m.activeSession?.pid).toBe(12345);
  });

  // DIVERGES FROM UPSTREAM. agentsd always sends { toolName, ruleContent: "*" },
  // which allows every call to that tool for the rest of the session. We echo the
  // pre-scoped rule Claude Code supplies instead, so approving one read of System32
  // doesn't silently allow Read everywhere.
  it("always-allow echoes permission_suggestions rather than a blanket rule", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission("Read", READ_SUGGESTION);
    m.setPendingPermission(SESSION_A, pending);

    expect(m.resolvePermissionAlwaysAllow(SESSION_A)).toBe(true);

    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(body.hookSpecificOutput.decision.updatedPermissions).toEqual(READ_SUGGESTION);
    // The blanket rule upstream would have sent must NOT appear.
    expect(JSON.stringify(body)).not.toContain('"ruleContent":"*"');
  });

  it("always-allow falls back to a blanket rule when the payload has no suggestions", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PermissionRequest", { session_id: SESSION_A });
    const pending = makePendingPermission("Bash", undefined);
    m.setPendingPermission(SESSION_A, pending);

    expect(m.resolvePermissionAlwaysAllow(SESSION_A)).toBe(true);

    const body = JSON.parse((pending.res.end as any).mock.calls[0][0]);
    const rules = body.hookSpecificOutput.decision.updatedPermissions[0].rules;
    expect(rules).toEqual([{ toolName: "Bash", ruleContent: "*" }]);
  });

  // Replaces upstream's interruptActiveSession test. That method is not ported —
  // process.kill(pid, "SIGINT") terminates rather than interrupts on Windows. See
  // session-manager.ts and PORTING.md.
  //
  // hasPid is what took its place: it gates PID resolution so netstat runs once per
  // session rather than on every hook event.
  it("hasPid reports whether a PID has been resolved", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.hasPid(SESSION_A)).toBe(false);

    m.setSessionPid(SESSION_A, 12345);
    expect(m.hasPid(SESSION_A)).toBe(true);
  });

  it("hasPid is false for an unknown session", () => {
    m = new SessionManager();
    expect(m.hasPid("no-such-session")).toBe(false);
  });
});

describe("SessionManager pruning", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("prunes IDLE sessions after 60s of inactivity", () => {
    const m = startedManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.sessionCount).toBe(1);

    // Advance fake timer past STALE_MS (60s) plus a pruning interval tick (60s).
    vi.advanceTimersByTime(61_000);
    // Trigger the prune interval explicitly
    vi.advanceTimersByTime(60_000);

    expect(m.sessionCount).toBe(0);
    m.stop();
  });

  it("does NOT prune PROCESSING sessions", () => {
    const m = startedManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "Bash" });

    vi.advanceTimersByTime(121_000);
    expect(m.sessionCount).toBe(1);
    expect(m.activeSession?.state).toBe(State.PROCESSING);
    m.stop();
  });
});

describe("SessionManager event emission", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("emits sessionUpdated with the event name for every transition", () => {
    m = new SessionManager();
    const events: Array<HookEventName> = [];
    m.on("sessionUpdated", (_s, e) => events.push(e));

    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("PreToolUse", { session_id: SESSION_A, tool_name: "X" });
    m.handleEvent("Stop", { session_id: SESSION_A });

    expect(events).toEqual(["SessionStart", "PreToolUse", "Stop"]);
  });

  it("emits activeSessionChanged when cycling", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.handleEvent("SessionStart", { session_id: SESSION_B });

    const changes: Array<string | undefined> = [];
    m.on("activeSessionChanged", (s) => changes.push(s?.id));

    m.cycleSession(1);
    m.cycleSession(1);
    expect(changes).toEqual([SESSION_B, SESSION_A]);
  });
});
