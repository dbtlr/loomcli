---
description: "The on<Event> lifecycle hooks: judging the built graph, failure hints, observing log events, and observing live regions."
---

# Lifecycle hooks

A lifecycle hook is a function on the plugin definition that core calls at one named point of an Application's life. Its name is `on` followed by the event, with the subject where it carries meaning: `onCommandAttach`, [`onGraphBuilt`](#judging-the-built-graph), [`onFailure`](#failure-hints), [`onLog`](#observing-log-events), [`onLiveRegions`](#observing-live-regions), and [`onEnvironment`](plugin-contract.md#environment-preparation). A hook runs in sequence at its point; middleware wraps an invocation and keeps its name for that reason. Contributions from a middleware into an action's context are direction, not contract, and wait for a plugin that needs them. Core has no hook before or after an action, or at the start or end of a run: an `'always'` [middleware](middleware.md) already runs code around every dispatched action, and each reported failure's exit code reaches `onLog` in its [failure event](logging.md). [ADR-0028](../decisions/0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) records the decision in its 2026-10-25 entry.

A new hook earns its place when it reaches a point no `'always'` middleware reaches and serves a use the log events do not. That entry rejected a run-start, a run-end, and a progress hook as second ways to do one job: a failure event already carries its exit code, an invocation's caller already receives its outcome, and a progress event reaches only the caller of its run. Symmetry with an existing hook is not a reason to add one.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onCommandAttach?: CommandAttachHook;
  // ...
}
type CommandAttachHook = (command: AttachedCommand) => AttachedCommand;

interface AttachedCommand {
  readonly [attachedCommand]: true; // an unexported unique symbol, the brand a Command carries under another name
  readonly name: string | null; // null for the root
  readonly path: readonly string[];
  readonly hasAction: boolean;
  readonly arguments: readonly string[]; // declared names, in order
  readonly options: readonly string[]; // declared local option names, in order
  readonly result: ResultNode | null; // as inspect() publishes it
  readonly extensions: Readonly<Record<string, unknown>>; // as inspect() would publish it at this hook
  argument(name: string, config: ArgumentConfig): AttachedCommand;
  option(name: string, config: OptionConfig): AttachedCommand;
  exclusive(...names: [string, string, ...string[]]): AttachedCommand; // the option-group calls, over local options
  oneRequired(...names: [string, string, ...string[]]): AttachedCommand;
  requiredTogether(...names: [string, string, ...string[]]): AttachedCommand;
  requires(option: string, ...needed: [string, ...string[]]): AttachedCommand;
  views<const R extends Readonly<Record<string, ResultView>>>(replacements: R, options?: { default?: keyof R & string }): AttachedCommand;
  extend(...values: readonly ExtensionValue<'command'>[]): AttachedCommand;
}
type ResultView = View<never> | RowView<never>; // the erased view a result names
```

```ts
// src/format/attach.ts, the hook of the @loomcli/plugins/format subpath
import type { AttachedCommand, CommandAttachHook } from '@loomcli/core';

import { formatName } from './names.js';
import type { FormatSettings } from './plugin.js';
import { json, jsonl } from './views.js';

const groupNames = ['json', 'jsonl'];

function attachToGroup(command: AttachedCommand, short: FormatSettings['short']): AttachedCommand {
  return command.option('format', {
    control: true,
    description: 'Select the output format.',
    hidden: true,
    ...(short === undefined ? {} : { short }),
    type: 'string',
    validate: formatName(groupNames),
  });
}

