import { describe, it, expect, afterEach } from "vitest";
import { SessionManager } from "../src/session-manager";
// Imported from util/, not the action: the action file carries an SDK decorator that
// the test transform chokes on, and pure logic has no business living behind it.
import { formatUntil, remaining } from "../src/util/usage";

// Real shape, from the Claude Code statusLine docs.
const PAYLOAD = {
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1746540000 },
    seven_day: { used_percentage: 12, resets_at: 1746799200 },
  },
};

describe("formatUntil", () => {
  const now = 1_700_000_000_000; // fixed clock; a real one makes this flaky

  it("renders under an hour as minutes", () => {
    expect(formatUntil(now / 1000 + 48 * 60, now)).toBe("48m");
  });

  it("renders over an hour as hours and zero-padded minutes", () => {
    expect(formatUntil(now / 1000 + (2 * 60 + 14) * 60, now)).toBe("2h14m");
    expect(formatUntil(now / 1000 + (3 * 60 + 5) * 60, now)).toBe("3h05m");
  });

  it("renders exactly one hour as 1h00m", () => {
    expect(formatUntil(now / 1000 + 3600, now)).toBe("1h00m");
  });

  // resets_at is epoch SECONDS while Date.now() is ms — mixing them up would show a
  // reset ~55 years away. Pin the unit.
  it("treats resets_at as seconds, not milliseconds", () => {
    expect(formatUntil(now / 1000 + 600, now)).toBe("10m");
  });

  it("clamps a window that already reset to 0m rather than going negative", () => {
    expect(formatUntil(now / 1000 - 3600, now)).toBe("0m");
  });

  // The 7-day window resets up to 168 hours out. Rendering that as "168h00m" is both
  // unreadable on a 72px key and useless — nobody counts in hours at that range.
  it("switches to days beyond 24 hours", () => {
    expect(formatUntil(now / 1000 + (3 * 24 + 5) * 3600, now)).toBe("3d05h");
    expect(formatUntil(now / 1000 + 7 * 24 * 3600, now)).toBe("7d00h");
  });

  it("uses hours right up to the day boundary, then flips", () => {
    expect(formatUntil(now / 1000 + 23 * 3600 + 59 * 60, now)).toBe("23h59m");
    expect(formatUntil(now / 1000 + 24 * 3600, now)).toBe("1d00h");
  });
});

describe("remaining", () => {
  it("reports what is left, not what is used", () => {
    expect(remaining({ used_percentage: 23.5, resets_at: 0 })).toBe(77);
  });

  it("rounds to a whole percent", () => {
    expect(remaining({ used_percentage: 0.4, resets_at: 0 })).toBe(100);
  });

  it("clamps out-of-range input rather than rendering a negative bar", () => {
    expect(remaining({ used_percentage: 120, resets_at: 0 })).toBe(0);
    expect(remaining({ used_percentage: -5, resets_at: 0 })).toBe(100);
  });
});

describe("SessionManager usage", () => {
  let m: SessionManager;
  afterEach(() => m?.stop());

  it("is null until the statusLine reports", () => {
    m = new SessionManager();
    expect(m.usage).toBeNull();
  });

  it("stores both windows and stamps arrival", () => {
    m = new SessionManager();
    const before = Date.now();
    m.setUsage(PAYLOAD);

    expect(m.usage?.five_hour?.used_percentage).toBe(23.5);
    expect(m.usage?.seven_day?.used_percentage).toBe(12);
    expect(m.usage?.receivedAt).toBeGreaterThanOrEqual(before);
  });

  it("emits usageUpdated so the key re-renders", () => {
    m = new SessionManager();
    let fired = 0;
    m.on("usageUpdated", () => fired++);
    m.setUsage(PAYLOAD);
    expect(fired).toBe(1);
  });

  // The statusLine fires on every assistant message. Most payloads are useful, but one
  // without rate limits must not wipe a good reading and blank the key.
  it("ignores a payload carrying no rate limits", () => {
    m = new SessionManager();
    m.setUsage(PAYLOAD);
    const first = m.usage?.receivedAt;

    m.setUsage({ session_id: "abc" });
    expect(m.usage?.five_hour?.used_percentage).toBe(23.5);
    expect(m.usage?.receivedAt).toBe(first);
  });

  it("does not emit for a payload with no rate limits", () => {
    m = new SessionManager();
    let fired = 0;
    m.on("usageUpdated", () => fired++);
    m.setUsage({});
    expect(fired).toBe(0);
  });

  it("accepts a payload with only one window present", () => {
    m = new SessionManager();
    m.setUsage({ rate_limits: { five_hour: { used_percentage: 90, resets_at: 1746540000 } } });
    expect(m.usage?.five_hour?.used_percentage).toBe(90);
    expect(m.usage?.seven_day).toBeUndefined();
  });

  it("replaces the previous reading rather than merging", () => {
    m = new SessionManager();
    m.setUsage(PAYLOAD);
    m.setUsage({ rate_limits: { five_hour: { used_percentage: 80, resets_at: 1746550000 } } });
    expect(m.usage?.five_hour?.used_percentage).toBe(80);
    expect(m.usage?.seven_day).toBeUndefined();
  });
});
