import { describe, it, expect } from "vitest";
// Imported from util/, not the action — the action carries an SDK decorator the test
// transform chokes on, and pure logic has no business behind it.
import { shortenModel } from "../src/util/model";

describe("shortenModel", () => {
  // The id shapes Claude Code actually emits (from the model list).
  it("renders a two-number id as Name Major.Minor", () => {
    expect(shortenModel("claude-opus-4-8")).toBe("Opus 4.8");
    expect(shortenModel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  it("renders a one-number id as Name Major", () => {
    expect(shortenModel("claude-sonnet-5")).toBe("Sonnet 5");
    expect(shortenModel("claude-fable-5")).toBe("Fable 5");
  });

  // resets_at-style trailing dates on some ids must not leak into the version.
  it("drops a trailing date suffix", () => {
    expect(shortenModel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("title-cases the family name", () => {
    expect(shortenModel("claude-opus-4-8")).toMatch(/^Opus/);
  });

  it("falls back to a stripped id for an unrecognised shape", () => {
    expect(shortenModel("gpt-4o")).toBe("gpt-4o");
    expect(shortenModel("claude-experimental")).toBe("experimental");
  });

  it("truncates a long fallback rather than overflowing the key", () => {
    expect(shortenModel("claude-" + "x".repeat(40)).length).toBeLessThanOrEqual(14);
  });
});
