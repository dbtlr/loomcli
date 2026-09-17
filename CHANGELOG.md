---
description: Published library release history and migration instructions for breaking changes.
---

# Changelog

Release history starts with the first library release. Pending changes live in [.changes/](.changes/README.md).

## v0.3.0 - 2026-09-17

0.3.0 adds typed Command results with table, records, JSON, and JSON Lines views. Semantic styles, view overrides, and the Loom theme let applications customize output, help, and diagnostics.

Pin both `@loomcli/core` and `@loomcli/plugins` to `0.3.0`. The migrations below cover Application registration, rendering and view overrides, result and context fixtures, middleware validation order, and help output.

### Breaking Changes

- Restore automatic Application global types in independently authored Commands and extracted actions through one shallow `Register.environment` augmentation.
- Replace `GlobalOptions` and constructor `globals` configuration with `Application.globalOption(name, config)`. The Application supplies validated global values to every action.
- Add immutable `Command.extend()` and `Application.extend()` calls that remain available after action registration. A later value replaces the complete earlier value from the same descriptor.

### Migration

**Affected surface.** `GlobalOptions`, constructor `globals` options on Application and Command, explicit global type arguments on either constructor, `CommandOptions<Globals>`, `ApplicationOptions<Globals>`, and TypeScript Commands whose actions read Application globals.

**Why.** Application ownership should require one declaration, with global types available throughout its compiler project.

**Before and after.**

Before:

```ts
const globals = new GlobalOptions().option('file', { required: true, type: 'string' });
const read = new Command('read', { globals }).action(handler);
const app = new Application('app', { globals }).command(read);
```

After, in the Application module:

```ts
import type { EnvironmentOf } from '@loomcli/core';

const configured = new Application('app')
  .globalOption('file', { required: true, type: 'string' });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}
const app = configured.command(read);
```

The Command module now uses `new Command('read').action(handler)` without importing globals.

**Steps.**

1. Replace each `GlobalOptions.option()` declaration with `Application.globalOption()`. Remove the `GlobalOptions` import, the separate globals value, and constructor `globals` properties. Remove global type arguments from both constructors and from `ApplicationOptions`; use `CommandOptions` without a type argument.
2. Declare all global options before the first `command()` or `action()` call. Register that configured Application value.
3. Include the registration module in that application's TypeScript project. Use separate projects for applications with different registrations; reusable libraries omit consumer registration.
4. To customize an imported Command, derive `command.extend(extensionValue)` and attach the returned value. Keep a self-typed extracted handler's original initializer ending in `action()`.

**Validation.** Run the application's TypeScript check and invocation tests. Confirm detached actions infer global schema outputs, unknown keys fail, and existing global CLI spellings still reach their actions. See the [SDK reference](docs/core.md#modular-authoring).

- Add composable `style`, independent `glyph`, deferred `pad`, and a destination-aware `ViewContext` on Node and Bun.
- Add one optional theme contribution with inferred custom names and the `theme(mapping)` and `loomTheme(overrides?)` factories at `@loomcli/plugins/theme`.
- Resolve view and semantic output under configurable color, modifier, hyperlink, and terminal-control policies. Add glyph gutters to `info`, `success`, `warn`, and `error`.

### Migration

**Affected surface.** View output, semantic output snapshots, embedded ANSI, marker-bearing raw data, complete `Host` values, and hand-built `ActionContext` values. Action contexts now require `style`.

**Why.** Core now resolves marked output for the destination. The write site owns the newline, while core controls terminal capabilities and prevents formatting from leaking across calls. `out.render` and a failure diagnostic add none, so a view rendered through either owns its trailing newline; a semantic method appends one after its lane view, so a lane view returns none.

**Before and after.**

Before:

```ts
const view = { render: (name: string) => `${name}\n` };
```

After, preserve raw data literally:

```ts
import type { View } from '@loomcli/core';

const fileName: View<string> = {
  render: (name, { style }) => `${style.escape(name)}\n`,
};
```

Previously `out.info('ready')` wrote `ready\n`. It now writes `ℹ ready\n` with main glyphs, or `i ready\n` with compatibility glyphs. `out.print('ready')` remains prefix-free.

