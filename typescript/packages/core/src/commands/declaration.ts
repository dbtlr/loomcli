import { spelled, quoteString } from '../diagnostics/diagnostic-text.js';
import type { Finding } from '../diagnostics/diagnostic-text.js';
import { DeclarationError } from '../failures/errors.js';
import { commandSentence, quoted } from '../failures/wording.js';
import type { Content } from '../inputs/content.js';
import type { StdinContext, Action, ActionContext } from '../invocation/types.js';
import type { Out, OpenResult, ResultView } from '../output/types.js';
import { validateLayer, extendStore } from '../plugins/extension.js';
import type { BuiltValues } from '../plugins/providers.js';
import { viewEntries } from './results.js';
import { portableName } from './rules.js';
import type { CommandState, ResultCall } from './state.js';
import { layerOf, pathOf } from './subjects.js';
/** A call's arguments as its author wrote them: the trailing ones left undefined are dropped. */
function callArguments(...values: readonly unknown[]): readonly unknown[] {
  let length = values.length;
  while (length > 0 && values[length - 1] === undefined) {
    length -= 1;
  }
  return values.slice(0, length);
}

/** A Command value as a finding prints it, which it would otherwise print as an ellipsis. */
export function commandCode(name: string): object {
  return spelled(`new Command(${quoteString(name)})`);
}

/** The finding for one `command()` call that attached a child under the Command at `path`. */
export function commandPlacement(path: readonly string[], child: string): Finding {
  return { arguments: [commandCode(child)], call: 'command', mark: '0', path };
}

/** The finding for one `new Command()` call, which carries the name and the options slot. */
export function constructorFinding(name: unknown, options: unknown, mark: string): Finding {
  return { arguments: callArguments(name, options), call: 'new Command', mark };
}

/**
 * The portable name rule, for every name an operator types as a command at a shell prompt: the
 * application name, every Command name, and every alias. The characters are the POSIX portable
 * filename set, and a name starts with neither `-`, which reads as an option, nor `.`, which a
 * shell hides. Core exports it so the lint plugin judges a literal name by this same rule.
 *
 * @example
 * ```ts
 * import { isPortableName } from '@loomcli/core';
 *
 * isPortableName('deploy'); // true
 * isPortableName('db.migrate'); // true
 * isPortableName('-deploy'); // false: it reads as an option
 * isPortableName('my command'); // false: it holds a space
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#declaring-a-command
 * @public
 */
export function isPortableName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u.test(name);
}

/** The one correction every portable name diagnostic ends with. */
export const portableNameCorrection =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

/**
 * The call that declares an alias of each kind: `alias()` an unadvertised one, and
 * `visibleAlias()` a visible one.
 */
type AliasCall = 'alias' | 'visibleAlias';

/**
 * An alias of either kind is typed at the prompt the way a Command name is, so it answers to the
 * portable rule, and the finding rebuilds the one call that named it.
 */
function checkAliasNames(command: string | null, names: readonly string[], call: AliasCall): void {
  for (const [index, alias] of names.entries()) {
    if (!isPortableName(alias)) {
      throw new DeclarationError(portableName, {
        correction: portableNameCorrection,
        findings: [{ arguments: names, call, mark: String(index), path: pathOf(command) }],
        sentence: `${commandSentence(command)} declares an alias named ${quoted(alias)}.`,
      });
    }
  }
}

/**
 * The finding for the call that declared one alias on the Command at `path`: `visibleAlias()`,
 * rebuilt from every visible alias the Command holds, for a visible alias, and `alias()`, rebuilt
 * from every alias that is not visible, for any other.
 */
export function aliasFinding(
  command: {
    path: readonly string[];
    aliases: readonly string[];
    visibleAliases: readonly string[];
  },
  alias: string,
  note: string,
): Finding {
  const { aliases, path, visibleAliases } = command;
  const visible = visibleAliases.includes(alias);
  const declared = visible
    ? visibleAliases
    : aliases.filter((name) => !visibleAliases.includes(name));
  const call: AliasCall = visible ? 'visibleAlias' : 'alias';
  return { arguments: declared, call, mark: String(declared.indexOf(alias)), note, path };
}

