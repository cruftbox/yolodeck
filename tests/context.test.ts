import { describe, it, expect, afterEach } from "vitest";
import { SessionManager } from "../src/session-manager";
// Imported from util/, not the action: the action file carries an SDK decorator that
// the test transform chokes on, and pure logic has no business living behind it.
import { contextBand } from "../src/util/context";

const SESSION_A = "sess-aaaa-1111";

describe("contextBand", () => {
  it("is approve while there's room", () => {
    expect(contextBand(0)).toBe("approve");
    expect(contextBand(49)).toBe("approve");
  });

  it("is awaiting from 50% used", () => {
    expect(contextBand(50)).toBe("awaiting");
    expect(contextBand(79)).toBe("awaiting");
  });

  it("is deny from 80% used", () => {
    expect(contextBand(80)).toBe("deny");
    expect(contextBand(100)).toBe("deny");
  });
});

describe("SessionManager context window", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("is null until the statusLine reports", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    expect(m.activeSession?.contextWindow).toBeNull();
  });

  it("attaches to the session named by session_id, not a manager-level value", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    const before = Date.now();

    m.setContextWindow({
      session_id: SESSION_A,
      context_window: { used_percentage: 42, context_window_size: 200_000 },
    });

    expect(m.activeSession?.contextWindow?.usedPercentage).toBe(42);
    expect(m.activeSession?.contextWindow?.contextWindowSize).toBe(200_000);
    expect(m.activeSession?.contextWindow?.receivedAt).toBeGreaterThanOrEqual(before);
  });

  it("defaults context_window_size to 200000 when the payload omits it", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setContextWindow({ session_id: SESSION_A, context_window: { used_percentage: 10 } });
    expect(m.activeSession?.contextWindow?.contextWindowSize).toBe(200_000);
  });

  it("ignores a payload with no session_id", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setContextWindow({ context_window: { used_percentage: 42 } });
    expect(m.activeSession?.contextWindow).toBeNull();
  });

  it("ignores a payload with no context_window", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setContextWindow({ session_id: SESSION_A });
    expect(m.activeSession?.contextWindow).toBeNull();
  });

  it("ignores a payload for a session that hasn't registered yet", () => {
    m = new SessionManager();
    m.setContextWindow({
      session_id: "unknown-session",
      context_window: { used_percentage: 42 },
    });
    expect(m.sessionCount).toBe(0);
  });

  it("replaces the previous reading rather than merging", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    m.setContextWindow({ session_id: SESSION_A, context_window: { used_percentage: 20 } });
    m.setContextWindow({ session_id: SESSION_A, context_window: { used_percentage: 65 } });
    expect(m.activeSession?.contextWindow?.usedPercentage).toBe(65);
  });

  it("emits sessionUpdated so the key re-renders", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    let fired = 0;
    m.on("sessionUpdated", () => fired++);
    m.setContextWindow({ session_id: SESSION_A, context_window: { used_percentage: 42 } });
    expect(fired).toBe(1);
  });

  it("does not emit for a payload with no context_window", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: SESSION_A });
    let fired = 0;
    m.on("sessionUpdated", () => fired++);
    m.setContextWindow({ session_id: SESSION_A });
    expect(fired).toBe(0);
  });
});
