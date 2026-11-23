/*
 * The lines a failure keeps beside it, each a phrase or a string repeated as written. A failure's
 * `message` is their English text joined by line breaks, and core renders the lines only while the
 * message still reads that text, so a message the author's code changed renders as written.
 */
import type { LoomError } from '../failures/errors.js';
import { Phrase } from './phrase.js';
import type { Localize } from './phrase.js';

/** One line of a failure: a phrase, or a string repeated as written. */
type FailureLine = string | Phrase;

/** What a failure class's constructor takes: one line, or a list of them. */
type FailureMessage = string | Phrase | readonly (string | Phrase)[];

/** The lines each failure keeps, by the failure. */
const lineStore = new WeakMap<Error, readonly FailureLine[]>();

/** Whether one value is a list of lines, a list a JavaScript caller may fill with anything. */
function isLineList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * One line as a failure keeps it: a phrase or a string, and any other value a JavaScript caller
 * passed as the text `Error` reads it as, so an omitted message reads as the empty string.
 */
function lineOf(value: unknown): FailureLine {
  if (typeof value === 'string' || value instanceof Phrase) {
    return value;
  }
  const text = String(value);
  return value === undefined ? '' : text;
}

/** The lines one failure's constructor received, frozen. */
function linesOf(message: FailureMessage): readonly FailureLine[] {
  return Object.freeze(isLineList(message) ? message.map(lineOf) : [lineOf(message)]);
}

/** The lines rendered by `localize` and joined by line breaks. */
function joinedLines(lines: readonly FailureLine[], localize: Localize): string {
  return lines.map((line) => (typeof line === 'string' ? line : localize(line))).join('\n');
}

/** The English text of a failure's lines: its `message`. */
function englishLines(lines: readonly FailureLine[]): string {
  return joinedLines(lines, (phrase) => phrase.text);
}

/** Keeps one failure's lines beside it. */
function keepLines(failure: Error, lines: readonly FailureLine[]): void {
  lineStore.set(failure, lines);
}

/**
 * The lines a failure keeps, one entry per line, each a phrase or a string, or `undefined` when it
 * keeps none or its `message` no longer reads their English text joined by line breaks.
 *
 * @example
 * ```ts
 * import { failureLines } from '@loomcli/core';
 * import type { LoomError } from '@loomcli/core';
 *
 * declare const failure: LoomError;
 *
 * const lines = failureLines(failure) ?? [failure.message];
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/localization.md#phrases
 * @public
 */
function failureLines(failure: LoomError): readonly (string | Phrase)[] | undefined {
  const lines = lineStore.get(failure);
  return lines !== undefined && englishLines(lines) === failure.message ? lines : undefined;
}

/**
 * A failure's sentence as a person reads it: its lines rendered by `localize`, or its `message` as
 * written when it keeps no lines that still read it.
 */
function failureText(failure: Error, localize: Localize): string {
  const lines = lineStore.get(failure);
  return lines !== undefined && englishLines(lines) === failure.message
    ? joinedLines(lines, localize)
    : failure.message;
}

export type { FailureLine, FailureMessage };
export { englishLines, failureLines, failureText, keepLines, linesOf };
