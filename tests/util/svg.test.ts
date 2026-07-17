import { describe, it, expect } from "vitest";
import { renderKey, GLYPH, escapeXml, svgDataUri } from "../../src/util/svg";
import { TOKENS } from "../../src/util/tokens";

function decode(uri: string): string {
  expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
  return decodeURIComponent(uri.slice("data:image/svg+xml,".length));
}

describe("escapeXml / svgDataUri", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });
  it("URL-encodes the SVG", () => {
    expect(svgDataUri("<svg/>")).toBe("data:image/svg+xml,%3Csvg%2F%3E");
  });
});

describe("renderKey", () => {
  it("is a 144x144 SVG data URI", () => {
    const svg = decode(renderKey({ token: TOKENS.approve }));
    expect(svg).toContain('width="144"');
    expect(svg).toContain('height="144"');
  });

  // §2: full-bleed, no rounded rect (the hardware rounds; drawing our own = double border).
  it("fills corner-to-corner with no rounded rect", () => {
    const svg = decode(renderKey({ token: TOKENS.approve }));
    expect(svg).toMatch(/<rect width="144" height="144"/);
    expect(svg).not.toContain('rx="16"');
  });

  // Flat fills, not gradients: the deck's renderer posterizes linearGradient into
  // visible bands on the hardware, so the token's top color is used flat.
  it("fills flat with the token's top color, no gradient", () => {
    const svg = decode(renderKey({ token: TOKENS.working }));
    expect(svg).not.toContain("<linearGradient");
    expect(svg.toLowerCase()).toContain(TOKENS.working.top.toLowerCase());
  });

  it("uses a flat fill for a bg hex", () => {
    const svg = decode(renderKey({ bg: "#123456" }));
    expect(svg).not.toContain("<linearGradient");
    expect(svg.toLowerCase()).toContain("#123456");
  });

  it("scales the fill toward black as brightness drops, leaving structure intact", () => {
    const full = decode(renderKey({ bg: "#ffffff", brightness: 1 }));
    const dim = decode(renderKey({ bg: "#ffffff", brightness: 0.5 }));
    expect(full.toLowerCase()).toContain("#ffffff");
    expect(dim.toLowerCase()).toContain("#808080"); // 255*0.5 -> 128
  });

  it("draws the targeted marker dot only when marked", () => {
    expect(decode(renderKey({ token: TOKENS.idle, mark: true }))).toContain("<circle");
    expect(decode(renderKey({ token: TOKENS.idle, mark: false }))).not.toContain("<circle");
  });

  it("includes the glyph markup verbatim", () => {
    expect(decode(renderKey({ token: TOKENS.approve, glyph: GLYPH.check }))).toContain(GLYPH.check);
  });

  // In the test env the bundled font isn't on disk, so renderKey falls back to <text>.
  // That path must still escape user text to avoid SVG injection.
  it("escapes label text (fallback path) against injection", () => {
    const svg = decode(renderKey({ token: TOKENS.idle, lines: [{ text: `</text><script>x</script>` }] }));
    expect(svg).not.toContain("<script>");
  });

  it("escapes an injected bg color", () => {
    const svg = decode(renderKey({ bg: `"/><script>x</script>` }));
    expect(svg).not.toContain("<script>");
  });
});
