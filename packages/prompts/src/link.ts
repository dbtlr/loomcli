import {
  DeclarationError,
  diagnosticRule,
  FatalError,
  isProseLine,
  missingInputError,
} from '@loomcli/core';
import type { OptionNode } from '@loomcli/core';

import type { LinkKey, PromptContext } from './types.js';

const linkRule = diagnosticRule('@loomcli/prompts/link', {
  explanation:
    'A question links one local option of the routed Command, of the kind the question accepts.',
  headline: 'Invalid question',
});

/** A malformed question is an authoring fault at its call. */
function invalid(message: string, correction: string): never {
  throw new DeclarationError(linkRule, { correction, sentence: message });
}

class InteractionUnavailableError extends FatalError {
  static override readonly code = 'interaction-unavailable';

  constructor(message: string, command: string) {
    super(
      `The question "${message}" needs an interactive terminal, and this run is not interactive. Run "${command}" at a terminal.`,
    );
    this.name = 'InteractionUnavailableError';
  }
}

/** Resolves only skipped questions; an asked question keeps its raw prefill separate from output. */
function resolveLink<Options, Key extends LinkKey<Options>>(
  context: PromptContext<Options>,
  settings: { message: string; option?: Key; skipIfSupplied?: boolean },
  kind: 'text' | 'secret' | 'confirm' | 'select',
): { kind: 'answered'; value: Options[Key] } | { kind: 'ask'; prefill: unknown } {
  const { message, option: key } = settings;
  if (!isProseLine(message)) {
    invalid('A question message must be one nonempty line.', 'Supply a one-line message.');
  }
  if (settings.skipIfSupplied !== undefined && typeof settings.skipIfSupplied !== 'boolean') {
    invalid(`The question "${message}" sets an invalid skipIfSupplied.`, 'Use true or false.');
  }
  if (key === undefined) {
    if ('skipIfSupplied' in settings) {
      invalid(
        `The question "${message}" sets skipIfSupplied without option.`,
        'Link an option or remove skipIfSupplied.',
      );
    }
    if (!context.interactive) {
      throw new InteractionUnavailableError(
        message,
        [context.graph.name, ...context.command.path].join(' '),
      );
    }
    return { kind: 'ask', prefill: undefined };
  }
  if (context.graph.globals.some((input) => input.name === key)) {
    invalid(
      `The question "${message}" links global option "${key}".`,
      'Link a local option of the routed Command.',
    );
  }
  const option = context.command.options.find((input) => input.name === key);
  if (option === undefined) {
    const command =
      context.command.name === null ? 'the root Command' : `Command "${context.command.name}"`;
    invalid(
      `The question "${message}" links option "${key}", which ${command} does not declare.`,
      'Link a local option of the routed Command.',
    );
  }
  checkKind(option, kind, message);
  const raw = context.supplied.options[key];
  if (raw !== undefined && (!context.interactive || settings.skipIfSupplied === true)) {
    return { kind: 'answered', value: context.options[key] };
  }
  if (!context.interactive) {
    throw missingInputError(context, key);
  }
  return { kind: 'ask', prefill: raw ?? ('default' in option ? option.default?.value : undefined) };
}

function checkKind(option: OptionNode, kind: string, message: string): void {
  if (kind === 'confirm') {
    if (option.type !== 'boolean') {
      invalid(
        `The question "${message}" links option "${option.name}", which is not a Boolean option.`,
        'Link a Boolean option.',
      );
    }
  } else if (option.type !== 'string' || option.multiple) {
    invalid(
      `The question "${message}" links option "${option.name}", which is not a string option that takes one value.`,
      'Link a string option that takes one value.',
    );
  }
}

export { InteractionUnavailableError, invalid, linkRule, resolveLink };