Before, a unit test could call `action(context)` with no `style` member. For an unthemed fixture, import `style` from `@loomcli/core` and call `action({ ...context, style })`. To test Application theme mappings, invoke the action through `Application.run()` so core supplies the configured style.

**Steps.**

1. Escape raw values before interpolating them into authored output. Preserve existing marked messages without another escape pass.
2. Update semantic-output snapshots for glyph gutters and continuation indentation. `out.render` still adds no newline, and each semantic method still appends exactly one.
3. Review embedded ANSI. Automatic policies evaluate each destination; other terminal controls default to stripping. Use `rendering: { terminalControls: 'preserve' }` for intentional complete terminal commands. Color, modifiers, and hyperlinks each accept `auto`, `always`, or `never`. Incomplete commands are always discarded.
4. Add a `platform` string to complete `Host` values. Partial run overrides can omit it and use process capture.
5. Optionally install `theme(mapping)` or `loomTheme(overrides?)` and include the shallow Application registration in the TypeScript project to expose custom names.
6. Add `style` to hand-built action contexts, including values derived from `Parameters<ActionHandler<typeof command>>[0]`.

**Validation.** Run the application's TypeScript check and output tests under Node and Bun. Compare redirected and terminal output, `NO_COLOR=1`, `TERM=linux`, and multiline messages. Use `width(style.escape(value))` to verify literal data alignment. See the [style reference](docs/core.md#styles-and-rendering-policy) for policy precedence and glyph selection.

- Add one view registry for every rendered byte. `view(identity, definition)` declares a view, `override(key, view)` pairs a declared view or a failure class with a replacement, and both an Application and a plugin list them under `views`.
- Add `lanes`, the five declared views behind `print`, `info`, `success`, `warn`, and `error`. An override of a lane view owns the glyph gutter, and the semantic method still appends one newline.
- Add `helpPage` at `@loomcli/plugins/help/views` and `versionLine` at `@loomcli/plugins/version/views`, so an application brands the help page or the version line while the plugin stays installed.
- Remove the `failures` option, `renderFailure`, `FailureRenderer`, `Renderer`, and `RendererContext`. `Renderer` is now `View` and `RendererContext` is now `ViewContext`.
- Change failure resolution to walk each contributor in turn, the application first and then each plugin in installation order, and to walk the failure's prototype chain in full at each contributor. An application's override for a base class now beats a plugin's override for a subclass.
- Change the text of a non-string view return from `The renderer returned <type> instead of a string.` to `The view returned <type> instead of a string.`

### Migration

**Affected surface.** The `failures` Application option, the `renderFailure` function, the `FailureRenderer`, `Renderer`, and `RendererContext` types, a plugin's `failures` declaration, the resolution order between an application's base-class registration and a plugin's subclass registration, and diagnostics that quote the non-string return reason.

**Why.** A failure diagnostic, a semantic lane message, a help page, and a version line are all rendered output an application owns. One registry gives them one override surface and one resolution, as [ADR-0021](docs/decisions/0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) decides, so branding a plugin's page and branding a failure class are the same call.

**Before and after.**

Before:

```ts
import { Application, InputError, renderFailure } from '@loomcli/core';
import type { Renderer } from '@loomcli/core';

const inputProblems: Renderer<InputError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};

export const app = new Application('app', {
  failures: [renderFailure(InputError, inputProblems)],
});
```

After:

```ts
import { Application, InputError, override } from '@loomcli/core';
import type { View } from '@loomcli/core';

const inputProblems: View<InputError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};

export const app = new Application('app', {
  views: [override(InputError, inputProblems)],
});
```

A plugin lists the views it declares beside the overrides it makes:

```ts
plugin('@acme/brand', { views: [brandPage, override(InputError, inputProblems)] });
```

**Steps.**

