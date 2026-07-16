import { describe, it, expect } from "vitest";
import { hexToRgb, rgbToHex, scaleBrightness, breathe } from "../src/util/color";

describe("hexToRgb", () => {
  it("parses #rrggbb", () => {
    expect(hexToRgb("#8957e5")).toEqual([137, 87, 229]);
  });

  it("expands #rgb shorthand", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
  });

  it("tolerates a missing leading #", () => {
    expect(hexToRgb("8957e5")).toEqual([137, 87, 229]);
  });
});

describe("rgbToHex", () => {
  it("round-trips with hexToRgb", () => {
    expect(rgbToHex(...hexToRgb("#8957e5"))).toBe("#8957e5");
  });

  it("clamps out-of-range channels rather than overflowing", () => {
    expect(rgbToHex(300, -20, 128)).toBe("#ff0080");
  });

  it("zero-pads single-digit channels", () => {
    expect(rgbToHex(1, 2, 3)).toBe("#010203");
  });
});

describe("scaleBrightness", () => {
  it("returns the same colour at factor 1", () => {
    expect(scaleBrightness("#8957e5", 1)).toBe("#8957e5");
  });

  it("dims toward black below 1", () => {
    // 137·0.5→69 (0x45), 87·0.5→44 (0x2c), 229·0.5→115 (0x73), rounded
    expect(scaleBrightness("#8957e5", 0.5)).toBe("#452c73");
  });

  it("bottoms out at black at factor 0", () => {
    expect(scaleBrightness("#8957e5", 0)).toBe("#000000");
  });

  it("clamps rather than overflowing above 1", () => {
    expect(scaleBrightness("#8957e5", 5)).toBe("#ffffff");
  });
});

describe("breathe", () => {
  const P = 2800;

  it("sits at the minimum at the start of a cycle", () => {
    expect(breathe(0, P, 0.5, 1)).toBeCloseTo(0.5, 5);
  });

  it("reaches the maximum at the half cycle", () => {
    expect(breathe(P / 2, P, 0.5, 1)).toBeCloseTo(1, 5);
  });

  it("returns to the minimum at the end of the cycle", () => {
    expect(breathe(P, P, 0.5, 1)).toBeCloseTo(0.5, 5);
  });

  it("stays within [min, max] across the whole cycle", () => {
    for (let t = 0; t <= P; t += 50) {
      const v = breathe(t, P, 0.5, 1);
      expect(v).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  // Wall-clock driven: the same absolute time yields the same value in the next cycle,
  // which is what keeps multiple keys in phase without shared state.
  it("is periodic", () => {
    expect(breathe(700, P, 0.5, 1)).toBeCloseTo(breathe(700 + P, P, 0.5, 1), 5);
  });

  it("eases — moves slower near the extremes than through the middle", () => {
    // Near the trough (t≈0) the step is small; through the middle (t≈P/4) it's large.
    const nearTrough = breathe(P * 0.05, P, 0, 1) - breathe(0, P, 0, 1);
    const midway = breathe(P * 0.3, P, 0, 1) - breathe(P * 0.25, P, 0, 1);
    expect(midway).toBeGreaterThan(nearTrough);
  });
});
