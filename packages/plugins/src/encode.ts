import type { ViewContext } from '@loomcli/core';

/**
 * The text escaping every pack view that prints JSON shares, the formatter's `json()` and
 * `jsonl()` and the manifest's document alike. This module belongs to no subpath, so each plugin
 * imports it and neither imports the other's views.
 */

/** The radix and digit count a `\uXXXX` control-character escape always uses. */
const hexRadix = 16;
const hexDigitCount = 4;

/** Each replaced character is exactly one UTF-16 code unit, so its code always sits at index 0. */
const soleCodeUnit = 0;

/**
 * Makes the rendered text safe under every rendering policy. `style.escape` neutralizes the
 * internal markup delimiters first; the C1 controls and DEL, U+007F through U+009F, are not among
 * them, so they are replaced afterward, each as its own four-digit lowercase `\uXXXX` escape. The
 * two passes never collide: `style.escape` only ever inserts its own marker character followed by
 * hex digits, never a literal backslash, so it cannot re-mangle the escapes this second pass adds.
 */
export function encodeText(text: string, context: ViewContext): string {
  return context.style
    .escape(text)
    .replace(
      /[\u007F-\u009F]/gu,
      (character) =>
        `\\u${character.charCodeAt(soleCodeUnit).toString(hexRadix).padStart(hexDigitCount, '0')}`,
    );
}
