/*
 * The operator sentences core's output writes, under ADR-0164: the line of a result sequence that
 * stopped before its end. `tests/message-voice.test.ts` holds this module to the failure message
 * voice.
 */
import { routedSubject } from '../failures/messages.js';

/**
 * The sentence of a sequence that stopped before its end, so an empty result and a truncated one
 * never read alike: the Command it belongs to, the rows its source produced, and the rows core
 * wrote.
 *
 * @example
 * ```ts
 * incompleteOutput(['logs'], 3, 2); // 'Output is incomplete: Command "logs" stopped after 3 rows, 2 written.'
 * ```
 */
function incompleteOutput(path: readonly string[], yielded: number, written: number): string {
  return `Output is incomplete: ${routedSubject(path)} stopped after ${yielded} rows, ${written} written.`;
}

export { incompleteOutput };
