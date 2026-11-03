/** The radix and digit count a `\uXXXX` escape always uses. */
const hexRadix = 16;
const hexDigitCount = 4;

/** Each replaced character is exactly one UTF-16 code unit, so its code always sits at index 0. */
const soleCodeUnit = 0;

/**
 * Every character a quoted diagnostic escapes: the control characters U+0000 through U+001F and
 * U+007F through U+009F, the separators U+2028 and U+2029, the bidirectional embedding, override,
 * and isolate controls U+202A through U+202E and U+2066 through U+2069, and the marks U+200E,
 * U+200F, and U+061C. Other format characters, such as a zero-width joiner inside an emoji or a
 * soft hyphen, are ordinary text and stay.
 */
const escaped = /[\p{Cc}\p{Zl}\p{Zp}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{200e}\u{200f}\u{61c}]/gu;

/**
 * The text with every control character, line separator, and bidirectional control replaced by its
 * four-digit lowercase `\uXXXX` escape, so the text stays on one line, no control character
 * reaches a terminal, and no bidirectional control reorders the rest of the line. Raw text a
 * diagnostic quotes, such as a file path, a typed token, or a reason a plugin threw, is escaped
 * with this before it is written.
 */
export function escapeControlCharacters(text: string): string {
  return text.replaceAll(
    escaped,
    (character) =>
      `\\u${character.charCodeAt(soleCodeUnit).toString(hexRadix).padStart(hexDigitCount, '0')}`,
  );
}
