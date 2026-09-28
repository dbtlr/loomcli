/** The radix and digit count a `\uXXXX` escape always uses. */
const hexRadix = 16;
const hexDigitCount = 4;

/** Each replaced character is exactly one UTF-16 code unit, so its code always sits at index 0. */
const soleCodeUnit = 0;

/**
 * The text with every control character and line separator, U+0000 through U+001F, U+007F through
 * U+009F, U+2028, and U+2029, replaced by its four-digit lowercase `\uXXXX` escape, so the text
 * stays on one line and no control character reaches a terminal. Raw text a diagnostic quotes, such
 * as a file path or a reason a plugin threw, is escaped with this before it is written.
 */
export function escapeControlCharacters(text: string): string {
  return text.replaceAll(
    /[\p{Cc}\p{Zl}\p{Zp}]/gu,
    (character) =>
      `\\u${character.charCodeAt(soleCodeUnit).toString(hexRadix).padStart(hexDigitCount, '0')}`,
  );
}
