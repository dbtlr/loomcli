import { DeclarationError } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

import { isPlainObject } from './data.js';

/** One factory call as a finding rebuilds it: the factory's name and the arguments it received. */
interface FactoryCall {
  readonly factory: string;
  readonly arguments: readonly unknown[];
}

/**
 * A factory argument that can never work, under the rule it breaks. The finding rebuilds the call
 * and marks the argument or the key at fault, `mark` being its dotted path among the arguments,
 * with a note when given. The sentence names the factory and the argument and states the problem,
 * and the correction states the fix.
 */
function fault(
  rule: DiagnosticRule,
  at: FactoryCall & { readonly mark: string; readonly note?: string },
  parts: { readonly sentence: string; readonly correction: string },
): DeclarationError {
  const { mark, note } = at;
  const finding = { arguments: at.arguments, call: at.factory, mark };
  return new DeclarationError(rule, {
    correction: parts.correction,
    findings: [note === undefined ? finding : { ...finding, note }],
    sentence: parts.sentence,
  });
}

/**
 * A factory's options read as unknown values, with omitted options read as an empty record. The
 * types bound every factory's options, so a value that is not an object reads as none. Only `path()`
 * still reads its options through it.
 */
function readOptions(_factory: string, options: unknown): Readonly<Record<string, unknown>> {
  return isPlainObject(options) ? options : {};
}

export { fault, readOptions };
export type { FactoryCall };
