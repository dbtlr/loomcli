import { DeclarationError, InputError } from './errors.js';
import type { BuiltGlobals, GlobalOptions } from './globals.js';
import { defaultGlobals } from './globals.js';
import { compileOptions, extractGlobals, mergeValues, parseInputs } from './options.js';
import type {
  Action,
  ArgumentConfig,
  ArgumentValue,
  DefaultConstraint,
  GlobalNameConstraint,
  Host,
  NameConstraint,
  OptionConfig,
  OptionValue,
  Out,
} from './types.js';
import { validateValues } from './validation.js';
import type { InputDeclaration, ValidatedInputs } from './validation.js';

/** One positional slot: the declaration it fills and whether it takes the remaining tokens. */
export interface ArgumentSlot {
  input: InputDeclaration;
  variadic: boolean;
}

export interface DispatchInput {
  host: Host;
  out: Out;
  passthrough: string[];
  values: ValidatedInputs;
}

export interface BuiltCommand {
  arguments: readonly ArgumentSlot[];
  children: ReadonlyMap<string, BuiltCommand>;
  dispatch: (input: DispatchInput) => unknown;
  inputs: readonly InputDeclaration[];
  name: string | null;
  options: ReturnType<typeof compileOptions>;
}

/** The attachable shape of a Command, without its inferred declaration types. */
export interface CommandNode {
  readonly name: string | null;
  build(globals: BuiltGlobals): BuiltCommand;
}

function subjectOf(name: string | null) {
  return name === null ? 'the root Command' : `Command "${name}"`;
}

function sentenceOf(name: string | null) {
  const subject = subjectOf(name);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

function checkChildName(parent: string | null, name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || name.startsWith('-') || /[\s=]/u.test(name)) {
    throw new DeclarationError(
      `${sentenceOf(parent)} attaches a child named "${String(name)}". Use a nonempty name without a leading hyphen, whitespace, or "=".`,
    );
  }
}

/** Everything one Command declaration holds. Builder calls copy it with one field replaced. */
export interface CommandState<Args, Options, Globals> {
  actions: Action<Args, Globals & Options>[];
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  children: CommandNode[];
  globals: GlobalOptions<Globals>;
  inputs: readonly InputDeclaration[];
  name: string | null;
}

export class CommandBuilder<Args, Options, Globals> implements CommandNode {
  readonly actions: Action<Args, Globals & Options>[];
  readonly bind: (values: ValidatedInputs) => { args: Args; options: Options };
  readonly children: CommandNode[];
  readonly globals: GlobalOptions<Globals>;
  readonly inputs: readonly InputDeclaration[];
  readonly name: string | null;

  constructor(state: CommandState<Args, Options, Globals>) {
    this.actions = state.actions;
    this.bind = state.bind;
    this.children = state.children;
    this.globals = state.globals;
    this.inputs = state.inputs;
    this.name = state.name;
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): CommandBuilder<Args & Record<Name, ArgumentValue<Config>>, Options, Globals> {
    const declared: ArgumentConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'argument', name };
    return new CommandBuilder({
      ...this.copy(),
      bind: (values) => {
        const previous = this.bind(values);
        // Validation supplies the schema output, and the computed key is exactly Name.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: values.get(input) } as Record<Name, ArgumentValue<Config>>;
        return { ...previous, args: { ...previous.args, ...value } };
      },
      inputs: [...this.inputs, input],
    });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>>,
  ): CommandBuilder<Args, Options & Record<Name, OptionValue<Config>>, Globals> {
    const declared: OptionConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'option', name };
    return new CommandBuilder({
      ...this.copy(),
      bind: (values) => {
        const previous = this.bind(values);
        // Validation supplies the declared output, and the computed key is exactly Name.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: values.get(input) } as Record<Name, OptionValue<Config>>;
        return { ...previous, options: { ...previous.options, ...value } };
      },
      inputs: [...this.inputs, input],
    });
  }

  /** A builder call keeps the declarations it already holds and replaces one field. */
  private copy(): CommandState<Args, Options, Globals> {
    return {
      actions: [...this.actions],
      bind: this.bind,
      children: [...this.children],
      globals: this.globals,
      inputs: this.inputs,
      name: this.name,
    };
  }

  action(handler: Action<Args, Globals & Options>): this {
    this.actions.push(handler);
    return this;
  }

  build(globals: BuiltGlobals): BuiltCommand {
    const subject = subjectOf(this.name);
    if (this.globals !== globals.source) {
      throw new DeclarationError(
        `${sentenceOf(this.name)} holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.`,
      );
    }
    const attached = this.collectChildren();
    const slots = this.collectArguments(subject);
    const first = slots[0];
    const child = attached[0];
    if (first && child) {
      throw new DeclarationError(
        `${sentenceOf(this.name)} declares argument "${first.input.name}" and attaches child "${child[0]}". Move the argument into a child Command or remove the children.`,
      );
    }
    if (this.actions.length > 1) {
      throw new DeclarationError(
        `${sentenceOf(this.name)} has multiple actions. Register one action.`,
      );
    }
    const action = this.actions[0];
    if (!action) {
      throw new DeclarationError(`${sentenceOf(this.name)} has no action. Register an action.`);
    }
    const options = this.compileLocalOptions(globals, subject);
    return {
      arguments: slots,
      children: new Map(attached.map(([name, node]) => [name, node.build(globals)])),
      dispatch: ({ host, out, passthrough, values }) => {
        const bound = this.bind(values);
        return action({
          args: bound.args,
          host,
          options: { ...this.globals.bind(values), ...bound.options },
          out,
          passthrough,
        });
      },
      inputs: this.inputs,
      name: this.name,
      options,
    };
  }

  /** Child names are checked before any child builds, so parent diagnostics come first. */
  private collectChildren(): [string, CommandNode][] {
    const attached: [string, CommandNode][] = [];
    const seen = new Set<string>();
    for (const child of this.children) {
      const name = child.name;
      checkChildName(this.name, name);
      if (seen.has(name)) {
        throw new DeclarationError(
          `${sentenceOf(this.name)} attaches two children named "${name}". Rename or remove one.`,
        );
      }
      seen.add(name);
      attached.push([name, child]);
    }
    return attached;
  }

  private collectArguments(subject: string): ArgumentSlot[] {
    const slots: ArgumentSlot[] = [];
    const seen = new Set<string>();
    for (const input of this.inputs.filter((entry) => entry.kind === 'argument')) {
      if (seen.has(input.name)) {
        throw new DeclarationError(
          `Argument "${input.name}" is declared more than once on ${subject}. Remove or rename the duplicate.`,
        );
      }
      seen.add(input.name);
      slots.push({ input, variadic: input.config.variadic === true });
    }
    for (let index = 0; index + 1 < slots.length; index += 1) {
      const slot = slots[index];
      const next = slots[index + 1];
      if (slot?.variadic && next) {
        throw new DeclarationError(
          `Argument "${slot.input.name}" is variadic and precedes argument "${next.input.name}" on ${subject}. Declare the variadic argument last.`,
        );
      }
    }
    return slots;
  }

  private compileLocalOptions(globals: BuiltGlobals, subject: string) {
    const declarations = this.inputs.filter((input) => input.kind === 'option');
    for (const declaration of declarations) {
      if (globals.names.has(declaration.name)) {
        throw new DeclarationError(
          `Option "${declaration.name}" is declared as a global option and as a local option on ${subject}. Rename the local option.`,
        );
      }
    }
    const options = compileOptions(declarations, subject);
    for (const [spelling, option] of options) {
      const global = globals.options.get(spelling);
      if (global) {
        throw new DeclarationError(
          `Option spelling "${spelling}" is used by the global option "${global.name}" and the local option "${option.name}" on ${subject}. Change one declaration.`,
        );
      }
    }
    return options;
  }
}

