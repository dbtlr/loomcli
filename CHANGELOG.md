---
description: Published library release history and migration instructions for breaking changes.
---

# Changelog

Release history starts with the first library release. Pending changes live in [.changes/](.changes/README.md).

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

