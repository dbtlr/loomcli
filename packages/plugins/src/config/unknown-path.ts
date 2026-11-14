import { escapeControlCharacters } from '@loomcli/core';

import type { Step } from './drop.js';

/**
 * How the unknown-key line shows a key whose difference from a correctly spelled key is invisible.
 * The rule is the plugin contract's "Naming unknown keys", under **A key that cannot be seen**.
 */

const hexRadix = 16;
const codePointDigits = 4;
const none = 0;
const first = 0;

/** A format character, or a space separator. */
const invisible = /^[\p{Cf}\p{Zs}]$/u;

/** One whitespace character, and a key with whitespace at either edge. */
const whitespace = /^\s$/u;
const edgeSpace = /^\s|\s$/u;

/** The whitespace run at the start of a key, and the one at its end. */
const leadingSpace = /^\s*/u;
const trailingSpace = /\s*$/u;

/** A character the line already escapes, which the line keeps showing as it does. */
function lineEscapes(character: string): boolean {
  return escapeControlCharacters(character) !== character;
}

/** A character as its code point, `U+` and at least four uppercase hexadecimal digits. */
function codePointOf(character: string): string {
  const code = character.codePointAt(first) ?? none;
  return `U+${code.toString(hexRadix).toUpperCase().padStart(codePointDigits, '0')}`;
}

/** A character that is invisible wherever it stands: not the ordinary space. */
function isHidden(character: string): boolean {
  return character !== ' ' && invisible.test(character);
}

/** A character a reader cannot see in a key: a hidden one, or whitespace at an edge. Escaped ones stay as the line shows them. */
function isUnseen(character: string, atEdge: boolean): boolean {
  return !lineEscapes(character) && (isHidden(character) || (atEdge && whitespace.test(character)));
}

/** A key's characters, each with whether it stands in the whitespace run at either edge. */
function charactersOf(key: string): { atEdge: boolean; character: string }[] {
  const lead = leadingSpace.exec(key)?.[first].length ?? none;
  const trailStart = key.length - (trailingSpace.exec(key)?.[first].length ?? none);
  let index = none;
  return Array.from(key, (character) => {
    const atEdge = index < lead || index >= trailStart;
    index += character.length;
    return { atEdge, character };
  });
}

/** One character of a quoted key: a quote or a backslash with a backslash before it, an unseen character as its code point. */
function quotedCharacter(character: string, atEdge: boolean): string {
  if (character === '"' || character === '\\') {
    return `\\${character}`;
  }
  return isUnseen(character, atEdge) ? codePointOf(character) : character;
}

/** A key as the line shows it: in double quotes when it is empty, has whitespace at an edge, or holds an unseen character. */
function shownKey(key: string): string {
  const characters = charactersOf(key);
  const quote =
    key === '' ||
    edgeSpace.test(key) ||
    characters.some((entry) => isUnseen(entry.character, false));
  return quote
    ? `"${characters.map((entry) => quotedCharacter(entry.character, entry.atEdge)).join('')}"`
    : key;
}

/**
 * An unknown key's path as its line shows it: keys joined by dots and an array item as its index in
 * brackets, with each key that is empty, has whitespace at an edge, or holds an unseen character in
 * double quotes. Every other key keeps its bytes.
 */
function shownUnknownPath(path: readonly Step[]): string {
  return path.reduce<string>((text, step, position) => {
    if (typeof step === 'number') {
      return `${text}[${step}]`;
    }
    return position === first ? shownKey(step) : `${text}.${shownKey(step)}`;
  }, '');
}

export { shownUnknownPath };