export function attachFormat(short: FormatSettings['short']): CommandAttachHook {
  return (command) => {
    const result = command.result;
    if (result === null) {
      return command.hasAction ? command : attachToGroup(command, short);
    }
    const machine = { json: json(), jsonl: jsonl() };
    const added = Object.entries(machine).filter(([name]) => !result.views.includes(name));
    const reshaped = command.views(Object.fromEntries(added));
    const names = [...result.views, ...added.map(([name]) => name)];
    return reshaped.option('format', {
      control: true,
      description: `Select the output format, ${result.default} by default.`,
      ...(short === undefined ? {} : { short }),
      type: 'string',
      validate: formatName(names),
    });
  };
}
```

The hook includes the declared default in its description, as specified by the [help restyle](../plugins/help.md#help-and-version-restyle), and leaves the view names to the help page's [accepted values](../plugins/help.md#accepted-values), which read them from the option's input schema.

- **When.** Graph build, once per Command, the root first and then each child depth first in authoring order; for each Command, every installed plugin's hook in installation order, each receiving what the previous returned. The author's result record passed the rules under [Result declaration errors](results.md#result-declaration-errors) at its own calls and at attach, so `result` is exact, and build runs those rules over what the hooks returned. A hook is synchronous and costs one call per Command on every build.
- **What it receives.** The declaration unlocked, with its types erased: the facts `inspect()` publishes, including the extension values, and the four calls above. Each call returns a new value whose facts include what the call added, so `result.views` inside the hook lists the names the hook's own earlier calls appended. `extensions` is the record `inspect()` would publish for the Command at that hook: the author's layers, then every value an earlier hook or this hook's earlier `extend()` calls added, each validated and frozen. `readExtension` reads it through a Command-target descriptor, as it reads a `CommandNode`. The author's layers were validated at the calls that declared them, so a hook never reads an unvalidated value, and an invalid value the author declared has thrown before any hook runs. A value passed to `extend()` is validated at the call: every rule under [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) that applies to a declaration's `extensions` applies there too, and it throws its `DeclarationError` from the call, which reports as itself. A hook that catches the throw continues, and the rejected value is not added. Only the value a hook returns carries its `extend()` values into the build, so a descriptor used in a call that threw, or in a value the hook discarded, registers nothing. Build stores the output validated at the call and runs no schema twice. The root arrives through the same surface with `name` `null`; `option()` on it declares a root-local option, and nothing declares a global. On a group, `option()` declares an option that reaches the plugin's own middleware alone, under [Nested Commands and groups](commands.md#nested-commands-and-groups), as the formatter's hidden `--format` on a group does. `result()`, `rows()`, `alias()`, `command()`, and `action()` are not published, because each changes what the action was compiled against or the graph's shape; a plugin attaches a Command to the root through its definition's [`commands`](plugin-contract.md#plugin-commands) instead.
- **What it returns.** The value it received or one derived from it by those calls. A hook that throws is a build fault, under [When author code fails](#when-author-code-fails). A returned value the hook's type rejects gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Types.** Nothing a hook adds reaches the action's types: a hook-declared option is in `options` at run time and absent from the typed `options`, and a middleware reads it through `request`, which is untyped for that reason. A rule the types reject for an author is reached by a hook's erased call and reported at build; a JavaScript author's value that bypasses the types gets no rule.
- **Rules.** A hook's calls are exempt from the four closures `action()` applies, to arguments, options, aliases, and children, and from nothing else. An input a hook declares whose key or spelling the Command, the Application's globals, another plugin's options, or another plugin's hook already use is the hook-collision error, naming the plugin and the Command; the rule reads across kinds, so a hook-declared argument collides with an option and a hook-declared option collides with an argument. `arguments` and `options` show the Command's own names, so a hook sees that case before it causes it, and the other three surface at build. Hooks compose in sequence, not first-in-wins: a later hook sees and can replace what an earlier one added, `views()` by name included, except that a value of a [collecting extension](extensions.md#collecting-extensions) joins the values before it and replaces none of them.
- **Names.** `AttachedCommand`, `CommandAttachHook`, and `ResultView` are exported.

## Judging the built graph

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onGraphBuilt?: GraphBuiltHook;
  // ...
}
type GraphBuiltHook = (graph: CommandGraph) => undefined;
```

