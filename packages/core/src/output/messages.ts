/*
 * The operator sentence core's output writes, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { routedSubject } from '../failures/messages.js';

function incompleteOutput(path: readonly string[], yielded: number, written: number): string {
  return `Output is incomplete: ${routedSubject(path)} stopped after ${yielded} rows, ${written} written.`;
}

export { incompleteOutput };