1. Rename the `Renderer<Data>` type to `View<Data>` and `RendererContext` to `ViewContext`. The `render` function itself is unchanged.
2. Replace each `failures` list with `views`, and each `renderFailure(Class, renderer)` entry with `override(Class, view)`. Do the same for a plugin's `failures` declaration.
3. Check any application that registers a base class, such as `UsageError`, beside a plugin that registers a subclass, such as `InputError`. The application's override now answers both. Register the subclass on the application too where the earlier order was intended.
4. Replace a call-site view you want an application to be able to brand with a declared view: export `view('<package>/<name>', definition)` from a `<subpath>/views` module and render it with `out.render(data, name)`. One identity means one object, so a second copy of the declaring package is a build error.
5. Update any test that asserts the `The renderer returned ...` reason, and any that asserts a diagnostic from the retired declaration rules; the `failures` option now reports `The Application options contain failures. Declare view overrides under views with override(key, view).`

**Validation.** Run `pnpm run check:types`, or `tsc --noEmit` in the application's own project, to find every retired name. Then run the output and failure tests under both runtimes: `pnpm exec vp test --run`, and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`. Compare the bytes of each branded diagnostic, help page, and version line before and after the change.

- Add `result<Value>({ views })` and `rows<Row>({ views })`, the authoring calls through which a Command or an Application's root declares what it produces. The type is stated by the author, `views` is a record keyed by view name whose first key is the default, and `action()` closes both calls, so an extracted `ActionHandler` types the emission from the declaration it imports.
- Add `views(replacements, { default })`, published in every state on a declaration that carries a result. It merges by key, so a name the record already holds keeps its position and a new name is appended, and a default once named persists through later calls that name none, so an importing application reshapes the views without touching the action.
- Add `out.results(value)`, the one call an action emits its result through. Under `result<Value>` it renders the resolved view over the value; under `rows<Row>` it accepts any iterable or async iterable and either feeds a row view as the source yields or collects the sequence for a whole view.
- Add `RowView<Row>`, a view that renders a sequence one row at a time through `row`, with optional `head` and `tail`. `tail(count, context)` receives the number of rows that `row` received. `view(identity, definition)` and `override(key, replacement)` accept the shape, and `out.render(rows, rowView)` takes an iterable or an async iterable, requesting the next row only after the previous piece is written.
- Change stdout to belong to the result. On a Command that declares one, the action's `print` and `render` write to stderr with stderr's capabilities, decided at graph build, so a script that captures stdout reads the result alone. A middleware's channel keeps the default destinations, and no method is removed.
- Add `ResultError`, an `InternalError` carrying the routed `path`, a `kind` of `missing`, `repeated`, `undeclared`, or `middleware`, and no cause. An action that returns without emitting fails with exit 1, a second emission turns a would-be 0 into 1, and a cancelled run raises no missing-result fault.
- Add `incompleteResult`, the declared view core writes on stderr when a sequence stops early, before the fault's own report. It carries the routed path and the yielded and written counts, and an override that returns the empty string silences it.
- Add `result` to every node `inspect()` publishes: `null` where none is declared, and otherwise the unit, the view names in record order, and the default. The [core reference](docs/core.md#results) states the lane and its build rules.
- Change `Out` to carry a required `results` member, and `View` to carry `row?: never`, so the two view shapes are exclusive in the type system.

### Migration

**Affected surface.** `Out<Result>` gains the required member `results`, so a value that implements `Out` by hand, such as a test double for an action's channel, no longer satisfies the type without it. `View<Data>` gains `row?: never`, so an object literal that carries both `render` and `row` no longer satisfies `View`, and `view(identity, definition)` rejects such a definition at the call with a `DeclarationError`. `CommandNode` gains the required member `result`, so hand-built graph nodes also need an update.

**Why.** An action emits its result through one call, so `results` is on every `Out` rather than added by a declaration, and a Command with no result types its argument `never`. A view renders one whole value or one row at a time, never both, so the exclusion is stated in the type rather than guessed at the write site.

**Before and after.**

Before, a hand-built channel in a test:

```ts
import type { Out } from '@loomcli/core';

const out: Out = {
  error: async () => undefined,
  fatal: (message) => {
    throw new Error(message);
  },
  info: async () => undefined,
  print: async () => undefined,
  render: async () => undefined,
  success: async () => undefined,
  warn: async () => undefined,
};
```

After, with the emission the lane requires:

```ts
import type { Out } from '@loomcli/core';

const out: Out = {
  error: async () => undefined,
  fatal: (message) => {
    throw new Error(message);
  },
  info: async () => undefined,
  print: async () => undefined,
  render: async () => undefined,
  results: async () => undefined,
  success: async () => undefined,
  warn: async () => undefined,
};
```

Before, one object serving as both shapes:

```ts
const rowsAndValue = {
  render: (all: readonly Row[]) => all.map(line).join(''),
  row: (row: Row) => line(row),
};
```

After, one object per shape:

```ts
const whole: View<readonly Row[]> = { render: (all) => all.map(line).join('') };
const byRow: RowView<Row> = { row: (row) => line(row) };
```

Before, a `CommandNode` fixture omitted `result`. After, a fixture for a Command with no result uses `{ ...node, result: null }`. A result-bearing fixture supplies `{ kind: 'value', views: ['json'], default: 'json' }`, or uses `kind: 'rows'` for a row sequence. Prefer a node from `Application.inspect()` when the test needs the complete declared graph.

**Steps.**

1. Add a `results` member to every hand-built `Out` value. A double that emits nothing returns a resolved promise.
2. Find every view value that carries `render` beside `row` and split it into one whole view and one row view. Name each where its shape is wanted: a `views` record entry, an `out.render` argument, or a `view(identity, definition)` call.
3. Add `result` to every hand-built `CommandNode`, including nodes nested in a `CommandGraph` fixture. Match the Command's declaration or use `null` when it declares no result.
4. Rebuild, and read each new error at a `View`, `Out`, or `CommandNode` annotation. These changes surface at compile time.

**Validation.** Run `pnpm run check:types`, or `tsc --noEmit` in the application's own project, to find every value these types now reject. Then run the application's tests under both runtimes: `pnpm exec vp test --run`, and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`.

- Add `@loomcli/plugins/format`, the formatter plugin. `format()` puts `--format <format>` on every Command that declares a result, listing the record's view names and declared default in its description and accepting `ndjson` as an unadvertised alias of `jsonl`, and its always-on middleware copies a supplied name into the selected view. `--format` on a Command with no result is the ordinary unknown-option error, and an unknown name is the option's validation issue with exit 2.
- Add `json()` and `jsonl()` from `@loomcli/plugins/format`, whole views with an optional `map`. `json()` writes one indented document and `jsonl()` one compact line per element, each escaping DEL and the C1 controls as `\uXXXX`, and both render with the plugin uninstalled as any bare pack view does. The formatter's hook appends them to every result record that lacks the keys, so an author's own `json` is kept as written.
- Add `onCommandAttach` to the plugin definition, a lifecycle hook core calls at graph build once per Command, the root first and then each child depth first, with the hooks of the installed plugins composing in installation order. It receives the declaration unlocked as `AttachedCommand`, the facts `inspect()` publishes beside the `argument`, `option`, `views`, and `extend` calls with their types erased, and returns the declaration to build. The exported types are `AttachedCommand`, `CommandAttachHook`, and `ResultView`. The [core reference](docs/core.md#lifecycle-hooks) states the hook and its build errors.
- Add `request` to the middleware context, the routed Command's parsed and validated invocation as the exported `Request`, `null` while core holds a fault and on a group, and `view`, the name of the view the result renders through, which a middleware assigns before the dispatch boundary and reads as the declaration's default until one does. A name the record does not hold is an internal error at the boundary naming the plugin.
- Change the middleware chain to run after local parsing and validation. Core parses the routed Command's tokens and validates the invocation before the first middleware runs, holds the fault it finds, and raises it at the dispatch boundary, the point the chain reaches when its last middleware continues, so a takeover still observes no fault and a wrapper installed ahead of help still reaches help's takeover. The [core reference](docs/core.md#invocation) states the order.

### Migration

**Affected surface.** A validator on an argument, a local option, or a global option with a side effect, or one that reads the host or awaits a resource, now runs on an invocation a middleware then takes over, `app get --help` included, because local parsing and validation run ahead of the chain. A middleware that took over and relied on no validator having run is affected the same way. `MiddlewareContext` gains required `request` and `view` members. Core supplies them during a run, but hand-built contexts in middleware unit tests must supply them too.

**Why.** A middleware surrounds the whole request. Running the chain ahead of parsing kept a local option invisible to every middleware, so the formatter could not read `--format`, and any plugin that needs the invocation's values would have needed a second chain.

**Before and after.**

Before, a validator that recorded every invocation as a run:

```ts
const app = new Application('audit').argument('target', {
  required: true,
  validate: z.string().transform((value) => {
    audit.record(value);
    return value;
  }),
});
```

After, the validator answers and the action records, since the action runs only when the chain reaches the dispatch boundary:

```ts
const app = new Application('audit')
  .argument('target', { required: true, validate: z.string() })
  .action(async ({ args }) => {
    audit.record(args.target);
    // ...
  });
```

Before, a middleware test could call `middleware(context)` without `request` or `view`. After, a fixture for a group uses `middleware({ ...context, request: null, view: null })`. For a callable Command, supply its parsed and validated `request`; use `null` only when core holds a fault. Set `view` to the declared default for a result Command, or `null` for a Command with no result.

**Steps.**

1. Read every `validate` and `validateOmitted` schema for a side effect, a host read, or an awaited resource. Move a side effect into the action, or make the schema idempotent where the effect is harmless when repeated.
2. Read every middleware that takes over for an assumption that no validator ran. Remove the assumption; the held fault is still never raised under a takeover.
3. Install `format()` after `help()` and `version()` where the application wants `--format`, and rename a local or global option named `format` that collides with it, or install one of the two plugins when another plugin's option already claims `format`, since build reports the collision and the plugin offers no rename.
4. Add `request` and `view` to hand-built middleware contexts. Run the application's TypeScript check to find incomplete fixtures, then exercise any middleware that reads or assigns these members.

**Validation.** Run the application's tests under both runtimes, `pnpm exec vp test --run` and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`, and invoke each takeover path, such as `app get --help` with a required argument missing, to confirm it prints as before with any moved side effect absent.

- Style the default help page and version line with semantic theme tokens and explicit bold and italic modifiers. Align help columns by terminal width, including wide and combining characters.
- Include the formatter's declared default in its option description. Keep graph facts, defaults, and authored examples literal.

### Migration

**Affected surface.** Exact-byte consumers of the default help and version views, including snapshots and wrappers that call their `render` functions.

**Why.** These views now return marked strings for core to resolve under the destination's rendering policy. Help columns use terminal width instead of JavaScript string length.

**Before and after.** A capable terminal previously printed an unstyled application name. It now prints a bold highlighted name. The formatter description changes from `Select the output format: records, json, jsonl.` to `Select the output format: records, json, jsonl. Default: records.`

**Steps.**

1. For plain output, set `rendering: { color: 'never', modifiers: 'never' }` on the Application or invocation. `NO_COLOR` alone preserves modifiers at a capable terminal.
2. Update help snapshots for the formatter sentence and Unicode column alignment.
3. Pass default view output through `out.render` so core resolves its markers. Keep custom whole-view overrides when the application requires different output.

**Validation.** Run the application's tests with plain and themed output configured as above. Compare stdout, stderr, exit codes, and final newlines against the updated expectations. This repository checks those policies and installed-package output with:

```sh
pnpm exec vp test --run packages/plugins/tests/help-style.test.ts
LOOM_TEST_RUNTIME=bun pnpm exec vp test --run packages/plugins/tests/help-style.test.ts
pnpm run check:packed
```

### Changes

- Add `@loomcli/plugins/table` and `@loomcli/plugins/records` as typed view factories. A table buffers rows to measure its columns. A records view writes each row as it arrives and closes with the record count.

- Add `loomTheme(overrides?)` at `@loomcli/plugins/theme` with seven dark foreground defaults, whole-token replacements, and inferred custom token names.
- Add independent `ansi256` and `ansi16` fallbacks to concrete color helpers. Core selects the destination depth and preserves fallbacks through nesting and resets. Use one-argument wrappers such as `colors.map((color) => style.hex(color))` when passing helpers to array methods.
- Install the Loom theme in both examples and highlight the `textstat --total` summary row. Ordinary pipes and automatic `NO_COLOR` retain plain output.

## v0.2.0 - 2026-09-10

This release adds plugins. An Application installs each one explicitly through its `plugins` list, and a plugin contributes options, one middleware with declared activation, extension values, failure renderers, and a claim on the process signals. Core installs nothing on its own.

`@loomcli/plugins` is a new package. It ships the first-party plugins as separately installable subpath exports, starting with `@loomcli/plugins/help` and `@loomcli/plugins/version`, and it declares `@loomcli/core` as a peer dependency at its own version, so pin both packages at the same version.

Two changes are breaking. `Command` takes one options object, and `ExitCode` gains 130 and 143 for cancelled runs. Each migration section below gives the exact steps.

### Breaking Changes

- Change `Command` to take one options object. `new Command(name, { globals })` replaces the positional `new Command(name, globals)` form, which no longer compiles and no longer builds.
- Add `description` and `version` as core facts. `description` is optional on the Application, on a Command, on an option, and on an argument, and holds a character other than whitespace and no line terminator. `version` is an optional string on the Application under the same rule, and a version that is not a string, is blank, or holds a line terminator fails build with `The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".` Build validates both in `inspect()` and in `run()`.
- Add the facts to `inspect()`. `CommandGraph` reports `version` as a string, `0.0.0` when the Application declares none, which means unversioned, so a projection never branches on an absent version. It reports `description`, and each `CommandNode`, `ArgumentNode`, and `OptionNode` reports its own `description`, or `undefined` where the declaration omits one. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds.
- Export the `CommandOptions` type from [core](docs/core.md#commands-and-global-options).

### Migration

**Affected surface.** Every `new Command(name, globals)` call that supplies a `GlobalOptions` value positionally. The Application constructor, the declaration calls, and every runtime behavior are unchanged.

**Why.** A Command now carries facts beside its globals, so its second argument is one options object, as the Application's already is. The retired form supplies a value that holds no `globals` key, so the globals would vanish silently and an operator, not the author, would meet the result as an unknown-option error.

**Before and after.**

Before:

```ts
import { Command } from '@loomcli/core';

import { globals } from '../globals.js';

export const get = new Command('get', globals).argument('path', { required: true }).action(getValue);
```

After:

```ts
import { Command } from '@loomcli/core';

import { globals } from '../globals.js';

export const get = new Command('get', { description: 'Reads one value.', globals })
  .argument('path', { required: true })
  .action(getValue);
```

**Steps.**

1. Replace each `new Command(name, globals)` with `new Command(name, { globals })`.
2. Leave `new Command(name)` unchanged, because a Command without globals still omits the second argument.
3. Add `description` to a Command, an option, or an argument, and `description` and `version` to the Application, where a projection needs them. Each fact is optional.
4. Read the new `inspect()` fields in any projection that renders the graph.

**Validation.** Run the application's type check to find each remaining positional call, which reports `Type 'GlobalOptions<...>' has no properties in common with type 'CommandOptions<...>'`. Run one invocation of a Command the application declares, such as `node ./your-cli.js get user.name`: a missed call reports `Invalid declaration: Command "get" takes an options object. Supply { globals } instead of a positional GlobalOptions value.` and exits with code 1. Run the application's test command to confirm the graph builds and dispatches.

- Add `run({ signal })`. It accepts a caller-owned `AbortSignal` that cancels the run; core subscribes at run entry and honors the abort at every phase boundary. A value that is not an `AbortSignal` is an internal error with code 1.
- Add the signals slot. One installed plugin claims `SIGINT`, `SIGTERM`, or both, each of them once; core installs one process listener per claimed signal once the graph has validated, removes them on every exit path of that run, and re-raises a repeated signal so the default disposition ends the process when no other listener remains.
- Add a typed cancellation reason. The `signal` on a middleware context and on an action context aborts with a reason core owns, the exported `CancellationReason`, `{ source: 'SIGINT' | 'SIGTERM' | 'caller', cause?: unknown }`, where `cause` carries the caller's own `signal.reason`, so a middleware reads `source` and never infers a signal name.
- Change `ExitCode` to widen from `0 | 1 | 2` to `0 | 1 | 2 | 130 | 143`: 130 for `SIGINT` or a caller abort, 143 for `SIGTERM`.

### Migration

**Affected surface.** Every consumer that switches exhaustively on the published `ExitCode` type, including a `switch` with no `default` case or a type-level exhaustiveness check.

**Why.** A cancelled run now resolves a code of its own, 130 or 143, instead of falling into an existing code. A consumer that matched every member of `ExitCode` before this change now has a `switch` that no longer type-checks, because two members are unhandled.

**Before and after.**

Before:

```ts
import type { ExitCode } from '@loomcli/core';

function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'succeeded';
    case 1:
      return 'failed';
    case 2:
      return 'invalid input';
  }
}
```

After:

```ts
import type { ExitCode } from '@loomcli/core';

function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'succeeded';
    case 1:
      return 'failed';
    case 2:
      return 'invalid input';
    case 130:
      return 'cancelled by SIGINT or a caller abort';
    case 143:
      return 'cancelled by SIGTERM';
  }
}
```

**Steps.**

1. Find every exhaustive `switch` or lookup over `ExitCode` with the type checker; a missing case reports the unhandled literals.
2. Add a `130` case for `SIGINT` or a caller-supplied abort, and a `143` case for `SIGTERM`.
3. Where the consumer treats an unknown code as success, confirm that treatment still holds for 130 and 143, since a script that reports 0 after an interrupt carries on as if the work finished.
4. If the consumer owns a supervising process, decide whether to propagate 130 or 143 to its own exit code or to translate them, and update its own documented exit codes accordingly.

**Validation.** Run `pnpm exec tsc --noEmit`, or the consumer's own type check, to confirm every `ExitCode` switch compiles with the two new cases. A code of 130 or 143 reaches a consumer only when the application installs a plugin that owns the signals slot, or when the caller supplies `run({ signal })`; with neither, core installs no listener and a process signal keeps its default effect. With an owner installed, interrupt a long-running invocation with Ctrl-C and confirm the process exits 130, then send `SIGTERM` to another and confirm it exits 143.

See the [core reference](docs/core.md) for the exit code table and the [signals and cancellation](docs/core.md#signals-and-cancellation) section, and [ADR-0018](docs/decisions/0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) for the decision.

### Changes

- Add plugins. `plugin(identity, definition)` returns a frozen value that an Application installs through `plugins` in its options object, in the order every contribution composes. A plugin holds declarations alone and performs no work when it is created or installed. Build rejects an entry that is not a plugin, an identity installed twice, and an empty identity. See [the plugin contract](docs/core.md#plugins).
- Add plugin options. A plugin declares options under `options` with the parsing keys `type`, `short`, `shortOnly`, `polarity`, `multiple`, `default`, `description`, and `extensions`, and no schema or presence rule. They join the globals table after the application's own globals, so the pre-scan consumes them at any placement with the same value rules and the same diagnostics. Every collision by key or by spelling is a build error. A plugin option reaches its own plugin's middleware alone: an action never receives it.
- Add middleware with declared activation and lazy loading. Core runs the middleware of each installed plugin whose activation matched between routing and the callable check, in installation order, and calls a plugin's `load` only when the chain reaches it. `activate` is `'always'` or a list of the plugin's own option names, evaluated from the pre-scan before any plugin code loads. A middleware receives `options`, `graph`, `command`, `host`, `out`, `signal`, and `next`, takes over by returning without calling `next()`, and reads what it wrapped from the `ChainOutcome` that `next()` resolves.
- Add extensions. `extension(identity, { schema, target })` returns a descriptor that is also a factory, and a declaration lists the values it produces under `extensions` on the Application, on a Command, on any option, and on an argument. Build validates each value once, synchronously, and stores its plain-data output on the graph node under the extension's identity. `readExtension(node, descriptor)` is the typed read; a fact whose plugin is not installed stays inert and is still reported.
- Add failure renderers from plugins. A plugin registers renderers under `failures`, which enter resolution after the application's own in installation order. The same class registered by two contributors resolves first-in-wins.
- Add `scope` and `extensions` to `inspect()`. `globals` holds the application's options and every plugin option in one list, and `scope` reads `'application'` or `'plugin'`. Every `CommandNode`, `ArgumentNode`, and `OptionNode` reports `extensions` as the frozen record its declaration carries, or an empty record.
- Add `signal` to the action context. It is the run's cancellation signal, and it never aborts until a caller or an installed signals owner can abort it.
- Export `plugin`, `extension`, and `readExtension`, with the types `Plugin`, `PluginDefinition`, `PluginOptions`, `PluginOptionValues`, `OptionsOf`, `AnyExtension`, `Extension`, `ExtensionValue`, `Middleware`, `MiddlewareContext`, and `ChainOutcome`.

- Add `@loomcli/plugins`, the first-party plugin pack, which ships each plugin as its own subpath export and has no root export. `@loomcli/plugins/help` contributes the Boolean option `help` with the short spelling `h`, and prints the help page of the routed Command, derived from the graph alone: the masthead, the details the node carries, USAGE, COMMANDS, ARGUMENTS, OPTIONS, GLOBAL OPTIONS, EXAMPLES, and the closing hint. `@loomcli/plugins/version` contributes the Boolean option `version` with the short spelling `V`, and prints `<name> v<version>`, so an Application that declares no version prints `v0.0.0`. Each one takes over the invocation, so the remaining tokens are never parsed and the exit code is 0. `@loomcli/plugins/help/extension` exports the two descriptors a declaration carries for the page: `helpCommand({ details, examples })` on the Application and on a Command, and `helpInput({ placeholder })` on a local, global, or plugin option. The pack declares `@loomcli/core` as a peer dependency at its own version, so one core instance serves the application and its plugins. See [First-party plugins](docs/core.md#first-party-plugins).
- Fix the extension value diagnostic so a schema message that ends with its own full stop is not followed by a second one. Core now adds the full stop only when the message carries none.

- Add `hidden` to a named Command's options object and to an option config, including a `GlobalOptions` declaration and a plugin option. A hidden member routes, parses, and runs as any other member, and every listing omits it. An omitted `hidden` reads `false`.
- Add `deprecated` to the same declarations. Its value is the one-line migration message a projection shows beside the member, such as `'Use get instead.'`. A bare `true` is rejected, because a deprecation with no migration path leaves an operator with nothing to do.
- Reject either fact on an argument config and on the Application options, because a positional cannot leave the grammar it sits in and the root is every page's entry point.
- Report `hidden` and `deprecated` on every `CommandNode` and `OptionNode` that `inspect()` returns, so a projection reads both without a plugin installed.
- Omit a hidden child from the candidates a routing failure carries. When every child of a Command is hidden the candidate list is empty, so a renderer that offers candidates handles the empty case.
- Render both facts on the help pages that `@loomcli/plugins` prints. A hidden Command or option leaves its own row out of every usage form, COMMANDS section, OPTIONS section, and closing hint, though a group whose children are all hidden still keeps its own children usage form, and a hidden Command routed to directly still prints its own page. A deprecated Command adds a `Deprecated: <message>` line, indented two spaces, under its masthead, and a deprecated child or option carries `deprecated: <message>` as the last fact of its right cell.

## v0.1.1 - 2026-09-09

### Changes

- Change the verified platforms to macOS and Linux. Windows is no longer exercised in CI and is unverified.

## v0.1.0 - 2026-09-08

This first release provides typed command declarations, local and global options, nested Commands, and Standard Schema validation.

Applications can inspect the command graph, stream stdin, and customize output and failure rendering. The package supports Node.js 22.23.2 or later and Bun 1.4.0 or later.

New applications install `@loomcli/core`. The migration below applies to applications built against the unpublished `@loom/core` source package. See the [core reference](docs/core.md) for the SDK contract.

### Breaking Changes

- Change the core package name to `@loomcli/core` before the first publication. The validation context key follows the package name.

### Migration

**Affected surface.** Core dependencies, import specifiers, and direct Standard Schema `libraryOptions` access.

**Why.** The published libraries use the maintained `@loomcli` npm scope.

**Before and after.**

```ts
import { Application } from '@loom/core';
```

```ts
import { Application } from '@loomcli/core';
```

**Steps.**

1. Replace the `@loom/core` dependency with `@loomcli/core` at the release version.
2. Update core import specifiers to `@loomcli/core`.
3. Use the exported `validationContext` accessor or `validationContextKey` instead of a literal `libraryOptions` key.

**Validation.** Compile the application against the installed package and run its command and validation tests.

