/**
 * The lowercase letter names accepted by the terminal's modifier keys.
 *
 * @public
 */
type KeyLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

const controlMask = 31;
const letterOffset = 0;

/**
 * Terminal bytes for a scripted keyboard read. Each member is a string, and `ctrl` and `alt`
 * return one, so keys join with `+` into one read of a mock terminal's `keys`.
 *
 * @example
 * ```ts
 * import { key, mockProcess } from '@loomcli/testing';
 *
 * const mock = mockProcess({
 *   argv: ['setup'],
 *   terminal: { columns: 80, keys: [key.down + key.enter, 'db' + key.enter], rows: 24 },
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/testing.md#the-key-table
 * @public
 */
const key = Object.freeze({
  alt: (letter: KeyLetter): string => `\u001b${letter}`,
  backspace: '\u007f',
  ctrl: (letter: KeyLetter): string =>
    String.fromCharCode(letter.charCodeAt(letterOffset) & controlMask),
  delete: '\u001b[3~',
  down: '\u001b[B',
  end: '\u001b[F',
  enter: '\r',
  escape: '\u001b',
  home: '\u001b[H',
  left: '\u001b[D',
  right: '\u001b[C',
  space: ' ',
  tab: '\t',
  up: '\u001b[A',
});

export { key };
export type { KeyLetter };
