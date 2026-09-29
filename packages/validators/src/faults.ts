import { DeclarationError } from '@loomcli/core';
import type { DiagnosticRule } from '@loomcli/core';

import { isPlainObject } from './data.js';
import { factoryOptions } from './rules.js';

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

/** A declared value as a fault message quotes it: a string in quotes, a primitive as printed. */
function quote(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return `a value of type ${typeof value}`;
}

/**
 * A factory's options read as unknown values, because a JavaScript caller can pass anything.
 * Omitted options read as an empty record.
 */
function readOptions(factory: string, options: unknown): Readonly<Record<string, unknown>> {
  if (options === undefined) {
    return {};
  }
  if (!isPlainObject(options)) {
    throw fault(
      factoryOptions,
      { arguments: [options], factory, mark: '0' },
      {
        correction: 'Supply an object or leave it out.',
        sentence: `${factory}() options is not a plain object.`,
      },
    );
  }
  return options;
}

export { fault, quote, readOptions };
export type { FactoryCall };
