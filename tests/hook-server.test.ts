import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookServer } from "../src/hook-server";
import { SessionManager } from "../src/session-manager";
import { State } from "../src/types";

const SESSION_A = "sess-aaaa-1111";

let manager: SessionManager;
let server: HookServer;
let baseUrl: string;

async function startServer(
  options: { debugEnabled?: boolean; permissionTimeoutMs?: number; token?: string } = {},
) {
  manager = new SessionManager();
  server = new HookServer(manager, 0, options);
  await server.start();
  const port = server.listeningPort!;
  baseUrl = `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await server?.stop();
  manager?.stop();
});

// NOT IN UPSTREAM. agentsd has no auth on the listener at all — loopback binding is its
// only defence, and that doesn't stop a web page you visit from POSTing to
// 127.0.0.1:9200 from your browser. This endpoint approves tool calls, so that matters.
describe("HookServer bearer token", () => {
  const TOKEN = "test-token-abc123";

  it("401s a request with no Authorization header", async () => {
    await startServer({ token: TOKEN });
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    expect(res.status).toBe(401);
    expect(manager.sessionCount).toBe(0);
  });

  it("401s a request with the wrong token", async () => {
    await startServer({ token: TOKEN });
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token-xxxxx" },
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    expect(res.status).toBe(401);
    expect(manager.sessionCount).toBe(0);
  });

  it("accepts a request with the correct token", async () => {
    await startServer({ token: TOKEN });
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    expect(res.status).toBe(200);
    expect(manager.sessionCount).toBe(1);
  });

  it("runs open when no token is configured (upstream behaviour)", async () => {
    await startServer({});
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    expect(res.status).toBe(200);
  });
});

describe("HookServer routing", () => {
  beforeEach(() => startServer());

  it("405 on non-POST to a hook path", async () => {
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("404 on POST to an unknown event", async () => {
    const res = await fetch(`${baseUrl}/hooks/NotAnEvent`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    expect(res.status).toBe(404);
  });

  it("400 on POST with empty body", async () => {
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("400 on POST with invalid JSON", async () => {
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("200 on POST with valid body; SessionManager receives the event", async () => {
    const res = await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A, model: "claude-sonnet-4-6" }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("{}");
    expect(manager.sessionCount).toBe(1);
    expect(manager.activeSession?.state).toBe(State.IDLE);
    expect(manager.activeSession?.model).toBe("claude-sonnet-4-6");
  });

  it("routes PreToolUse to handleEvent and transitions to PROCESSING", async () => {
    await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A }),
    });
    await fetch(`${baseUrl}/hooks/PreToolUse`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A, tool_name: "Bash" }),
    });
    expect(manager.activeSession?.state).toBe(State.PROCESSING);
    expect(manager.activeSession?.currentTool).toBe("Bash");
  });
});

describe("HookServer debug endpoint", () => {
  it("404 on GET /debug/sessions when debug disabled", async () => {
    await startServer({ debugEnabled: false });
    const res = await fetch(`${baseUrl}/debug/sessions`, { method: "GET" });
    // Debug path bypassed; falls through to the 405-on-non-POST gate.
    expect(res.status).toBe(405);
  });

  it("200 with JSON array on GET /debug/sessions when debug enabled", async () => {
    await startServer({ debugEnabled: true });
    await fetch(`${baseUrl}/hooks/SessionStart`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A, model: "claude-sonnet-4-6" }),
    });

    const res = await fetch(`${baseUrl}/debug/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].id).toBe(SESSION_A);
    expect(body[0].state).toBe(State.IDLE);
    expect(body[0].hasPendingPermission).toBe(false);
  });
});

describe("HookServer PermissionRequest hold-open", () => {
  it("holds response open until resolved", async () => {
    await startServer({ permissionTimeoutMs: 5000 });

    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/hooks/PermissionRequest`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A, tool_name: "Bash" }),
      signal: controller.signal,
    });

    // Give the server a moment to register the pending permission.
    await new Promise((r) => setTimeout(r, 50));
    const snap = manager.getSnapshot()[0];
    expect(snap.hasPendingPermission).toBe(true);
    expect(snap.pendingPermissionToolName).toBe("Bash");

    // Resolve via the SessionManager (what a Stream Deck button press would do).
    manager.resolvePermission(SESSION_A, true);

    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.decision.behavior).toBe("allow");
  });

  it("writes deny response on timeout", async () => {
    // Short timeout so the test runs fast; no fake timers (real HTTP server).
    await startServer({ permissionTimeoutMs: 100 });

    const res = await fetch(`${baseUrl}/hooks/PermissionRequest`, {
      method: "POST",
      body: JSON.stringify({ session_id: SESSION_A, tool_name: "Bash" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(body.hookSpecificOutput.decision.message).toBe("Timed out");
    // SessionManager should have cleared the pending state.
    expect(manager.getSnapshot()[0].hasPendingPermission).toBe(false);
  });
});

describe("HookServer lifecycle", () => {
  it("listeningPort returns the OS-assigned port when started with port 0", async () => {
    await startServer();
    expect(server.listeningPort).toBeGreaterThan(0);
  });

  it("stop() closes the server and lets a new one bind the same port", async () => {
    await startServer();
    const port = server.listeningPort!;
    await server.stop();
    manager.stop();

    // Re-bind specifically to the same port; should not throw.
    manager = new SessionManager();
    server = new HookServer(manager, port);
    await expect(server.start()).resolves.toBeUndefined();
  });
});