```ts
// src/plugin.ts, a plugin that rejects a graph in which two Commands share one description
import { DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
import type { CommandNode, GraphBuiltHook, Plugin } from '@loomcli/core';

import { packageName } from './constants.js';

const sharedDescription = diagnosticRule(`${packageName}/shared-description`, {
  explanation: 'An agent tells two Commands apart by their descriptions, so each Command describes its own job.',
  headline: 'Two Commands share one description',
});

const walk = (node: CommandNode): readonly CommandNode[] => [node, ...node.children.flatMap(walk)];

const distinctDescriptions: GraphBuiltHook = (graph) => {
  const seen = new Map<string, CommandNode>();
  for (const node of walk(graph.root)) {
    const earlier = node.description === undefined ? undefined : seen.get(node.description);
    if (earlier !== undefined) {
      throw new DeclarationError(sharedDescription, {
        correction: 'Describe what each Command does in its own words.',
        sentence: `Commands "${earlier.path.join(' ')}" and "${node.path.join(' ')}" share one description.`,
      });
    }
    if (node.description !== undefined) {
      seen.set(node.description, node);
    }
  }
  return undefined;
};

export function distinct(): Plugin {
  return plugin(packageName, { onGraphBuilt: distinctDescriptions });
}
```

A plugin judges the whole built graph through `onGraphBuilt`, and it may reject the graph. It never contributes: it cannot attach a Command, rewrite a fact, or store what it derives. [ADR-0060](../decisions/0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md) records the decision.

