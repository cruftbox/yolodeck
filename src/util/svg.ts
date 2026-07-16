export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Keys are authored at 144x144 — the @2x size of a 72x72 MK.2 key.
 * Everything below is in that coordinate space.
 */
const SIZE = 144;
/** Text wider than this clips against the key bezel. */
const TEXT_WIDTH = 128;

/**
 * Pick the largest font size at which `text` still fits TEXT_WIDTH.
 *
 * Stream Deck's own title rendering does not do this — it draws at a fixed size and
 * lets long strings run off both edges, which is why "Permission?" rendered as
 * "rmission" on the hardware. Estimating from character count is crude but
 * predictable; a glyph is roughly 0.58em wide in a sans face at these sizes.
 */
function fitSize(text: string, base: number, min = 11): number {
  if (!text) return base;
  const estimated = TEXT_WIDTH / (0.58 * text.length);
  return Math.max(min, Math.min(base, Math.floor(estimated)));
}

export interface KeyLine {
  text: string;
  /** Preferred size. Shrinks automatically if the text would clip. */
  size?: number;
  bold?: boolean;
  /** Muted secondary text, e.g. a session counter or model name. */
  dim?: boolean;
}

export interface KeyImageOptions {
  bg: string;
  /**
   * Glyph markup authored for a full 144x144 key, centred on (72,72).
   * Scaled and lifted automatically to make room for any lines.
   */
  glyph?: string;
  lines?: KeyLine[];
  fg?: string;
  /**
   * Draw a selection ring. Used by session keys to show which session approve/deny
   * will act on — with one key that was implicit, with five it's a real question, and
   * approving the wrong agent is the failure this prevents.
   */
  active?: boolean;
}

/**
 * Compose a key image with a glyph and/or text, laid out so they never collide.
 *
 * All rendering goes through here deliberately. The plugin previously mixed two
 * systems: some actions drew text into the SVG, while others called setTitle() and
 * relied on Stream Deck's overlay with TitleAlignment "bottom". The overlay draws on
 * top of the image, so a centred glyph and a bottom-aligned title landed on each
 * other — visible on hardware as "Approve" sitting across the tick. Manifest states
 * now set ShowTitle:false, and nothing calls setTitle().
 */
export function keyImage({ bg, glyph, lines = [], fg = "#ffffff", active = false }: KeyImageOptions): string {
  const parts: string[] = [`<rect width="${SIZE}" height="${SIZE}" rx="16" fill="${escapeXml(bg)}"/>`];
  const hasText = lines.length > 0;

  if (glyph) {
    if (hasText) {
      // Scale about the centre and lift, reserving the lower third for text.
      // An explicit translate/scale/translate matrix rather than transform-origin,
      // which not every SVG rasteriser honours.
      parts.push(`<g transform="translate(72,54) scale(0.74) translate(-72,-72)">${glyph}</g>`);
    } else {
      parts.push(glyph);
    }
  }

  if (hasText) {
    const lineHeight = 22;
    // With a glyph: sit below it. The glyph transform above puts its ink in roughly
    // y 26..85, so 104 is the first safe baseline for two lines and 118 for one —
    // any lower and a second line runs off the bottom bezel.
    // Without a glyph: centre the block on the key.
    let y = glyph
      ? (lines.length > 1 ? 104 : 118)
      : 72 - ((lines.length - 1) * lineHeight) / 2;

    for (const line of lines) {
      const size = fitSize(line.text, line.size ?? (line.dim ? 17 : 21));
      parts.push(
        `<text x="72" y="${y}" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="sans-serif" font-size="${size}"` +
        (line.bold ? ` font-weight="bold"` : "") +
        ` fill="${escapeXml(fg)}"` +
        (line.dim ? ` opacity="0.72"` : "") +
        `>${escapeXml(line.text)}</text>`,
      );
      y += lineHeight;
    }
  }

  if (active) {
    // Inset so the stroke sits inside the rounded corner rather than straddling it.
    parts.push(
      `<rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="14" ` +
      `fill="none" stroke="#ffffff" stroke-width="6" opacity="0.9"/>`,
    );
  }

  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${parts.join("")}</svg>`);
}

/** Glyphs, authored centred on (72,72) in the 144x144 space. */
export const GLYPH = {
  check: `<path d="M40 74 L63 97 L106 50" stroke="white" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  doubleCheck:
    `<path d="M26 74 L46 94 L84 52" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M62 74 L82 94 L120 52" stroke="white" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: `<path d="M46 46 L98 98 M98 46 L46 98" stroke="white" stroke-width="11" stroke-linecap="round"/>`,
  window:
    `<rect x="36" y="44" width="72" height="56" rx="6" fill="none" stroke="white" stroke-width="8"/>` +
    `<path d="M36 62 L108 62" stroke="white" stroke-width="8"/>`,
  shield: `<path d="M72 34 L104 48 V76 C104 96 90 108 72 114 C54 108 40 96 40 76 V48 Z" fill="none" stroke="white" stroke-width="9" stroke-linejoin="round"/>`,
} as const;

/** Neutral background for an inert key — nothing to act on. */
export const INERT_BG = "#3a3f46";
