/**
 * The two forms in which an application name enters a completion script, so the name reaches the
 * shell as data and never as source: a function identifier and a single-quoted string, in Bash and
 * Zsh, Fish, PowerShell, or Nushell (double-quoted) quoting. Each script takes the Application's name, which core's
 * portable name rule already keeps to the POSIX portable filename set, starting with neither `-`
 * nor `.`, so no newline, quote, or leading `-` reaches a script.
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
 * `git-lfs` gives `git_2d_lfs` and no two names give one identifier.
 */
function identifier(name: string): string {
  return Array.from(name, (character) =>
    /^[A-Za-z0-9]$/u.test(character) ? character : `_${hexDigits(character)}_`,
  ).join('');
}

/** The name as a Bash or Zsh single-quoted string, each `'` written as `'\''`. */
function posixQuoted(name: string): string {
  return `'${name.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * A path as one word a shell reads back as the path, for a step an operator pastes: as written
 * when it holds only ASCII letters, digits, `_`, `.`, `/`, `:`, and `-`, which no shell reads
 * specially inside an absolute path, and otherwise as a Bash or Zsh single-quoted string, as
 * `shlex.quote` gives it. Bash, Zsh, and Nushell read a single-quoted string that holds no `'` as
 * written, and so does Fish unless it also holds two backslashes in a row. PowerShell also ends a
 * single-quoted string at U+2018 through U+201B, so a path that holds one of them, or a `'`, is a
 * POSIX word only: the step is for a POSIX shell, and PowerShell reads such a path otherwise.
 */
function shellWord(path: string): string {
  return /^[\w./:-]+$/u.test(path) ? path : posixQuoted(path);
}

/** The name as a Fish single-quoted string, which reads `\\` and `\'` as escapes. */
function fishQuoted(name: string): string {
  return `'${name.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`;
}

/** The name as a Nushell double-quoted string, which reads `\\` and `\"` as escapes. */
function nuQuoted(name: string): string {
  return `"${name.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}

/** The code point of `'`. */
const apostrophe = 39;

/** U+2018 through U+201B, the curly and low single quotes, which PowerShell reads as `'`. */
const firstCurlyQuote = 8216;
const lastCurlyQuote = 8219;

/** Whether PowerShell's single quotes end at the character: `'` or U+2018 through U+201B. */
function endsPowershellQuotes(character: string): boolean {
  const code = character.codePointAt(soleCodePoint);
  return (
    code === apostrophe || (code !== undefined && code >= firstCurlyQuote && code <= lastCurlyQuote)
  );
}

/**
 * The text as a PowerShell single-quoted string, each of its single quotes written twice, which
 * PowerShell reads as that one character. Nothing else in single quotes is special to it.
 */
function powershellQuoted(text: string): string {
  const doubled = Array.from(text, (character) =>
    endsPowershellQuotes(character) ? `${character}${character}` : character,
  );
  return `'${doubled.join('')}'`;
}

export { fishQuoted, identifier, nuQuoted, posixQuoted, powershellQuoted, shellWord };
