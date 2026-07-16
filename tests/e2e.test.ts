import { afterEach, describe, expect, it } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookServer } from "../src/hook-server";
import { SessionManager } from "../src/session-manager";
import type { HookEventName } from "../src/types";

// Resolve testagent. CI installs it via `gh release download`; locally devs
// usually have it via `go install github.com/paultyng/testagent/cmd/testagent@latest`.
// If absent, skip these tests rather than fail the suite.
let testagentPath: string | null = null;
try {
  // WINDOWS PORT — upstream used `command -v`, a POSIX shell builtin that cmd.exe
  // doesn't have. It still "worked" (threw, so the suite skipped) but printed
  // "'command' is not recognized" noise on every run, which reads like a failure.
  const probe = process.platform === "win32" ? "where testagent" : "command -v testagent";
  testagentPath = execSync(probe, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split(/\r?\n/)[0]
    .trim() || null;
} catch {
  /* not on PATH */
}

const runE2E = testagentPath ? describe : describe.skip;

const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "PermissionRequest",
  "Notification",
];

interface Harness {
  manager: SessionManager;
  server: HookServer;
  port: number;
  workDir: string;
  settingsPath: string;
  child: ChildProcess | null;
  /** Hook events observed by the SessionManager, in order. */
  events: Array<{ event: HookEventName; sessionId: string }>;
  /** Accumulated testagent stdout — set by attachStdoutBuffer. */
  stdout: () => string;
  /** Resolves when the spawned testagent process exits. */
  exitPromise: Promise<number | null>;
}

let harness: Harness | null = null;

interface HarnessOptions {
  permissionTimeoutMs?: number;
}

async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const manager = new SessionManager();
  manager.start();
  const server = new HookServer(manager, 0, {
    debugEnabled: true,
    permissionTimeoutMs: opts.permissionTimeoutMs ?? 5_000,
  });
  await server.start();
  const port = server.listeningPort!;
  const workDir = await mkdtemp(join(tmpdir(), "agentsd-e2e-"));

  const settings = {
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((e) => [
        e,
        [{ matcher: "", hooks: [{ type: "http", url: `http://127.0.0.1:${port}/hooks/${e}`, timeout: 5 }] }],
      ]),
    ),
  };
  const settingsPath = join(workDir, "settings.json");
  await writeFile(settingsPath, JSON.stringify(settings));

  const events: Array<{ event: HookEventName; sessionId: string }> = [];
  manager.on("sessionUpdated", (session, event) => {
    events.push({ event, sessionId: session.id });
  });

  // exitPromise + stdout are assigned by attachExitTracker / attachStdoutBuffer.
  return { manager, server, port, workDir, settingsPath, child: null, events, stdout: () => "", exitPromise: Promise.resolve(null) };
}

function attachExitTracker(h: Harness): void {
  h.exitPromise = new Promise<number | null>((resolve) => {
    h.child!.on("exit", (code) => resolve(code));
  });
}

function attachStdoutBuffer(h: Harness): void {
  let buf = "";
  h.child!.stdout!.on("data", (chunk: Buffer) => { buf += chunk.toString("utf8"); });
  h.stdout = () => buf;
}

