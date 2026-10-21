import { DeclarationError } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

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

export { fault };
export type { FactoryCall };
