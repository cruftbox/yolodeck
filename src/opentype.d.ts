// Minimal ambient types for the slice of opentype.js this plugin uses. The package
// ships no declarations, and @types/opentype.js is stale; we only need parse + the
// per-glyph layout path (charToGlyph → getPath → toPathData), which bypasses GSUB.
declare module "opentype.js" {
  export interface Path {
    toPathData(decimalPlaces?: number): string;
  }
  export interface Glyph {
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    unitsPerEm: number;
    charToGlyph(char: string): Glyph;
    getPath(text: string, x: number, y: number, fontSize: number): Path;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const _default: { parse: typeof parse };
  export default _default;
}
