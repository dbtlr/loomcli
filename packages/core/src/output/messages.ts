/*
 * The sentences core's output says, under ADR-0164: the operator's, and the redaction fault's to
 * the author. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { quoted, routedSubject } from '../failures/messages.js';

function incompleteOutput(path: readonly string[], yielded: number, written: number): string {
  return `Output is incomplete: ${routedSubject(path)} stopped after ${yielded} rows, ${written} written.`;
}

/** The sentence of a `log.redact` entry that is not a dotted path of nonempty keys. */
function redactPathSentence(path: string): string {
  return `The Application redacts ${quoted(path)}, which is not a dotted path of nonempty keys.`;
}

const redactPathCorrection = 'List dotted paths of nonempty keys, such as password or user.token.';

export { incompleteOutput, redactPathCorrection, redactPathSentence };
