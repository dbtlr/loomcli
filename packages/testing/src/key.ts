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
 * Terminal bytes for a scripted keyboard read.
 *
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
