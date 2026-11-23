/*
 * The phrasing an input's sentences name it through, under ADR-0200: a wording module, which the
 * sentences of `messages.ts` and the Developer Diagnostics of declarations compose, so no
 * phrasebook covers it. `tests/message-voice.test.ts` reads it as it reads a message module.
 */
import { quoted } from '../failures/wording.js';
import { escapeControlCharacters } from '../support/controls.js';

/** The input a sentence names: its kind, the spelling it reports, and where its value came from. */
interface InputSubject {
  /** Whether the input is an argument or an option. */
  readonly kind: 'argument' | 'option';
  /** The name or spelling the sentence reports the input by. */
  readonly spelling: string;
  /** The label of the source that supplied the value, such as a configuration file, or none. */
  readonly origin?: string | undefined;
}

function inputSubject(subject: InputSubject): string {
  return subject.kind === 'argument'
    ? `Argument ${quoted(subject.spelling)}`
    : `Option ${quoted(subject.spelling)}${origin(subject.origin)}`;
}

function origin(label: string | undefined): string {
  return label === undefined ? '' : ` (from ${escapeControlCharacters(label)})`;
}

export type { InputSubject };
export { inputSubject, origin };