/**
 * One call's names join the Command's aliases. An alias that repeats the Command's own name or an
 * alias it already holds adds no name, so it is skipped. A `visibleAlias()` call also makes each of
 * its names visible, one `alias()` declared first included, in the place `aliases` holds it.
 */
export function declareAlias<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  names: readonly string[],
  call: AliasCall,
): CommandState<Args, Options, Globals> {
  const { name } = state;
  checkAliasNames(name, names, call);
  const aliases = [...state.aliases];
  for (const alias of names) {
    if (alias !== name && !aliases.includes(alias)) {
      aliases.push(alias);
    }
  }
  const visible = new Set(
    call === 'visibleAlias' ? [...state.visibleAliases, ...names] : state.visibleAliases,
  );
  return { ...state, aliases, visibleAliases: aliases.filter((alias) => visible.has(alias)) };
}

/**
 * Extension layers remain open after inputs and the action have been fixed. Each layer is validated
 * at its own call, against every descriptor the declaration already names.
 */
export function declareExtensions<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  values: readonly unknown[],
): CommandState<Args, Options, Globals> {
  const descriptors = new Map(state.descriptors);
  const layer = validateLayer({
    declared: values,
    descriptors,
    site: { at: '', declaration: { arguments: values, call: 'extend', path: pathOf(state.name) } },
    subject: layerOf(state.name),
  });
  return { ...state, descriptors, extensions: extendStore(state.extensions, layer) };
}

/**
 * The same channel, read as the result the handler's own declaration names. The value one call
 * emits is checked where the action was authored, and the channel core hands an action accepts
 * whatever the routed declaration named, so this reading adds no promise the run does not keep.
 */
function declaredChannel<Result>(out: Out<OpenResult>): Out<Result> {
  return { ...out, results: (value) => out.results(value) };
}

/**
 * The handler is typed against the result its own declaration carries, and the state holds one
 * action for every declaration, so the context the handler receives is read back at the call.
 */
export function declareAction<Args, Options, Globals, Result, Stdin extends StdinContext, Provided>(
  state: CommandState<Args, Options, Globals>,
  handler: Action<Args, Globals & Options, Result, Stdin, Provided>,
  binds: {
    stdin: (source: Content | undefined, passthrough: string[]) => Stdin;
    provided: (values: BuiltValues) => Provided;
  },
): CommandState<Args, Options, Globals> {
  // The graph and the routed node stay getters, because a spread would build the graph on every run.
  const stored = (
    context: ActionContext<Args, Globals & Options, OpenResult, BuiltValues> & {
      passthrough?: string[];
    },
  ): unknown =>
    handler({
      args: context.args,
      cancel: context.cancel,
      get command() {
        return context.command;
      },
      get graph() {
        return context.graph;
      },
      host: context.host,
      interactive: context.interactive,
      invoke: context.invoke,
      log: context.log,
      onResume: context.onResume,
      onShutdown: context.onShutdown,
      onSuspend: context.onSuspend,
      options: context.options,
      out: declaredChannel(context.out),
      provided: binds.provided(context.provided),
      signal: context.signal,
      ...binds.stdin(context.stdin, context.passthrough ?? []),
      style: context.style,
      supplied: context.supplied,
    });
  return { ...state, action: stored };
}

/** The result declaration, which closes both result calls. */
export function declareResult<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  kind: 'value' | 'rows',
  declaration: { readonly views: Readonly<Record<string, ResultView>> },
): CommandState<Args, Options, Globals> {
  const call: ResultCall = { entries: viewEntries(declaration.views), kind };
  return { ...state, results: [...state.results, call] };
}

/** A `views()` call reshapes views and closes nothing. */
export function declareResultViews<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  replacements: Readonly<Record<string, ResultView>>,
  options: { readonly default?: string | undefined } | undefined,
): CommandState<Args, Options, Globals> {
  return { ...state, results: [...state.results, viewsCall(replacements, options)] };
}

/** One `views()` call as the results lane records it. */
export function viewsCall(
  replacements: Readonly<Record<string, ResultView>>,
  options: { readonly default?: string | undefined } | undefined,
): ResultCall {
  return { default: options?.default, entries: viewEntries(replacements), kind: 'views' };
}
