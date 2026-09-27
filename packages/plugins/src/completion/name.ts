/**
 * The two forms in which an application name enters a completion script, so the name reaches the
 * shell as data and never as source: a function identifier and a single-quoted string.
 */

/** The radix of the digits that encode one code point in an identifier. */
const hexRadix = 16;

/** `Array.from` over a string yields whole code points, so each one's code sits at index 0. */
const soleCodePoint = 0;

/** The lowercase hexadecimal digits of the one code point a character holds. */
function hexDigits(character: string): string {
  const code = character.codePointAt(soleCodePoint);
  if (code === undefined) {
    throw new TypeError('An identifier encodes one code point at a time.');
  }
  return code.toString(hexRadix);
}

/**
 * The name as the suffix of a shell function identifier. ASCII letters and digits stay, and every
 * other code point, `_` included, is written as `_`, its lowercase hexadecimal digits, and `_`, so
 * `git-lfs` gives `git_2d_lfs` and no two names give one identifier. An empty name throws, because
 * a script needs a name to complete.
 */
function identifier(name: string): string {
  if (name === '') {
    throw new TypeError('A completion script needs a nonempty application name.');
  }
  return Array.from(name, (character) =>
    /^[A-Za-z0-9]$/u.test(character) ? character : `_${hexDigits(character)}_`,
  ).join('');
}

/** The name as a Bash or Zsh single-quoted string, each `'` written as `'\''`. */
function posixQuoted(name: string): string {
  return `'${name.replaceAll("'", String.raw`'\''`)}'`;
}

/** The name as a Fish single-quoted string, which reads `\\` and `\'` as escapes. */
function fishQuoted(name: string): string {
  return `'${name.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`;
}

export { fishQuoted, identifier, posixQuoted };
