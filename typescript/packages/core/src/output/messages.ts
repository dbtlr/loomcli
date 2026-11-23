/*
 * The sentences core's output says to the operator, under ADR-0164. Each export is a sentence a
 * phrasebook may hold, under ADR-0200. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { routedSubject } from '../failures/wording.js';

function incompleteOutput(path: readonly string[], yielded: number, written: number): string {
  return `Output is incomplete: ${routedSubject(path)} stopped after ${yielded} rows, ${written} written.`;
}

export { incompleteOutput };
