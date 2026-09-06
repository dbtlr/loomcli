import { DeclarationError, InputError } from './errors.js';
import type { BuiltGlobals, GlobalOptions } from './globals.js';
import { bindGlobals, buildGlobals, defaultGlobals } from './globals.js';
import { compileOptions, extractGlobals, mergeValues, parseInputs } from './options.js';
import type {
  Action,
  ArgumentConfig,
  ArgumentValue,
  declaredTypes,
  DeclaredTypes,
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

/** Phantom key. It marks a Command value, so only a Command can be attached as a child. */
export declare const commandValue: unique symbol;

/**
 * Every authoring call a Command can publish. A Command's type state is a subset of these names,
 * and each call removes the names it invalidates. Adding `command()` to a Command adds it here.
 */
export type CommandMethod = 'action' | 'argument' | 'option';

/** A declaration made after the action, kept in authoring order so build reports the first. */
type LateDeclaration =
  | { child: object; kind: 'child' }
  | { input: InputDeclaration; kind: 'input' };

/** The attachable shape of a Command, without its inferred declaration types. */
interface CommandNode {
  readonly name: string | null;
  build(globals: BuiltGlobals): BuiltCommand;
}

/** Authored values register here, so the public type publishes no state to reach or replace. */
const nodes = new WeakMap<object, CommandNode>();

function subjectOf(name: string | null) {
  return name === null ? 'the root Command' : `Command "${name}"`;
}

function sentenceOf(name: string | null) {
  const subject = subjectOf(name);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

/** Reads the declarations behind an attached value; anything else is a declaration error. */
function nodeOf(parent: string | null, child: object): CommandNode {
  const node = nodes.get(child);
  if (!node) {
    throw new DeclarationError(
      `${sentenceOf(parent)} attaches a value that is not a Command. Attach the value returned by new Command(name).`,
    );
  }
  return node;
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
  actions: readonly Action<Args, Globals & Options>[];
  bind: (values: ValidatedInputs) => { args: Args; options: Options };
  children: readonly object[];
  globals: GlobalOptions<Globals>;
  inputs: readonly InputDeclaration[];
  late: readonly LateDeclaration[];
  name: string | null;
}

export class CommandBuilder<Args, Options, Globals, State extends CommandMethod = CommandMethod> {
  declare readonly [commandValue]: true;
  declare readonly [declaredTypes]: DeclaredTypes<Args, Options, Globals>;

  readonly #state: CommandState<Args, Options, Globals>;

  constructor(state: CommandState<Args, Options, Globals>) {
    this.#state = state;
    nodes.set(this, this);
  }

  get name(): string | null {
    return this.#state.name;
  }

  argument<const Name extends string, const Config extends ArgumentConfig>(
    name: Name,
    config: Config & NameConstraint<Name>,
  ): Command<
    Args & Record<Name, ArgumentValue<Config>>,
    Options,
    Globals,
    Exclude<State, 'command'>
  > {
    const declared: ArgumentConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'argument', name };
    const previous = this.#state.bind;
    return new CommandBuilder({
      ...this.#state,
      bind: (values) => {
        const bound = previous(values);
        // Validation supplies the schema output, and the computed key is exactly Name.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: values.get(input) } as Record<Name, ArgumentValue<Config>>;
        return { ...bound, args: { ...bound.args, ...value } };
      },
      inputs: [...this.#state.inputs, input],
      late: this.recordLate({ input, kind: 'input' }),
    });
  }

  option<const Name extends string, const Config extends OptionConfig>(
    name: Name,
    config: Config &
      NameConstraint<Name> &
      GlobalNameConstraint<Name, Globals> &
      NoInfer<DefaultConstraint<Config>>,
  ): Command<Args, Options & Record<Name, OptionValue<Config>>, Globals, State> {
    const declared: OptionConfig = { ...config };
    const input: InputDeclaration = { config: declared, kind: 'option', name };
    const previous = this.#state.bind;
    return new CommandBuilder({
      ...this.#state,
      bind: (values) => {
        const bound = previous(values);
        // Validation supplies the declared output, and the computed key is exactly Name.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const value = { [name]: values.get(input) } as Record<Name, OptionValue<Config>>;
        return { ...bound, options: { ...bound.options, ...value } };
      },
      inputs: [...this.#state.inputs, input],
      late: this.recordLate({ input, kind: 'input' }),
    });
  }

  /** The action is the last declaration call, so the value it returns publishes no other. */
  action(handler: Action<Args, Globals & Options>): Command<Args, Options, Globals, never> {
    return new CommandBuilder({
      ...this.#state,
      actions: [...this.#state.actions, handler],
    });
  }

  /** Attaching is a declaration call too, so the receiver keeps the children it already had. */
  attach(child: object): CommandBuilder<Args, Options, Globals> {
    return new CommandBuilder({
      ...this.#state,
      children: [...this.#state.children, child],
      late: this.recordLate({ child, kind: 'child' }),
    });
  }

  /** The globals table compiles once per invocation and every Command in the graph shares it. */
  buildGraph(): { globals: BuiltGlobals; root: BuiltCommand } {
    const globals = buildGlobals(this.#state.globals);
    return { globals, root: this.build(globals) };
  }

  build(globals: BuiltGlobals): BuiltCommand {
    const { actions, name } = this.#state;
    const subject = subjectOf(name);
    if (this.#state.globals !== globals.source) {
      throw new DeclarationError(
        `${sentenceOf(name)} holds a different GlobalOptions value than its Application. Share one GlobalOptions value across the declarations.`,
      );
    }
    this.checkDeclarationOrder(name);
    const attached = this.collectChildren();
    const slots = this.collectArguments(subject);
    const first = slots[0];
    const child = attached[0];
    if (first && child) {
      throw new DeclarationError(
        `${sentenceOf(name)} declares argument "${first.input.name}" and attaches child "${child[0]}". Move the argument into a child Command or remove the children.`,
      );
    }
    if (actions.length > 1) {
      throw new DeclarationError(`${sentenceOf(name)} has multiple actions. Register one action.`);
    }
    const action = actions[0];
    if (!action) {
      throw new DeclarationError(`${sentenceOf(name)} has no action. Register an action.`);
    }
    const options = this.compileLocalOptions(globals, subject);
    const state = this.#state;
    return {
      arguments: slots,
      children: new Map(attached.map(([key, node]) => [key, node.build(globals)])),
      dispatch: ({ host, out, passthrough, values }) => {
        const bound = state.bind(values);
        return action({
          args: bound.args,
          host,
          options: { ...bindGlobals(state.globals, values), ...bound.options },
          out,
          passthrough,
        });
      },
      inputs: state.inputs,
      name,
      options,
    };
  }

  /** A declaration after the action is an order fault; build reports the first one recorded. */
  private recordLate(declaration: LateDeclaration): readonly LateDeclaration[] {
    const { actions, late } = this.#state;
    return actions.length > 0 ? [...late, declaration] : late;
  }

  /** The types remove a late call for TypeScript authors; JavaScript authors read it here. */
  private checkDeclarationOrder(name: string | null): void {
    const late = this.#state.late[0];
    if (!late) {
      return;
    }
    if (late.kind === 'input') {
      throw new DeclarationError(
        `${sentenceOf(name)} declares ${late.input.kind} "${late.input.name}" after its action. Declare arguments and options before action().`,
      );
    }
    throw new DeclarationError(
      `${sentenceOf(name)} attaches child "${nodeOf(name, late.child).name}" after its action. Attach children before action().`,
    );
  }

  /** Child names are checked before any child builds, so parent diagnostics come first. */
  private collectChildren(): [string, CommandNode][] {
    const attached: [string, CommandNode][] = [];
    const seen = new Set<string>();
    for (const child of this.#state.children) {
      const node = nodeOf(this.#state.name, child);
      const name = node.name;
      checkChildName(this.#state.name, name);
      if (seen.has(name)) {
        throw new DeclarationError(
          `${sentenceOf(this.#state.name)} attaches two children named "${name}". Rename or remove one.`,
        );
      }
      seen.add(name);
      attached.push([name, node]);
    }
    return attached;
  }

  private collectArguments(subject: string): ArgumentSlot[] {
    const slots: ArgumentSlot[] = [];
    const seen = new Set<string>();
    for (const input of this.#state.inputs.filter((entry) => entry.kind === 'argument')) {
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
    const declarations = this.#state.inputs.filter((input) => input.kind === 'option');
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

/**
 * The authoring surface of a Command in one type state. Every call returns a new declaration value,
 * leaves its receiver unchanged, and publishes only the calls that are still valid after it. The
 * declarations themselves stay private, so no consumer can reach them. `Command<A, O, G, never>` is
 * a Command that registered its action: it is finished, and its only use is `command()`.
 */
export type Command<
  Args = {},
  Options = {},
  Globals = {},
  State extends CommandMethod = CommandMethod,
> = Pick<
  CommandBuilder<Args, Options, Globals, State>,
  typeof commandValue | typeof declaredTypes | State
>;

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
      late: [],
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
