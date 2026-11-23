import { commandSubject } from '../failures/wording.js';
import type { InputDeclaration } from '../inputs/declarations.js';
import type { SpellingTable } from '../inputs/options.js';
import { tableEntries } from '../inputs/options.js';
import type { Action, StdinContext } from '../invocation/types.js';
import type { OpenResult } from '../output/types.js';
import { buildExtensions, publishStore } from '../plugins/extension.js';
import type { ExtensionRecords } from '../plugins/extension.js';
import type { BuiltPlugin } from '../plugins/plugin.js';
import type { BuiltValues } from '../plugins/providers.js';
import { runAttachHooks, applyAttachCalls, checkAttachedInputs } from './attach-hooks.js';
import type { CommandPlace } from './attach.js';
import { checkFinished, rootedPlacement } from './attach.js';
import type { BuiltGlobals, GlobalsState } from './globals.js';
import { buildGlobals } from './globals.js';
import {
  checkArgumentName,
  slotOf,
  checkSlotOrder,
  inputSite,
  checkStdinClaims,
  checkCompiledOptions,
  localScope,
} from './inputs.js';
import type { Declared, CommandState } from './state.js';
import { layerOf } from './subjects.js';
import type {
  ArgumentSlot,
  DispatchInput,
  BuildContext,
  BuiltCommand,
  RoutedChild,
} from './types.js';
/**
 * The positional slots one declaration holds. Every authored argument answered these rules at its
 * own call, so they throw here only for an argument a lifecycle hook declared.
 */
function collectArguments(state: Declared, command: CommandPlace): ArgumentSlot[] {
  const slots: ArgumentSlot[] = [];
  const declared: InputDeclaration[] = [];
  const judged = { ...command, subject: commandSubject(command.name) };
  for (const input of state.inputs.filter((entry) => entry.kind === 'argument')) {
    checkArgumentName(judged, declared, input);
    declared.push(input);
    slots.push(slotOf(input));
  }
  for (let index = 0; index + 1 < slots.length; index += 1) {
    const slot = slots.slice(0, index + 1).find((entry) => entry.variadic) ?? slots[index];
    const next = slots[index + 1];
    if (slot && next) {
      checkSlotOrder(slot, next, judged);
    }
  }
  return slots;
}

/** Binds one Command's declarations to its action, so an action reads only validated values. */
function bindDispatch<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  action: Action<
    Args,
    Globals & Options,
    OpenResult,
    StdinContext & { passthrough?: string[] },
    BuiltValues
  >,
  globals: BuiltGlobals,
) {
  return ({
    cancel,
    onResume,
    onShutdown,
    onSuspend,
    interactive,
    supplied,
    command,
    graph,
    host,
    invoke,
    log,
    out,
    passthrough,
    provided,
    signal,
    style,
    stdin,
    values,
  }: DispatchInput) => {
    const bound = state.bind(values);
    // Last resort: no typed path exists.
    // The graph erases the binder's generic relationship.
    // It holds because attachment checks the global output requirement.
    // The call or the attach that met both options rejected a collision between a global and a local.
    // This binder returns the validated value of every global option, the plugins' included.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const globalOptions = globals.bind(values) as Globals;
    return action({
      args: bound.args,
      cancel,
      get command() {
        return command();
      },
      get graph() {
        return graph();
      },
      host,
      interactive,
      invoke,
      log,
      onResume,
      onShutdown,
      onSuspend,
      options: { ...globalOptions, ...bound.options },
      out,
      passthrough,
      provided,
      signal,
      stdin,
      style,
      supplied,
    });
  };
}

/**
 * The extension values of each input a lifecycle hook declared, which the calls that declared the
 * author's inputs already validated.
 */
function checkInputFacts(
  inputs: readonly InputDeclaration[],
  command: { name: string | null; subject: string },
  context: BuildContext,
): void {
  const { name, subject } = command;
  for (const input of inputs) {
    const site = inputSite(name, context.path, input);
    const sentence = site.subject;
    context.extensions.set(
      input,
      buildExtensions({
        declared: input.config.extensions,
        descriptors: context.descriptors,
        site: { ...site, at: '1.extensions' },
        subject: { phrase: `on ${subject} ${input.kind} "${input.name}"`, sentence },
      }),
    );
  }
}

/**
 * Compiles one declaration for dispatch against the shared globals table. Every authored rule threw
 * at the call or the attach that first held its data, so what can still fail here is the root's
 * finished-Command rules, the root never being attached, and whatever the lifecycle hooks
 * contributed.
 */
