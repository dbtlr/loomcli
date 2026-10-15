import { registerRule } from './diagnostic-text.js';
import { DeclarationError, InputError, quoted } from './errors.js';
import { reportedSpelling } from './inspect.js';
import type { ActionContext, Host } from './types.js';

/** Hosts belong to one invocation, so naming stays private while the action context is copied. */
const missingInput = registerRule('@loomcli/core/missing-input-name', {
  explanation: 'A missing input names a local option of the routed Command.',
  headline: 'Unknown missing input',
});

const named = new WeakSet<Host>();

export function rememberInputNames(host: Host, invokedBy: 'argv' | 'name'): void {
  if (invokedBy === 'name') {
    named.add(host);
  }
}

/** Builds the ordinary missing-option failure for an action-owned question. */
export function missingInputError(
  context: Pick<ActionContext<unknown>, 'command' | 'host' | 'interactive'>,
  name: string,
): InputError {
  const option = context.command.options.find((input) => input.name === name);
  if (option === undefined) {
    throw new DeclarationError(missingInput, {
      correction: 'Supply the name of a local option of the routed Command.',
      findings: [],
      sentence: `missingInputError() received option ${quoted(name)}, which ${context.command.name === null ? 'the root Command' : `Command ${quoted(context.command.name)}`} does not declare.`,
    });
  }
  const spelling = named.has(context.host) ? name : reportedSpelling(option);
  const forms =
    option.type === 'boolean'
      ? [
          option.long,
          option.negative,
          ...(option.long === null && option.negative === null ? [option.short] : []),
        ].filter((form) => form !== null)
      : [];
  const fix =
    !named.has(context.host) && forms.length > 0
      ? `Supply ${forms.map((form) => quoted(form)).join(' or ')}.`
      : 'Supply a value.';
  return new InputError(
    `Option ${quoted(spelling)} is required${context.interactive ? '' : ' when input is not interactive'}. ${fix}`,
    [
      {
        input: { global: false, kind: 'option', name },
        reason: 'missing',
        spelling,
      },
    ],
  );
}
