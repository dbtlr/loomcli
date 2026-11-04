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
    'A question asks in one line of prose and links at most one local option or argument of the routed Command, of the kind the question accepts, and a select or multiselect question offers enough choices that are not disabled to be answered.',
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

/** The question that links an input: its message and its kind. */
interface Question {
  readonly message: string;
  readonly kind: 'text' | 'secret' | 'confirm' | 'select' | 'multiselect';
}

/** A linked input as a question resolves it: its raw value, its validated value, and its fallback. */
interface Linked<Value> {
  readonly raw: unknown;
  readonly value: () => Value;
  readonly missing: () => Error;
  readonly fallback: unknown;
}

/** The argument a question links, once its declaration is checked. */
function linkedArgument<Options, Args, Argument extends LinkKey<Args>>(
  context: PromptContext<Options, Args>,
  name: Argument,
  { message, kind }: Question,
): Linked<Args[Argument]> {
  const argument = context.command.arguments.find((input) => input.name === name);
  if (argument === undefined) {
    invalid(
      `The question "${message}" links argument "${name}", which ${context.command.name === null ? 'the root Command' : `Command "${context.command.name}"`} does not declare.`,
      'Link an argument of the routed Command.',
    );
  }
  if (kind === 'multiselect' && (argument.type === 'content' || !argument.variadic)) {
    invalid(
      `The question "${message}" links argument "${name}", which is not a variadic string argument.`,
      'Link a multiple string option or a variadic string argument.',
    );
  }
  if (
    kind !== 'multiselect' &&
    (argument.type === 'content' || argument.variadic || kind === 'confirm')
  ) {
    invalid(
      `The question "${message}" links argument "${name}", which is not a string argument that takes one value.`,
      'Link a string option or argument that takes one value.',
    );
  }
  return {
    fallback: argument.default?.value,
    missing: () => missingInputError(context, { argument: name }),
    raw: context.supplied.args[name],
    value: () => context.args[name],
  };
}

/** The option a question links, once its declaration is checked. */
function linkedOption<Options, Key extends LinkKey<Options>, Args>(
  context: PromptContext<Options, Args>,
  key: Key,
  { message, kind }: Question,
): Linked<Options[Key]> {
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
  return {
    fallback: 'default' in option ? option.default?.value : undefined,
    missing: () => missingInputError(context, key),
    raw: context.supplied.options[key],
    value: () => context.options[key],
  };
}

/** Resolves only skipped questions; an asked question keeps its raw prefill separate from output. */
function resolveLink<Options, Key extends LinkKey<Options>, Args, Argument extends LinkKey<Args>>(
  context: PromptContext<Options, Args>,
  settings: { message: string; option?: Key; argument?: Argument; skipIfSupplied?: boolean },
  kind: 'text' | 'secret' | 'confirm' | 'select' | 'multiselect',
): { kind: 'answered'; value: Options[Key] | Args[Argument] } | { kind: 'ask'; prefill: unknown } {
  const { message, option: key, argument } = settings;
  if (!isProseLine(message)) {
    invalid('A question message must be one nonempty line.', 'Supply a one-line message.');
  }
  let linked: Linked<Options[Key] | Args[Argument]> | undefined = undefined;
  if (argument !== undefined) {
    linked = linkedArgument(context, argument, { kind, message });
  } else if (key !== undefined) {
    linked = linkedOption(context, key, { kind, message });
  }
  if (linked === undefined) {
    if (!context.interactive) {
      throw new InteractionUnavailableError(
        message,
        [context.graph.name, ...context.command.path].join(' '),
      );
    }
    return { kind: 'ask', prefill: undefined };
  }
  const supplied =
    linked.raw !== undefined && (!Array.isArray(linked.raw) || linked.raw.length > 0);
  if (supplied && (!context.interactive || settings.skipIfSupplied === true)) {
    return { kind: 'answered', value: linked.value() };
  }
  if (!context.interactive) {
    throw linked.missing();
  }
  return { kind: 'ask', prefill: supplied ? linked.raw : linked.fallback };
}

function checkKind(option: OptionNode, kind: string, message: string): void {
  if (kind === 'multiselect') {
    if (option.type !== 'string' || !option.multiple) {
      invalid(
        `The question "${message}" links option "${option.name}", which is not a multiple string option.`,
        'Link a multiple string option or a variadic string argument.',
      );
    }
  } else if (kind === 'confirm') {
    if (option.type !== 'boolean') {
      invalid(
        `The question "${message}" links option "${option.name}", which is not a Boolean option.`,
        'Link a Boolean option.',
      );
    }
  } else if (option.type !== 'string' || option.multiple) {
    invalid(
      `The question "${message}" links option "${option.name}", which is not a string option that takes one value.`,
      'Link a string option or argument that takes one value.',
    );
  }
}

export { InteractionUnavailableError, invalid, linkRule, resolveLink };