export type Command<Args = {}, Options = {}, Globals = {}> = CommandBuilder<Args, Options, Globals>;

interface CommandConstructor {
  new (name: string): Command;
  new <Globals>(name: string, globals: GlobalOptions<Globals>): Command<{}, {}, Globals>;
}

class CommandDeclaration extends CommandBuilder<{}, {}, {}> {
  constructor(name: string, globals?: GlobalOptions) {
    super({
      actions: [],
      bind: () => ({ args: {}, options: {} }),
      children: [],
      globals: defaultGlobals(globals),
      inputs: [],
      name,
    });
  }
}

/** The public constructor requires a name and narrows the globals type to the supplied value. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const Command = CommandDeclaration as unknown as CommandConstructor;

/** Every declaration in the graph, so defaults are validated before any token is read. */
export function collectInputs(command: BuiltCommand): InputDeclaration[] {
  return [
    ...command.inputs,
    ...[...command.children.values()].flatMap((child) => collectInputs(child)),
  ];
}

/** Bare tokens select children until a Command has none; the first hyphen token commits. */
export function route(root: BuiltCommand, tokens: readonly string[]) {
  let command = root;
  let index = 0;
  while (command.children.size > 0) {
    const token = tokens[index];
    if (token === undefined || token === '--' || token.startsWith('-')) {
      break;
    }
    const child = command.children.get(token);
    if (!child) {
      throw new InputError(
        `Unknown command "${token}". Use one of: ${[...command.children.keys()].join(', ')}.`,
      );
    }
    command = child;
    index += 1;
  }
  return { command, tokens: tokens.slice(index) };
}

function bindArguments(command: BuiltCommand, positionals: readonly string[]) {
  const values = new Map<InputDeclaration, string | string[]>();
  let index = 0;
  for (const slot of command.arguments) {
    const { name } = slot.input;
    if (slot.variadic) {
      const rest = positionals.slice(index);
      if (rest.length === 0) {
        throw new InputError(
          `Argument "${name}" requires at least one value. Supply a value for "${name}".`,
        );
      }
      values.set(slot.input, rest);
      index = positionals.length;
    } else {
      const value = positionals[index];
      if (value === undefined) {
        throw new InputError(`Argument "${name}" requires a value. Supply a value for "${name}".`);
      }
      values.set(slot.input, value);
      index += 1;
    }
  }
  if (index < positionals.length) {
    const count = command.arguments.length;
    throw new InputError(
      count === 0
        ? `${sentenceOf(command.name)} accepts no arguments. Remove the supplied values.`
        : `${sentenceOf(command.name)} accepts ${count} ${count === 1 ? 'argument' : 'arguments'}. Remove the extra values.`,
    );
  }
  return values;
}

/** Consumes globals, routes to a Command, then validates globals and locals in one pass. */
export async function selectCommand(
  graph: { globals: BuiltGlobals; root: BuiltCommand },
  tokens: readonly string[],
  defaults: ValidatedInputs,
) {
  const scan = extractGlobals(graph.globals.options, tokens);
  const selected = route(graph.root, scan.rest);
  const parsed = parseInputs(selected.command.options, selected.tokens);
  const args = bindArguments(selected.command, parsed.positionals);
  const values = await validateValues(
    [...graph.globals.inputs, ...selected.command.inputs],
    { args, options: mergeValues(scan.values, parsed.options) },
    defaults,
  );
  return { command: selected.command, passthrough: parsed.passthrough, values };
}
