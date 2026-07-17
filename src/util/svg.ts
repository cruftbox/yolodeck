import { textPath } from "./text";
import { TOKENS, type Token } from "./tokens";

/**
 * Key rendering — the design spec's visual contract.
 *
 * Everything goes through renderKey(). It draws, in order: a full-bleed gradient fill
 * (no rounded rect — the hardware rounds the corners; drawing our own gave a double
 * border), an optional filled glyph, and label text as vector paths (see util/text).
 *
 * Motion is the same spec at varying brightness: the fill's RGB is multiplied by an
 * eased value while glyph + text stay at full brightness so they stay legible.
 */

const SIZE = 144; // authored @2x; Stream Deck downscales to 72
const SAFE = 12; // bezel/diffuser eats the outer ring; keep content inside ~120
const MIN_TEXT = 22; // floor for shrinking long labels (so names fit rather than truncate)
const PRIMARY = 42; // default primary label size — short labels render this big
const MAX_TEXT_WIDTH = SIZE - SAFE * 2; // 120

export interface KeyLine {
  text: string;
  size?: number;
  /** Muted secondary line (e.g. a countdown or version), rendered at 82% opacity. */
  dim?: boolean;
}

export interface KeyImageOptions {
  /** State token (gradient) or a flat hex. */
  token?: Token;
  bg?: string;
  glyph?: string;
  lines?: KeyLine[];
  /** 0..1 fill brightness for motion. Glyph + text stay full brightness. */
  brightness?: number;
  /**
   * Small corner dot marking the "targeted" session (approve/deny act on it). A dot,
   * not a ring — a full border would fight the hardware's rounded corners (double
   * border), which §2 forbids.
   */
  mark?: boolean;
}

function scaleHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

let gradSeq = 0; // unique gradient id per render — duplicate ids collide across keys

/** Largest size ≤ base at which `str` fits the safe width; floored at `floor`. */
function fitSize(str: string, base: number, floor: number): number {
  const p = textPath(str, base);
  if (!p || p.width <= MAX_TEXT_WIDTH) return base;
  return Math.max(floor, Math.floor(base * (MAX_TEXT_WIDTH / p.width)));
}

/**
 * A centered text line as filled paths with a 1px drop shadow (double-draw: a
 * black-offset copy under a white copy — renderer-independent, unlike SVG filters,
 * which the deck's engine may not support).
 */
/** Trim with an ellipsis until it fits MAX_TEXT_WIDTH at `size` (last resort). */
function truncate(str: string, size: number): string {
  let s = str;
  while (s.length > 1) {
    const p = textPath(s + "…", size);
    if (!p || p.width <= MAX_TEXT_WIDTH) return s + "…";
    s = s.slice(0, -1);
  }
  return s;
}

function line(str: string, baseSize: number, cy: number, dimmed: boolean): string {
  // Both primary and secondary must be readable on the downscaled 72px hardware key.
  // Secondary can shrink a little more before truncating, but not to illegibility.
  const floor = dimmed ? 24 : MIN_TEXT;
  const size = fitSize(str, baseSize, floor);
  // If it still won't fit even at the floor size, truncate rather than clip.
  const p0 = textPath(str, size);
  if (p0 && p0.width > MAX_TEXT_WIDTH) str = truncate(str, size);
  const p = textPath(str, size);
  if (!p) {
    // Font unavailable — fall back to a <text> element in a system sans.
    const op = dimmed ? 0.82 : 0.96;
    return (
      `<text x="72" y="${cy + size * 0.35}" text-anchor="middle" font-family="sans-serif" ` +
      `font-weight="600" font-size="${size}" fill="#fff" fill-opacity="${op}">${escapeXml(str)}</text>`
    );
  }
  const x = 72 - p.width / 2;
  const y = cy + size * 0.35; // approx visual centering on cy
  const op = dimmed ? 0.82 : 0.96;
  return (
    `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
    `<path d="${p.d}" transform="translate(0 1)" fill="#000" fill-opacity="0.35"/>` +
    `<path d="${p.d}" fill="#fff" fill-opacity="${op}"/>` +
    `</g>`
  );
}

export function renderKey({ token, bg, glyph, lines = [], brightness = 1, mark = false }: KeyImageOptions): string {
  const parts: string[] = [];

  // Full-bleed flat fill, brightness-scaled.
  //
  // The spec wanted a top→bottom gradient for a "lit plastic" look, but Stream Deck's
  // SVG renderer either ignores linearGradient or posterizes it into visible bands on
  // the hardware. The spec explicitly allows "flat hex if a gradient is inconvenient" —
  // it is. Flat reads clean; the token's top color is the fill.
  const fill = scaleHex(token ? token.top : bg ?? "#14171C", brightness);
  parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="${escapeXml(fill)}"/>`);

  if (glyph) {
    if (lines.length) {
      // Shrink + lift the glyph into the upper half so the label clears it. Scales
      // about the key center (72,72), then recenters the glyph near (72,48).
      parts.push(`<g transform="translate(72 48) scale(0.66) translate(-72 -72)">${glyph}</g>`);
    } else {
      parts.push(glyph); // glyph-only key: full size, centered
    }
  }

  // Lay text lines vertically. With a glyph, the label sits in the lower third; without,
  // the block centers on the key. Line height accommodates the bigger secondary text.
  if (lines.length) {
    const lh = 38;
    const startY = glyph ? 106 : 72 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => {
      parts.push(line(l.text, l.size ?? (l.dim ? 30 : PRIMARY), startY + i * lh, !!l.dim));
    });
  }

  // Targeted marker: a small white dot near the top-right, inside the safe area.
  if (mark) parts.push(`<circle cx="122" cy="22" r="8" fill="#fff" fill-opacity="0.95"/>`);

  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${parts.join("")}</svg>`,
  );
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Filled glyphs (single-weight solid shapes, per §1 — no strokes; stroked icons
 * disintegrate at 72px behind the diffuser). Authored ~56px, centered near (72,54).
 */
export const GLYPH = {
  check:
    `<path d="M58 92 L30 64 L40 54 L58 72 L104 26 L114 36 Z" fill="#fff"/>`,
  doubleCheck:
    `<path d="M46 92 L20 66 L29 57 L46 74 L86 34 L95 43 Z" fill="#fff"/>` +
    `<path d="M78 92 L68 82 L77 73 L78 74 L114 38 L123 47 Z" fill="#fff"/>`,
  cross:
    `<path d="M44 34 L72 62 L100 34 L110 44 L82 72 L110 100 L100 110 L72 82 L44 110 L34 100 L62 72 L34 44 Z" fill="#fff"/>`,
  window:
    `<path d="M30 40 h84 a6 6 0 0 1 6 6 v52 a6 6 0 0 1 -6 6 h-84 a6 6 0 0 1 -6 -6 v-52 a6 6 0 0 1 6 -6 Z M28 58 h88 v6 h-88 Z" fill="#fff" fill-rule="evenodd"/>`,
  shield:
    `<path d="M72 26 L112 42 V74 C112 98 94 112 72 120 C50 112 32 98 32 74 V42 Z" fill="#fff"/>`,
  arrow:
    `<path d="M40 62 h44 l-18 -18 l12 -12 l38 40 l-38 40 l-12 -12 l18 -18 h-44 Z" fill="#fff"/>`,
} as const;

/** Convenience re-exports of tokens for actions. */
export { TOKENS };
export const INERT = TOKENS.idle;