async function waitForEvent(h: Harness, event: HookEventName, sessionId: string, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (h.events.some((e) => e.event === event && e.sessionId === sessionId)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${event} for ${sessionId} not observed in ${timeoutMs}ms; saw: ${JSON.stringify(h.events)}`);
}

async function waitForStdout(h: Harness, substr: string, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (h.stdout().includes(substr)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`stdout did not contain ${JSON.stringify(substr)} in ${timeoutMs}ms; got:\n${h.stdout()}`);
}

afterEach(async () => {
  if (harness?.child && harness.child.exitCode === null && !harness.child.killed) {
    harness.child.kill("SIGKILL");
  }
  if (harness) {
    await harness.server.stop();
    harness.manager.stop();
    await rm(harness.workDir, { recursive: true, force: true });
  }
  harness = null;
});

runE2E("E2E via testagent", () => {
  // E2E's job: prove testagent's hook payload shape matches what the server
  // expects. Per-event behavior is already covered by tests/hook-server.test.ts
  // POSTing hook payloads directly. The E2E layer just proves the wire-up
  // (testagent → http → hook-server → SessionManager) is intact.
  it("fires SessionStart and SessionEnd around a one-shot --print session", async () => {
    harness = await startHarness();
    const sessionId = "e2e-lifecycle-1";

    harness.child = spawn(
      testagentPath!,
      [
        "claude",
        "--settings", harness.settingsPath,
        "--session-id", sessionId,
        "--print", "hello",
        "--stream-delay", "0",
        "--think-delay", "0",
      ],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["ignore", "pipe", "pipe"] },
    );
    attachExitTracker(harness);

    await waitForEvent(harness, "SessionStart", sessionId);
    const exit = await harness.exitPromise;
    expect(exit).toBe(0);
    await waitForEvent(harness, "SessionEnd", sessionId);
    expect(harness.manager.sessionCount).toBe(0);
  });

  it("fires PostToolUse when testagent runs /fake-tool + /fake-tool-result", async () => {
    harness = await startHarness();
    const sessionId = "e2e-tool-1";

    harness.child = spawn(
      testagentPath!,
      [
        "claude",
        "--settings", harness.settingsPath,
        "--session-id", sessionId,
        "--stream-delay", "0",
        "--think-delay", "0",
      ],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);

    await waitForEvent(harness, "SessionStart", sessionId);

    // /fake-tool fires PreToolUse and renders the fake tool-use block;
    // /fake-tool-result fires PostToolUse with the captured input + supplied response.
    harness.child.stdin!.write('/fake-tool Bash {"command":"echo hi"}\n');
    harness.child.stdin!.write('/fake-tool-result {"stdout":"hi"}\n');

    await waitForEvent(harness, "PostToolUse", sessionId);

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
    await waitForEvent(harness, "SessionEnd", sessionId);
  });

  // Permission lifecycle: testagent sends PermissionRequest, agentsd holds
  // the HTTP response open, the test calls resolvePermission to write the
  // allow/deny body back, testagent renders the outcome. Requires testagent
  // ≥ v0.5.0 (the /fake-permission-request slash).
  it("PermissionRequest allow round-trip: resolvePermission(true) → testagent renders granted", async () => {
    harness = await startHarness();
    const sessionId = "e2e-permission-allow";

    harness.child = spawn(
      testagentPath!,
      ["claude", "--settings", harness.settingsPath, "--session-id", sessionId,
        "--stream-delay", "0", "--think-delay", "0"],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);
    attachStdoutBuffer(harness);

    await waitForEvent(harness, "SessionStart", sessionId);

    // Drive testagent into PermissionRequest. agentsd holds the response
    // open until resolvePermission writes the decision body.
    harness.child.stdin!.write('/fake-permission-request Bash {"command":"ls"}\n');
    await waitForEvent(harness, "PermissionRequest", sessionId);
    expect(harness.manager.resolvePermission(sessionId, true)).toBe(true);

    // testagent's allow body from agentsd has no message field, so the
    // marker is the bare "permission granted" with no reason suffix.
    await waitForStdout(harness, "permission granted");

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
  });

  it("PermissionRequest deny round-trip: resolvePermission(false, reason) → testagent renders denied with reason", async () => {
    harness = await startHarness();
    const sessionId = "e2e-permission-deny";

    harness.child = spawn(
      testagentPath!,
      ["claude", "--settings", harness.settingsPath, "--session-id", sessionId,
        "--stream-delay", "0", "--think-delay", "0"],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);
    attachStdoutBuffer(harness);

    await waitForEvent(harness, "SessionStart", sessionId);

    harness.child.stdin!.write('/fake-permission-request rm {}\n');
    await waitForEvent(harness, "PermissionRequest", sessionId);
    expect(harness.manager.resolvePermission(sessionId, false, "user said no")).toBe(true);

    await waitForStdout(harness, "permission denied: user said no");

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
  });

  it("PermissionRequest timeout: HookServer auto-denies after permissionTimeoutMs → testagent renders Timed out", async () => {
    harness = await startHarness({ permissionTimeoutMs: 200 });
    const sessionId = "e2e-permission-timeout";

    harness.child = spawn(
      testagentPath!,
      ["claude", "--settings", harness.settingsPath, "--session-id", sessionId,
        "--stream-delay", "0", "--think-delay", "0"],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);
    attachStdoutBuffer(harness);

    await waitForEvent(harness, "SessionStart", sessionId);

    harness.child.stdin!.write('/fake-permission-request Bash {}\n');
    // Don't resolve — HookServer should auto-deny with message "Timed out".
    await waitForStdout(harness, "permission denied: Timed out", 3_000);

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
  });

  it("Notification advisory: testagent fires fire-and-forget; state unchanged", async () => {
    harness = await startHarness();
    const sessionId = "e2e-notification";

    harness.child = spawn(
      testagentPath!,
      ["claude", "--settings", harness.settingsPath, "--session-id", sessionId,
        "--stream-delay", "0", "--think-delay", "0"],
      { env: { ...process.env, HOME: harness.workDir }, stdio: ["pipe", "pipe", "pipe"] },
    );
    attachExitTracker(harness);

    await waitForEvent(harness, "SessionStart", sessionId);
    const stateBefore = harness.manager.getSnapshot().find((s) => s.id === sessionId)?.state;

    harness.child.stdin!.write('/fake-notification permission_prompt -- session has been idle\n');
    await waitForEvent(harness, "Notification", sessionId);

    // Notification is advisory: state machine returns null for the
    // transition, so the session stays in whatever state it was in.
    const stateAfter = harness.manager.getSnapshot().find((s) => s.id === sessionId)?.state;
    expect(stateAfter).toBe(stateBefore);

    harness.child.stdin!.write("/exit 0\n");
    harness.child.stdin!.end();
    await harness.exitPromise;
  });
});
