---
description: Published library release history and migration instructions for breaking changes.
---

# Changelog

Release history starts with the first library release. Pending changes live in [.changes/](.changes/README.md).

## v0.9.0 - 2026-10-06

0.9.0 lets an agent drive a Loom application without its command line. `invoke` runs a Command by name with named values, as `run()` runs the argv that spells them, and returns a structured outcome with no process effects. The MCP plugin, `mcp()`, serves every Command that opts in as one Model Context Protocol tool over stdio, each call run through `invoke`. Every failure now carries a stable code and a plain-data form, `{ code, exitCode, message, hints }`, which a tool error, an `invoke` outcome, and the formatter's one-line JSON failure output under `--format json` all report.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.9.0`.

The three migrations below are independent. The version line's view receives the postfix beside the graph. A development build fails on a Command or input with no description, because agents, MCP tools, help, and the manifest describe a Command by its descriptions. And a manifest failure entry reads its code from the failure class instead of a hand-written name, so a failure has one identity everywhere it is reported.

### Breaking Changes

- Add `postfix` to the version plugin's settings, so `version({ postfix: '(Report schema v1)' })` prints `app v1.2.0 (Report schema v1)`: the standard line, one space, and the postfix, dim and escaped. A postfix that is not one line of prose throws `@loomcli/plugins/version/postfix` from `version()`. See [Version](docs/core.md#version).
- Change the data `versionLine` renders from the `CommandGraph` to `VersionLine`, `{ graph, postfix }`, so an override reads the postfix beside the graph. `VersionSettings` and `VersionLine` are exported.
- Add `isProseLine` to `@loomcli/core`, the one-line rule every core fact string follows, so a plugin judges a setting printed inside one line against core's rule. See [Plugin settings](docs/core.md#plugin-settings).
- Add `checkPluginSettings` to `@loomcli/core`, which judges a plugin factory's settings object alone, so a factory with no `short` setting applies core's not-an-object rule without judging a `short` key. `checkShortSetting` applies it first and behaves as before.

### Migration

**Affected surface.** Applications that override `versionLine` from `@loomcli/plugins/version/views`.

**Why.** The version line now carries the postfix the application gave `version()`, so its view receives the graph and the postfix together, as the help page receives the graph, the routed Command, and the variant.

**Before and after.**

Before:

```ts
override(versionLine, {
  render: (graph, context) => `${graph.name} ${graph.version}\n`,
});
```

After:

```ts
override(versionLine, {
  render: ({ graph }, context) => `${graph.name} ${graph.version}\n`,
});
```

An override that calls the default passes the data through unchanged, so only the parameter's name reads differently:

```ts
override(versionLine, {
  render: (line, context) => `build\n${versionLine.render(line, context)}`,
});
```

**Steps.**

1. Find each `override(versionLine, ...)` in the application.
2. Read the graph from the data's `graph` field, and the postfix from its `postfix` field when the override prints it.

**Validation.** Run the application's type check, which rejects a replacement that still reads the graph as its data, and run `<app> --version` to confirm the line.

- Change a development build to fail every `run()` and every `app.invoke()` whose graph holds a Command, the root included, a global or local option, or an argument without a description. The run exits 1 with one Developer Diagnostic under `@loomcli/core/undescribed`, which lists each gap with the call that declared it, hidden and deprecated members and what a plugin or its `onCommandAttach` hook declares included. The check runs before routing, so `--help` and a completion request fail too. `inspect()`, an action's `invoke`, and a distributed build run no such check. See [Undescribed declarations](docs/core.md#undescribed-declarations).

### Migration

**Affected surface.** Applications whose `loom.packet.json` reads `development`, run from source or from a bundle built without `packet()`, that leave out `description` on the Application, on a `Command`, on a `globalOption()`, `option()`, or `argument()` call, or on a plugin's `options` entry. A distributed build is unaffected.

**Why.** Agents, MCP tools, help, and the manifest describe a Command and its inputs by their descriptions, so the author meets a gap in development before an operator or an agent meets it in a shipped application.

**Before and after.**

Before, a development run of `store get name` printed the value:

```ts
export const store = new Application('store', { packet })
  .globalOption('verbose', { type: 'boolean' })
  .command(
    new Command('get')
      .argument('path', { required: true })
      .action(({ args, out }) => out.print(args.path)),
  );
```

After, the same run exits 1 with `4 declarations have no description.` and a finding for each gap. Describe each member:

```ts
export const store = new Application('store', { description: 'Read stored values.', packet })
  .globalOption('verbose', { description: 'Print more detail.', type: 'boolean' })
  .command(
    new Command('get', { description: 'Read one value at a path.' })
      .argument('path', { description: 'The path to read.', required: true })
      .action(({ args, out }) => out.print(args.path)),
  );
```

**Steps.**

1. Run the application from source in a development build, such as `bun src/main.ts --help`.
2. For each finding the diagnostic lists, add a one-line `description` to the call it marks: the Application's options for the root, the `Command` constructor's options for a Command, and the config of each option and argument.
3. For a finding noted `declared by plugin "<identity>"`, or one that marks a plugin's `options` entry or `commands` entry, describe the member in the plugin, or report the gap to the plugin's author.

**Validation.** Run the application from source with no arguments and with `--help`, and confirm that neither prints a diagnostic under `@loomcli/core/undescribed`. Run the application's own tests in a development build.

- Change a `manifestCommand` failure entry to read its failure code from the class: an entry is `{ failure, meaning }`, and the manifest document lists `{ code, exitCode, meaning }` in place of `{ name, exitCode, meaning }`. A stale `name` key is dropped, not rejected, and `exitCodes` rows name failure codes. A class whose code is outside the grammar is rejected at the call with core's own sentence. See [Manifest failures](docs/core.md#manifest-failures).
- Rename the manifest's conflict rule to `@loomcli/plugins/manifest/failure-code-conflict`, keyed on the failure code. Its sentence reads `Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".` with the correction `Declare one exit code and one meaning for each failure code.`
- Reject a failure class whose static `code` is not a kebab-case string at its first construction, under `@loomcli/core/failure-code`, such as `Failure class "RegistryDownError" declares failure code "Registry_Down".` A class that used `static code` for another purpose now declares a failure code.

### Migration

**Affected surface.** Applications and plugins that pass `failures` to `manifestCommand()` from `@loomcli/plugins/manifest/extension`, consumers that read `name` on the manifest document's failure entries or key on `@loomcli/plugins/manifest/failure-name-conflict`, and failure classes that declare a static `code` outside the kebab-case grammar.

**Why.** A failure's identity now lives on its class as a static `code`, which survives a minifying build and which `invoke()`'s outcome, a failure encoder, and the manifest all report, so a hand-written name would be a second spelling of it.

**Before and after.**

Before:

```ts
export class PathNotFoundError extends FatalError {
  static override readonly exitCode = EX_DATAERR;
  // ...
}

manifestCommand({
  failures: [
    { failure: PathNotFoundError, meaning: 'The path names no value in the document.', name: 'path-not-found' },
  ],
});
```

After:

```ts
export class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;
  // ...
}

manifestCommand({
  failures: [{ failure: PathNotFoundError, meaning: 'The path names no value in the document.' }],
});
```

**Steps.**

1. For each `manifestCommand()` failure entry, move its `name` to the class it names as `static override readonly code`, and remove `name` from the entry.
2. Give two classes that shared an inherited code, such as two `FatalError` subclasses with different exit codes or meanings, codes of their own, or `--manifest` reports `@loomcli/plugins/manifest/failure-code-conflict`.
3. Rename a static `code` that is not lowercase letters and digits joined by single hyphens, such as `ENOENT` or a number, so it follows the grammar, or move the value to another static name.
4. Read `code` in place of `name` on each manifest failure entry, and key on `@loomcli/plugins/manifest/failure-code-conflict` in place of `@loomcli/plugins/manifest/failure-name-conflict`.

**Validation.** Run the application's type check and tests, then run `<app> --manifest` and confirm that each Command's `failures` entries list the codes the classes declare and that the run exits 0.

### Changes

- Add `invoke(path, values, options?)`, which runs one Command by its path with named values in place of argv, captures what the run writes, and resolves a structured outcome: `completed` with `output` and `messages`, `failed` with the failure, its `exitCode`, and the captured text, or `cancelled` with `130` or `143`. An embedding host calls `app.invoke`, which builds the graph for each call and reads `env`, `cwd`, `platform`, and `readSource` from the process unless `host` replaces one. An action calls `invoke` on its context, which reuses the graph its run built and derives its signal from the run's. An invocation by name behaves as `run()` does on the argv that spells the same path and values, and it touches no process: it installs no signal listener, sets no `process.exitCode`, writes to no real stream, and reads an empty stdin on a host with no terminal. See [Invocation by name](docs/core.md#invocation-by-name).
  - Each value lowers to the tokens argv would give: a string or a finite number is one token, a Boolean a spelling or its absence, a whole number on a counted option that many occurrences, `true` on an option with an implied value the bare spelling, and an array one occurrence per element. Arguments bind by name. A value no token spells is an input problem with exit code 2, such as `Option "file": Use a string or a number.`
  - Every problem names an input by its declared name, the key the caller wrote, so `Unknown option "verbos". Supply the name of a declared option.` and `Command "get" declares no argument "pth". Supply the name of a declared argument.` replace the spelled sentences.
  - `view` selects the starting view, and a name the routed Command's result does not hold is the `@loomcli/core/view-selection` defect named for `invoke()`, such as `invoke() selected view "yaml", which Command "count" does not name.`
  - A `failure` handler maps the translated failure into the outcome after the failure's report is written to `messages`. A malformed call is a defect under the new rule `@loomcli/core/invoke-options`, such as `invoke() received a signal that is not an AbortSignal.`
- Export the types `InvocationValues`, `InvokeOptions`, and `InvocationOutcome`, and add `invoke` to `ActionContext`.
- Add `invokedBy`, `'argv'` or `'name'`, to `FailureViewContext`, `FailureHookContext`, and `SourceContext`, so a failure view, a hint, or a configuration source can tell a run `invoke()` started from one a command line started.

