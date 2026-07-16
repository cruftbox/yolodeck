import { describe, it, expect } from "vitest";
import { escapeXml, svgDataUri, keyImage, GLYPH } from "../../src/util/svg";

/** Decode a data: URI back to SVG markup so assertions can read it. */
function decode(uri: string): string {
  expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
  return decodeURIComponent(uri.slice("data:image/svg+xml,".length));
}

/** Every y coordinate on a <text> element, in document order. */
function textYs(svg: string): number[] {
  return [...svg.matchAll(/<text[^>]*\sy="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
}

function fontSizes(svg: string): number[] {
  return [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
}

describe("svg.escapeXml", () => {
  it("escapes all five XML entities", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("leaves plain text alone", () => {
    expect(escapeXml("hello world 123")).toBe("hello world 123");
  });
});

describe("svg.svgDataUri", () => {
  it("returns a data: URI with URL-encoded content", () => {
    const uri = svgDataUri("<svg/>");
    expect(uri).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});

describe("svg.keyImage", () => {
  it("composes a 144x144 SVG with the given background and glyph", () => {
    const svg = decode(keyImage({ bg: "#ff0000", glyph: GLYPH.check }));
    expect(svg).toContain('width="144"');
    expect(svg).toContain('height="144"');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain(GLYPH.check);
  });

  it("escapes the background colour to avoid SVG injection", () => {
    const svg = decode(keyImage({ bg: `"/><script>x</script><foo bar="` }));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;");
  });

  it("escapes label text to avoid SVG injection", () => {
    const svg = decode(keyImage({ bg: "#000", lines: [{ text: `</text><script>x</script>` }] }));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;/text&gt;");
  });

  // The bug this whole helper exists to fix: on hardware, a centred glyph and a
  // bottom-aligned Stream Deck title overlay were drawn on top of each other, so
  // "Approve" sat across the tick. Text must clear the glyph's ink (~y 26..85).
  it("keeps a label clear of the glyph", () => {
    const svg = decode(keyImage({ bg: "#000", glyph: GLYPH.check, lines: [{ text: "Approve" }] }));
    expect(textYs(svg)[0]).toBeGreaterThan(90);
  });

  // Two lines under a glyph previously ran off the bottom bezel.
  it("keeps two lines under a glyph inside the key", () => {
    const svg = decode(keyImage({
      bg: "#000",
      glyph: GLYPH.shield,
      lines: [{ text: "Default" }, { text: "Opus 4.8", dim: true }],
    }));
    const ys = textYs(svg);
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeGreaterThan(90);
    expect(ys[ys.length - 1]).toBeLessThanOrEqual(132);
  });

  it("centres a text block vertically when there is no glyph", () => {
    const one = textYs(decode(keyImage({ bg: "#000", lines: [{ text: "Idle" }] })));
    expect(one).toEqual([72]);

    const two = textYs(decode(keyImage({ bg: "#000", lines: [{ text: "Working" }, { text: "Bash" }] })));
    // Symmetric about the key centre.
    expect((two[0] + two[1]) / 2).toBe(72);
  });

  // "Permission?" rendered as "rmission" on the hardware because Stream Deck's title
  // overlay draws at a fixed size and lets long strings run past both edges.
  it("shrinks long text instead of letting it clip", () => {
    const short = fontSizes(decode(keyImage({ bg: "#000", lines: [{ text: "Idle" }] })))[0];
    const long = fontSizes(decode(keyImage({ bg: "#000", lines: [{ text: "Permission?" }] })))[0];
    const veryLong = fontSizes(decode(keyImage({ bg: "#000", lines: [{ text: "a-very-long-project-name" }] })))[0];

    expect(long).toBeLessThan(short);
    expect(veryLong).toBeLessThan(long);
  });

  it("never shrinks text below a legible floor", () => {
    const svg = decode(keyImage({ bg: "#000", lines: [{ text: "x".repeat(200) }] }));
    expect(fontSizes(svg)[0]).toBeGreaterThanOrEqual(11);
  });

  it("renders a glyph at full size when there is no text to make room for", () => {
    const svg = decode(keyImage({ bg: "#000", glyph: GLYPH.check }));
    expect(svg).not.toContain("scale(");
  });
});
