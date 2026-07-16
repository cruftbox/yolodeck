import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager, normalizePath } from "../src/session-manager";

const A = "sess-aaaa";
const B = "sess-bbbb";
const C = "sess-cccc";

// String.raw throughout. A plain "C:\Code\orbis" is not that path — TypeScript reads
// \C and \o as unrecognised escapes and silently drops the backslashes, giving
// "C:Codeorbis". Tests written that way assert against a string that never occurs,
// and a case-insensitivity check will still "pass" because both sides are mangled
// identically.
const ORBIS = String.raw`C:\Code\orbis`;
const YOLODECK = String.raw`C:\Code\yolodeck`;

describe("normalizePath", () => {
  it("treats Windows and POSIX separators as equivalent", () => {
    expect(normalizePath(ORBIS)).toBe(normalizePath("C:/Code/orbis"));
  });

  it("is case-insensitive, as Windows paths are", () => {
    expect(normalizePath(String.raw`C:\Code\Orbis`)).toBe(normalizePath(String.raw`c:\code\orbis`));
  });

  // Concatenated, not String.raw`...\` — a raw template still can't END with a
  // backslash, because the lexer treats it as escaping the closing backtick.
  it("ignores a trailing separator", () => {
    expect(normalizePath(ORBIS + "\\")).toBe(normalizePath(ORBIS));
  });

  it("collapses repeated separators", () => {
    expect(normalizePath(String.raw`C:\\Code\\orbis`)).toBe(normalizePath(ORBIS));
  });

  it("returns empty for null/undefined/empty", () => {
    expect(normalizePath(null)).toBe("");
    expect(normalizePath(undefined)).toBe("");
    expect(normalizePath("")).toBe("");
  });

  it("does not treat a different project as a match", () => {
    expect(normalizePath(ORBIS)).not.toBe(normalizePath(String.raw`C:\Code\orbis-old`));
  });

  it("does not treat a parent directory as a match", () => {
    expect(normalizePath(ORBIS)).not.toBe(normalizePath(String.raw`C:\Code`));
  });
});

describe("SessionManager.findByCwd", () => {
  let m: SessionManager;
  beforeEach(() => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: A, cwd: ORBIS });
    m.handleEvent("SessionStart", { session_id: B, cwd: YOLODECK });
  });
  afterEach(() => m.stop());

  it("finds a session by its exact directory", () => {
    expect(m.findByCwd(ORBIS)?.id).toBe(A);
    expect(m.findByCwd(YOLODECK)?.id).toBe(B);
  });

  // A pin is typed by hand in the inspector; it must not be brittle about form.
  it("matches regardless of separator, case, or trailing slash", () => {
    expect(m.findByCwd("c:/code/orbis")?.id).toBe(A);
    expect(m.findByCwd(String.raw`C:\CODE\ORBIS` + "\\")?.id).toBe(A);
  });

  it("returns undefined when nothing runs there", () => {
    expect(m.findByCwd(String.raw`C:\Code\tessera`)).toBeUndefined();
  });

  it("returns undefined for an empty pin rather than matching anything", () => {
    expect(m.findByCwd("")).toBeUndefined();
  });

  // The bug pinning exists to fix: every session under the home directory rendered as
  // an indistinguishable "micha", because basename(cwd) was the only identity a key had.
  it("distinguishes two sessions sharing a basename", () => {
    m.handleEvent("SessionStart", { session_id: C, cwd: String.raw`D:\Archive\orbis` });
    expect(m.findByCwd(ORBIS)?.id).toBe(A);
    expect(m.findByCwd(String.raw`D:\Archive\orbis`)?.id).toBe(C);
  });

  it("follows a session if it ends and a new one starts in the same directory", () => {
    m.handleEvent("SessionEnd", { session_id: A, cwd: ORBIS });
    expect(m.findByCwd(ORBIS)).toBeUndefined();

    m.handleEvent("SessionStart", { session_id: C, cwd: ORBIS });
    expect(m.findByCwd(ORBIS)?.id).toBe(C);
  });
});

describe("SessionManager.getSessions", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  // Overflow slots hand sessions out by index, so ordering must not shuffle.
  it("returns sessions in arrival order", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: A, cwd: String.raw`C:\a` });
    m.handleEvent("SessionStart", { session_id: B, cwd: String.raw`C:\b` });
    m.handleEvent("SessionStart", { session_id: C, cwd: String.raw`C:\c` });
    expect(m.getSessions().map((s) => s.id)).toEqual([A, B, C]);
  });

  it("keeps order stable as sessions update", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: A, cwd: String.raw`C:\a` });
    m.handleEvent("SessionStart", { session_id: B, cwd: String.raw`C:\b` });
    m.handleEvent("PreToolUse", { session_id: A, tool_name: "Bash" });
    expect(m.getSessions().map((s) => s.id)).toEqual([A, B]);
  });

  it("exposes the active session id", () => {
    m = new SessionManager();
    m.handleEvent("SessionStart", { session_id: A, cwd: String.raw`C:\a` });
    m.handleEvent("SessionStart", { session_id: B, cwd: String.raw`C:\b` });
    m.focusSession(B);
    expect(m.activeSessionId).toBe(B);
  });
});
