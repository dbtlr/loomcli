/**
 * Text as a pattern that matches it exactly under the `u` flag JSON Schema patterns use: each
 * ECMAScript syntax character, `^ $ \ . * + ? ( ) [ ] { } |`, escaped with a backslash, and every
 * other character bare. A hyphen is not one, and stays bare, because `u` refuses `\-` outside a
 * class.
 */
function escapeSyntax(text: string): string {
  return text.replaceAll(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
}

export { escapeSyntax };
