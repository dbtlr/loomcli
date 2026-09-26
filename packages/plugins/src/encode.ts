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

/** Each matched character replaced by its four-digit lowercase `\uXXXX` escape. */
function escapeMatching(text: string, pattern: RegExp): string {
  return text.replaceAll(
    pattern,
    (character) =>
      `\\u${character.charCodeAt(soleCodeUnit).toString(hexRadix).padStart(hexDigitCount, '0')}`,
  );
}

/**
 * Makes the rendered text safe under every rendering policy. `style.escape` neutralizes the
 * internal markup delimiters first; the C1 controls and DEL, U+007F through U+009F, are not among
 * them, so they are replaced afterward, each as its own four-digit lowercase `\uXXXX` escape. The
 * two passes never collide: `style.escape` only ever inserts its own marker character followed by
 * hex digits, never a literal backslash, so it cannot re-mangle the escapes this second pass adds.
 */
export function encodeText(text: string, context: ViewContext): string {
  return escapeControls(context.style.escape(text));
}

/**
 * The text with DEL and every C1 control, U+007F through U+009F, replaced by its four-digit
 * lowercase `\uXXXX` escape, so none reaches a terminal. JSON escapes the C0 controls itself and
 * leaves these raw, so JSON text passes through here before it prints.
 */
export function escapeControls(text: string): string {
  return escapeMatching(text, /[\u007F-\u009F]/gu);
}

/**
 * The text with every control character and line separator, U+0000 through U+001F, U+007F through
 * U+009F, U+2028, and U+2029, replaced by its four-digit lowercase `\uXXXX` escape. Raw text that
 * never passes through JSON, such as a file path, is escaped with this before it reaches a label, a
 * warning, or a failure.
 */
export function escapeControlCharacters(text: string): string {
  return escapeMatching(text, /[\p{Cc}\p{Zl}\p{Zp}]/gu);
}