- Change help's failure hint to add no line for an invocation by name, where no command line exists to rerun with `--help`. See [Help's failure hint](docs/core.md#helps-failure-hint).
- Change the suggestions plugin to offer the declared names of the visible options for an unknown option in an invocation by name, printed as names, such as `Did you mean "verbose"?`. See [Suggestions](docs/core.md#suggestions).
- Change the configuration plugin to name an option by its declared name in an invocation by name, as core does there, such as `Option "min-bytes" (from minBytes in .textstat.toml): Use a string or a number.` and `Option "config": File "missing.json" does not exist. Supply the path of an existing file.`

- Add `onGraphBuilt` to a plugin definition, typed by the exported `GraphBuiltHook`. Core calls it once per graph build, after every `onCommandAttach` hook, with the frozen graph `inspect()` returns, on every `run()`, `inspect()`, and `app.invoke()` and never again for an action's `invoke`. A hook rejects the graph by throwing a `DeclarationError`, which reports as itself with exit 1. Any other throw, and any returned value, a promise included, is the build fault `@loomcli/core/broken-graph-hook`, and an `onGraphBuilt` that is not a function is rejected by `plugin()`. See [Judging the built graph](docs/core.md#judging-the-built-graph).
- Add `mediaType` to every view shape, `View` and `RowView`, bare or declared through `view()`, and add `mediaTypes` to `ResultNode`: each view's declared media type by view name, or `null` where a view declares none. The call that stores a view reads its media type once, and core never checks the string against the text the view writes. A media type that is not a string throws `@loomcli/core/media-type`, such as `Command "count" names view "csv" with a media type that is not a string.` See [Media types](docs/core.md#media-types).
- Add `control` to every option config, a local option, a global option, a plugin's option, and an option a lifecycle hook declares, and to every `OptionNode` that `inspect()` returns. It marks an option that controls the invocation rather than feeding the Command's work, reads `false` when omitted, and changes nothing at run time. A value that is not a Boolean throws `@loomcli/core/flag-not-boolean`, and `control` on an argument throws `@loomcli/core/misplaced-listing-fact`. See [Control options](docs/core.md#control-options).
- Change the formatter's `json()` and `jsonl()` to declare `application/json` and `application/jsonl` under every `map`, and mark `--format`, `--help`, `--version`, `--manifest`, and `--config` as control options.
- Change the manifest to carry `control` on every option entry and `mediaTypes` on every result. Its `encodings` statements now apply to the views whose media types they name, never to a view name.
- Fix a development build's converter failure to report as the other build faults do: no `onFailure` hook runs for it, so no hint prints under its Developer Diagnostic.

- Add a failure code to every failure class: a static, kebab-case `code`, read like `exitCode` from the nearest class that declares one and captured at the class's first construction. Core's classes carry fixed codes, such as `unknown-command`, `unknown-option`, `invalid-input`, and `fatal`, an author's class inherits its parent's, and `DeclarationError`, `InternalError`, and `ResultError` read `internal`. See [Failure codes](docs/core.md#failure-codes).
- Add the failure form, `{ code, exitCode, message, hints }`, typed by the exported `FailureForm`: one failure as frozen plain data, with its message and hints as plain text and a defect reading `Something went wrong.` in a distributed build. `invoke()`'s failed outcome and its caller's `failure` handler context carry it as `form`. See [The failure form](docs/core.md#the-failure-form).
- Add `view` and `mediaType` to `FailureViewContext` and `FailureHookContext`: the view the result would render through when the run failed, a middleware's assignment, else the view `invoke()` started with, else the routed Command's default view, and the media type that view declares. Both read `undefined` for a build fault, an unknown command, a Command with no result, and a selected name the result does not hold. See [Failure view context](docs/core.md#failure-view-context).
- Add `ownOptions` to the middleware context: the validated value of each option the plugin declared, its global options and the local options its `onCommandAttach` hook declared on the routed Command, whatever fault core holds for another input. Under any held fault, such as an unknown option or a configuration file that cannot be read, core still validates a plugin's own options whose tokens parsed, for `ownOptions` alone, and the held fault stays the one reported. A validator runs at most once per run, so an option whose validator threw is absent and is not validated again. See [Middleware](docs/core.md#middleware).
- Add failure encoders: `encodeFailure(mediaType, encoder)`, typed by the exported `FailureEncoder` and `FailureEncoding`, listed under a plugin's new `failureEncoders`. When a failed `run()` selected a view whose media type an installed plugin encodes, core writes the encoder's text for the failure's form to stderr in place of the failure view and writes no incomplete-result line. A run whose failure no encoder writes, such as a stream cancelled mid-sequence, a stdout that fails, or a broken encoder, still writes that line. A development build writes a defect's Developer Diagnostic first. Two encoders for one media type throw `@loomcli/core/failure-encoder-taken`, and an encoder that throws or returns a value that is not a string reports `@loomcli/core/broken-failure-encoder` with exit 1. `invoke()` calls no encoder. See [Failure encoders](docs/core.md#failure-encoders).
- Change the formatter to register encoders for `application/json` and `application/jsonl`, so a failed run under `--format json` or `--format jsonl`, or a Command whose default view is `json()`, writes one line to stderr, such as `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--metric\": Expected one of: bytes, words, lines.","hints":["Run \"textstat --help\" to see the usage."]}}`. Its middleware reads `--format` from `ownOptions`, so the selection holds under a held fault, `textstat --format json --bogus one.txt` and `textstat --format json -c missing.json one.txt` included. See [Formatter](docs/core.md#formatter).

- Add `WorkingDirectoryError`, the failure a run reports when the process's working directory cannot be read, such as one another process removed. Its failure code is `working-directory-unreadable` and it exits 1. `run()` from a removed directory now writes `<app>: The current working directory cannot be read. Change to a directory that exists and run the command again.` to stderr and resolves 1 instead of rejecting with the platform's error, and `app.invoke` resolves `failed` instead of rejecting. A `host.cwd` override and an action's `invoke` read no working directory from the process, so they never meet it. See [An unreadable working directory](docs/core.md#an-unreadable-working-directory).

- Add the MCP plugin, `mcp()` from `@loomcli/plugins/mcp`. It attaches the visible Command `mcp`, which serves every Command that carries an `mcpCommand` value as one tool of a Model Context Protocol server over stdin and stdout, pinned to revision `2026-07-28`, until stdin ends or the run's signal aborts. Each tool call runs the Command through `invoke`, so a call meets the Command's own validation, failures, and exit codes. See [MCP](docs/core.md#mcp).
  - A tool's name is the Command's path joined by `_`, each `-` written as `_`, with no application-name prefix, so `scratch create` serves `scratch_create`, and the root's tool is the application name, so jsonkit serves `jsonkit`, `get`, `keys`, and `select`. Its input schema lists the Command's arguments, its local options, and every global option by declared name, minus hidden and control options, each with its published input schema or one derived from its kind.
  - A completed call answers the output and the messages as text, and the output of the first `application/json` view as `structuredContent`. A failed call answers `isError: true`, the failure's report as text, and `structuredContent` `{ exitCode, failure }`, where `failure` is the failure form. A key outside the input schema answers a tool execution error, and an unknown tool or `arguments` that are not an object answer the JSON-RPC error `-32602`.
- Add `mcpCommand`, `mcpInput`, and `mcpArgument` from `@loomcli/plugins/mcp/extension`. `mcpCommand` opts a Command in as a tool, with an optional description for an agent and the effect hints `readOnly`, `destructive`, `idempotent`, and `openWorld`, which the listing projects as the protocol's tool annotations. `mcpInput` and `mcpArgument` give an option or an argument its description for an agent.
- Add three build faults the MCP plugin reports on every build: two opted-in Commands that serve one tool name, `@loomcli/plugins/mcp/tool-name-taken`; `mcpCommand` on a Command with no action, `@loomcli/plugins/mcp/tool-without-action`; and an argument and an option that one tool would list under one name, `@loomcli/plugins/mcp/property-name-taken`, such as `Command "get" declares argument "path" and option "path", which one MCP tool lists under one name.`

## v0.8.0 - 2026-10-05

0.8.0 gives every option one system. A plugin's options are ordinary global options, validated with the application's and typed in every action, and an invocation parses in one pass: routing reads the global options, then the routed Command's words are read against one table of its own options and every global option. Options also gain unadvertised aliases, counted options such as `-vvv`, implied values for a bare `--backup`, and ordered help sections.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.8.0`.

The three migrations below follow from that one change. A plugin option needs no class of its own, so its types and rules become the global option's. A short group may mix a global letter with a Command's letter, so a group that once failed now parses. And an option reads its words by one of four value classes, so a counted or implied option is an ordinary option that every declarer, help page, manifest, and completion script reads the same way.

### Breaking Changes

- Change a plugin's options into global options, with no difference from the ones `globalOption()` declares. Each entry of a plugin's `options` record takes `GlobalOptionConfig`, the configuration `globalOption()` takes: everything `option()` takes except `required` and `validateOmitted`. A plugin's option may now carry a validator, a default of its validator's input type, and every other rule an option declaration meets. `plugin()` rejects `required` and `validateOmitted`, whatever their value, under `@loomcli/core/global-presence-rule`, such as `Plugin "@acme/log" option "level" declares required. Remove required, and check for the value in each Command that needs it.` The rule `@loomcli/core/plugin-option-rule` is removed. See [Global options from plugins](docs/core.md#global-options-from-plugins).
- Add the type `GlobalOptionConfig`, and remove the types `PluginStringOption` and `PluginOptionConfig`. `PluginOptions` is `Readonly<Record<string, GlobalOptionConfig>>`, and `PluginOptionValues` reads a validated option as its validator's output.
- Change validation so that a plugin's option values pass their validators with the application's global options, the application's own first in authoring order and then each plugin's in installation order. A rejected value is an input problem with exit code 2, reported with every other validation problem of the run. A configuration source's own options pass their validators before the source is called. When one is rejected, the source is never called, and the problem is reported with every other validation problem in that order; it is not a source failure. An option the skipped source would have filled reports no missing value, and an absence rule never judges its omission, because the operator's configuration may hold it. The global options are now validated when a local option holds a fault too.
- Change every action's `options` to hold every global option's validated value, the application's and every plugin's, a plugin Command's action included. An action's type names them through the constructor's `plugins` tuple, and a Command built where the Application's `Register` augmentation is visible names them through `EnvironmentOf`. In both places `.option()` now rejects the name of a plugin's option at compile time, as it rejects the name of an application's global option.
- Change `MiddlewareContext.options` to hold every global option's validated value, the application's and every plugin's, keyed by declared name, typed `(PluginOptionValues<Options> & Readonly<Record<string, unknown>>) | null`. It is `null` when a global option has a structural fault or was rejected, and a fault on a local option alone leaves it set. Each value is a copy frozen to every depth, as the request's values are. Activation and `spellings` still cover the plugin's own options alone.
- Change `SourceContext.options` to hold each of the source's own options as its validator's output, frozen to every depth, so a source that writes to a value in it fails.
- Remove `OptionNode.scope`. A global option reads the same whether the application or a plugin declared it.

### Migration

**Affected surface.** A plugin whose `options` record is typed with `PluginStringOption` or `PluginOptionConfig`, or whose option declares `required` or `validateOmitted`. A middleware that reads `options`, assumes it holds the plugin's own options alone, or writes to a value in it. A configuration source that writes to a value in its `options`. Code that reads `OptionNode.scope`. An `Application<Args, Options, Globals>` annotation whose `Globals` omits the installed plugins' option values. An Application that attaches Commands built under another Application's `Register` augmentation without installing the same plugins. Code that serializes or compares an action's whole `options` object.

**Why.** A plugin's options were a second class of global option that parsed with the globals but carried no validator and reached their own plugin's middleware alone. They are now ordinary global options, so they validate once with the application's, and every action and every middleware reads them under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

**Before and after.**

Before, the plugin declared its option without a validator, and its middleware checked the raw value:

```ts
import type { Middleware, PluginOptionConfig } from '@loomcli/core';

const options = { level: { type: 'string' } } satisfies Record<string, PluginOptionConfig>;

const middleware: Middleware<typeof log> = ({ next, options }) => {
  if (options.level !== undefined && !['debug', 'info'].includes(options.level)) {
    throw new FatalError('Use debug or info.');
  }
  return next();
};
```

After, the option carries its validator, and the middleware handles `null`:

```ts
import type { Middleware, PluginOptions } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

const options = { level: { type: 'string', validate: oneOf(['debug', 'info']) } } satisfies PluginOptions;

const middleware: Middleware<typeof log> = ({ next, options }) => {
  // `options` is null when a global option faulted or was rejected, and core reports that problem.
  const level: 'debug' | 'info' | undefined = options?.level;
  configureLogging(level);
  return next();
};
```

Before, an annotation named the application's own global options:

```ts
function serve(app: Application<{}, {}, { file: string | undefined }>) {}
```

After, it names the configured Application's environment, which holds the plugins' option values too:

```ts
function serve(app: Application<{}, {}, EnvironmentOf<typeof configured>['globals']>) {}
```

**Steps.**

1. Replace `PluginStringOption` and `PluginOptionConfig` with `GlobalOptionConfig`, or declare the record with `satisfies PluginOptions`.
2. Remove `required` and `validateOmitted` from each of a plugin's options, and check for the value in each Command that needs it.
3. Move a check a middleware made on its own option's raw value into the option's validator, and read the validator's output.
4. In each middleware that reads `options`, handle `null`, read another plugin's or the application's option as `unknown`, and copy a value before changing it. In a configuration source, copy a value of its `options` before changing it too.
5. Replace each read of `OptionNode.scope`. A plugin's options are the names its own declaration holds.
6. Install the same plugins in every Application that attaches Commands built under one `Register` augmentation, and name the globals of an `Application` annotation with `EnvironmentOf<typeof configured>['globals']`.
7. Update code that serializes or compares an action's whole `options` object to expect every global option's key.

**Validation.** Run the application's type check, such as `tsc --noEmit`, to find each removed type, presence rule, `scope` read, and annotation. Run the application's tests, then run the application with a value the validator of each of a plugin's options rejects, and check that it exits 2 with the validator's message.

- Change how core reads an invocation. Routing reads the words before the first bare `--` against the global options and the own options of each Command with an action and children, the routed Command's words are read against one table of its own options and every global option, and each owner reads its values, under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md). See [Global consumption and routing](docs/core.md#global-consumption-and-routing).
- Allow a short group to mix a global option's letter with a letter of the routed Command, so `textstat -ht` renders help and `get a.b -qp` reads a global `-q` and `get`'s own `-p`. Read a short group under the POSIX `getopt` rule: a value letter takes the rest of its word with one leading `=` stripped, so `-mwords`, `-m=words`, `-tmwords`, and `-m=` are accepted. A word that is neither `--` and at least one character nor `-` and an ASCII letter, such as `-5`, `-.5`, `-1e3`, or `-`, is a value or an argument.
- Allow an option of a Command with an action and children, typed before a child's name, to reach that child: `jsonkit --format json paths` routes to `paths` with the root's `--format`, where it reported that the root accepts no arguments. The option binds to the Command routing reaches, so that Command reports it as an unknown option when it does not declare the spelling, and as a `MisplacedOptionError` that names it when it declares the spelling with another value class.
- Change a short group whose value letter is followed by more characters, such as `-mt` where `m` takes a value, to give that option the rest of the word, `t`, instead of failing. The option's validator is where such a typo surfaces.
- Add `MisplacedOptionError`, a `UsageError` with exit code 2 and the facts `spelling` and `commands`, for an option word the routed Command's table does not hold while a visible Command below it declares it, such as a Command's own option typed before the Command's name: `Option "-F" belongs to command "select". Supply it after "select".` Such an invocation reported `UnknownOptionError` before. The error also names the routed Command when it declares a parent's own option, typed before its name, with another value class.
- Remove `ShortGroupError`. An undeclared letter of a short group is an `UnknownOptionError` that names that letter, a `=` after a Boolean letter is an `UnexpectedValueError`, and a repeated letter is a `RepeatedOptionError`. The walk stops at the first letter that faults, so the characters after it supply nothing.
- Change every fault except an unknown command to be held to the dispatch boundary, so a middleware such as help can take it over. A structural fault on a global option, such as a missing value, a repeated option, or a value after a Boolean, was raised before the chain and is now held, so `jsonkit --file --help` and `jsonkit --help --help` render help. Parsing continues past a fault to find every global option, the first fault in word order is reported, and an occurrence that faulted supplies no value and activates no plugin. A failure view's `path` is the path routing reached.
- Change the order in which faults rank: an unknown command, then the first structural fault in word order, then a group's missing subcommand, then validation problems. `store cache --verbose` reports the unknown option instead of the missing subcommand, and `app --file --quiet nope`, where `--quiet` is a global Boolean option, reports the unknown command instead of the missing value.
- Add the attached form to the missing-value sentence when the word after a value option is an option word or `--`: `Option "--pattern" requires a value. Supply a value after "--pattern", or attach one that starts with a hyphen as "--pattern=<value>".` `MissingValueError` takes an optional second constructor argument, `'attached'` or `'separate'`, which selects the sentence.

### Migration

**Affected surface.** Code that imports `ShortGroupError`, overrides its view, or reads its `reason` or `token`. Code that matches `UnknownOptionError` for an option typed before its Command's name. A middleware or a test that expects a structural fault on a global option to be raised before the middleware chain, or that pins which failure an invocation with several faults reports. An application whose operators rely on `-mt` failing when `m` takes a value.

**Why.** The global pre-scan read one table of global options before routing, so it rejected a short group that mixed a global letter with a local one, and it raised a global option's fault before help could take it over. Core now routes on the global options and reads the routed Command's words against one table, under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

**Before and after.**

Before, a view override matched the short-group fault:

```ts
import { override, ShortGroupError } from '@loomcli/core';

const views = [override(ShortGroupError, { render: (failure) => `app: ${failure.message}\n` })];
```

After, the override matches the misplaced-option fault, and a short-group fault reaches the view of its own class:

```ts
import { MisplacedOptionError, override } from '@loomcli/core';

const views = [
  override(MisplacedOptionError, {
    render: (failure) => `app: Run "${failure.commands[0]?.join(' ')} --help" for ${failure.spelling}.\n`,
  }),
];
```

**Steps.**

1. Remove each import and `override()` of `ShortGroupError`. Match `UnknownOptionError`, `UnexpectedValueError`, or `RepeatedOptionError` for a fault inside a short group.
2. Match `MisplacedOptionError` where code matched `UnknownOptionError` for an option typed before its Command's name, and read `commands` for the paths of the Commands that declare it.
3. In a middleware that runs on every invocation, handle a run whose global option faulted: `options` and `request` are `null`, and core raises the fault after the chain unless the middleware takes the invocation over.
4. Update tests that pin the failure an invocation reports to the new ranking: an unknown command, the first structural fault in word order, a group's missing subcommand, then validation problems.
5. Give a value option a validator where a mistyped group such as `-mt` must fail.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and check that it reports no use of `ShortGroupError`. Run the application's tests, including a middleware test where a global value option is missing its value, and check that the middleware handles `options` and `request` as `null`. Then run three invocations with the application's own names. An option of a child Command typed before the child's name, such as `app -x get`, exits 2 and prints `Option "-x" belongs to command "get". Supply it after "get".` The same words followed by `--help` exit 0 and print help when the help plugin is installed, because the fault is held. A global value option with no value before an unknown command, such as `app --file --quiet nope` where `--quiet` is a global Boolean option, exits 2 and prints `Unknown command "nope"`, because an unknown command ranks first.

- Add counted options. `type: 'count'` declares an option that takes no value and reads, as a `number`, how many times it was supplied across every spelling, alias, and word, so `-vvv`, `-v -v -v`, and `--verbose -vv` each read `3` and an omitted one reads `0`. A global counted option adds its occurrences on both sides of the Command name. A value attached to a counted spelling, as in `--verbose=3`, is the unexpected-value error, worded to tell the operator to repeat the spelling instead. An environment variable of ASCII decimal digits and a configuration answer of a whole number of 0 or more fill it when no occurrence did. A counted option declares no `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`, which TypeScript rejects and the call rejects under `@loomcli/core/count-option-value-rule`, `@loomcli/core/count-option-multiple`, `@loomcli/core/polarity-on-count`, and `@loomcli/core/implied-on-boolean-or-count`. Help prints its row as `-v, --verbose...`. See [Counted options](docs/core.md#counted-options) in the [core reference](docs/core.md).
- Add `implied` to a string option, the value a bare spelling supplies. `--backup` and `-b` supply it, an explicit value is attached as `--backup=numbered`, `-bnumbered`, or `-b=numbered`, and a bare spelling never takes the next word. Each run passes the implied value through the option's validator before it reads a token, and a rejected one is the declaration error `@loomcli/core/invalid-implied`. Input sources never supply it. `implied` on a Boolean or counted option and an `implied` that is not a string are rejected under `@loomcli/core/implied-on-boolean-or-count` and `@loomcli/core/implied-not-a-string`. Help prints the option as `-b, --backup[=<control>]` with the fact `implied: <value>`, and completion offers its values only after `=` or the letter. See [Implied values](docs/core.md#implied-values) in the [core reference](docs/core.md).
- Change `OptionNode`, `OptionConfig`, and the manifest's option entry type to unions of three kinds: each gains a `count` variant, which carries no `negative`, `polarity`, `required`, `multiple`, or `default`, and the string variants gain `implied`, the implied value or `null`. `SuppliedInputs.options` and `SourceAnswer.value` admit a `number` for a counted option. TypeScript code that narrows one of these unions by `type` in two ways, or that types a validator's `context.supplied.options` values, no longer compiles until it handles the third kind.

### Migration

**Affected surface.** TypeScript code that reads `OptionNode` from `inspect()`, a lifecycle hook, a configuration source's `requests`, or a failure hook, or that reads an option entry of the manifest document, and narrows by `type` in two ways, such as `option.type === 'boolean' ? option.negative : option.default`. A validator that types the values of `context.supplied.options` as `string | readonly string[] | boolean | undefined`. Code that assigns `OptionConfig` to a type that names only `StringOption` and `BooleanOption`.

**Why.** A counted option is a third kind of option under [ADR-0057](docs/decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md). It has no default, polarity, or negative spelling, so code that treats every option that is not Boolean as a string option reads fields a counted option does not have, and its token is a number.

**Before and after.**

Before, every option that was not Boolean was a string option:

```ts
const facts = (option: OptionNode) =>
  option.type === 'boolean' ? option.negative : option.default;

const supplied: string | readonly string[] | boolean | undefined = context.supplied.options.verbose;
```

After, the string variant is narrowed by its own tag, and a supplied count is a number:

```ts
const facts = (option: OptionNode) => {
  switch (option.type) {
    case 'boolean':
      return option.negative;
    case 'string':
      return option.default;
    case 'count':
      return undefined;
  }
};

const supplied: string | readonly string[] | boolean | number | undefined =
  context.supplied.options.verbose;
```

**Steps.**

1. Find each narrowing of `OptionNode`, `OptionConfig`, or a manifest option entry by `type` that assumes two kinds, such as a conditional on `'boolean'` or `'string'` alone.
2. Narrow the string variant by `type === 'string'`, and handle `type === 'count'`, whose node carries `long`, `short`, `aliases`, `env`, and `schema: null` and no value facts.
3. Add `number` to any type that holds a value of `SuppliedInputs.options` or of a configuration source's `SourceAnswer.value`.
4. A consumer of the manifest JSON reads an entry whose `type` it does not know by the fields it knows, under the manifest's stability rule, so JSON consumers need no change.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and expect no error at a narrowing of `OptionNode` or a manifest option entry. Run `inspect()` on an application that declares a counted option and check that each projection the application builds reads its node.

### Changes

- Add `aliases` to every option config, a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares alike, so a renamed option keeps its earlier name. Each alias is one more long spelling of the same option, with `--no-<alias>` where the option's polarity generates a negative form, so repetition, input sources, and validation see one option whichever spelling the operator typed. Help, the manifest, completion, and suggestions never list an alias, and `inspect()` reports the declared names as `aliases` on each `OptionNode`. The [core reference](docs/core.md#option-aliases) describes the rules.

- Add `manifest({ short })` so an application can choose a short spelling for `--manifest`. Without the setting, the option keeps no short spelling.

- Add ordered help sections for Commands and options through `helpCommand` and `helpInput`. Section paths contain one or two headings, each help page can prioritize its Command and option sections, and matching named sections combine local and global options. Both help variants use the same grouping; applications without section fields retain their existing layout.

- Add `reportedSpelling(option)` to `@loomcli/core`. It returns the spelling a reported problem names an `OptionNode` by, the one core's own validation reports: the long form, a negative-only Boolean option's `--no-<name>`, and otherwise the short form of a `shortOnly` option. A plugin that builds an `InputProblem`, such as a configuration source, names the option the way core does. The [core reference](docs/core.md#failure-classes) describes the rule.

## v0.7.0 - 2026-10-03

0.7.0 is a hardening release. Every declaring call reads its declaration once and reports a declaration it cannot read at that call, a declared default nests at most ten levels, `override()` takes one signature derived from its key, and the configuration plugin reads one TOML, YAML, or JSON file per run. Core also carries its Unicode tables as a JavaScript module, so any bundler can bundle a Loom application.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.7.0`.

The four migrations below share one idea: a fault surfaces where its author can fix it. A throwing getter or an over-deep default fails at the call that declares it rather than inside `inspect()` or a run, a mismatched `override()` replacement names its own type against the one its key expects, and an operator's settings live in one file the application names.

### Breaking Changes

- Add the rule `@loomcli/core/unreadable-declaration`. Every declaring call now reads its declaration once, at the call, copying every own string key, enumerable or not: `argument()`, `option()`, `globalOption()`, and an input a lifecycle hook declares read their config, its `extensions` list included; `plugin()` reads its whole definition, the `options` record and each option's config included; and `new Application()` and `new Command()` read their options. Every later check, every finding, and the graph read that one copy, so a getter runs once and a finding prints the value the rule judged. A read that throws, such as a getter or a proxy trap that throws, or one at any depth of a default, throws a `DeclarationError` from that call, such as `Option "format" config could not be read: boom.`, `Plugin "@acme/log" definition could not be read: boom.`, or `The Application options could not be read: boom.`, with the thrown value as its `cause`. Before, the throw escaped as the raw error, or, inside a default, broke `inspect()` and every plugin that reads the graph.
- Change a declared default to one frozen snapshot that the declaring call takes. The graph publishes it, and a run passes the same frozen copy to the default's validator, so a validator, or an action that receives the validator's output unchanged, can no longer write to an object default. An array default still reaches the action as its own mutable copy, holes included.
- Fix a converter's JSON Schema that holds itself. Core copies it with the same cycle instead of overflowing the stack, so a development build no longer reports it as `@loomcli/core/schema-converter-failed`, and the manifest reports that it cannot encode the schema as JSON. See the [core reference](docs/core.md).

### Migration

**Affected surface.** A config passed to `argument()`, `option()`, `globalOption()`, or a lifecycle hook's `argument()` or `option()`, whose own properties, `extensions` list, or default throw when read. A `plugin()` definition, an options object passed to `new Application()` or `new Command()`, or a plain object or list nested in one of them, such as a plugin's `options` record and each option's config, `middleware`, or `views`, or the Application's `packet`, `rendering`, or `plugins`, that throws when read. A `plugin()` definition, or a plain object or list nested in it, that holds a key that is not enumerable, which core now reads where it ignored it before. A default's validator or an action that writes to an object default it receives.

**Why.** Core reads a declaration once, at the call that declares it, so every check, the graph, and every run read one copy. A read that throws now reports at that call, and the copy of a default that every reader shares is frozen so that no reader can change it for another.

**Before and after.**

Before, the declaration was accepted, and the first `inspect()` threw `boom`:

```ts
app.option('format', { default: { get style(): string { throw new Error('boom'); } }, type: 'string', validate });
```

After, declare the default as plain data:

```ts
app.option('format', { default: { style: 'plain' }, type: 'string', validate });
```

Before, a hand-written validator's `'~standard'.validate` method could normalize a default in place:

```ts
const validate: StandardSchemaV1<{ style?: string }> = {
  '~standard': {
    validate: (value) => {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'Expected an object.' }] };
      }
      Object.assign(value, { style: 'plain', ...value });
      return { value };
    },
    vendor: 'acme',
    version: 1,
  },
};
```

After, the method returns a new value:

```ts
const validate: StandardSchemaV1<{ style?: string }> = {
  '~standard': {
    validate: (value) =>
      typeof value === 'object' && value !== null
        ? { value: { style: 'plain', ...value } }
        : { issues: [{ message: 'Expected an object.' }] },
    vendor: 'acme',
    version: 1,
  },
};
```

**Steps.**

1. Replace each getter or proxy in a declaration config and its default, a plugin definition, or a constructor's options, with the plain value it returns.
2. Change each validator or action that writes to an object default it receives so that it builds a new value instead.
3. Remove each key that is not enumerable from a `plugin()` definition and the values nested in it, unless core should read it.

**Validation.** Run `inspect()` on the Application in a test, and run each Command with no tokens so that every default passes through its validator and reaches its action. `inspect()` throws no `DeclarationError`, and no run reports `@loomcli/core/unreadable-declaration` or `@loomcli/core/validator-failed`.

- Add the rule `@loomcli/core/default-depth`. No path through a declared default may hold more than 10 arrays and plain objects, counted from the default itself, with a list or object the default holds twice counted on every path through it, and a default that holds itself nests without end. `argument()`, `option()`, `globalOption()`, a lifecycle hook's `argument()` or `option()`, and `plugin()` for an option it declares throw a `DeclarationError` for a deeper default, such as `Option "deep" default nests deeper than 10 levels.`, on Node and Bun alike. Before, the declaring call accepted any default, and one nested deeply enough, or one that held itself, made `inspect()` throw `RangeError: Maximum call stack size exceeded` and every run fail as an internal error, at a depth that differed between Node and Bun. See [ADR-0053](docs/decisions/0053-a-declared-default-nests-at-most-ten-levels.md).

### Migration

**Affected surface.** A default passed to `argument()`, `option()`, `globalOption()`, a lifecycle hook's `argument()` or `option()`, or an option in a `plugin()` definition, that nests arrays and plain objects more than 10 levels deep, or holds itself.

**Why.** Every reader of the graph walks a default, and each one spends the call stack at its own rate on each runtime. One cap at the declaring call keeps every reader within the stack everywhere.

**Before and after.**

Before, the declaration was accepted:

```ts
app.option('tree', { default: [[[[[[[[[[['leaf']]]]]]]]]]], type: 'string', validate });
```

After, declare a flatter default and build any deeper structure in the action:

```ts
app.option('tree', { default: ['leaf'], type: 'string', validate });
```

**Steps.**

1. Find each default that nests arrays or plain objects more than 10 levels deep, or holds itself.
2. Flatten it, or declare the shallow value and build the deeper structure from it in the action.

**Validation.** Run `inspect()` on the Application in a test. It throws no `DeclarationError` with the rule `@loomcli/core/default-depth`.

- Change `override()` from three overloads, one per key kind, to one signature whose type parameter is the key's type. The replacement's type is derived from the key, so a mismatched replacement now reports its own type against the one the key expects, such as `Argument of type 'View<number>' is not assignable to parameter of type 'View<readonly Row[]>'`, instead of `No overload matches this call`, and a key that is neither a declared view nor a failure class is reported at the key. Inference is unchanged for declared views, declared row views, and failure classes, and a helper generic over a view's data or a failure class's instances still forwards to `override()` unchanged.
- Add the exported types `AnyOverrideKey`, every value an override can key on, and `ReplacementView<Key>`, the replacement view one key takes, so a helper generic over the key can type its replacement. See the [core reference](docs/core.md#views).

### Migration

**Affected surface.** A call to `override()` that passes an explicit type argument, such as `override<readonly Row[]>(summary, table)` or `override<InputError>(InputError, problems)`. A helper generic over a failure class's own type, such as `function f<C extends typeof UsageError>(key: C)`, that passes a concrete replacement. Any other call without a type argument compiles unchanged.

**Why.** The type parameter is now the key's type rather than the view's data or the failure class's instance type, so a data or instance type passed as the type argument no longer satisfies its constraint and fails with `TS2344`. In a helper generic over the class type, the replacement's type stays unresolved until the key is known, so a concrete replacement fails with `TS2345`.

**Before and after.**

Before, the type argument named the data:

```ts
override<readonly Row[]>(summary, table);
```

After, drop it, because the key determines the replacement's type:

```ts
override(summary, table);
```

**Steps.**

1. Find each `override<` call in the application and its plugins.
2. Remove the type argument. Where the call must name a type, type the key or the replacement instead, such as `const table: View<readonly Row[]> = …`.
3. Make a helper generic over the failure's instances instead of its class, such as `function f<F extends UsageError>(key: FailureClass<F>)`, and type the replacement's parameter as `Readonly<UsageError>`.

**Validation.** Run `tsc --noEmit` on the application. It reports no error at an `override()` call.

- Change `@loomcli/plugins/config` to read one configuration file per run, never merged: the file `--config` names, or else the first found of the application's `file` in the working directory and then in the home directory, `USERPROFILE` on Windows and `HOME` elsewhere. A broken file in the working directory warns and the lookup goes on to the home directory. See the [core reference](docs/core.md#configuration).
- Remove the `files` setting of `config()`, the key-by-key answers across several files, and the user file derived from the application name under `XDG_CONFIG_HOME`, `HOME/.config`, or `APPDATA`.
- Add the `file` setting to `config()`: the configuration file's name or relative path, `.<app>.json` by default. Its extension chooses the parser: `.toml` reads as TOML through `smol-toml` (TOML 1.0, with the TOML 1.1 additions it accepts), `.yaml` and `.yml` as YAML 1.2 under the core schema, and every other name as JSON. `file` is a file pattern whose extension may be `*`, which tries `toml`, `yaml`, `yml`, then `json`, or a brace list such as `{toml,json}`, tried in the order listed. When several candidates are present in one directory, the first answers and one warning names the others. A TOML date or time fills an option as the file wrote it, and a TOML integer beyond the safe range fills its exact digits.
- Add the `short` setting to `config()`, so an application can give `--config` a short spelling such as `-c`. `config()` judges it under `checkShortSetting`, as `format()` does.
- Add the declaration rules `@loomcli/plugins/config/file-path`, which `config()` throws for a `file` that is not a relative path, and `@loomcli/plugins/config/file-pattern`, which it throws for glob syntax outside a whole extension of `*` or a brace list, and for a brace list that names an extension the plugin cannot read. They replace `@loomcli/plugins/config/files`.
- Add `yaml` and `smol-toml` as runtime dependencies of `@loomcli/plugins`. The configuration plugin loads each only after it reads the text of a file of that kind, so a run that reads a JSON file loads neither.

### Migration

**Affected surface.** An application that calls `config({ files: [...] })` from `@loomcli/plugins/config`, and an operator whose settings live in the derived user file, `~/.config/<app>/config.json`, `$XDG_CONFIG_HOME/<app>/config.json`, or `%APPDATA%\<app>\config.json`. An application that calls `config()` with no settings compiles unchanged and now reads `.<app>.json` in the working directory and then in the home directory.

**Why.** A run now reads one file, so the list of project files and the derived user file are gone. The home directory serves the per-operator case with the same file name the working directory uses.

**Before and after.**

Before, the application listed its project files:

```ts
config({ files: ['.textstat.json'] });
```

After, it names its one file, which may let the operator choose a format:

```ts
config({ file: '.textstat.{toml,json}', short: 'c' });
```

Before, an operator kept per-user settings in `~/.config/textstat/config.json` or `%APPDATA%\textstat\config.json`. After, the same JSON lives in `~/.textstat.json`, or in the home directory under the name the application's `file` gives, such as `~/.textstat.toml` written as TOML.

**Steps.**

1. Replace `config({ files: [...] })` with `config({ file })`, naming the file the application looks for. An application that listed several files keeps the one its operators use, or names a pattern such as `.textstat.{toml,json}`.
2. Move each operator's settings from `~/.config/<app>/config.json`, `$XDG_CONFIG_HOME/<app>/config.json`, or `%APPDATA%\<app>\config.json` to `.<app>.json`, or to the application's `file`, in the home directory.
3. Merge any settings an operator kept in two files into one file, because a run no longer combines files key by key.

**Validation.** Run `tsc --noEmit` on the application. It reports no error at the `config()` call. Then run the application in a project directory with a bound option unset, and confirm that it reads the value from the project file, and from the home file when the project directory holds none.

### Changes

- Add `format({ short })` to `@loomcli/plugins/format`, so an application can give `--format` a short spelling such as `-f`. `format()` judges its settings at its own call: settings that are not an object throw `@loomcli/core/not-an-object`, and a short spelling that is not one ASCII letter throws `@loomcli/core/short-alias`, the rule every option's short spelling answers, with a finding that quotes the `format()` call. A spelling another option already holds is the hook-collision build error naming both, and `format()` with no settings still declares `--format` with no short spelling. See the [core reference](docs/core.md#formatter).
- Add `checkShortSetting(settings, declarer)` to `@loomcli/core`, so a plugin factory that takes a short spelling as `{ short }` judges it at its call under core's own rules and names itself in the finding. See [Plugin settings](docs/core.md#plugin-settings).

- Change `@loomcli/core` to carry its Unicode width tables as a JavaScript module, so it reads no file at run time and any bundler, such as `Bun.build` or Rolldown, can bundle a Loom application that starts under Node and Bun. A distributed build still needs `packet()`, the `Bun.build` plugin from `@loomcli/loom/build`; a bundle made without it is a development build. Core no longer depends on `@rockorager/uucode`, and text measures and pads to the same columns as before. Core's license field reads `MIT AND Unicode-3.0`, because the tables derive from Unicode data, and the package ships the license texts in `licenses/` with a `NOTICE`.
- Change `packet()` from `@loomcli/loom/build` to answer the packet alone. It no longer carries data files into the bundle, and an application bundled without it starts, reads its source packet, `development`, and is a development build. See [Development builds](docs/core.md#development-builds).

- Change the optional peer dependency of `@loomcli/loom` from `pnpm` 12.3.2 to 12.8.1, the version that prepares `pnpm-lock.yaml` for a release. The error for a missing pnpm now asks for 12.8.1. `@loomcli/plugins` and `@loomcli/loom` now depend on `zod` `^4.6.5`, and `@loomcli/loom` on `yaml` `^2.9.1`, so a fresh install resolves the newer releases.

- Fix the compiler error for a view whose data type does not match. Under `exactOptionalPropertyTypes`, TypeScript opened it with advice to add `undefined` to the target's properties; it now opens with the data type that does not match. `View` and the failure view mark `row` as `undefined`, and `RowView` marks `render` as `undefined`, so a value with both functions is still rejected.

## v0.6.0 - 2026-09-30

0.6.0 is the failure handling release. A failure class declares its own exit code, a translator turns a foreign throw into one of the application's failure classes, plugins add hint lines under a failure, every message Loom ships says what went wrong and what to do instead, and the manifest lists the failures each Command can raise. `@loomcli/loom` joins the release set as the Loom toolchain. Install it as a development dependency for its `packet()` build plugin.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.6.0`.

An application now has a build. The `loom.packet.json` in the source tree reads `development`, so a defect or a declaration fault prints its Developer Diagnostic for the author. The `packet()` plugin writes `distributed` into the bundle, so an operator sees `<application>: Something went wrong.` An Application given no packet is distributed, so an application that does not adopt the packet shows the generic message for a defect.

The three migrations below share one idea: a fact is declared once, where its owner states it. A failure class declares its exit code on the class, a `text()` pattern carries the author's own sentence, and a plugin, extension, or view takes its identity from its package name.

### Breaking Changes

- Change `LoomError`'s constructor to `constructor(message: string, options?: ErrorOptions)`, which takes no exit code. A failure class declares its exit code once, as `static override readonly exitCode`, and core reads it from the nearest ancestor that declares one; `failure.exitCode` reports the same value. `LoomError` declares 1 and `UsageError` declares 2, so every core class keeps its code. See [Declared exit codes](docs/core.md#declared-exit-codes) and [ADR-0045](docs/decisions/0045-a-failure-class-declares-its-exit-code.md).
- Change `ExitCode` to widen from `0 | 1 | 2 | 130 | 143` to `0 | FailureExitCode | 130 | 143`, where the exported `FailureExitCode` is every whole number from 1 through 125. Change the instance field `LoomError#exitCode` from `1 | 2` to a read-only accessor typed `FailureExitCode`, which reports the code core captured for the class at its first construction. A subclass can no longer override the instance `exitCode` as a property; it declares the static instead.

### Migration

**Affected surface.** A class that extends `LoomError` directly and passes a code to `super(message, code)`. A failure subclass that overrides the instance `exitCode` as a property. Every consumer that switches exhaustively on the published `ExitCode` type, including a `switch` with no `default` case or a type-level exhaustiveness check. Code that reads `failure.exitCode` into a `1 | 2` annotation or switches on it exhaustively.

**Why.** A code passed to the constructor exists only on an instance and lets one class exit with two codes. A static declaration states the code once, so a script branches on the code the way a view branches on the class, and a projection reads the code without constructing a failure. An application's own failure class may now exit with a code from 3 through 125, so `run()` can resolve any of them.

**Before and after.**

Before:

```ts
import { LoomError } from '@loomcli/core';
import type { ExitCode } from '@loomcli/core';

class QuotaError extends LoomError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'QuotaError';
  }
}

function category(failure: LoomError): 1 | 2 {
  return failure.exitCode;
}

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

After:

```ts
import { LoomError } from '@loomcli/core';
import type { ExitCode, FailureExitCode } from '@loomcli/core';

class QuotaError extends LoomError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

function category(failure: LoomError): FailureExitCode {
  return failure.exitCode;
}

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
    default:
      return `failed with declared code ${String(code)}`;
  }
}
```

**Steps.**

1. Remove the second argument from each `super(message, code)` call in a class that extends `LoomError`.
2. Where that argument was not 1, declare the code on the class: `static override readonly exitCode = 2;`, or a constant such as `EX_DATAERR` from `@loomcli/core`.
3. Add a case or a `default` branch for codes 3 through 125 to every exhaustive `switch` or lookup over `ExitCode`.
4. Widen each `1 | 2` annotation that holds `failure.exitCode` to `FailureExitCode`, and add a `default` branch to each exhaustive `switch` over `failure.exitCode`.
5. Replace an instance `exitCode` property on a failure subclass with `static override readonly exitCode`.

**Validation.** Run the application's type check. A remaining numeric second argument to `super` reports TS2559, because a code has no properties in common with `ErrorOptions`, an unhandled `ExitCode` member reports in the exhaustiveness check, a `1 | 2` annotation that holds `failure.exitCode` reports TS2322, and an instance `exitCode` property on a subclass reports TS2610. Run a Command that raises each migrated class and confirm the process exits with the code it exited with before.

- Change core's default text for every `UsageError` to open with the application name and a colon in place of `Invalid input: `, so `jsonkit nope` prints `jsonkit: Unknown command "nope". Use one of: doctor, completion, get, keys, select.` An `InputError` that reports several problems opens each problem line with the name, and hint lines from `onFailure` hooks carry no prefix. See [Failure messages](docs/failure-messages.md).
- Change `candidates` on `UnknownCommandError` and `NonCallableCommandError` to leave out deprecated children, as completion does. A deprecated Command typed in full still routes. With no candidates, the sentence ends with its fix: `Supply the name of a declared command.` or `Supply the name of a declared subcommand.` See [Failure classes](docs/core.md#failure-classes).
- Change the root's failure with no subcommand to `A command is required.`, followed by its candidates or its fix, and the issue for a validator that rejects with no issues to `The validator rejected this value without an explanation. Supply a different value.`
- Change core's failure sentences to escape every typed token, option spelling, and issue path they quote through `escapeControlCharacters`, so a quoted token cannot reorder the line. The failure's public fields keep the raw values.
- Change the mixed-scope `ShortGroupError` sentence to name only the two letters that disagree, `A short group mixes the global option "-q" with "-m", which is not a global option. Supply global options as separate tokens, and local options after their command name.`, because the rest of the group may hold an inline value such as a secret. `ShortGroupError.token` still holds the whole group. A global value option that is not last in its group, as in `-fhunter2`, is now the `'value-position'` fault that names that option alone, as a local value option is, and no longer a mixed-scope fault that names a letter of its value.
- Change the configuration plugin's `--config` failures to end with their fix: `File "<path>" does not exist. Supply the path of an existing file.`, `could not be read. Supply a file this process can read.`, `is not valid JSON. Correct its syntax, or supply another file.`, and `does not hold a JSON object. Write its settings as one JSON object.` Each warning about a discovered file ends with its fix too: `Make it readable, or remove it.`, `Correct its syntax, or remove it.`, or `Write its settings as one JSON object, or remove it.` See [Configuration](docs/core.md#configuration).
- Change the formatter's `json()` and `jsonl()` encode failure to `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, and for an `undefined` value to `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.` The message no longer includes the engine's reason, which differs between Node.js and Bun; the thrown error keeps the engine's error as its `cause`.
- Add `issueCode(code, { schema, message })` to `@loomcli/validators`. It declares one namespaced issue code, `<package>[/<subpath>...]/<rule-name>` as a diagnostic rule's identity reads, with its parameter schema and its sentence, and returns a frozen descriptor whose `issue(params)` builds a coded issue and whose `read(issue)` returns the typed parameters, or `undefined` for any other issue. See [Issue codes](docs/validators.md#issue-codes).
- Add the catalog's 23 code descriptors, such as `integerRangeIssue` for `@loomcli/validators/integer-range`. Every catalog rejection now carries `code` and `params` beside its message, so an `InputError` view override can reword one catalog sentence with `integerRangeIssue.read(issue)`.
- Change `path()` with no `access` to reject with `Expected a nonempty path with no NUL character.` in place of `Expected a path.`
- Change `text()` to require `message` whenever `pattern` is given, and remove the default sentence `Expected a value that matches the required pattern.` See [text](docs/validators.md#text).

### Migration

**Affected surface.** Every `text()` call from `@loomcli/validators` that passes `pattern` without `message`.

**Why.** The default sentence told the operator that a pattern exists without saying what it accepts. Only the author can say that, so the sentence for a pattern failure is now the author's `message`. See [ADR-0048](docs/decisions/0048-a-validator-package-declares-one-issue-code-per-sentence.md).

**Before and after.**

Before:

```ts
import { text } from '@loomcli/validators';

app.option('slug', { type: 'string', validate: text({ pattern: /^[a-z0-9-]+$/ }) });
```

After:

```ts
import { text } from '@loomcli/validators';

app.option('slug', {
  type: 'string',
  validate: text({
    pattern: /^[a-z0-9-]+$/,
    message: 'Expected lowercase letters, digits, and hyphens.',
  }),
});
```

**Steps.**

1. Find each `text()` call that passes `pattern`.
2. Add `message`: one sentence, beginning `Expected`, that states what the pattern accepts. Do not repeat the operator's value in it.

**Validation.** Run the application's type check. A remaining call without `message` reports TS2345, `Property 'message' is missing`, and throws a `DeclarationError` at the call when it runs: `text() pattern has no message to describe it. Supply a message that states what the pattern accepts.` Run a Command with a value the pattern rejects and confirm that stderr prints the new `message` after the input's name.

- Change `plugin()`, `extension()`, and `view()` to check their identity at the call against one grammar: an npm package name, scoped or unscoped, of lowercase letters, digits, `-`, `.`, and `_` and at most 214 characters with its scope, then zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens. `help`, `@acme/config`, and `@loomcli/plugins/help/page` pass; `Help`, `@acme`, `x//y`, and `x/under_score` throw a `DeclarationError` under `@loomcli/core/invalid-identity`, such as `A plugin declares the identity "Help", which is not a package name with optional kebab-case subpath segments.` with the fix `Name it <package>[/<subpath>...], such as "@acme/notes" or "@acme/notes/page".` An empty identity and one that is not a string report under the same rule. A hand-built descriptor in a plugin's `extensions` list, and so a source binding, is checked when `plugin()` admits the list, with the sentence `Plugin "@acme/notes" holds the extension identity "Not A Valid/ID_", which is not a package name with optional kebab-case subpath segments.` See [Identity and installation](docs/core.md#identity-and-installation).
- Add `isRuleIdentity(value)` to `@loomcli/core`. It answers whether a value is a string in the grammar of a diagnostic rule's identity, an identity followed by a kebab-case rule name, and `issueCode()` in `@loomcli/validators` checks its code with it. See [Developer Diagnostics](docs/core.md#developer-diagnostics).

### Migration

**Affected surface.** Every `plugin()`, `extension()`, and `view()` call whose identity is not a package name followed by kebab-case subpath segments, such as one with an uppercase letter, an underscore, a space, an empty segment, or a scope with no package name. Also every hand-built extension descriptor, a callable object with an `identity` and a `target`, that a plugin lists under `extensions` or binds as its `source`, whose identity is outside the grammar. Since 0.2.0 `plugin()` accepted any nonempty string, and `extension()`, `view()`, and a hand-built descriptor accepted any identity.

**Why.** An identity keys what a plugin contributes and prefixes the identities of the diagnostic rules its package declares, so it follows the package-name convention as a rule rather than by habit. See [ADR-0052](docs/decisions/0052-a-plugin-extension-and-view-identity-follows-one-grammar.md).

**Before and after.**

Before:

```ts
import { extension, plugin, view } from '@loomcli/core';

const audit = plugin('Audit', { views: [view('Audit/Report', { render })] });
const owner = extension('audit/owner_name', { schema, target: 'command' });
```

After:

```ts
import { extension, plugin, view } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

const audit = plugin(Package.name, { views: [view(`${Package.name}/report`, { render })] });
const owner = extension(`${Package.name}/owner-name`, { schema, target: 'command' });
```

**Steps.**

1. Find every `plugin()`, `extension()`, and `view()` call in the application and in the plugins it ships.
2. Name each plugin by its package name, or by the package name and a kebab-case subpath when the package ships several plugins, read from the package manifest.
3. Name each extension and view by its plugin's identity and a kebab-case suffix, including the `identity` of every hand-built descriptor a plugin lists under `extensions`.
4. Lowercase every segment and replace each underscore or space with a hyphen.

**Validation.** Import each module that declares a plugin, an extension, or a view, or run the application's test command. A remaining identity outside the grammar throws `@loomcli/core/invalid-identity` when its module evaluates, with a finding that marks the identity.

### Changes

- Allow a failure class to declare its own exit code from 1 through 125 as `static override readonly exitCode`, so a `FatalError` subclass such as a registry failure exits 69 wherever it is raised: from an action, a middleware, or a configuration source. A subclass that declares nothing exits with its parent's code. A class that declares 0, a code from 126 up, or a value that is not a whole number throws a `DeclarationError` under `@loomcli/core/failure-exit-code` when it is constructed, whose sentence is `Failure class "RegistryUnavailableError" declares exit code 130.` and whose correction is `Declare a whole number from 1 through 125.` See [Declared exit codes](docs/core.md#declared-exit-codes).
- Add the `sysexits.h` names to `@loomcli/core` as flat constants with literal types, `EX_USAGE` 64 through `EX_CONFIG` 78. `EX_OK` is not exported.
- Change a configuration source's thrown or rejected `LoomError` to report with its class's code, as an action's failure does. A source that calls `out.fatal()` now prints the message alone and exits 1, where it printed a plugin fault. A plain `Error` that no translator answers, and any failure thrown while core reads the answers, stays the plugin fault with code 1.
- Fix a thrown value that inherits from a failure class without being constructed by one, such as `Object.create(FatalError.prototype)`, to report a defect with code 1, whose sentence is `A thrown value inherits from a failure class but was never constructed as one.`, where it exited 0 with nothing on stderr. `run()` now resolves only 0, a code from 1 through 125, 130, or 143.

- Add `application`, `path`, and `hints` to every failure view's context, typed by the exported `FailureViewContext`. `path` holds the canonical Command names routing walked: `[]` before routing, the partial path for an unknown Command, and the routed path otherwise. `override(FailureClass, view)` now types its replacement as the exported `FailureView`, and an override written against `ViewContext` compiles unchanged. See [Failure view context](docs/core.md#failure-view-context).
- Add the optional `onFailure` plugin hook, typed by the exported `FailureHook` and `FailureHookContext`. Core calls each installed plugin's hook, in installation order, for every failure `run()` renders after graph build, and the failure's view receives the hints they return. Core's default text prints each hint on its own line under its sentence, and a failure with no hints adds no lines. A hook that throws, returns something other than a string or an array of strings, or returns a promise loses its hints, is reported after the diagnostic as a defect, the generic defect message in a distributed build and a Developer Diagnostic naming the plugin and the reason in a development build, and makes the run return 1 unless it was cancelled. `plugin()` rejects an `onFailure` that is not a function. See [Failure hints](docs/core.md#failure-hints).
- Change validation to keep every own field of an issue a validator returns, rewriting only `path`, so a field such as a schema library's issue `code` reaches an `InputError` view. See [Issues and validator failures](docs/core.md#issues-and-validator-failures).
- Add `escapeControlCharacters`, which replaces every control character and line separator in raw text, and every bidirectional control and mark, U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, and U+061C, with its lowercase `\uXXXX` escape, so escaped text stays on one line and cannot reorder the rest of it. Other format characters, such as a zero-width joiner or a soft hyphen, pass through. See [Strings and composition](docs/core.md#strings-and-composition).
- Fix a thrown value whose message cannot be read, such as an Error whose `message` getter throws, suppressing the failure it caused. Wherever core reports a thrown value, from an action, a failure view, a hook, a plugin loader, or a configuration source, it now reports `The thrown value has no readable message.` as its reason. See [Failure contract](docs/core.md#failure-contract).

- Add the suggestions plugin, `suggestions()` from `@loomcli/plugins/suggestions`. When an unknown Command or option is near a declared name, the failure's sentence offers that name as its fix, as in `jsonkit: Unknown command "gte". Did you mean "get"?` or `Did you mean one of these: --file, --field?`, in place of core's fix clause. It never offers an alias, a hidden member, a deprecated member, or a short spelling, and with no near name it prints core's text unchanged. An application's own override of either failure class, or of a class above them, still owns the sentence. See [Suggestions](docs/core.md#suggestions).
- Change `help()` to add one hint under every usage error that names the help page of the Command routing reached, as in `Run "jsonkit get --help" to see the usage.` A fatal error, an internal error, and a declaration error gain no line. See [Help's failure hint](docs/core.md#helps-failure-hint).

- Add translators, so a foreign throw such as the `SyntaxError` from `JSON.parse` reports as one of the application's own failure classes, with that class's exit code and view, instead of an internal error with exit 1. `translate(ErrorClass, translator)` pairs an error class with a function that receives the thrown instance, typed from the class, and returns a failure or `undefined` to pass. The Application and each plugin list their translations under `translators`, and they resolve in the order view overrides do: the application's first, then each plugin's in installation order, the thrown value's prototype chain walked in full at each. A throw from an action, from a middleware before its `next()` has settled, and from a configuration source is offered, and so is a destination write failure such as `EPIPE` that the action awaits and lets propagate, and a row source's throw under `out.results()`, whether the action awaited the call, never awaited it, or caught its rejection; for the last two the translated failure replaces the deferred internal error, prints after the incomplete-result line, and sets the exit code a clean run would have left at 0; a `LoomError`, a thrown primitive, a cancellation echo, and a throw from a view, an `onFailure` hook, a validator, or a plugin loader are never offered. A throw no translator answers still reports as an internal error with exit 1. See [Translators](docs/core.md#translators).
- Add the exported `translate`, `Translation`, `Translator`, and `ErrorClass`. A `translators` entry that is not a translation throws a `DeclarationError` from `plugin()` or the Application constructor, and so does `translate()` with a key that is not a class, a key that is a failure class such as `LoomError` or a subclass of `FatalError`, since a failure is never offered to a translator, or a translator that is not a function.
- Change a translator that throws, or returns a value that is not a failure, a promise included, to report a defect under the rule `@loomcli/core/broken-translator` with exit 1. No later translator is consulted. A development build prints its Developer Diagnostic, whose sentence names who registered the translator and the class it was keyed on, such as `The translator the Application registered for "SyntaxError" threw: <reason>`, and which shows the translator's throw and the original throw under it. A distributed build prints the generic defect message. The defect's `cause` is an `AggregateError` that holds the translator's throw and then the original throw, or the original throw alone for a returned value.
- Allow `LoomError`, `FatalError`, `InputError`, and `DeclarationError` to take the platform's `ErrorOptions` as their last constructor parameter, so a failure keeps the error it replaces as `cause`, as in `new InvalidJsonError({ cause: error })`. Core sets no `cause` on a failure it did not construct.

- Add `failures` to `manifestCommand` from `@loomcli/plugins/manifest/extension`, so an author or a plugin's `onCommandAttach` hook declares the failures a Command can raise, each as `{ failure, meaning, name }`: a class that extends `LoomError`, one line of meaning, and a kebab-case name. The value reads the class's declared exit code when it is made. A value that is not a failure class, a class whose static `exitCode` is outside 1 through 125 or whose `exitCode` getter throws, a value whose `prototype` read throws, a name that is not kebab-case, and a meaning that is not one line are rejected at the call. See [Manifest failures](docs/core.md#manifest-failures).
- Change `--manifest` to list each Command's declared failures under `failures` as `{ name, exitCode, meaning }`, in collection order with an identical entry printed once, and `[]` where a Command declares none. `exitCodes` gains a row for each declared code other than 1 and 2 anywhere in the application, hidden Commands included, such as `"65": "Declared failures: invalid-json, path-not-found"`. One failure name declared with two codes or two meanings makes `--manifest` report a declaration fault with code 1 under the rule `@loomcli/plugins/manifest/failure-name-conflict`, whose sentence is `Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".` and whose correction is `Declare one code and one meaning for each failure name.`, with a finding for each declaration that marks the code or the meaning the two disagree on, by build as [Development builds](docs/core.md#development-builds) states.

- Add the `packet` Application option and the exported `Packet` type. An application imports its `loom.packet.json` as a JSON module and passes it as `packet`; its `build` reads `development` or `distributed`, and an Application given no packet is distributed. `new Application()` rejects a packet that is not a plain object or whose `build` is neither value, and ignores every other member. See [Development builds](docs/core.md#development-builds).
- Change how `run()` reports a defect, an `InternalError` or a `ResultError`, and a declaration fault it meets, a `DeclarationError`. A distributed build writes `<application>: Something went wrong.` through the failure's view, at most once per run, so `override(InternalError, view)` and `override(DeclarationError, view)` replace it, and an `onFailure` hint prints under it. A development build writes the fault's Developer Diagnostic ahead of every view override, with the hints under it. A usage error, a `FatalError`, and an application's own failure class print the same bytes in both builds. The `Invalid declaration: ` and `Internal error: ` prefixes are gone.
- Change a broken failure view and a broken `onFailure` hook to report, after the failure's own text, the generic defect message at most once per run in a distributed build, and one Developer Diagnostic per broken contract in a development build, in place of their `Internal error: ` lines.
- Add `diagnosticRule(identity, { headline, explanation, docs })`, which declares one Developer Diagnostic rule and returns a frozen descriptor, and the exported `DiagnosticRule`, `Finding`, and `DiagnosticParts` types. A rule's identity is `<package>[/<subpath>...]/<rule-name>`, the package name, any kebab-case subpath segments that name the part of the package that owns the rule, and a kebab-case rule name, such as `@acme/retry/retry-limit` or `@loomcli/plugins/manifest/failure-name-conflict`. `new DeclarationError(rule, { sentence, findings, correction }, options)` and `new InternalError(rule, { sentence, correction, cause })` take a rule beside their earlier constructors, and each class carries `rule`, `sentence`, and `correction`, with `findings` on `DeclarationError`. See [Developer Diagnostics](docs/core.md#developer-diagnostics).
- Change `DeclarationError.message` to hold the fault's whole Developer Diagnostic as plain text at 80 columns, a banner, the sentence, and the rule's other parts, so a fault thrown at an authoring call prints its diagnostic through the runtime's own uncaught-error output. `sentence` holds the sentence alone.
- Add the optional `Host.readSource(path, cwd)`. A development build reads a defect's source through it, for a frame under the working directory and outside `node_modules` alone, and prints the lines around the failing frame with a caret under its column, above the cause chain. The chain prints each error an `AggregateError` holds under `Holds `, and the source comes from the first of them with a frame under the working directory. Process capture supplies a reader that refuses a file outside `cwd` after resolving symbolic links, a path that is not a regular file, and a file larger than 1 MiB.
- Change a validator that throws, rejects, or returns a malformed result to report under the rule `@loomcli/core/validator-failed`, with a full stop after the thrown reason, a finding that marks `validate` on the call that declared the input, and the thrown value as its `cause`. A distributed build shows the generic defect message in its place.
- Publish `@loomcli/loom`, the Loom toolchain, whose public surface is `@loomcli/loom/build`. Install it as a development dependency. It exports `packet()`, a `Bun.build` plugin that writes `distributed` into the packet a bundle or a compiled binary carries and leaves the source packet reading `development`. It also carries into the bundle the data files core's Unicode tables read at run time, without which a bundled Loom application cannot start, and fails the build when a table module reads them in a shape it does not recognize. Build a compiled binary with `Bun.build` and its `compile` option, because the `bun build` command line takes no plugin.
- Change core's invocation-time defects to report under rules of their own: a middleware's bad `view` assignment under `@loomcli/core/view-selection`, a configuration source's rejected answers under `@loomcli/core/source-answers`, a `run()` signal that is not an `AbortSignal` under `@loomcli/core/run-options`, whose sentence and correction are now separate, a graph `inspect()` did not return under `@loomcli/core/foreign-graph`, and a failed destination write under `@loomcli/core/broken-destination`, which writes the generic defect message in a distributed build and its Developer Diagnostic in a development build.
- Change the declaration faults core raises for Commands, names, aliases, nesting, children, actions, results, views, and the description, version, `hidden`, and `deprecated` facts to carry a rule of their own, such as `@loomcli/core/portable-name` and `@loomcli/core/sibling-name-taken`, with findings that rebuild the faulty call under the Command path it sits on, the rule's explanation, and the fix. Each fault's `sentence` holds what is wrong and its `correction` the fix, which its `message` prints after the explanation. A `hidden` value that is not a Boolean reads `Command "fetch" declares hidden that is not a Boolean.` with the fix `Use true or false.` under `@loomcli/core/flag-not-boolean`, and options that are not an object read `Command "get" declares options that are not an object.` or `The Application declares options that are not an object.` under `@loomcli/core/not-an-object`. Every name, identity, and key a declaration sentence quotes prints each control character escaped, and a value that is not a string prints as code, such as `Command name 7 is invalid.` See the Rule columns of [Command declaration errors](docs/core.md#command-declaration-errors) and [Result declaration errors](docs/core.md#result-declaration-errors).
- Change the declaration faults core raises for options, arguments, validators, defaults, global options, and environment bindings to carry a rule of their own, such as `@loomcli/core/boolean-option-multiple`, `@loomcli/core/spelling-taken`, and `@loomcli/core/invalid-default`, with findings that mark the key of the faulty call at fault, a finding for each side of a collision, and the rule's explanation. Several sentences now state the key at fault: a Boolean option reads `Option "verbose" is Boolean and declares default.` with the fix `Remove default; use polarity to control its absent value.`, a short alias reads `Option "file" declares a short alias that is not one ASCII letter.`, `shortOnly` with no short alias reads `Option "file" declares shortOnly and no short alias.`, and a global option with a presence rule is fixed by `Remove required, and check for the value in each Command that needs it.` A `multiple`, `shortOnly`, `required`, `variadic`, or `validateOmitted` value that is not a Boolean reads `Command "get" option "file" declares required that is not a Boolean.` with the fix `Use true or false.` A collision with a plugin option, or with an input a plugin's `onCommandAttach` hook declares, reports under the rule the same collision between the application's own inputs breaks, such as `@loomcli/core/option-declared-twice` or `@loomcli/core/spelling-taken`, and its sentence names the plugin. A hook-declared argument or option whose name an input of the other kind holds reports under `@loomcli/core/name-shared-across-kinds`. An `argument()`, `option()`, or `globalOption()` call whose config is missing or is not an object reports under the same rule as `Option "format" declares a config that is not an object.` with the fix `Supply an option config object, such as { type: 'string' }.`, or `Argument "path" declares ...` with `Supply an argument config object, such as {}.`, and no longer throws a TypeError. See [Input declaration errors](docs/core.md#input-declaration-errors).
- Change a validator whose JSON Schema converter throws, returns anything but a plain object, or answers with an object core cannot copy, such as one whose getter throws, to be a `DeclarationError` under `@loomcli/core/schema-converter-failed` in a development build, from `run()` and from `inspect()`, naming the input, the target, and the thrown reason, with the thrown value as its `cause`. A development build asks every validated input's converter at build on every run. A distributed build still reads the input's schema as `null`. See [Input schema](docs/core.md#input-schema).
- Change the declaration faults core raises for plugins, extensions, extension values, declared views and overrides, translations, `onCommandAttach` hooks, a plugin theme, the Application's `plugins`, `packet`, `rendering`, and retired `globals` and `failures` options, a failure class's exit code, and `diagnosticRule()` itself to carry a rule of their own, such as `@loomcli/core/slot-taken`, `@loomcli/core/foreign-value`, and `@loomcli/core/invalid-extension-value`, with findings that rebuild the key, the list entry, or the key inside it at fault, and a finding for each entry of a repeat. Several sentences changed: a `plugins` value that is not an array reads `The Application declares plugins that are not an array.`, and a `translators`, `views`, or `extensions` value `... declares translators that are not an array.`, with `views` and `extensions` in its place; an extension descriptor's `collect` that is not a Boolean reports under `@loomcli/core/flag-not-boolean` with the fix `Use true or false.`; a failure class's exit code is fixed by `Declare a whole number from 1 through 125.`; an override keyed on neither a declared view nor a failure class reads `The Application overrides a key that is neither a declared view nor a failure class.`; `translate()` with a failure class as its key is fixed by `Key the translation on the foreign class it replaces.`; a rendering policy reads `The rendering policy is not an object.` and `Rendering color is not auto, always, or never.`; a plugin theme reads `Plugin "@acme/theme" declares a theme that is not a mapping.` and `... theme mapping "highlight" is not an unapplied concrete style chain without semantic tokens.`; and a throwing `onCommandAttach` hook now escapes its reason, keeps the thrown value as `cause`, and gains a fix, as does a hook's spelling collision. See the Rule column of [Plugin declaration errors](docs/core.md#plugin-declaration-errors).
- Change the declaration faults `@loomcli/plugins` and `@loomcli/validators` raise to carry rules they declare through the public `diagnosticRule()` under their package names and, for a plugin the pack ships as a subpath, that plugin's subpath: `@loomcli/plugins/config/files` for a configuration `files` setting that is not a list of paths, and fifteen catalog rules such as `@loomcli/validators/bounds-order` and `@loomcli/validators/issue-code-config`, each with a finding that rebuilds the factory call and marks the argument or key at fault. A validator that reads the validation context outside a run gains the fix `Call the validator through an Application run, or leave the context unread.` See [Faults at the call](docs/validators.md#shared-rules).

## v0.5.0 - 2026-09-27

0.5.0 is the operator ergonomics release. An option now takes its value from argv, an environment variable, a configuration file, or its default, in that order, through one core input-source stage; the configuration plugin reads layered JSON files; a plugin can attach ordinary Commands to the root; `-h` prints compact help and `--help` the extended page; and the completion plugin prints Bash, Zsh, and Fish scripts that complete Command names, option spellings, and closed-set values without ever evaluating typed text. `@loomcli/validators` joins the release set as a catalog of Standard Schema validators.

Pin `@loomcli/core`, `@loomcli/plugins`, and `@loomcli/validators` to `0.5.0`. The four migrations below share one idea: a rule is checked at the earliest point that knows it, once, in one place. A declaration fault throws at the call, the attach, or the build that first sees it rather than at the first run; each value of a multiple option or variadic argument passes the same validator instead of the list passing once; a global option declares no presence rule, so a Command that needs its value checks for it; and application, Command, and alias names hold to the portable filename set.

### Breaking Changes

- Change when a declaration fault throws. Every authoring call, both constructors, `plugin()`, and every `command()` attach throw `DeclarationError` the moment their data is known to be bad, so a JavaScript author's invalid declaration throws when its module evaluates, with a stack at the offending line, instead of being reported by `run()` or `inspect()`. Only the root's finished-Command rules and lifecycle hook faults still surface from `run()` or `inspect()`, and a default its schema rejects surfaces from `run()` alone. Diagnostics keep their text, except that an invalid Command name now reads `Command name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".` from `new Command()`. See [Declaration faults](docs/core.md#declaration-faults).
- Change the Command graph to nest at most two levels below the root. `command()` on a named Command rejects a child that has children of its own: `Command "cache" attaches child "clear", which has children of its own. Nest Commands at most two levels below the root.` See [Nested Commands and groups](docs/core.md#nested-commands-and-groups).

### Migration

**Affected surface.** JavaScript authors, and TypeScript authors who pass values through `any`, whose declarations hold a fault; code that caught a declaration fault from `run()` or `inspect()`; and any application whose Command paths nest three or more levels below the root.

**Why.** A fault known at the call now throws where the author made it, rather than from a stack inside core during a run. A bounded depth keeps every Command path discoverable and every attach check local.

**Before and after.**

The throw at the call. Before, a fault surfaced from `run()` as a diagnostic with exit code 1:

```js
const list = new Command('list').option('verbose', { multiple: true, type: 'boolean' });
const code = await new Application('app').command(list).run(); // Invalid declaration: ..., code 1
```

After, the `option()` call throws `DeclarationError` when the module evaluates, so fix the declaration itself:

```js
const list = new Command('list').option('verbose', { type: 'boolean' });
const code = await new Application('app').command(list).run();
```

The nesting cap. Before, a three-level path such as `app store cache clear` was accepted:

```js
const cache = new Command('cache').command(clear);
const app = new Application('app').command(new Command('store').command(cache));
```

After, `command()` on `store` throws, so attach the group one level higher and route it as `app cache clear`:

```js
const cache = new Command('cache').command(clear);
const app = new Application('app').command(cache);
```

**Steps.**

1. Fix each declaration fault the application's modules now throw at import.
2. Move any `try`/`catch` that expected a declaration fault from `run()` or `inspect()` to the call that makes the declaration.
3. Attach each group that sits below a named Command to a shallower parent, or flatten its children into it.

**Validation.** Import each module that builds the application and run its test command; no `DeclarationError` should throw, and `inspect()` should list every Command path at most two levels below the root.

- Change `validate` on a multiple option or a variadic argument to name the validator for one value. Core runs it once for each value in order, and the action receives the array of outputs. An issue reads at its value's position, as `Option "--field" at 1: Expected a nonempty value.`
- Change an omitted multiple option or variadic argument to call no validator. The action receives `[]`, and `required: true` remains the rule for at least one value.
- Change a validated default of a multiple option or a variadic argument to an array of the validator's input type. Each default value passes through the validator, and a rejected one names its position. A default that is not an array throws `Option "field" default must be an array. Supply an array of values.` from the declaring call.
- Change the input schema of a multiple option or a variadic argument to the validator's own schema, unchanged. Help reads its accepted values from the top of that schema instead of under `items`, and the manifest's `tokens` note says each token of such an input satisfies the schema alone.
- Change input diagnostics to say "validator" where they said "schema", such as `default must be an array of strings without a validator.`

### Migration

**Affected surface.** A multiple option or a variadic argument that declares `validate` with a validator of the whole array, such as `z.array(...)`, a rule over the list, or a transform of the list. A manifest or help reader that looks for accepted values under `items`. Code that matches the text of the reworded diagnostics.

**Why.** A validator now means the same thing wherever it is declared, so a validator such as `integer()` works on a single option and on a multiple one. See [ADR-0036](docs/decisions/0036-each-value-passes-the-same-validator.md).

**Before and after.**

Before:

```ts
.option('field', {
  multiple: true,
  type: 'string',
  validate: z.array(z.string().min(1)).max(3, 'Supply at most three fields.'),
})
```

After:

```ts
.option('field', { multiple: true, type: 'string', validate: z.string().min(1) })
.action(({ options }) => {
  if (options.field.length > 3) {
    throw new InputError('Option "--field": Supply at most three fields.', [
      {
        input: { global: false, kind: 'option', name: 'field' },
        issues: [{ message: 'Supply at most three fields.' }],
        reason: 'invalid',
        spelling: '--field',
      },
    ]);
  }
  // ...
});
```

**Steps.**

1. Replace each `z.array(value)` validator on a multiple option or a variadic argument with `value`.
2. Move any rule over the whole list, such as a count, uniqueness, or a rule for an empty list, into the action. Throw `InputError` from the action to keep exit code 2.
3. Move any transform of the whole list into the action, which now receives the array of each value's output.
4. Write a validated default of a multiple option or a variadic argument as an array of raw values, such as `default: ['a']` in place of `default: 'a'`.
5. Read the accepted values of a multiple option or a variadic argument from the top of its input schema, beside the node's `multiple` or `variadic` flag.

**Validation.** Run the application's type check: TypeScript rejects a validator on a multiple option or a variadic argument whose input does not accept one `string`. Run the application's tests for each migrated input with no values, one value, and a rejected value.

- Remove presence rules from global options. `Application.globalOption()` rejects `required` and `validateOmitted`, whatever their value: TypeScript reports a compile error, and the call throws a `DeclarationError` for a JavaScript caller. An omitted global option is `undefined`, its default, or `[]`, so a Command that reads no such value, a plugin Command included, runs without it. See [ADR-0044](docs/decisions/0044-a-global-option-declares-no-presence-rule.md).

### Migration

**Affected surface.** Applications that pass `required` or `validateOmitted` to `Application.globalOption()`.

**Why.** A global option's validation runs on every Command, so a rule that the value must be supplied failed Commands that never read it, such as a plugin's `doctor` or shell completion Command.

**Before and after.**

Before:

```ts
const configured = new Application('jsonkit').globalOption('file', {
  required: true,
  type: 'string',
});

export const getValue: ActionHandler<typeof get> = async ({ options, out }) =>
  out.print(options.file);
```

After, the global is optional and each action that needs the value checks for it:

```ts
const configured = new Application('jsonkit').globalOption('file', { type: 'string' });

export const getValue: ActionHandler<typeof get> = async ({ options, out }) => {
  if (options.file === undefined) {
    throw new InputError('Option "--file": Supply a file.', [
      {
        input: { global: true, kind: 'option', name: 'file' },
        issues: [{ message: 'Supply a file.' }],
        reason: 'invalid',
        spelling: '--file',
      },
    ]);
  }
  return out.print(options.file);
};
```

**Steps.**

1. Remove `required` and `validateOmitted` from every `globalOption()` call.
2. Where the omission rule lived in a validator under `validateOmitted`, remove that validator or keep only the part that checks a supplied value.
3. In each action that needs the value, check for `undefined` and throw an `InputError`, or declare a default when one value fits every Command.
4. Update the type of each read from `string` to `string | undefined` where no default was added.

**Validation.** Run the application's type check; any remaining `required` or `validateOmitted` on a global is a compile error. Run each Command that does not read the global with the global omitted, and confirm it exits 0. Run each Command that does read it with the global omitted, and confirm it reports the input error with exit code 2.

- Change the rule for the application name, every Command name, and every alias to the portable name: `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`. `new Application()`, `new Command()`, and `alias()` throw a `DeclarationError` for any other name: `Application name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".`, and the Command and alias diagnostics end with the same correction. Argument, option, and view names keep the declared-name rule: nonempty, not starting with `-`, and without whitespace or `=`. See [Application declarations](docs/core.md#application-declarations) and [Command declaration errors](docs/core.md#command-declaration-errors).

### Migration

**Affected surface.** Applications whose application name, Command name, or alias holds a character outside `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, or starts with `.`, such as a name with a slash, a colon, or a non-ASCII letter. The application name was never checked before, so an empty name or one with whitespace, a line terminator, or a leading hyphen was accepted too, and Command names and aliases rejected only an empty name, whitespace, `=`, and a leading hyphen. Code that matches the text of the Command name or alias diagnostic.

**Why.** Each of these names is typed as a command at a shell prompt, and shell completion writes the application name into a script. One rule shared by all three keeps every name typeable and every script safe without a per-shell escape.

**Before and after.**

Before:

```ts
const app = new Application('my tool').command(new Command('get/all').alias('ls:all').action(run));
```

After:

```ts
const app = new Application('my-tool').command(new Command('get-all').alias('ls-all').action(run));
```

**Steps.**

1. Rename each application name, Command name, and alias that holds a character outside the portable set or starts with `.`, and each application name that is empty or starts with `-`.
2. Update any test or code that matches the old Command name or alias diagnostic text.

**Validation.** Import the application's modules; a name outside the rule throws when its module evaluates. Run the application's own test command.

### Changes

- Add environment bindings. A local, global, or plugin option that is not `multiple` accepts `env`, the variable that supplies the option when argv does not. A filled value is supplied in every sense: it satisfies `required`, reaches the schema and the validation context's `supplied` record as the raw value, activates a plugin's middleware, and reads to the action exactly as the flag would. An empty variable is unset. A Boolean variable reads `true`, `1`, `false`, or `0`, case-insensitive, and any other value fails with `Option "--verbose" (from VERBOSE): Use true, false, 1, or 0.` A failure on a filled value names its source in parentheses after the option. See [Input sources](docs/core.md#input-sources).
- Add configuration sources. A plugin definition may declare `source: { binding, load }`, and core loads it lazily and calls it once, with the host, the plugin's own option values, the `OptionNode` of every in-scope option that argv and the environment left unfilled, that holds no environment fault, and that carries the binding, the graph `inspect()` returns, and the `out` and `style` a middleware and an action read. Its answers fill after argv and the environment and before the declared default. A resolver that throws an `InputError` reports it as a usage failure with code 2, held like a validation fault in place of every collected problem; every other throw is a plugin fault with code 1, and its `out.results()` call is a `ResultError` of the kind `source`. Core exports `SourceResolver`, `SourceContext`, `SourceAnswer`, and `ContextualStyle`. An application installs at most one source.
- Add `env` to every `OptionNode` that `inspect()` returns and to every option entry of the manifest: the bound variable, or `null`.
- Bind textstat's `--min-bytes` to `TEXTSTAT_MIN_BYTES` and `--total` to `TEXTSTAT_TOTAL`.

- Add plugin Commands. A plugin definition may declare `commands`, a list of Command values that core attaches to the root, in installation and list order and ahead of the application's own Commands. A plugin Command is an ordinary Command: it routes, validates, runs, and appears in help, `inspect()`, and the manifest like any other, and a name or alias that repeats another root child's fails the build. An application whose root declares arguments cannot install a plugin that brings Commands. See [Plugin Commands](docs/core.md#plugin-commands).

- Add `@loomcli/validators`, a catalog of validators for common input shapes without a schema library: `text`, `integer`, `number`, `port`, `oneOf`, `url`, `uuid`, `date`, and `path`. Each factory returns a Standard Schema value that publishes a sound input schema, so help prints `One of: ...` for a `oneOf` input with no authored line. See the [validators reference](docs/validators.md).
- Add `createValidator` to `@loomcli/validators`, which builds a validator from a parse function and an optional input schema, the same way every catalog factory is built.

- Add the configuration plugin, `config()` at `@loomcli/plugins/config`, with its binding `configInput({ path })` at `@loomcli/plugins/config/extension`. An option that carries the binding reads a dotted path from JSON files: a user file derived from the application name, `$XDG_CONFIG_HOME/<name>/config.json`, `$HOME/.config/<name>/config.json`, or `%APPDATA%\<name>\config.json` on Windows, and the project files `config({ files })` lists, most specific first. Files answer key by key, the first listed winning and the user file last. `--config <path>` reads that file alone. A discovered file that is missing is silent, and one that cannot be read, is not JSON, or is not an object warns once and is skipped, while the named file and a value the option cannot take fail the run with code 2. A string option takes a JSON string or number, a Boolean option a JSON Boolean, and a multiple option an array of strings or numbers. See [Configuration](docs/core.md#configuration).
- Install the configuration plugin in textstat with `.textstat.json` as its project file, and bind `--min-bytes` to `minBytes` and `--total` to `total`.

- Change `-h` to print a compact help page: the extended page without the details and EXAMPLES blocks, with the child hint spelled `-h` and a closing `Run <path> --help for details and examples.` when the extended page holds either block. `--help` prints the page it printed before. `HelpPage` gains `variant`, typed by the exported `HelpVariant` at `@loomcli/plugins/help/views`, so a `helpPage` override can print a page per variant. See [Help variants](docs/core.md#help-variants).
- Add `spellings` to the middleware context, typed by the exported `PluginOptionSpellings`: the spelling that supplied each of the plugin's own options given as a token, such as `-h`, `--help`, or `--no-total`. An option filled by an input source or left to its default has no entry. See [Middleware](docs/core.md#middleware).

- Add `locate(graph, words)` and the `WordPosition` type. `locate` reads the words of an unfinished invocation against a graph `inspect()` returned, with the parser's own grammar, and reports where the last word sits: a Command name, an option spelling, an option's value, an argument, the passthrough tail, or nowhere. It runs no validator, input source, or middleware, and it throws nothing for any list of strings. See [Locating a word](docs/core.md#locating-a-word).
- Add `graph` and `command` to the action context. Every action, an application's or a plugin Command's, reads the frozen graph `inspect()` returns for the run and the routed node inside it, the same two values the run's middleware receive. See [Invocation](docs/core.md#invocation).
- Add the completion plugin, `completion()` from `@loomcli/plugins/completion`. It attaches a `completion` Command whose `bash`, `zsh`, and `fish` children print a script the operator's shell sources. On each Tab the script calls the application with the typed words and inserts the canonical Command names, option spellings, and closed-set values that fit the word under the cursor. The scripts are ported from Cobra and never evaluate typed text. See [Completion](docs/core.md#completion).
- Change the `@loomcli/plugins` license field to `MIT AND Apache-2.0`. The three completion script modules ported from Cobra stay under Apache-2.0, with Cobra's notice and license text shipped in the package; every other file stays MIT. An application that installs the package takes on no license obligation beyond keeping those notices with the files.

- Add the MIT license text to every published package. `@loomcli/core`, `@loomcli/plugins`, and `@loomcli/validators` each ship a `LICENSE` file holding the MIT terms their manifests declare, and the repository root carries the same file.

## v0.4.0 - 2026-09-25

0.4.0 adds the manifest: `--manifest` prints the routed Command's slice of the command graph as JSON, so an agent can build a correct invocation before it runs one. Every validated input publishes its JSON Schema as a graph fact, help rows state the values an input accepts, and collecting extensions let help and any other plugin supply prose to the manifest without the manifest knowing them.

Pin both `@loomcli/core` and `@loomcli/plugins` to `0.4.0`. The migrations below cover hand-built extension descriptors, which must now publish `collect`, and help snapshots and readers of the formatter's `--format` description.

### Breaking Changes

- Require every extension descriptor to publish `collect` as `true` or `false`. `AnyExtension` now includes `collect`, `extension()` publishes it, and build rejects a descriptor whose `collect` is missing or not a Boolean with `Extension "<identity>" declares collect that is not a Boolean. Supply true or false, or build the descriptor with extension(identity, config).`

### Migration

**Affected surface.** A plugin or application that lists a hand-built descriptor object, one not returned by `extension(identity, config)`, in a plugin's `extensions`, and TypeScript code that constructs an `AnyExtension` value by hand. Descriptors built with `extension()` are unaffected.

**Why.** A descriptor now says whether its values collect or replace each other, and build reads that flag for every descriptor it meets.

**Before and after.**

Before, a hand-built descriptor:

```ts
const notes = { identity: '@acme/notes/command', schema, target: 'command' };
```

After, built by the factory, which publishes `collect: false`:

```ts
import { extension } from '@loomcli/core';

const notes = extension('@acme/notes/command', { schema, target: 'command' });
```

**Steps.**

1. Find every descriptor object your code builds without calling `extension()`.
2. Replace each with `extension(identity, { schema, target })`, or add `collect: false` to the object.

**Validation.** Run the application's type check, then run `inspect()` or any command of the application. A remaining hand-built descriptor fails the build with the diagnostic above.

- Add accepted values to help pages. An option or argument row states the values its input accepts after its description: an authored `accepts` line, or `One of: …` derived from a closed set of strings in the input schema, up to eight values, when nothing beside the set could narrow it. See [Accepted values](docs/core.md#accepted-values).
- Add `accepts` to `helpInput`, and add `helpArgument`, the argument-targeted help extension that carries `accepts`, both from `@loomcli/plugins/help/extension`.
- Change the formatter's `--format` description to `Select the output format, <default> by default.` The help page lists up to eight view names as the row's accepted values, and the option's schema carries every name.

### Migration

**Affected surface.** Exact-byte consumers of the default help view, including help snapshots, for any option or argument whose schema is a closed set of strings. Consumers that read the view names from the `--format` option's description through `inspect()` or the manifest.

**Why.** A help row now states the values an input accepts, so a reader chooses a valid value before the first run, and the formatter's description stops repeating the view names the row now lists.

**Before and after.** textstat's `--metric` row changes from `What each row counts.  (default: bytes)` to `What each row counts. One of: bytes, words, lines.  (default: bytes)`. The formatter description changes from `Select the output format: table, json, jsonl. Default: table.` to `Select the output format, table by default.`

**Steps.**

1. Update help snapshots for the accepted-values sentences and the new formatter description.
2. Read the view names from the `--format` option's `schema.enum` in `inspect()` or the manifest instead of parsing its description.
3. Where a derived list reads poorly, give the input an `accepts` line through `helpInput` or `helpArgument`.

**Validation.** Run the application's help snapshots and any reader of the format option. This repository checks the pages and the installed packages with:

```sh
pnpm exec vp test --run packages/plugins/tests/help-accepted.test.ts
LOOM_TEST_RUNTIME=bun pnpm exec vp test --run packages/plugins/tests/help-accepted.test.ts
pnpm run check:packed
```

### Changes

- Add `schema` to every `ArgumentNode` and `OptionNode` that `inspect()` returns: the input-side JSON Schema a validated input's validator publishes through the Standard JSON Schema converter, requested for `draft-2020-12`, copied and frozen to every depth, or `null` where the graph holds no published shape. A validator with no converter, an unvalidated input, a Boolean option, and a converter that fails all read `null`. See [Input schema](docs/core.md#input-schema).
- Add the `StandardJSONSchemaV1` type export beside `StandardSchemaV1`, so a hand-written schema declares its converter with the standard's own type.
- Change the formatter's `--format` validator so its declared shape is the enum of the view names and the unadvertised `ndjson` mapping is applied before it, so the option publishes the view names alone. Accepted values and diagnostics are unchanged.

- Add collecting extensions. An extension declared with `collect: true` keeps every value the author or a plugin's `onCommandAttach` hook supplies, in order, instead of replacing the earlier value, and `readExtension` returns them as a read-only list, empty where a declaration carries none. See [Collecting extensions](docs/core.md#collecting-extensions).
- Allow a lifecycle hook to read a Command's extension values through `AttachedCommand.extensions` and `readExtension`. A value a hook passes to `extend()` is validated at the call, so a hook that catches the rejection continues without the value, and build validates each value once.
- Add `@loomcli/plugins/manifest/extension`, whose collecting extension `manifestCommand` holds the prose and example invocations a Command's manifest entry prints. The help plugin now supplies each Command's help `details` and `examples` to it, so `inspect()` reports them under `@loomcli/plugins/manifest/command` whether or not a manifest plugin is installed.

- Add the manifest plugin, `@loomcli/plugins/manifest`. Installing `manifest()` adds `--manifest`, which prints the routed Command's slice of the graph as JSON for an agent to read before it invokes: the Application's name, version, description, and globals; fixed statements of the token rule, the exit codes, and what the `json` and `jsonl` views print; and the Command's entry with its visible descendants, arguments, options, input schemas, defaults, result, and the `details` and `examples` collected under `manifestCommand`. Hidden members and aliases are omitted, a deprecated member carries its message, and an absent value reads `null`. See [Manifest](docs/core.md#manifest).

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