export function buildCommand<Args, Options, Globals>(
  state: CommandState<Args, Options, Globals>,
  context: BuildContext,
): BuiltCommand {
  const { action, facts, name } = state;
  const { globals } = context;
  const subject = commandSubject(name);
  const layer = layerOf(name);
  for (const [input, record] of state.records) {
    context.extensions.set(input, record);
  }
  const place: CommandPlace = { name, path: context.path };
  const declaredSlots = collectArguments(state, place);
  const hasAction = action !== undefined;
  /**
   * The hooks run once the author's declaration is complete, and each value a hook receives resolves
   * its result, so a hook reads an exact record. Every rule below reads what the hooks returned.
   */
  const progress = runAttachHooks(
    { declared: state, extensions: state.extensions, layer, registry: context.descriptors },
    { hasAction, path: context.path },
    context.plugins,
  );
  const { calls } = progress;
  // The descriptors the returned value's extensions registered join the build's registry.
  for (const [identity, descriptor] of progress.registry) {
    context.descriptors.set(identity, descriptor);
  }
  const hooked = applyAttachCalls(state, calls);
  const hookInputs = calls.filter((call) => call.kind === 'input');
  checkStdinClaims(
    hooked.inputs,
    { path: context.path, stdin: hooked.stdin },
    new Map(hookInputs.map(({ input, identity }) => [input, identity])),
  );
  checkInputFacts(
    hookInputs.map((call) => call.input),
    { name, subject },
    context,
  );
  // The hook-declared names are checked first, so a collision reports in the plugin's voice.
  // A rule the author's own declaration voices never speaks for a name a hook declared.
  checkAttachedInputs(hooked, hookInputs, { globals, path: context.path });
  // Every value was validated once, the author's at each call and each hook's at its `extend()`.
  const extensions = publishStore(progress.extensions);
  const slots = hookInputs.length > 0 ? collectArguments(hooked, place) : declaredSlots;
  const result = checkFinished(hooked, hasAction, { path: context.path });
  const options = checkCompiledOptions(hooked.inputs, globals, localScope(name, context.path));
  const table: SpellingTable = new Map([...tableEntries(options, false), ...globals.table]);
  const children = new Map<string, BuiltCommand>();
  const routes = new Map<string, RoutedChild>();
  for (const child of state.children) {
    const routed: RoutedChild = {
      command: child.node.build({
        ...context,
        path: [...context.path, child.name],
        placement: rootedPlacement(place, child),
      }),
      name: child.name,
    };
    children.set(routed.name, routed.command);
    routes.set(routed.name, routed);
    for (const alias of routed.command.aliases) {
      routes.set(alias, routed);
    }
  }
  return {
    aliases: state.aliases,
    arguments: slots,
    attachedBy: new Map(hookInputs.map(({ identity, input }) => [input, identity])),
    children,
    declarers: new Map(hookInputs.map(({ identity, input }) => [input, identity])),
    deprecated: facts.deprecated,
    description: facts.description,
    dispatch: action ? bindDispatch(hooked, action, globals) : undefined,
    extensions,
    hidden: facts.hidden,
    inputs: hooked.inputs,
    name,
    needsTerminal: state.needsTerminal === true,
    optionGroups: hooked.optionGroups,
    passthrough: state.passthrough,
    placement: context.placement,
    result,
    routes,
    stdin: state.stdin,
    table,
    uses: state.uses,
    visibleAliases: state.visibleAliases,
  };
}

/** One built graph: the shared globals table, the root Command, and the facts each node carries. */
export interface BuiltGraph {
  extensions: ExtensionRecords;
  globals: BuiltGlobals;
  root: BuiltCommand;
  /**
   * The plugin whose `commands` list contributed each of the root's Commands, by the Command's
   * name. It is kept beside the root, so nothing a hook, `inspect()`, or help reads holds it, and an
   * action under one of these Commands logs as that plugin (ADR-0165).
   */
  listedBy: ReadonlyMap<string, string>;
}

/**
 * The globals table compiles once per build and the whole graph shares it. The root's registry
 * holds every descriptor the Application names, so a hook's `extend()` call meets all of them.
 */
export function buildGraph<Args, Options, Globals>(
  root: CommandState<Args, Options, Globals>,
  globals: GlobalsState,
  plugins: readonly BuiltPlugin[],
): BuiltGraph {
  const extensions: ExtensionRecords = new Map([
    ...globals.records,
    ...plugins.flatMap((installed) => [...installed.records]),
  ]);
  const context: BuildContext = {
    descriptors: new Map(root.descriptors),
    extensions,
    globals: buildGlobals(globals, plugins),
    path: [],
    placement: undefined,
    plugins,
  };
  const listedBy = new Map(
    plugins.flatMap(({ commands, identity }) => commands.map(({ name }) => [name, identity])),
  );
  return { extensions, globals: context.globals, listedBy, root: buildCommand(root, context) };
}