- **When.** Once per graph build, after every `onCommandAttach` hook has run, after the build rules over what those hooks returned, and after the graph is frozen: on every `run()`, every `inspect()`, and every [`app.invoke()`](invocation.md#invocation-by-name). An action's `invoke` reuses its run's graph, so it runs no hook again. Every installed plugin's hook runs in installation order, and each receives the same graph. A `run()` reaches it before it validates declared defaults and implied values.
- **What it receives.** The frozen `CommandGraph` [`inspect()`](graph-inspection.md) returns for that build, extension values included: the same object the run's middleware, actions, and `onFailure` hooks read. The hook is synchronous and is not told which call built the graph.
- **What it returns.** `undefined`. To reject the graph, it throws a `DeclarationError`, which reports as itself: a build fault, exit 1, with its Developer Diagnostic in a [development build](release-facts.md#development-builds) and the generic defect message in a distributed one. The first hook that throws ends the build, and no later hook runs. Any other throw is a build fault, under [When author code fails](#when-author-code-fails). A returned value the hook's type rejects, a promise included, gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Types.** The return type is `undefined`, so a hook written as an arrow with no `return`, or one that returns `undefined`, compiles, and one that returns a value or a promise is a compile error.
- **Rules.** The graph is frozen, except the declared defaults and input schemas [graph inspection](graph-inspection.md) names, and its types are read-only, so a hook changes nothing about the build: a later hook, the run, and every projection read the graph the hooks received. A fault the hook reports is a build fault like a fault of `onCommandAttach`, so no `onFailure` hook runs for it, its `path` is `[]`, and an `inspect()` call throws it. A plugin that needs data derived from the graph derives it where it reads it, as the [MCP](../plugins/mcp.md) plugin builds its tool table in its own action.
- **Cost.** A plugin that implements the hook makes every build produce the frozen graph, so every validated input's [schema converter](validation.md#input-schema), and the configuration source's schema converter under [Input sources](input-sources.md), runs once per run, as it does on a run that has a middleware chain.
- **Names.** `GraphBuiltHook` is exported.

## Failure hints

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onFailure?: FailureHook;
  // ...
}
type FailureHook = (failure: Readonly<LoomError>, context: FailureHookContext) => string | readonly string[] | undefined;

interface FailureHookContext {
  readonly application: string;
  readonly path: readonly string[];
  readonly invokedBy: 'argv' | 'name'; // the value the failure view reads
  readonly view: string | undefined; // the selection the failure view reads
  readonly mediaType: string | undefined;
  readonly style: ContextualStyle;
  readonly graph: CommandGraph;
  readonly command: CommandNode;
  readonly log: Log; // see Logging
}
```

```ts
// src/plugin.ts, a plugin that suggests a declared spelling for a mistyped option
import { plugin, UnknownOptionError } from '@loomcli/core';
import type { FailureHook, Plugin } from '@loomcli/core';

import { packageName } from './constants.js';
import { nearest } from './nearest.js';

const suggestOption: FailureHook = (failure, { command, graph, style }) => {
  if (!(failure instanceof UnknownOptionError)) {
    return undefined;
  }
  const offered = [...graph.globals, ...command.options].filter(
    (option) => !option.hidden && option.deprecated === undefined,
  );
  const spellings = offered.flatMap((option) => (option.long === null ? [] : [option.long]));
  const match = nearest(failure.spelling, spellings);
  return match === undefined ? undefined : `${style.escape(failure.spelling)}: did you mean ${match}?`;
};

export function suggest(): Plugin {
  return plugin(packageName, { onFailure: suggestOption });
}
```

A hint is a line a plugin adds under a failure message. Plugins add hints to a failure and never replace each other's views; the failure's view receives them under [Failure view context](failure-views.md#failure-view-context). [ADR-0046](../decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the decision.

- **Streamed messages.** A streamed message's [unfinished row](output.md#a-streamed-message) and a streamed `print`'s unfinished line on a terminal count as a region's frame does, because a write core cannot see tears them as it tears a frame. An unfinished row holds the span from the write that first draws it until the write that finishes it or takes it off the screen, and an unfinished line from the write that leaves a line unfinished at the cursor until the write that ends that line. A run whose only redrawn content is a streamed message opens a span for it, and a streamed `print` that writes several lines opens and closes one for each line it leaves unfinished between chunks.
- **When.** Core calls each installed plugin's hook, in installation order, for each failure a run renders after graph build, whether `run()` or `invoke()` started it, before it calls that failure's view: the primary failure, and each fault reported after it, with calls of its own. A declared default or implied value its validator rejects is such a failure, because the graph has built. No hook runs for a declaration fault raised at graph build or for a failure raised before build, because no valid graph exists; a plugin's overrides are not consulted for a build fault either. No hook runs where nothing renders: a takeover such as `--help` never raises the held fault, and a cancelled run reports its own cancellation silently under [Signals, cancellation, and shutdown](signals.md). A failure a cancelled run still renders receives hints like any other. No hook runs for a line the plain fallback path writes.
- **What it receives.** The failure instance as the run caught it, typed `Readonly<LoomError>` as a failure view receives its failure, and the context above. The guarantee is the type's: core neither freezes nor copies the failure, so a JavaScript hook that assigns to it, `message` included, steps outside the contract, and the view may render what it assigned. A hook cannot catch or suppress the failure, and a working hook cannot change the exit code, because core reads the code before any hook runs. `application`, `path`, `invokedBy`, `view`, and `mediaType` are the values the failure view reads, so a hook that points at a command line returns no hint for an [invocation by name](invocation.md#invocation-by-name), and a hook reads the run's selection when it failed. `style` is the contextual style for stderr, so a hook escapes text the operator typed, such as `failure.spelling` or `failure.token`, with `style.escape()` before interpolating it. `graph` is the frozen graph [`inspect()`](graph-inspection.md) returns for this run, and `command` is the node at `path` inside it: the root when `path` is empty, the last Command the partial path reached for an unknown Command, and the routed node otherwise, so `command.path` equals `path`. They are the values an action and a middleware read under [ADR-0041](../decisions/0041-every-action-reads-the-frozen-graph-and-its-routed-command.md), and reading either builds the run's graph once.
- **What it returns.** A string is one hint, a readonly array is one hint per element in order, and `undefined` or `[]` contributes none. Each hint is marked text that core resolves for stderr as it resolves view output. Core keeps every string as returned and neither trims, filters, nor deduplicates, so an empty string prints an empty line and a line break inside a hint is written as it is.
- **Order.** Hints keep installation order, and each hook's strings keep their own. Each hook receives the failure and its context alone and never another hook's hints, so no plugin removes or rewords another's, and two plugins that return the same line print it twice.
- **Candidates.** A hook that suggests a name reads its candidates from the graph: `graph.globals` and `command.options` for an option spelling, and `command.children` for a Command name. It leaves out what [completion](../plugins/completion.md) leaves out, by the node facts: a hidden or deprecated member, and every alias, since a child's `name` is its canonical name. `UnknownOptionError` carries no accepted spellings, and `candidates` on the routing errors leaves out hidden and deprecated children, the same rule. A hint adds a line; a plugin that wants the near match inside the sentence itself overrides the failure's view, as the [suggestions](../plugins/suggestions.md) plugin does.
- **Plugins alone.** The hook is on the plugin definition alone, as `onCommandAttach` is. An application that wants a hint of its own writes an override that prints it, or installs a small local plugin.
- **Names.** `FailureHook`, `FailureHookContext`, and `InvokedBy` are exported.

## Observing log events

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onLog?: LogHook;
  // ...
}
type LogHook = (event: LogEvent, destination: LogDestination) => undefined;

interface LogDestination {
  readonly env: Readonly<Record<string, string | undefined>>; // the outermost run's host.env
  readonly home: string; // the outermost run's host.home
  readonly platform: string; // the outermost run's host.platform
  readonly stderr: Writable | null; // the outermost run's host.stderr; null under app.invoke
}
```

```ts
// src/plugin.ts, a plugin that prints the stack of each defect a run logs
import { plugin } from '@loomcli/core';
import type { LogHook, Plugin } from '@loomcli/core';

import { packageName } from './constants.js';

const printStack: LogHook = (event, destination) => {
  if (event.defect?.stack !== undefined && destination.stderr !== null) {
    destination.stderr.write(`${event.defect.stack}\n`);
  }
  return undefined;
};

export function stacks(): Plugin {
  return plugin(packageName, { onLog: printStack });
}
```

A plugin observes the run's [log events](logging.md) through `onLog`, and decides what becomes of them: the [logging plugin](../plugins/logging.md) writes them as records, and another plugin may forward, count, or drop them. [ADR-0069](../decisions/0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) records the decision.

- **When.** Core calls each installed plugin's hook, in installation order, inside the `log` call or the failure report that created the event, before that call returns. Every hook receives the same frozen event and never another hook's work. Events of an action's `invoke` reach the same hooks.
- **What it receives.** The event, and the destination of the outermost run. Under `run()` that is its host's `env`, `home`, `platform`, and `stderr`. Under an action's `invoke`, every [MCP](../plugins/mcp.md) tool call included, it is the parent run's, because a nested run's stderr is a capture sink. Under [`app.invoke`](invocation.md#invocation-by-name) it is the `env`, `home`, and `platform` the call captured from its process handle, and `stderr` is `null`, because an invocation by name writes to no process stream. A hook writes to `destination.stderr`, never to `process.stderr` or into a run's captured output, so an invocation's captured `messages` and an MCP tool result never hold a record. A hook reads `destination.env`, never `process.env`, so the `env` of the run's process handle reaches it.
- **What it returns.** `undefined`. A hook observes: it cannot change the event or stop its delivery to a later hook, and a working hook cannot change the run's outcome; one that throws fails the run, under [When author code fails](#when-author-code-fails). Work it starts, a promise included, is its own, and core neither waits for it nor tracks it.
- **Types.** The return type is `undefined`, so a hook written as an arrow with no `return` compiles, and one that returns a value or a promise is a compile error.
- **Plugins alone.** The hook is on the plugin definition alone. An application that wants to observe its own events installs a small local plugin.
- **Names.** `LogHook` and `LogDestination` are exported.

## Observing live regions

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  onLiveRegions?: LiveRegionsHook;
  // ...
}
type LiveRegionsHook = (state: 'drawn' | 'closed', context: LiveRegionsHookContext) => undefined;

interface LiveRegionsHookContext {
  readonly out: Out; // the run's channel with the default destinations, as a middleware's
}
```

```ts
// src/plugin.ts, a plugin that routes a dependency's logger above the live regions while one is drawn
import { plugin } from '@loomcli/core';
import type { LiveRegionsHook, Plugin, View } from '@loomcli/core';

import { packageName } from './constants.js';
import { logger, writeToStderr } from './logger.js'; // the dependency's logger writes each line through logger.sink

const literal: View<string> = { render: (line, { style }) => style.escape(line) };

const routeLogger: LiveRegionsHook = (state, { out }) => {
  logger.sink =
    state === 'drawn'
      ? (line) => {
          void out.error(line, literal);
        }
      : writeToStderr;
  return undefined;
};

export function routedLogger(): Plugin {
  return plugin(packageName, { onLiveRegions: routeLogger });
}
```

A write that does not pass through core lands where the cursor is, inside a frame, because core cannot see it, under [Live region](output.md#live-region). A plugin that can move such a write onto `out` needs to know when a frame is on the stack, wherever its region was opened. `onLiveRegions` tells it: core calls the hook with `'drawn'` when the run's first region draws a frame, or a [streamed message](output.md#a-streamed-message) first puts an unfinished row or line on the screen, and with `'closed'` when none is left, and between the two calls `out` writes above the regions and the unfinished rows, and after an unfinished line. The [patch-console plugin](../plugins/patch-console.md) is its first user. [ADR-0156](../decisions/0156-onliveregions-tells-a-plugin-when-a-runs-live-regions-first-hold-a-frame-and-when-none-does.md) records the decision.

- **What it observes.** Every live region of the run, wherever it was opened: by the action, by a middleware, by a configuration source, or by a library that draws through one of their `out` channels, such as a [question](../libs/prompts.md) or a [progress line](../libs/prompts.md#progress). A region holds a frame from the write of its first frame until the write that moves its last frame into scrollback. While an [input region](output.md#live-region) or a [lend](output.md#lending-the-terminal) holds the other frames, a region still holds its frame, and a region that closes meanwhile holds its last frame until that frame moves into scrollback, when the input region closes or the lend ends. A region whose `live` reads `false` never holds a frame, and neither does a region that never draws. A frame `out.draw` writes is not a region's frame: core writes it above the open regions as it writes every other write, and its caller erases it, so it opens no span and calls no hook.
- **When.** Core calls each installed plugin's hook, in installation order, with `'drawn'` at the write that gives a region of the run a frame while no region of the run holds one, and with `'closed'` at the write after which no region of the run holds a frame. A span runs from one point to the other, and each `'drawn'` is followed by one `'closed'` before the next `'drawn'`, so a run that closes its last region and later draws in another calls each hook `'drawn'`, `'closed'`, `'drawn'`, `'closed'`.
- **In stderr's write order.** Both points are writes, not calls, and a streamed `print`'s line on stdout takes its points in stdout's write order: a frame takes its place in stderr's write order at the `draw` call and is written when every write queued before it has been written, as [Live region](output.md#live-region) states. Core calls the `'drawn'` hooks in the same synchronous step as the frame's write, before its bytes, and the `'closed'` hooks in the same synchronous step as the closing write, after its bytes. No other code runs between a `'drawn'` hook and the frame's bytes, and once a `'closed'` hook has returned, a write that does not pass through core reaches the terminal after the last frame has left the stack. The promise `draw` returns resolves after the `'drawn'` hooks ran, and the promise `end` returns after the `'closed'` hooks ran, when that close ended the span.
- **Several regions.** Frames of several regions, open at once or overlapping one after another, make one span: `'drawn'` comes with the first frame, and `'closed'` once the last of them has left the stack. A region that draws while another holds a frame calls no hook, and neither does a region that closes while another still holds one.
- **An invocation by name.** A run that [`invoke`](invocation.md#invocation-by-name) starts has no terminal, so none of its regions is live and it calls no hook, whether an action's `invoke` or `app.invoke` started it. A frame the parent run's region holds while its action awaits the call stays on the stack, so the parent's span stays open across the call.
- **A stream that is not a terminal.** When stderr is not a terminal, no region is live and no unfinished row is drawn, so the run calls no hook unless a streamed `print` leaves a line unfinished on a terminal stdout. On a terminal under `CI`, and at verbosity -1, a region opened without `input: true` is not live, so only an input region, such as a question's, opens a span there. Under `TERM=dumb` and with the [plain switch](output.md#the-plain-switch) on, no region is live, an input region included, so the run calls no hook. Stdout takes no part: a run whose stdout is a pipe and whose stderr is a terminal calls the hooks as any other.
- **Failure and cancellation.** Before core renders a failure report, it closes every open region with `'failure'`, so a failing run calls `'closed'` with the write that moves the last of those frames into scrollback, and the report's bytes follow it. When the run's signal aborts, core closes every region with `'cancellation'` at once, and `'closed'` comes with the write after which none holds a frame. At a [shutdown](signals.md#the-shutdown)'s end, core writes every write still queued on the run's stdout and stderr, region frames and messages alike, in the order they were queued, under [At the process's end](output.md#at-the-processs-end); a run whose span is still open then calls `'closed'` in that step, after those bytes, before core calls the `onShutdown` handlers, even when the budget has run out. The process's own `exit` event, which writes the run's queue as a shutdown's end does, calls `'closed'` the same way, so a hook that restores what it changed at `'closed'` does so after every text it moved onto `out` has been written. That step calls no hook while it writes: a frame it writes while no span is open, such as a region's first frame queued just before the end, opens none and calls no `'drawn'`, and a span already open gets its one `'closed'` after the step's last bytes. A write a hook issues at that `'closed'` call is queued after the step and is not written at that end.
- **The run's end.** No span outlives its run. A run that finishes its output while a region still holds a frame, because stderr failed and the closing write never reached it, calls `'closed'` then, before `run()` resolves.
- **What it receives.** The state, and the run's context, which is the same object at every call of one run, so a plugin tells two runs apart by it. `out` is a channel of the run with the default destinations on every Command, as a [middleware](middleware.md)'s `out` is: `print` and `render` write to stdout on a Command that declares a result too, `results` takes a `never` argument, and a region opened through it closes as a middleware's does, once the chain has unwound. A write through it follows the [output](output.md) contract. It lands above the regions on stderr, and on stdout when stdout is a terminal too. It resolves under the run's rendering policy, a semantic method writes at the verbosity its level states, and the run waits for it before it ends.
- **What it returns.** `undefined`. A hook observes: it cannot hold back the write it came with, change a frame, or stop the delivery to a later hook. Work it starts, a promise included, is its own, and core neither waits for it nor tracks it.
- **Types.** The return type is `undefined`, so a hook written as an arrow with no `return` compiles, and one that returns a value or a promise is a compile error.
- **Every run on its own.** Each run calls the hooks for its own regions alone, so two runs that draw at once in one process, such as two tests that run concurrently, each call `'drawn'` and `'closed'` with their own context. Core keeps no span across runs.
- **Why a hook.** It reaches points no `'always'` middleware reaches. A middleware's `out` sees only the regions it opens itself, a region's handle reaches only the code that opened it, and a configuration source draws before any middleware runs. It is not the progress hook the 2026-10-25 entry of [ADR-0028](../decisions/0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) rejected: it carries no [progress event](output.md#progress-events), a region that never reports opens a span, and it is called under `run()`, where nothing observes a progress event.
- **Plugins alone.** The hook is on the plugin definition alone. An application that wants to act on its own spans installs a small local plugin.
- **Names.** `LiveRegionsHook` and `LiveRegionsHookContext` are exported.

## When author code fails

A lifecycle hook that throws takes the [ordinary failure path](failures.md#the-ordinary-failure-path) unless a rule below says otherwise, and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A value a hook returns that its type rejects, a promise included, gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). An `onEnvironment` hook's throw takes the ordinary failure path, under [Environment preparation](plugin-contract.md#environment-preparation).

- **`onCommandAttach`.** A hook that throws is a build fault under [`@loomcli/core/broken-attach-hook`](diagnostics.md#loomclicorebroken-attach-hook), which names the plugin and the Command and keeps the thrown value as its `cause`. A thrown `DeclarationError` reports as itself.
- **`onGraphBuilt`.** A hook that rejects the graph throws a `DeclarationError`, which reports as itself. Any other throw is a build fault under [`@loomcli/core/broken-graph-hook`](diagnostics.md#loomclicorebroken-graph-hook), which names the plugin and keeps the thrown value as its `cause`. The first hook that throws ends the build, and no later hook runs.
- **`onFailure`.** A hook that throws ends the hooks for that failure: core calls no later hook, and no hook's hints reach the report. Core writes the failure's default text through the plain fallback path a broken failure view takes, which calls no view, override, or encoder, then reports the hook's throw as a foreign throw from the hook's code, an `InternalError` under [`@loomcli/core/foreign-throw`](diagnostics.md#loomclicoreforeign-throw) whose `cause` is the throw: a distributed build writes the generic defect message, at most once per run, and a development build writes its Developer Diagnostic, whose sentence is the throw's reason, escaped onto one line as [`escapeControlCharacters`](styles.md#strings-and-composition) writes it, and whose cause chain names the hook's file and line. For a defect, the failure's default text is its Developer Diagnostic in a development build and the generic defect message in a distributed one. The run returns 1 whichever code the failure carried, except in a cancelled run, which keeps its signal's code and still writes the report.
- **`onLog`.** A hook that throws stays installed: core still calls it for every later event of the run, and the throw ends neither the delivery of that event to a later hook nor the `log` call that created it. Core reports the first throw of the run once, after the run's outcome and every other report, through the ordinary failure path, as a foreign throw from the hook's code: an `InternalError` under [`@loomcli/core/foreign-throw`](diagnostics.md#loomclicoreforeign-throw) whose `cause` is the throw, its failure view and `onFailure` hooks run as for any failure, and it logs its own failure event. A throw a hook raises later, such as one on that report's own event, is not reported. A distributed build writes the generic defect message, at most once per run, and a development build writes the defect's Developer Diagnostic. The run returns 1, whichever code it would have returned, except a cancelled run, which keeps its signal's code and still writes the report.
- **`onLiveRegions`.** A hook that throws stays installed: core still calls it at every later point of the run, and the throw ends neither the write it came with nor the delivery to a later hook. Core reports the first throw any `onLiveRegions` hook raised in the run once, after the run's outcome and every other report, an `onLog` hook's first throw included, as it reports that one: an `InternalError` under [`@loomcli/core/foreign-throw`](diagnostics.md#loomclicoreforeign-throw) whose `cause` is the throw, through the ordinary failure path, with exit 1, except a cancelled run, which keeps its signal's code and still writes the report. A throw raised after that point is dropped, because no report follows it: one at the close of a region nothing closed before the run's last reports, at the run's end once stderr failed, at a shutdown's end, or at the process's exit.
