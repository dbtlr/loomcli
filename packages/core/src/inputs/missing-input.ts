import { registerRule } from '../diagnostics/diagnostic-text.js';
import { DeclarationError, InputError } from '../failures/errors.js';
import { quoted } from '../failures/messages.js';
import type { Host } from '../host/types.js';
import { reportedSpelling } from '../inspection/inspect.js';
import type { ActionContext } from '../invocation/types.js';
import { requiredArgument, requiredOption } from './messages.js';
import type { OptionFix } from './messages.js';

/** Hosts belong to one invocation, so naming stays private while the action context is copied. */
const missingInput = registerRule('@loomcli/core/missing-input-name', {
  explanation: 'A missing input names a local option or an argument of the routed Command.',
  headline: 'Unknown missing input',
});

const named = new WeakSet<Host>();

function rememberInputNames(host: Host, invokedBy: 'argv' | 'name'): void {
  if (invokedBy === 'name') {
    named.add(host);
  }
}

/**
 * Builds the ordinary missing-option failure for an action-owned question.
 *
 * @example
 * ```ts
 * import { Command, missingInputError } from '@loomcli/core';
 *
 * export const deploy = new Command('deploy')
 *   .option('target', { type: 'string', description: 'Where to deploy.' })
 *   .action((context) => {
 *     if (context.options.target === undefined) {
 *       throw missingInputError(context, 'target');
 *     }
 *     context.out.print(`Deploying to ${context.options.target}`);
 *   });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/interaction.md
 * @public
 */
function missingInputError(
  context: Pick<ActionContext<unknown>, 'command' | 'host' | 'interactive'>,
  input: string | { argument: string },
): InputError {
  if (typeof input !== 'string') {
    return missingArgument(context, input.argument);
  }
  const option = context.command.options.find((entry) => entry.name === input);
  if (option === undefined) {
    throw new DeclarationError(missingInput, {
      correction: 'Supply the name of a local option of the routed Command.',
      findings: [],
      sentence: `missingInputError() received option ${quoted(input)}, which ${context.command.name === null ? 'the root Command' : `Command ${quoted(context.command.name)}`} does not declare.`,
    });
  }
  const spelling = named.has(context.host) ? input : reportedSpelling(option);
  const forms =
    option.type === 'boolean'
      ? [
          option.long,
          option.negative,
          ...(option.long === null && option.negative === null ? [option.short] : []),
        ].filter((form) => form !== null)
      : [];
  const valueFix: OptionFix =
    option.type === 'string'
      ? { arity: option.arity ?? undefined, collected: option.multiple, kind: 'values' }
      : { kind: 'value' };
  const fix: OptionFix =
    !named.has(context.host) && forms.length > 0
      ? { kind: 'spellings', spellings: forms }
      : valueFix;
  return new InputError(requiredOption({ kind: 'option', spelling }, !context.interactive, fix), [
    {
      input: { global: false, kind: 'option', name: input },
      reason: 'missing',
      spelling,
    },
  ]);
}

function missingArgument(
  context: Pick<ActionContext<unknown>, 'command' | 'host' | 'interactive'>,
  name: string,
): InputError {
  const argument = context.command.arguments.find((entry) => entry.name === name);
  if (argument === undefined) {
    throw new DeclarationError(missingInput, {
      correction: 'Supply the name of an argument of the routed Command.',
      findings: [],
      sentence: `missingInputError() received argument ${quoted(name)}, which ${context.command.name === null ? 'the root Command' : `Command ${quoted(context.command.name)}`} does not declare.`,
    });
  }
  return new InputError(requiredArgument(name, argument.variadic, !context.interactive), [
    { input: { global: false, kind: 'argument', name }, reason: 'missing', spelling: name },
  ]);
}

export { missingInputError, rememberInputNames };
