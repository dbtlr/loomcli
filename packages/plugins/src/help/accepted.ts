import { readExtension } from '@loomcli/core';
import type { ArgumentNode, OptionNode } from '@loomcli/core';

import { closedSet } from '../closed-set.js';
import type { Schema } from '../closed-set.js';
import { escapeControls } from '../encode.js';
import { terminator } from '../lines.js';
import { oneLine } from './cells.js';
import { helpArgument, helpInput } from './extension.js';

/** The most values a derived list names; a larger set is the author's to state with `accepts`. */
const maximumValues = 8;

/**
 * One value as the list prints it: as written, or as its JSON string when it is empty or holds
 * whitespace, a comma, a double quote, a line terminator, or a control character. JSON escapes the
 * C0 controls; DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX`
 * escapes, and every line terminator prints escaped, so the row shows the exact value on one line.
 */
function listed(value: string): string {
  const plain = value !== '' && !/[\s,"\p{Cc}]/u.test(value) && !terminator.test(value);
  if (plain) {
    return value;
  }
  return oneLine(escapeControls(JSON.stringify(value)));
}

/**
 * The sentence help derives from an input's schema: `One of: a, b, c.` for a closed set of at most
 * eight distinct strings. A multiple option or a variadic argument publishes the schema of each
 * value, so it derives the same way. Anything else derives nothing.
 */
function derived(schema: Schema | null): string | undefined {
  const distinct = closedSet(schema) ?? [];
  const [first] = distinct;
  if (first === undefined || distinct.length > maximumValues) {
    return undefined;
  }
  return `One of: ${distinct.map((value) => listed(value)).join(', ')}.`;
}

/**
 * The accepted-values sentence one option's row prints: its authored `accepts`, which always
 * wins, or the list derived from its schema. A Boolean option takes no value and prints none.
 */
function optionAccepts(option: OptionNode): string | undefined {
  if (option.type === 'boolean') {
    return undefined;
  }
  return readExtension(option, helpInput)?.accepts ?? derived(option.schema);
}

/** The accepted-values sentence one argument's row prints, authored or derived as an option's is. */
function argumentAccepts(argument: ArgumentNode): string | undefined {
  return readExtension(argument, helpArgument)?.accepts ?? derived(argument.schema);
}

export { argumentAccepts, optionAccepts };
