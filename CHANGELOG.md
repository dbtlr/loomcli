---
description: Published library release history and migration instructions for breaking changes.
---

# Changelog

Release history starts with the first library release. Pending changes live in [.changes/](.changes/README.md).

## v0.20.0 - 2026-11-21

This is the agents and operators release. An application's skills carry command references generated from its graph. Completion asks the application for values at every Tab, in Nushell too. MCP also serves over streamable HTTP, and `invoke` types its paths from the Application. `-v` now shows the log, which gains message templates, bound fields, redaction, several destinations, operator controls, and OpenTelemetry export. Loom says its own sentences in the operator's language through phrasebooks. Output gains streamed JSON Lines rows and `--fields`. Distribution gains npm launcher packages, a Homebrew formula, artifact attestation, and `install.sh --unmanaged`.

Keep all installed `@loomcli` packages at the same exact version, `0.20.0`. Before upgrading, act on these breaks, which no compile error reports, one line each:

- A `configuration()` whose `file` names a TOML or YAML extension now throws at startup unless the application passes that format's reader in `formats`. Without that reader, a `*` pattern no longer finds a file in that format, `--config` naming one fails with code 2, and one the `env` variable names warns and is not read, or fails under `strict`.
- An `onLog` hook or a JSONL log-file reader that reads a failure event's `hints` now receives an empty array.
- With `format()` installed, an option, alias, global option, or argument named `fields` on a Command with a result fails every run with the hook-collision error, under `@loomcli/core/name-shared-across-kinds` for an argument.
- An `'always'` middleware now runs on a run that names an unknown command, where `next()` rejects with `UnknownCommandError` and `request` and `options` read `null`.
- With an option marked verbose, the application's own `log` events now show at `-v`, and a first-party plugin's lines show on the outermost run's stderr, or in `app.invoke`'s `messages`.
- With `mcp()` installed, a global option named `http`, or one that claims `--http`, fails graph construction.
- A test double whose lane or level parameter is annotated `string`, or turned into text, now receives a `Phrase` when the code under test passes one.
- `host.release.installation` is now present on Homebrew and on global npm, pnpm, Bun, and Yarn runs, so it no longer identifies a script installation.
- A second `run()`, `app.invoke()`, or `inspect()` on one Application reuses its built graph, so `onCommandAttach` and `onGraphBuilt` run once per Application and build in a process.

Then run `tsc --noEmit` and fix what it reports:

- `out.debug` and `out.trace` calls and `lanes.debug` and `lanes.trace` reads, which now go through `log`; `destination.out` members other than `warn` in an `onLog` hook; the `out` of an `afterReplace` or refresh context; and `debug` or `trace` in a `@loomcli/testing` builder's `out`;
- `invoke` calls with a literal path that supply an undeclared input or a plugin-added option such as `format`, or that use an alias, and a value typed as one Application or Command that is given another that declares different Commands;
- `ExitCode` narrowings;
- reads of `ChildExit.code` or `ChildExit.error` that assumed one kind, `ChildExit` switches without `abandoned`, and hand-built children without `abandon()`;
- a required `installation.digest`;
- stated lanes or log levels whose parameter is used as a string.

Each breaking entry below carries its migration.

Known limitation: Nushell completion. Once the completion script is loaded, Nushell runs the program through the script's `extern`. Four typed forms then reach the program differently than with no script:

- a quote inside a word keeps its quotes, so `--field="a b"` arrives as typed;
- an interpolation that holds a subexpression, such as `$"($dir)/*.txt"`, expands as a wildcard;
- a bare `true`, `false`, or `null` fails to parse;
- a list such as `[b c]` reaches the program as the text `[b c]`.

To pass literal text, quote the whole word, as in `"--field=a b"`. [ADR-0195](docs/decisions/0195-completion-installs-for-nushell-as-one-owned-file-in-its-vendor-autoload-folder.md) and [Nushell](docs/plugins/completion.md#nushell) state these forms.

### Breaking Changes

- Remove `out.debug` and `out.trace`, and `lanes.debug` and `lanes.trace`. `out` keeps `print`, `info`, `success`, `warn`, and `error`, which tell the operator, and detail an operator reads only when they ask for it goes through `log`.
- Change `-v` and `-vv` to show the log: at `-v` core shows each log event at `debug`, `info`, `warn`, and `error` as a log line on stderr, and at `-vv` it adds `trace`, with or without an `onLog` hook installed. No flag and `-q` show none, and a failure event never shows. Log lines follow the outermost run's verbosity, so under an action's `invoke` or an MCP tool call they show on the parent run's stderr, and under `app.invoke` in its `messages` when its values ask for them. See [At -v](docs/core/logging.md#at--v).
- Add message templates: a log message's `{name}` placeholders fill from its fields on a log line, the fields it does not place trail as dim `name=value`, `{{` and `}}` write a brace, and every value shown is escaped, while the event's `message` keeps the template as written. See [Message templates](docs/core/logging.md#message-templates).
- Add `logLine`, the declared view `@loomcli/core/log/line` a log line draws through, and the types `LogLine`, `LogLineField`, and `LogLineLevel`, so an application restyles or replaces the line through `views`.
- Narrow `LogDestination`'s `out` to `warn` and add `log`: an event an `onLog` hook logs through it shows at `-v` and reaches every other hook, never the hook itself. Narrow an `onEnvironment` hook's `out` to `warn`. `@loomcli/testing`'s `logDestination` fills `log` with levels that do nothing, and its builders' `out` no longer holds `debug` or `trace`.
- Remove `out` from the self-update plugin's `AfterReplaceContext` and from `RefreshContext`, which 0.19.0 added to carry the `-v` lines of an `afterReplace` function; the function logs through the context's `log`, whose `debug` and `trace` events show at `-v` and `-vv`.
- Change the first-party plugins' `-v` and `-vv` lines, and core's line for a dropped configuration fill, into `log.debug` and `log.trace` events, so a log file records them. The plugins' change events, which are `info`, now show at `-v` too, so the five lines that said what a change event already says are removed: `Replaced <path>.`, `Ran <call>.` for a service manager call that changes something, `Refreshed completion after the update.`, `Refreshed the man pages after the update.`, and `Refreshed the skills after the update.` The change event, such as `Binary replaced.` or `Program run.`, is the line at `-v` in their place. Every other line keeps its words.

### Migration

**Affected surface.** The type checker reports every affected site for the removals. The surface is each call to `out.debug` or `out.trace`, each read of `lanes.debug` or `lanes.trace`, an `onLog` hook that reads a member of `destination.out` other than `warn`, an `onEnvironment` hook that calls `out.debug` or `out.trace`, an `afterReplace` function that reads its context's `out`, a call to `refreshCompletion`, `refreshManpages`, or `refreshSkills` whose context states `out`, and a test that states `debug` or `trace` in a `@loomcli/testing` builder's `out` or a member other than `warn` in `logDestination`'s `out`. No compile error for the rest: at run time, an application with a verbose-marked option now shows its own `log` events at `-v`, and a first-party plugin's lines move from a nested run's output to the outermost run's.

**Why.** Two calls did one job: `out.debug` reached the screen and never the log, and `log.debug` reached the log and never the screen. One call per job ends the choice, and `-v` now shows what the log records, as uv does.

**Before and after.**

Before:

```ts
.action(async ({ args, out, style }) => {
  await out.debug(`Read ${style.escape(args.file)}.`);
  await out.trace('Reusing the open connection.');
})
```

After, with the value in a field, which the line fills and escapes:

```ts
.action(({ args, log }) => {
  log.debug('Read {file}.', { file: args.file });
  log.trace('Reusing the open connection.');
})
```

An `onLog` hook that wrote its own line through its destination:

```ts
// Before
void destination.out.debug(`Wrote ${path}.`).catch(() => {});
// After
destination.log.debug('Wrote {path}.', { path });
```

**Steps.**

1. Run the type checker, and replace each `out.debug(x)` with `log.debug(x)` and each `out.trace(x)` with `log.trace(x)`, taking `log` from the same context. A `log` call returns `undefined`, so drop its `await`.
2. Move each value a message interpolates into the call's fields and name it with a placeholder, `log.debug('Read {file}.', { file })`, and drop the `style.escape` and `escapeControlCharacters` calls around it: the log line escapes every value, and the record keeps the template constant.
3. Replace a view passed to `out.debug` or `out.trace`, and an override of `lanes.debug` or `lanes.trace`, with an override of `logLine`, or pass the view to `out.info` when the line must reach the operator without `-v`. Collect a streamed message passed to `out.debug` or `out.trace` into a string before logging it.
4. In an `onLog` hook, replace `destination.out.debug(x)` and `destination.out.trace(x)` with `destination.log.debug(x)` and `destination.log.trace(x)`.
   In an `afterReplace` function, replace `context.out.debug(x)` and `context.out.trace(x)` with `context.log.debug(x)` and `context.log.trace(x)`, and drop `out` from a context you pass to a refresh function. Replace any other `context.out` call with `context.log.info` or `context.log.warn`, which the operator sees at `-v`; the hook no longer writes to the operator without `-v`.
5. In tests, remove `debug` and `trace` from a builder's `out` values and narrow `logDestination`'s `out` to `warn`. State `log` for its log calls.

**Validation.** Run `tsc --noEmit` and the application's tests. Run the application with `-v` and `-vv` and read each line it shows on stderr, and run `grep -rnE "out\.(debug|trace)" src` to confirm no call remains.

- Change failure log events to carry `failure.hints: []`. Core records the failure before gathering hints; the failure report still shows every hint.

### Migration

**Affected surface.** No compile error: `onLog` hooks and JSONL log-file readers that read `failure.hints` now receive an empty array instead of the `onFailure` hooks' hints recorded in 0.19.0.

**Why.** Core records the failure before gathering hints, so a failure that is a run's first record reaches the log file and a hint can name that file and run.

**Before and after.**

Before, a failure event's form could include a hook's hint:

```json
{ "code": "fatal", "exitCode": 1, "message": "Cannot finish.", "hints": ["Check the connection."] }
```

After, the same event's form has no hints:

```json
{ "code": "fatal", "exitCode": 1, "message": "Cannot finish.", "hints": [] }
```

The failure report still includes `Check the connection.`.

**Steps.**

1. Find `onLog` hooks and log-file readers that read `failure.hints`.
2. Read hints from the failure report. If a consumer needs hints separately, pass the hints your `onFailure` hook returns directly to that consumer.

**Validation.** Run `tsc --noEmit` and the application's tests. Trigger a failure for which an `onFailure` hook returns a hint. Check that the failure report or the hook supplies that hint to its consumer, while the failure event in `onLog` and the JSONL file carries `hints: []`.

- Add `--fields` to every Command the formatter gives `--format`. It keeps the named top-level keys of the json and jsonl output the formatter itself appended, in the order named, for a value, an array, and rows as they stream: `notes list --format jsonl --fields title,id`. An author-declared json or jsonl view is excluded, even without a map; its author shapes the data themselves. It repeats, takes a comma list, and is a control option, so it is on the help page and off MCP tool inputs. A field the output does not hold, a value that is not an object, or a view the formatter did not append fails with exit 2 and a sentence that says what to supply. The refusal under another view names only the formatter's views the Command has, and in an invocation by name each `--fields` failure names the options by their declared names, `fields` and `format`. See [Selecting fields](docs/plugins/format.md#selecting-fields).
- Add `transform` to `MiddlewareContext` and export `ResultTransform` from `@loomcli/core`. A middleware assigns one function per run before the dispatch boundary, and core applies it to a value result once, and to each row of a rows result before the selected view renders: as it arrives under a row view, or when the collected rows render under a whole view. `middlewareContext` from `@loomcli/testing` keeps the last transform assigned. See [Middleware](docs/core/middleware.md).

### Migration

**Affected surface.** No compile error: the application fails every run with the hook-collision error. The surface is an application that installs `format()` and declares its own option named `fields` on a Command that declares a result, or on a group, or a global option or another plugin's option named `fields`, or an option that claims the spelling `--fields` through `aliases` or `visibleAliases`. A positional argument named `fields` on a Command that receives `--fields` also collides: core rejects it with `@loomcli/core/name-shared-across-kinds`.

**Why.** The formatter now declares `--fields` beside `--format`, and a second declaration of one name on a Command is the hook-collision build error, as it is for `format`. An argument and an option also cannot share the declared name `fields`.

**Before and after.**

Before, a Command's own option, which now collides:

```ts
new Command('list')
  .option('fields', { type: 'string' })
  .rows<Note>({ views: { table: notesTable } })
  .action(listNotes);
```

After, the option renamed, or removed in favor of the formatter's `--fields` under `--format json` or `--format jsonl`:

```ts
new Command('list')
  .option('columns', { type: 'string' })
  .rows<Note>({ views: { table: notesTable } })
  .action(listNotes);
```

For a positional argument, rename `.argument('fields', ...)` to `.argument('columns', ...)` and change action code from `args.fields` to `args.columns`.

**Steps.**

1. Search the application for options named `fields`: `.option('fields'` and `.globalOption('fields'`, and plugins whose `options` name `fields`. Also search for `.argument('fields'`, and for `aliases` or `visibleAliases` that include `fields`.
2. Rename each one, or remove it where the formatter's `--fields` already does its job. For a renamed argument, update action code reading `args.fields` to read the new name. For an alias, remove or rename the alias; the option and its readers stay as they are.
3. Update the application's scripts and documentation that pass the old spelling.

**Validation.** Run the application's `inspect()` or `--help` on each Command that declares a result; a collision fails with `@loomcli/core/option-declared-twice` naming `fields`, with `@loomcli/core/spelling-taken` for an alias, or with `@loomcli/core/name-shared-across-kinds` for an argument. Run the application's test command.

- Add `mcp --http <address>`, which serves an application's MCP tools over the protocol's streamable HTTP transport at `http://<host>:<port>/mcp` instead of stdin and stdout. A port alone listens on 127.0.0.1, port 0 takes any free port, and the run writes the endpoint as its one stdout line. See the [MCP plugin reference](docs/plugins/mcp.md#serving-over-http).
  - A request that carries an `Origin` header is refused with 403, a POST body has a size limit, and each `2026-07-28` request is served on its own while an initialize-era client gets a session that ends on DELETE or when idle. A call answers as an event stream with its progress, and the run's signal aborts every call and tears down each open subscription.
  - A non-loopback address always writes a warning before the endpoint line: about open access without an `authorize` hook, and about unencrypted credentials with one.
- Add optional settings to `mcp()` for the HTTP server alone: `authorize`, which judges each request from a copy of its headers, `maxBodyBytes`, 4 MiB by default, and `sessionIdleMs`, 30 minutes by default. A hook that throws answers 500, and the run reports its first throw once when the server stops, as the Developer Diagnostic `@loomcli/plugins/mcp/broken-authorize-hook` in a development build.
- Change the stdio server so the run's signal ends each open subscription with `notifications/cancelled` and its closing result, as the end of stdin already did, because the protocol requires that teardown of a server on any transport.

### Migration

**Affected surface.** No compile error: graph construction fails at run time. Applications that install `mcp()` and declare a global option named `http`, including one supplied by another plugin, or a global option that claims the spelling `--http` through `aliases` or `visibleAliases`, collide with the MCP Command's new local option.

**Why.** The `mcp` Command now declares `--http`, and core rejects a local option that shares a global option's name or spelling.

**Before and after.**

Before:

```ts
app.globalOption('http', { type: 'string' });
// The action reads options.http.
```

After:

```ts
app.globalOption('endpoint', { type: 'string' });
// The action reads options.endpoint.
```

**Steps.**

1. Find the application's global option named `http`, including plugin options, and any global option whose `aliases` or `visibleAliases` include `http`.
2. Rename an option named `http` and update its readers from `options.http` to the new name. For an alias, remove or rename the alias; the option and its readers stay as they are.
3. Update scripts and documentation that pass the application's old spelling.

**Validation.** Run the application's `--help` and `mcp --help` commands to verify that the graph builds and the renamed option appears. Run the application's test command.

- Change `run()`, `app.invoke()`, and `inspect()` to reuse the graph an Application already built in the same process, one for a development build and one for a distributed build. A second call on one Application builds no Command and runs no `onCommandAttach` or `onGraphBuilt` hook, so repeated runs in a test suite or an embedding host cost only the run's own work, and two `inspect()` calls return the same object. `check()` still builds anew on every call, a build that faults keeps nothing, and every run still validates its declared defaults and implied values. A launch is unchanged. See [Reusing the built graph](docs/core/graph-inspection.md#reusing-the-built-graph).

### Migration

**Affected surface.** No compile error. A plugin's `onCommandAttach` or `onGraphBuilt` hook, and a test that counts their calls, now sees one graph build per Application and build in a process, where 0.19.0 built the graph, and ran both hooks, on every `run()`, `app.invoke()`, and `inspect()`.

**Why.** A built graph depends only on the Application's declarations and its build, so repeated calls in one process, in a test suite or an embedding host, no longer pay for a build each time.

**Before and after.** Before, two `run()` calls on one Application ran each `onGraphBuilt` hook twice. After, they run it once, and a second `inspect()` returns the same object as the first.

```ts
let builds = 0;
const counter = plugin('@acme/counter', { onGraphBuilt: () => { builds += 1; } });
const app = new Application('notes', { plugins: [counter] }).action(() => {});
await app.run({ process: mockProcess({ argv: [] }) });
await app.run({ process: mockProcess({ argv: [] }) });
// 0.19.0: builds === 2. 0.20.0: builds === 1; app.check() still builds anew.
```

**Steps.**

1. Find `onCommandAttach` and `onGraphBuilt` hooks that read the host, the environment, or anything that changes between runs, and move that work into middleware or the action.
2. In tests that count hook calls or need a fresh build, call `check()`, which still builds anew, or build a new Application value, since every authoring call returns one.

**Validation.** Run `tsc --noEmit` and the application's tests. Run the application twice in one process and check that each hook runs once and both runs give the same output.

- Change `app.invoke` and an action's `invoke` to type a literal path and its values from the Commands the Application declares. A mistyped Command name in a literal path, an option or argument the routed Command does not declare, and a value of the wrong kind are compile errors, such as `Type '"gte"' is not assignable to type '"get" | "remote"'`. A path typed as `readonly string[]` keeps the dynamic `InvocationValues`, as do a union of literal paths, a path deeper than four Commands, and a first name an Application with plugins does not declare. A union inside one element, such as `['remote', dry ? 'add' : 'rm']`, stays typed: its values take either Command's, and the run checks them against the Command the path routes to. Where a literal path is checked against canonical names, an alias in it is a compile error; pass an alias path as a `readonly string[]` so routing resolves it at run time. See [Typed paths](docs/core/invocation.md#typed-paths).
- Add `Register.paths`, which `PathsOf<typeof app>` fills, so an action's `invoke` types a literal path in a registered compilation, and export `CommandPaths`, `PathsOf`, and `Invoke`.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is an `invoke` call with a literal path, such as `[]` or `['get']`, whose values name an input the routed Command and the global options do not declare, name an option a plugin's attach hook adds, such as the `--format` and `--fields` options `format()` adds to every Command with a result, or use an alias in the path; and a variable or parameter whose inferred type is one Application's or one Command's and that is given another one that declares different Commands or another name.

**Why.** Each Command and Application now carries its Command paths in its type, so `invoke` can check a literal path and its values, and two values that declare different Commands no longer share a type.

**Before and after.**

Before, a call that selects a view through the formatter's option:

```ts
await app.invoke(['list'], { options: { format: 'json' } });
```

After, the view goes in the call's options:

```ts
await app.invoke(['list'], {}, { view: 'json' });
```

Before, a parameter that takes its type from one Application:

```ts
const run = (application = app()) => application.run({ process: mockProcess({ argv: [] }) });

run(otherApp());
```

After, it takes the neutral annotation:

```ts
const run = (application: Application = app()) => application.run({ process: mockProcess({ argv: [] }) });
```

**Steps.**

1. Run the type checker and open each reported `invoke` call.
2. Correct a mistyped Command, option, or argument name, or a value of the wrong kind, that the call meant to supply.
3. For a call that supplies `format` to select a view, such as `{ options: { format: 'json' } }`, pass the view in the call's options instead, as `invoke(['list'], {}, { view: 'json' })`.
4. For a call that supplies an undeclared name on purpose, another option an attach hook adds, such as `fields`, or names an alias, pass the path as a `readonly string[]` value.
5. Give a variable or parameter that holds Applications or Commands declaring different Commands the `Application` or `Command` annotation.
6. To type an action's `invoke`, add `paths: PathsOf<typeof app>` to the `Register` augmentation, naming the completed Application.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its tests: each `invoke` call compiles, and every call whose path is dynamic behaves as before.

- Change an unknown command to a held fault: core raises `UnknownCommandError` at the dispatch boundary after running the `'always'` middleware, which read the unknown word and the words after it under the new `unknownCommand` member of the middleware context. A middleware may take such a run over. An application with no such middleware prints and exits as before. See [Middleware](docs/core/middleware.md) and [ADR-0192](docs/decisions/0192-core-holds-an-unknown-command-for-the-chain-and-a-plugin-runs-an-external-command-from-path.md).
- Add `invokedBy` and `exitCode` to the middleware context. A takeover, a middleware that returns without calling `next()` or that catches the fault the dispatch boundary raised, may assign `exitCode` to end the run with that code and print nothing. `invoke()`'s `completed` outcome gains an optional `exitCode`, present when a takeover stated a code other than 0.
- Change `ExitCode` to every whole number from 0 through 255, because a takeover may state a child program's code. `FailureExitCode` still bounds a failure class at 1 through 125.

### Migration

**Affected surface.** The type checker reports code that narrows an `ExitCode` to `FailureExitCode` or to the codes it listed before, such as a `switch` whose `default` branch assigns the code to `FailureExitCode` or `never`. No compile error: behavior changes at run time for an `'always'` middleware, which now runs on a run that names an unknown command, where its `next()` rejects with `UnknownCommandError`, its `request` and `options` read `null`, and its `ownOptions` reads an empty record.

**Why.** An operator extends an application by putting `<application>-<word>` on `PATH`, which a middleware can serve only when it sees the unknown command and can end the run with the program's exit code.

**Before and after.**

Before, code that read every code past the cancellations as a failure class's:

```ts
function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'ok';
    case 129:
    case 130:
    case 131:
    case 141:
    case 143:
      return 'cancelled';
    default: {
      const failure: FailureExitCode = code;
      return `failed with ${String(failure)}`;
    }
  }
}
```

After, the remaining codes are any code a takeover stated:

```ts
function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'ok';
    case 129:
    case 130:
    case 131:
    case 141:
    case 143:
      return 'cancelled';
    default:
      return `exited ${String(code)}`;
  }
}
```

An `'always'` middleware now also runs on an unknown command, where its `next()` rejects. Loaded by a plugin `auditing()` that declares `middleware: { activate: 'always', load: () => import('./audit.js') }`, this audit middleware never saw `app nope` before; after, it records the run and the rejection reaches it:

```ts
const audit: Middleware<typeof auditing> = async ({ next, unknownCommand }) => {
  try {
    await next();
  } finally {
    // After: also runs for `app nope`, where `unknownCommand` is { word: 'nope', rest: [] }.
    record(unknownCommand?.word ?? 'routed');
  }
};

export default audit;
```

**Steps.**

1. Run the type checker, and give each site it reports a branch for any code from 0 through 255 that a takeover may state.
2. In an `'always'` middleware that reads `request`, `options`, or a value only a routed run has, check `unknownCommand` first, or read the `null` request as it reads one under any held fault.

**Validation.** Run the type checker with no errors. Run the application with an unknown command, such as `app nope`, and check that it prints the same unknown-command failure and exits 2. Check that each `'always'` middleware completes on that run without reading a `null` `request` or `options`.

- Change the configuration plugin to read JSON alone unless the application passes a reader for TOML or YAML in the new `formats` setting: `toml` from the new `@loomcli/plugins/config/toml` subpath reads `.toml` files, and `yaml` from the new `@loomcli/plugins/config/yaml` subpath reads `.yaml` and `.yml` files. The plugin no longer imports either parser itself, so an application that passes neither reader bundles neither `smol-toml` nor `yaml` (about 266 KB) and carries neither license. See [Configuration](docs/plugins/config.md#readers) and [ADR-0196](docs/decisions/0196-an-application-passes-the-toml-and-yaml-readers-it-reads-and-the-configuration-plugin-reads-json-alone-without-them.md).
- Add the `@loomcli/plugins/config/file-format` rule: a `file` that names a `toml`, `yaml`, or `yml` file, in a brace list or as a literal name, without its format's reader in `formats` throws at `configuration()`, naming the reader to pass.
- Change `*` in `file` to name the extensions of the readers passed, then `json` and `jsonc`. With no readers, `*` names `json` and `jsonc` alone.
- Change `--config` naming a `.toml`, `.yaml`, or `.yml` file the application does not read to fail with code 2, naming the file's format and the formats the application reads, as in `Option "--config": File "x.toml" is TOML, which this application does not read. Supply a JSON file.` A file the `env` variable names in such a format warns and the run reads no configuration. A file of any other name still reads as JSON.
- Change the `loom` bin to read JSON alone: `loom --config x.toml` now fails, and `@loomcli/loom` no longer bundles `smol-toml` or declares BSD-3-Clause.

### Migration

**Affected surface.** No compile error: `configuration()` throws a `DeclarationError` when the application starts, under `@loomcli/plugins/config/file-format`. The surface is a `configuration()` call whose `file` names a `toml`, `yaml`, or `yml` extension, in a brace list such as `.textstat.{toml,json}` or as a literal name such as `.textstat.yaml`. A call whose `file` has the extension `*`, or names only JSON files, compiles and starts unchanged, and so does a call with no `file`, which looks for `.<app>.json` and so names only a JSON file. Under `*`, a TOML or YAML file the walk used to find is no longer looked for, so its settings stop applying with no warning. Each of these stops reading TOML and YAML files at run time: an operator's `--config` naming a TOML or YAML file fails with code 2, and a TOML or YAML file the `env` variable names warns, or fails under `strict`.

**Why.** The plugin chose a parser at run time, so every application that installed it bundled both parsers whatever format it read. A reader the application passes keeps an unused parser out of the bundle.

**Before and after.**

Before:

```ts
import { configuration } from '@loomcli/plugins/config';
import { z } from 'zod';

export const config = configuration({
  file: '.textstat.{toml,json}',
  schema: z.object({ minBytes: z.number().optional() }),
});
```

After, passing the reader the file pattern names:

```ts
import { configuration } from '@loomcli/plugins/config';
import { toml } from '@loomcli/plugins/config/toml';
import { z } from 'zod';

export const config = configuration({
  file: '.textstat.{toml,json}',
  formats: [toml],
  schema: z.object({ minBytes: z.number().optional() }),
});
```

**Steps.**

1. Find each `configuration()` call: one whose `file` names `toml`, `yaml`, or `yml`, one whose extension is `*`, one whose `file` names only JSON files, and one with no `file`.
2. For `toml`, import `toml` from `@loomcli/plugins/config/toml` and add it to `formats`.
3. For `yaml` or `yml`, import `yaml` from `@loomcli/plugins/config/yaml` and add it to `formats`.
4. For `*`, add the reader of every format the application's operators may write, or neither to read JSON alone.
5. For a call whose `file` names only JSON files, or that passes no `file` and so looks for `.<app>.json`, add the reader of each format operators may name through `--config` or the `env` variable, or neither to read JSON alone.
6. If you pass `loom --config` a TOML file, convert it to `loom.config.json`.

**Validation.** Start the application, for example with `--help`, and check that it prints no `@loomcli/plugins/config/file-format` diagnostic. For each reader you added, run it with `--config` naming a file of that format and check that it reads the file's values. For an application that reads JSON alone, run it with `--config` naming a JSON file, and check that a TOML or YAML file fails with code 2. For a `*` pattern, test each format whose reader you passed one at a time: put one file the `file` pattern names in a directory the lookup's `scopes` search, with no other configuration file there and no `--config` or `env` override, and check that its values apply.

- Derive Homebrew, npm, pnpm, Bun, and Yarn installations from the resolved application path when no installation record matches. `host.release.installation.digest` is now optional because a derived installation has no recorded digest.
- Show the package manager's upgrade command in update notices and when `self-update` refuses a package-managed installation, when the facts the command needs are available, such as the npm package name the build bakes. Otherwise an update notice is skipped, and the refusal tells you to update with the package manager. A script-recorded binary whose real path is in a Homebrew Cellar or a package manager's global root counts as that package manager's installation.
- Export `packageManagerInstallation(path, platform)` from `@loomcli/core`, which derives the Homebrew installation or the global installation for npm, pnpm, Bun, or Yarn for an absolute realpath.
- Export `isNpmPackageName(name)` from `@loomcli/core`, the npm package name rule that update notices and `loom build --target npm` judge a name by.

### Migration

**Affected surface.** Code that requires `host.release.installation.digest` to be a string can now fail type checking. Code that uses the presence of `host.release.installation` to identify a script installation changes behavior at run time without a compile error. `host.release.installation` is now present on Homebrew, npm, pnpm, Bun, and Yarn runs that match the layout rules.

**Why.** The resolved application path can identify a package-managed installation. Only a matching installation record supplies its verified digest.

**Before and after.**

Before:

```ts
const { installation } = host.release;
if (installation !== undefined) {
  checkInstalledBinary(installation.path, installation.digest);
}
```

After:

```ts
const { installation } = host.release;
if (installation?.method === 'script' && installation.digest !== undefined) {
  checkInstalledBinary(installation.path, installation.digest);
}
```

**Steps.**

1. Check `installation.method === 'script'` anywhere presence previously meant a script installation.
2. Check `installation.digest !== undefined` before using the digest.

**Validation.** Run your project's type checker, for example `pnpm exec tsc --noEmit`. Run the application with a matching script record and from a matching Homebrew, npm, pnpm, Bun, or Yarn path. Confirm that only the script installation enters the code that needs its recorded digest.

- Change the `out` lanes, `out.fatal`, `MessageArguments`, and the `log` levels to take `string | Phrase` where they took `string`, so Loom's own code can hand core a sentence it renders in the operator's language. A test double an author states for one of these members, through `@loomcli/testing`'s builders, now receives a parameter that may be a `Phrase`.

### Migration

**Affected surface.** The type checker reports a stated lane or level whose parameter is typed from the context and used as a string, such as `log: { info: (message) => { lines.push(message); } }`, and a lane written `(...call: MessageArguments)` that narrows with `typeof message === 'string'` and then iterates. No compile error: a double whose parameter is annotated `string`, or that turns its parameter into text with `String()` or a template, receives a `Phrase` at run time when the code under test passes one.

**Why.** Core renders a phrase in the run's language where it writes text for a person, and the failure form and the log record keep its English text, so the members that carry Loom's text to core take a phrase as well as a string.

**Before and after.**

Before, a stated `log` level typed from the context:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  log: { info: (message) => { lines.push(message); } },
  options: {},
  provided: {},
});
```

After, the parameter is annotated, because the action under test passes strings:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  log: { info: (message: string) => { lines.push(message); } },
  options: {},
  provided: {},
});
```

A stated lane that takes `(...call: MessageArguments)` reads a phrase's English text before it narrows a stream:

```ts
import { Phrase, type MessageArguments } from '@loomcli/core';

const print = async (...[message]: MessageArguments) => {
  if (message instanceof Phrase) lines.push(message.text);
  else if (typeof message === 'string') lines.push(message);
  else for await (const part of message) lines.push(part);
};
```

**Steps.**

1. Run the project's type check, such as `tsc --noEmit`, and note each stated lane or level it reports.
2. Annotate the parameter `(message: string)` where the code under test passes only strings. Where it may pass a phrase, type the parameter `string | Phrase` and narrow with `message instanceof Phrase` to read `message.text`: a double annotated `(message: string)` still compiles there, because the builder hands the argument through unchanged, and fails only when it runs.

**Validation.** Run the type check again and confirm it reports no stated lane or level, then run the tests that state them.

- Add `Child.abandon()` to release a spawned child's connections so the host can exit while the child runs. Abandoning sends no signal and can settle `exited` with the new `abandoned` kind and the output captured so far.

### Migration

**Affected surface.** The type checker reports reads of `ChildExit.code` or `ChildExit.error` that no longer narrow to one kind, exhaustive switches that omit `abandoned`, and hand-built `ProcessHandle` children without `abandon()`.

**Why.** A caller can stop waiting before the child reports an exit or a failed start.

**Before and after.**

Before, ruling out `unstarted` also narrowed to an exit code:

```ts sketch
const exit = await child.exited;
if (exit.kind === 'unstarted') throw exit.error;
return exit.code;
```

After, handle each kind:

```ts sketch
const exit = await child.exited;
switch (exit.kind) {
  case 'unstarted':
    throw exit.error;
  case 'exited':
    return exit.code;
  case 'abandoned':
    return undefined;
}
```

**Steps.**

1. Narrow on `kind === 'exited'` before reading `code`, and on `kind === 'unstarted'` before reading `error`.
2. Handle `abandoned` in exhaustive switches over `ChildExit.kind`.
3. Implement `abandon()` on children returned by a hand-built `ProcessHandle`. While `exited` is pending, `abandon()` settles it at once and stops waiting for the child: as `{ kind: 'exited', code, stdout, stderr }` when the child's exit has already been reported, and otherwise as `{ kind: 'abandoned', stdout, stderr }`, each with the output captured so far. Once `exited` has settled, it does nothing.

**Validation.** Run the application's type check, such as `tsc --noEmit`: every read of `code` or `error` and every exhaustive `switch` on `kind` compiles. Run the application's test command, such as `pnpm test`, including the tests of code that starts child programs through `host.spawn` or a `mockProcess` script. If your code calls `abandon()`, check that it handles the captured output without expecting an exit code.

### Features

- Add multiple destinations to one `logging()` installation through `destinations`, each with its own level and each file with its own path, rotation, and error callback. Every eligible file and console destination writes identical JSONL record bytes. Existing single-destination calls keep working.

- Add `log.with(fields)`, which returns a `Log` whose every event carries those fields, copied once, as a pino or winston child logger does. It nests, a call's own field wins over a bound one of the same name, and a bound field fills a message template's placeholder. Every context that carries `log` has it, a log destination's included, and `@loomcli/testing`'s builders' `log` passes the bound fields to the levels a test states. `logDestination` takes its `log` level by level, as the builders do, so a test that states only `debug` keeps the other levels inert. See [Bound fields](docs/core/logging.md#bound-fields).
- Add `log: { redact }` to the Application options: a list of dotted field paths whose values read `"[Redacted]"` in every log event, so no `onLog` hook, log line at `-v`, or log record sees them. A path steps through arrays, bound fields are redacted too, and Loom redacts nothing an Application does not list. A path that is not dotted nonempty keys is the declaration error `@loomcli/core/invalid-redact-path` from the constructor. See [Redaction](docs/core/logging.md#redaction).

- Add an OpenTelemetry logging destination that sends message templates, redacted fields, and run and failure facts to an author's own logger, with an independent level and no runtime SDK dependency.

- Add two operator variables to the logging plugin, named after the application, such as `HEIMDALL_LOG_LEVEL` and `HEIMDALL_LOG_FILE`: the first sets every file destination's level, and the second redirects the first file destination. `levelEnv` and `fileEnv` rename either, and `false` turns either off. An unusable value prints one warning and keeps the author's setting. See the [logging reference](docs/plugins/logging.md#operator-variables).
- Add a failure hint to the logging plugin that names the log file the failure was appended to and the run's id. `failureHint` selects `'runtime'` failures by default, every failure but a usage error, or `'always'`, `'defects'`, or `false`.
- Add `@loomcli/plugins/logging/extension`, which exports `loggingFiles`, the fact the logging plugin publishes on the root Command, and `resolveLoggingFiles`, which turns the fact and a host's `env`, `home`, and `platform` into the files a run writes, with the operator's variables applied.
- Add `run` to `FailureHookContext`, the identifier every log event of the run carries. `failureHookContext` in `@loomcli/testing` takes `run`, and `logDestination` gives `out` an inert `warn`.

- Add logging destinations to `service status` text and JSON when the logging plugin is installed. Status names every resolved file and notes files with no records yet. It reports journald or discarded console output when the logging plugin has no files and `output` is unset. Paths use the environment running status. A service manager with different variables can resolve different paths.

- Add nearest accepted-value suggestions for rejected closed-set inputs. The suggestions plugin replaces the accepted-values fix in each affected sentence and preserves other input problems without repeating the received value.
- Add `FailureHookContext.received(problem)` so failure hooks can read a rejected input's raw value without exposing it on the failure. The testing context builder accepts an optional reader and defaults to returning `undefined`.

- Add `needsTerminal()` on a Command and on the Application, so a Command whose action works only at a terminal, such as a full-screen view, says so. Without a terminal, where stdin or stderr is not one or the run is under CI, the run fails before the action with the new `TerminalUnavailableError`, failure code `terminal-unavailable`, exit 1. `--no-input` does not refuse it. `invoke` and `app.invoke` always refuse it, because an invocation by name has no terminal. See [A Command that needs a terminal](docs/core/commands.md#a-command-that-needs-a-terminal).
- Add `needsTerminal` to `CommandNode`, the manifest's Command entry, the help page, which prints `Needs a terminal: stdin and stderr, outside CI.` under the Command's masthead, and the man page, which prints it as a paragraph of DESCRIPTION.
- Add the MCP build fault `@loomcli/plugins/mcp/tool-needs-terminal`: a Command that carries `mcpCommand` and needs a terminal fails every build, so it never reaches `tools/list`.

- Add `jsonlRows()`, a row view that writes one JSON Lines line per row as the row arrives, exported from `@loomcli/plugins/format` and `@loomcli/plugins/format/views`. Its `map` applies to each row, and its bytes equal `jsonl()`'s for the same rows.
- Change `--format jsonl` on a Command that declares `rows()` to write each line as its row arrives, so an unbounded source prints as it goes. A run that fails after its first row now leaves the rows it wrote before the failure on stdout, where it wrote nothing before, and the failure line goes to stderr. A Command that needs all-or-nothing output declares `jsonl: jsonl()` in its `views`, which collects the rows and writes nothing when the run fails. A value result keeps the whole view too.

- Add static value hints to shell completion. `completionInput` and `completionArgument` from `@loomcli/plugins/completion/extension` mark an option or an argument as completing file names, files of some extensions, directories only, nothing, or, for an argument only, the Commands its earlier words have reached; Tab then completes accordingly in Bash, Zsh, Fish, and PowerShell, including, for the files-of-some-extensions and directories-only hints, a value attached to its option, as in `--config=a` or `-ca`, and never falls back to a file name the hint rejects. The Fish script now filters by extension and to directories instead of completing every file name.
  ```ts
  new Command('load').option('config', {
    extensions: [completionInput({ extensions: ['json', 'yaml'] })],
    type: 'string',
  });
  ```
- Complete Commands after `help` when the help Command is on: `app help ta<Tab>` offers `task`, and `app help task sh<Tab>` offers its children.

- Add named completers to shell completion. `completion({ values: { task: ({ word, typed }) => [...] } })` holds functions that supply an option's or an argument's values at Tab time, and `completionInput({ values: 'task' })` or `completionArgument({ values: 'task' })` names one. A completer reads the word being completed, the words the earlier words gave each input, the run signal, and the host, and returns, now or later, values as text or `{ value, description }`. The answer offers those that start with the typed word, after `--option=` or an attached short letter as for any value. A completer that throws offers nothing and logs a `warn` event, while child Commands that share its position are still offered, and a name the settings do not define is the declaration fault `@loomcli/plugins/completion/unknown-completer`. See the [completion reference](docs/plugins/completion.md#named-completers).
  ```ts
  completion({ values: { task: async () => [{ description: 'Fix the build.', value: 'task-1' }] } });
  ```

- Add `typed` to every position `locate()` reports except `none`: the words the earlier words gave each option and each argument, by declared name, exactly as the parser read them and before any validation, a parent's own option that routing still holds included, and an arity option's words ending with those its unfinished occurrence has received. `TypedInputs` is exported as a type. A reader that completes one input can now narrow by the others.
  ```ts
  const position = locate(graph, ['task', '--project', 'alpha', '']);
  position.kind === 'argument' && position.typed.options.get('project'); // ['alpha']
  ```

- Add command references to installed agent skills. A skill selects Commands by their paths with `commands`, such as `[['note']]` or `[[]]` for the whole application, and `skills install`, `skills update`, and a project install write a Markdown command reference for each selected Command an operator can find, plus an `index.md` that lists them and the global options, under the skill's `references/commands/`, generated from the installing binary's graph. Each reference shows the usage forms, arguments, standard input, options, result, and the `manifestCommand` details, examples, and failures as help's cells state them, with no option alias. A path that names no Command, or two Commands that give one file name, fails the build. The [skills plugin](docs/plugins/skills.md#command-references) describes the files.
- Add an entry without `files` to the `skills` list of settings that name a `folder`, `{ name, commands }`, which selects Commands for the folder's skill of that name. `skills()` takes the new `FolderSkillsSettings` for it, whose `folder` is required, so such an entry without a folder is a compile error.
- Add `skillCommand` from `@loomcli/plugins/skills/extension`, which adds guidance for an agent to a Command's command reference.
- Add `commandReferences` and `skillFolders` to `@loomcli/plugins/skills`, which give a tool outside an install the command references a selection renders and every file an install writes for each declared skill.

- Add `skills status` to report each skill as missing, unmanaged, modified, stale, or current, globally or in a project. Global installs record each installed file's digest and protect changes to generated command references until `skills install --force` replaces them; earlier skill records roll forward on install or update. A binary older than this release refuses the new record file. A project row's note quotes a project root that holds a space or another character a shell reads, as `shlex.quote` does, so its `--directory` step pastes as one word.

- Add `loom skills export <directory>` to write all or selected application skills with the same files and generated command references as an install.
- Add `assertSkillsMatch(application, directory, options?)` to `@loomcli/testing` to fail a test at the first file that differs from a committed skill copy. Select skills with `options.skills` and resolve a relative source folder with `options.moduleDirectory`. It loads the optional `@loomcli/plugins` companion only when called.

- Add `loom docs <directory>` to write a Markdown command reference for every non-hidden Command of the application, with an `index.md`, using the renderer that skill command references use. A renderer that throws fails the run with the Developer Diagnostic [`@loomcli/loom/command-references-failed`](docs/core/diagnostics.md#loomcliloomcommand-references-failed), which names `@loomcli/plugins` and says to install it and `@loomcli/core` at one version. A reference file it cannot write is reported as a write, with the folder whose write access it needs.

- Add `timeZone` to invocation options so embedded and nested calls resolve zone-less date-time inputs, declared defaults, and implied values in the caller's zone. Nested calls inherit the zone unless they supply their own, and the parent and process handle keep their zones. `resolveTimeZone` resolves a runtime-known IANA name and refuses numeric offsets. MCP tool calls accept the zone through `params._meta["io.github.dbtlr.loomcli/timeZone"]` over stdio and HTTP, and invalid metadata returns a tool error naming the key and the accepted form.

- Add the [external-commands plugin](docs/plugins/external-commands.md), `externalCommands()` from `@loomcli/plugins/external-commands`. When the first word of argv names no Command, it runs the first executable `<application>-<word>` on the run's `PATH` with the words after it, and the run exits with the program's code. With no such program, the unknown command reports as before.

- Add Nushell completion. `jsonkit completion nu` prints a script that declares one extern for the application's name and asks the application for matches, and `jsonkit completion install nu` writes it into Nushell's vendor autoload folder, `$XDG_DATA_HOME/nushell/vendor/autoload`, by default `~/.local/share/nushell/vendor/autoload` on Linux and `~/Library/Application Support/nushell/vendor/autoload` on macOS, with no edit to `config.nu`; `update`, `uninstall`, and the self-update refresh act on it as on the other shells. Nushell 0.117 is the floor. Under a value hint for file names, Nushell lists every file name by its own rule, and completes none after an `=` or a short option's attached value, as [Completion](docs/plugins/completion.md#nushell) states.

- Speed up unbundled Loom applications on Node by loading fewer files at startup.
- Ship source maps with the TypeScript sources embedded, so a stack trace under `node --enable-source-maps` names the source file and line. The packed libraries grow with them: `@loomcli/core` from about 446 KB to 742 KB.

- Add `--unmanaged` to the `install.sh` that `loom init` manages. With `--dir`, which it requires, it installs a verified side copy of the binary and writes no `install.json`, prints no PATH advice or post-install message, and runs no post-install command, so running it beside a live install leaves that install's record, and its self-update, as they were. A declared post-install command is printed as skipped, with a note that running it would point shared setup at the side copy. Run `loom init` to render the new script; see [the installer script](docs/toolchain/install.md).

- Add `@loomcli/plugins/self-update/attestation`, whose `attestation({ workflow })` makes self-update verify a GitHub artifact attestation of the release asset before it downloads the asset. Pass its value as `selfUpdate({ attestation: attestation({ workflow: '.github/workflows/release.yml' }) })`. An update then passes only when an attestation verifies in full against Sigstore's trust root and names the pinned workflow in the application's repository, a run on the release's own tag, and the asset's name with the digest `SHA256SUMS` lists. A rate limit, a missing attestation, and every failed check fail the update, and none falls back to the digest alone. The [self-update reference](docs/plugins/self-update.md#attestation) states the requests, the failures, and the release workflow the author adds.
  - The subpath verifies with `@sigstore/verify`, `@sigstore/bundle`, and `@sigstore/tuf`, which are optional peer dependencies of `@loomcli/plugins`. An application that imports the subpath adds them to its own dependencies and runs on Node `^22.22.2 || ^24.15.0 || >=26.0.0`. An application that does not import it bundles none of their code, and self-update without `attestation` makes the same requests as before.
  - `selfUpdate()` throws a `DeclarationError` with the diagnostic code `@loomcli/plugins/self-update/attestation-setting` for an `attestation` value that `attestation()` did not make, and `attestation()` throws one with `@loomcli/plugins/self-update/attestation-workflow` for a `workflow` that is not a workflow file in `.github/workflows`.

- Add `loom build --target npm`, which ships a compiled application through npm as a launcher package and one platform package per binary, as esbuild and Biome do. Turn it on with `"npm": { "launcher": true }` in `loom.config.json`, and name the platforms with `npm.platforms`, any of `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`, and `linux-x64-musl`, all six by default. The build compiles each platform's release binary, which bakes the launcher package's name so an `npm install -g` reads the installation method `npm`, and writes `<out>/npm/<package>` and `<out>/npm/<package>-<platform>`, each named for the package without its scope, moving the set into place only once every binary compiled. It replaces or removes only a package folder whose `package.json` names the package it writes there, so a folder it did not write fails the build before anything compiles, or stays when its platform was dropped, and a `package.json` `name` outside npm's package name rule fails with code 2. The launcher is dependency-free CommonJS that runs the matching platform package's binary in its own place through `process.execve`, or as a child that forwards signals and dies by the child's signal on a Node without it. Publishing stays in your workflow; see [the npm launcher packages](docs/toolchain/build.md#the-npm-launcher-packages).

- Add `loom release formula` to render a Homebrew formula for a published binary release from its `SHA256SUMS`. It reads the application's name from `--name`, else `loom.config.json`'s `name`, else `package.json` `bin`, and a `loom.config.json` that cannot be used fails it with code 2.

- Add localization of Loom's own sentences through phrasebooks. `localization({ locales: { de: [coreDe] } })` from `@loomcli/plugins/localization` installs phrasebooks per language, and `phrasebook('@loomcli/core', sentences)` makes one, checked at compile time against core's message modules, so a misspelled package, module, or sentence, or a parameter of the wrong type, fails to compile in a phrasebook written as an object literal; a sentence object declared apart and passed by name checks the entries it shares with the module but not a misspelled extra one, which falls back to English. Core renders a failure's sentence, an `out` line, a hint, an issue, and a `-v` log line in the run's language wherever it renders text for a person, and falls back per sentence to English. The failure form, failure codes, `failure.message`, `invoke`'s outcome, JSON output, and the log record stay English. Without a plugin that installs phrasebooks, every output byte is unchanged. See [Localization](docs/core/localization.md) and [the localization plugin](docs/plugins/localization.md).
- Add `host.locale`, the operator's locale as a canonical BCP 47 tag, resolved once at entry from `LC_ALL`, `LC_MESSAGES`, and `LANG`, or from a process handle's new optional `locale`, and `resolveLocale(env)`, the rule that reads it. `mockProcess({ locale })` sets it in a test.
- Add phrases: `phrases(packageName).module(key, sentences)` makes a module's phrases, `Phrase` holds a sentence with its values and computes its English text on first read, and `phrasedIssue`, `issuePhrase`, `failureLines`, and `replaceValue` let a plugin build and rebuild Loom's text. A failure class's constructor, a log call's top-level field values, and an `onFailure` hook's hints take a phrase where they took a string, and a failure class's constructor takes a list of lines. An application may register its own message modules on `MessagePackages` and translate them the same way.
- Add `ViewContext.localize(phrase)` and `FailureViewContext.message`, the failure's sentence in the run's language. `@loomcli/testing`'s `viewContext()` answers an unstated `localize` with the phrase's English text.
- Add the declaration rule [`@loomcli/core/phrasebook-language`](docs/core/diagnostics.md#loomclicorephrasebook-language), which `plugin()` raises for a phrasebook map keyed by anything but a canonical language subtag, such as `de-AT`, `DE`, or `iw`.
- Publish each core sentence's export name and parameters through `MessagePackages`, so a later rename or a changed parameter is a breaking change for a phrasebook that holds the sentence, and a reworded English sentence is named in its release's notes.

- Add a `name` key to `loom.config.json`, the application's release name. `loom build`, `loom release formula`, and `loom init` read it, so the release asset, the Homebrew formula, the npm target's binaries, and the installer script agree on `<name>` when it differs from the one `package.json` `bin` gives: the installer script requests the `<name>-<platform>` asset the build bakes. `--name` still beats the key, and a value that is not a portable name fails the run with code 2.
- Change the sentence for a build that finds no application name in `bin` to name the `name` key as well as `--name`.

- Change the `-vv` reason when the installation is absent from `Skipped the update check: notes was not installed by install.sh.` to `Skipped the update check: notes has no installation record and does not run from a Homebrew Cellar or a package manager's global root.`, where `notes` is the application name.
- Change the `-vv` reason for a run without release facts from `Skipped the update check: notes is not a release binary.` to `Skipped the update check: notes is not a release build.`, because a release bundle now passes it.

- Add the plugin pack's sentences to localization. `phrasebook('@loomcli/plugins', sentences)` makes a phrasebook for the pack, checked at compile time against its message modules, and compiles for an application that imports any of the pack's subpaths. The modules are keyed `background`, `common`, `completion`, `config`, `dotenv`, `external-commands`, `format`, `help`, `installation`, `logging`, `manpage`, `mcp`, `self-update`, `service`, `skills`, `suggestions`, and `version`. Installed through `localization()`, it renders in the run's language the help page's headings, facts, hints, and INPUT and option-group sentences, the records view's count, the failures, issues, and `-v` lines of the configuration and format plugins, the help plugin's usage hint, the shared change events at `-v`, the suggestions plugin's fix inside core's line, and every other plugin's failures, notices, status notes, and `-v` lines. Declared descriptions, man pages, and skill references stay English. Without a plugin that installs phrasebooks, every output byte is unchanged. See [the localization plugin](docs/plugins/localization.md).
- Add `PluginMessageModules`, exported from `@loomcli/plugins/localization`, the pack's member of `MessagePackages`. Each sentence's export name and parameters are public through it, so a later rename or a changed parameter is a breaking change for a phrasebook that holds the sentence, and a reworded English sentence is named in its release's notes.
- Add `@loomcli/validators`' sentences to localization. `phrasebook('@loomcli/validators', { common: { ... } })` makes a phrasebook for the validator catalog's issues, which compiles for an application that imports `@loomcli/validators`. Each issue the catalog reports carries its phrase, so an input's line renders the issue in the run's language, while the issue's `message`, `code`, and `params` stay English and unchanged, and the validators run outside Loom as before. A catalog issue now lists `message` after `code` and `params`, so an inline snapshot or `util.inspect` of one shows the members in that order; deep equality is unchanged.
- Add `@loomcli/prompts`' sentences to localization. `phrasebook('@loomcli/prompts', { common: { ... } })` makes a phrasebook for the prompts package, which compiles for an application that imports `@loomcli/prompts` or `@loomcli/prompts/views`. Its failures, the line under a rejected answer, the dropped-lines notice, and the fixed labels the default views draw, such as the key hints under a question, `Searching…`, `No matches`, and progress units, render in the run's language. A view override still receives strings.
- Fix `service status` lining up a row name in wide characters, such as a probe's row an author names `接続`: it padded names by string length, so that row's value began a column or two early. It now pads by display width, as the new `skills status` does.

- Allow `issueCode`'s `message` to return a `Phrase` as well as a string, so a validator package built on `issueCode` localizes its issues through a phrasebook. The change is additive: an existing config still compiles and behaves the same, and a string `message` builds the same issue. Only code that calls a config's own `message` and expects a `string` needs to narrow the result.

- Add `environment`, `output`, and `stopTimeout` to the service plugin's settings: environment variables the unit sets, one file for the service's stdout and stderr, and the manager's stop timeout in milliseconds. When `output` is set, service status reports the configured output file and whether it exists in place of the manager's console capture. The `unitHoldsControl` sentence, for a control character the unit cannot store, now names an environment variable too, and `service install` fails with the new `outputFolderBlocked` or `outputFolderUnwritable` sentence when the output file's folder cannot be created.

- Teach the authoring skill that `loom init` writes the 0.20.0 surface: the configuration plugin's TOML and YAML readers, `--fields` and the streamed `jsonl` row view, log message templates, `log.with`, redaction, and the `logging()` plugin's destinations, `needsTerminal()`, completion value hints and named completers, generated command references in an application's skills, a middleware's `unknownCommand`, `invokedBy`, and `transform`, the run-once `onCommandAttach` and `onGraphBuilt` hooks, typed `invoke` paths and the call's `view`, `context.message` and `localization()` in a failure view, package-manager update notices, the release name, `install.sh --unmanaged`, and self-update attestation.

### Fixes

- Fix the order of the logging plugin's console records on a stderr that is not a terminal, such as under `2>run.log` or in CI. Core now carries what an `onLog` hook writes to the run's stderr through the run's stderr order off a terminal as well as on one, so each record follows its own `-v` log line and precedes the warnings, log lines, and progress lines of later calls, where a record could land above the output of earlier calls before. A record, and a `-v` log line, still reach stderr in the log call when nothing waits ahead of them, so they survive a `process.abort()` or a crash that follows. A record logged while an earlier write is still queued, such as right after an unawaited `out.warn`, waits for that write: `process.exit()` and a signal's shutdown write both, and an abort before its turn loses both. A record an `onShutdown` handler logs, and the `A shutdown handler failed.` event, reach stderr before the process ends. See [At the process's end](docs/core/output.md#at-the-processs-end).

- Fix a streamed message on a lane view core ships laying out its whole text again at every chunk once a finished line held a raw color or hyperlink sequence, a lone carriage return or another terminal control, a pad or no-wrap frame, a header core rejects, a stray close, or a style that names a token the application's theme adds, so the work of a long message grew with the square of its length. The message now carries what such a line leaves open into the lines after it and lays out each finished line a bounded number of times, writing the same bytes as before. It still lays out everything after the last line it had finished once a finished line holds a style naming a token the application's palette lacks, or a frame header or terminal control string that never ends. Where the rendering policy keeps terminal controls, the message carries every raw SGR command Loom does not track, because each one is written as it is, so a message that sets such a command on every line still lays out text that grows with the square of its length. See [A streamed message](docs/core/output.md#a-streamed-message).

- Fix SIGINT cancellation of rows sources whose pulls resolve through microtasks alone. Under row views and while collecting for whole views, core reads a monotonic clock every 64 rows and gives the event loop a turn once 50 ms have passed since the last one, so a Ctrl-C stops the sequence at the first check point after about 50 ms of the source's own work and reports incomplete output. A row's own work is not interrupted, so a source whose rows each take longer stops a check point's worth of rows later.

- Fix the Zsh completion script running text typed in a file path when Tab lists file names. With Tab bound to `complete-word`, a typed `$(…)/`, such as in `--config $(touch x)/`, ran when the script handed the word to Zsh's `_files` or `_path_files`. The script now lists file names itself and reads the typed folder as text, so the script never runs what was typed. Zsh itself can still expand the word, and the script cannot prevent it: the default Tab widget, `expand-or-complete`, and the `_expand` completer, when the operator's `completer` style lists it, each run a typed `$(…)`. The listing keeps the operator's completion styles, such as `matcher-list` and `format`, except `file-patterns`, which `_files` honored and the script's own listing does not, and inserts each name exactly, with a leading `~` or `=` escaped. It matches only the last path component, so an abbreviated path such as `D/R` no longer expands to `Docs/Readme.json`. A leading `~/` still lists the home folder; a typed `$HOME/`, `~user/`, `~[x]`, or `=cmd` is read as text.

- Fix shell completion of a file name attached to its option when the option has no value hint or has `{ files: true }`. A value attached to the short spelling, as in `-pa<Tab>` or a short group `-vpa<Tab>`, listed nothing in any shell, and `--path=a<Tab>` and `-p=a<Tab>` listed nothing in Zsh and PowerShell. The `__complete` answer now writes the option's lead, such as `-p`, `-vp`, or `--path=`, as its first word under directive `0` when some of the value follows it, and the Bash, Zsh, Fish, and PowerShell scripts list every file name for the rest of the word and insert each behind the lead, so `-pa<Tab>` inserts `-palpha.json`. Nothing typed is evaluated. In Nushell these words still list nothing. A script an operator installed before this release completes these words as it did, until `completion update` replaces it.

- Fix a streamed message on a terminal writing part of an escape sequence when a chunk ended inside one, such as inside an OSC 8 link's close: a streamed `print` counted that part as text it had written and never wrote the text after it, so that text was missing from the screen. Before its end, a streamed message now holds back a lone ESC, a CSI without its final byte, or an OSC, DCS, SOS, PM, or APC string without its terminator that ends the text so far, until the chunk that finishes it arrives or the iterable ends. It reads the text as resolution does, so frame markup between a sequence's bytes, as two chunks that each wrap part of it in a style call leave it, does not part them. Bytes off a terminal are unchanged. See [A streamed message](docs/core/output.md#a-streamed-message).
- Fix a streamed message on a terminal dropping the terminal controls that the text writes after its last line break with no text after them, such as a window title or a bell under a rendering policy that keeps terminal controls. At its end the message now writes them, with the line break the method writes after them for the joined text.

- Fix Zsh and PowerShell completion of a file name for a value whose word ends at its option's lead, as in `--path=<Tab>`, `-p=<Tab>`, or a short group `-vp=<Tab>`, when the option has no value hint or has `{ files: true }`. Those shells listed no file name for such a word. The scripts now read such a word as the lead, list every name in the current folder that does not start with `.`, and insert each behind it, so `--path=<Tab>` inserts `--path=alpha.json`. A word is read as a lead only when it is `--` and a name of ASCII letters, digits, `_`, `.`, and `-` that starts with a letter or digit, or `-` and ASCII letters, followed by `=`, so nothing typed is evaluated and a word that holds `$(…)` or a backtick lists nothing. A script an operator installed before this release completes these words as it did, until `completion update` replaces it.

- Fix PowerShell completion of a value attached to its short option after a typed `.`, as in `-pnotes.<Tab>` or `-calpha.j<Tab>`, which listed nothing, because PowerShell splits such a word at its first `.` before the script reads it. The script now reads a word under the cursor that starts with `.` and touches the parameter before it as one word, its quoting and escapes removed as in any other word, so ``-pnotes.` j<Tab>`` matches `notes. january.txt`, and inserts each name with the rest of the word single-quoted after the parameter, so `-pnotes.<Tab>` inserts `-pnotes'.txt'`, which the program receives as `-pnotes.txt`. A `.` after a space, as in `-p .j`, still starts a word of its own, and nothing typed is evaluated. A script an operator installed before this release completes these words as it did, until `completion update` replaces it.

- Fix raw ANSI text that sets an underline color, such as `\e[58;5;3m` or `\e[58;2;1;3;4m`, whose parameters Loom read as separate codes, so they could turn modifiers on, change the text or background color, or reset every attribute. Loom now reads the command whole and does not track it, so the `terminalControls` setting keeps it whole under `'preserve'` and drops it otherwise. The colon form `\e[4:0m`, which turns underline off, no longer turns it on.

- Fix a streamed message off a terminal taking time that grows with the cube of an unbroken line's length, so a long relayed token stream with no line breaks, written to a pipe or a file, stalled for minutes. Each chunk now costs work linear in the text so far, as it does on a terminal, and the bytes written are unchanged.

- Fix terminal output at process exit and at `SIGQUIT` so an unfinished streamed `print` line ends and resets its color before queued warnings, log lines, and records appear.

- Fix a streamed message costing each chunk time in the square of a long run of spaces or tabs inside one line, on a terminal and off one: a run of 16,000 spaces took about 0.65 seconds a chunk. The trailing run a streamed message holds back is now found in time linear in its length, and the bytes written are unchanged.
- Fix a streamed `print` on a terminal, under a rendering policy that keeps terminal controls, counting the payload of a DCS, SOS, PM, or APC string as visible text and writing the string's terminator in a separate write. Such a string that `ESC \` ends, with no ESC in its payload, is now written whole, terminator included, and takes no width; one that the C1 ST ends, or whose payload holds an ESC, as tmux passthrough's does, still counts its payload as text.
- Fix the `loom` bin's sentence for a path it is denied creating or removing, which spoke of execute access to each folder above the path: it now says to give write access to the folder that holds it. A create that meets a link to a missing path, on the path or a folder on the way, now says that it or a folder on the way to it is a link to a path that does not exist, or that a folder on the way is missing, instead of saying the path does not exist.
- Fix the service, completion, man page, and skills plugins failing with "Something went wrong." and no path when a file sits where a folder belongs on the way to a file or folder they install or record, or when the folder cannot be written. The same fix covers a folder they cannot search or a file they cannot read. `install`, `uninstall`, and `update`, like the new `skills status`, now name the path they cannot reach and say to remove or rename that file, or name the path they cannot read and say to make it readable, and `install` and `update` name the path they could not write and say to make the location writable, then run the command again. A run that meets a file in place of a folder fails before it changes any installed file or the installation record, so the installed files stay owned once the folder is back; it may already have removed a stopped run's leftover staging files or recovered a pending record, as the next run would. A service install whose new unit's location cannot be written has already stopped and disabled an earlier unit when it fails. `completion uninstall` of one shell no longer adds its shared folders to another shell's record before it fails on a third shell's path.

- Allow any pnpm from 12.16.1 on as `@loomcli/loom`'s optional peer dependency, so a project on a later pnpm installs `@loomcli/loom` with no unmet peer warning. `loom release` prepares `pnpm-lock.yaml` with the pnpm the project installs.

## v0.19.0 - 2026-11-17

This is the polish release: every published export is documented and guarded by `check:api`, the SDK's contracts read one way across core, the plugins, and the libraries, and the prompt, validator, option, and progress floor fills in. `loom init` now also keeps an authoring skill current for an author's coding agent.

Keep all installed `@loomcli` packages at the same exact version, `0.19.0`. Before upgrading, act on these breaks, which no compile error reports, one line each:

- A linked `select` now answers its input's validated value, keeps asking on a choice the validator rejects, and needs a `graph` from `inspect()` in an `actionContext` test; a `questionFrame` override draws choice rows, not strings.
- A `questionFrame` override that falls through to a default case now meets the `editor` kind.
- With `format()` installed, a group's own `format` option, or one with `format({ short })`'s spelling, fails every run with exit 1.
- `loom changelog check`, `write`, and `notes` refuse a fragment with CRLF line endings, non-UTF-8 bytes, or a refused control character.
- `loom` fails on a `loom.config.json` that cannot be read or parsed, or that holds a value its schema rejects, where it warned and ran on conventions.
- An `out` message that ends with a line break no longer prints a blank line after it.
- On `0.x`, a feature fragment advances the minor, so a patch `--target` or a patch prerelease fails the cut.
- A `mockProcess` test's configuration walk now stops at its `cwd`, so it no longer finds a file above it; name `ceiling` on the mock to let the walk reach that file.
- `loom changelog write --narrative` refuses a file with CRLF line endings, non-UTF-8 bytes, or a refused control character.
- An optional argument declared before a content argument with a positive `min` throws a `DeclarationError` at build; make it an option.
- Code that reads a manifest as parsed JSON meets `optionGroups` entries of kind `requires`, which carry `option` and `requires` in place of `options`.
- Words after a bare `--` now fill arguments, or fail with exit 2, unless the Command declares `.passthrough()`; `invoke` refuses a passthrough tail without it; the rule `@loomcli/core/variadic-argument-last` is now `@loomcli/core/argument-after-variadic`.
- A region opened with `input: true` is not live under `TERM=dumb` or `ACCESSIBLE`, and no region is live under `ACCESSIBLE`, so its frames draw nothing there.
- `@loomcli/loom`'s optional `pnpm` peer is now exactly 12.16.1.
- `loom pr check` refuses a release PR whose `CHANGELOG.md` narrative holds CRLF, non-UTF-8 bytes, or a refused control character.

Then run `tsc --noEmit` and fix what it reports: a lane in a test's `out` with an unannotated parameter, a hand-built `progress()` context without `warn` or `draw`, a reader of `supplied.options` that meets arity tuples, a pack extension descriptor's `schema` read as valibot or its facts mutated, a read of `options` on an `optionGroups` entry, `passthrough` read on a Command without the mode, and the `select` frame and `SelectSettings.choices` changes. Each breaking entry below carries its migration.

### Breaking Changes

- Add `multiselect`, a question that offers the same choices as `select`, toggles them with Tab always and with Space when it does not search, submits them in the order they were selected between `min` and `max`, and links a multiple string option or a variadic string argument.
- Add choice objects to `select` and `multiselect`: a `value` of any type on an unlinked question, a `label`, a `description`, and a `disabled` state with its reason, beside `{ separator }` entries.
- Add `search: true`, which filters a question's static choices as the operator types, and `source`, a function that returns the choices for a search term and whose previous call each keystroke aborts.
- Add Ctrl-P, Ctrl-N, Home, and End to a select's navigation, and draw a supplied value a question cannot select in its issue instead of dropping it.
- Add `validateLinkedValue` to `@loomcli/core`, which runs a linked input's validator on one value with the question's validation options, and its types `LinkedValue`, `LinkedValueContext`, `ValueLink`, and `LinkedOutput`.
- Change a linked `select` that asks to pass the chosen value through the linked input's validator and return its output, typed as the input's value, as a skipped `select` already returns. A choice the validator rejects now keeps the question asking with the validator's issue, where it used to return the choice's string, and a test that asks one through `actionContext` states a `graph` that `inspect()` returned.
- Change `SelectSettings` to a union of a `choices` list and a `source`, so its `choices` is optional.
- Change the `select` member of `questionFrame`'s data to choice rows and separator rows, which the new `multiselect` member shares, with a `highlighted` that may be `undefined`, export `TypedFrame`, `ListFrame`, `ChoiceRow`, and `SeparatorRow` from `@loomcli/prompts/views`, and add the question's `kind` to `answeredLine`'s data, so the default view draws an empty multiselect answer as `none`.

### Migration

**Affected surface.** The type checker reports a hand-built frame, a read of `SelectSettings.choices`, and a read of a linked `select`'s answer once its validator's output type is not a string. Four breaks have no compile error and surface when the code runs: a `questionFrame` override that interpolates a row into a template string draws `[object Object]`, a linked `select` whose input's validator returns a different string, such as `path()`, answers that string, so a comparison with the choice compiles and is false, a linked `select` that offers a choice its input's validator rejects keeps asking, and a unit test that asks a linked `select` through `actionContext` without a `graph` from `inspect()` fails. The surfaces are a view override of `questionFrame` from `@loomcli/prompts/views` that reads a select's `choices` or `highlighted`, frame data an application builds by hand for `out.draw(data, questionFrame)`, an action that reads the answer of a `select` with `option` or `argument` whose input declares a validator that transforms its value, a `select` with `option` or `argument` that offers a choice its input's validator rejects, code that reads `choices` from a `SelectSettings` value, such as a wrapper around `select`, and a unit test that calls an action asking a linked `select` through `actionContext` without a `graph` from `inspect()`.

**Why.** A choice row carries a label, a description, a disabled state, and a selection, and one row type serves both list kinds. A search may leave nothing highlighted. A linked question's asked answer passes the same validator as its skipped answer, so both have one type, and a choice that validator rejects can no longer answer. A question with a `source` has no `choices`.

**Before and after.**

Before, in a `questionFrame` override:

```ts
if (data.kind === 'select') {
  return data.choices.map((choice, index) => (index === data.highlighted ? `> ${choice}` : `  ${choice}`)).join('\n');
}
```

After:

```ts
if (data.kind === 'select' || data.kind === 'multiselect') {
  return data.choices
    .map((row, index) => {
      const label = escapeControlCharacters(row.label);
      return row.kind === 'separator' ? `  ${label}` : `${index === data.highlighted ? '>' : ' '} ${label}`;
    })
    .join('\n');
}
```

**Steps.**

1. In a `questionFrame` override, read each row's `kind` for a `select` or `multiselect` frame: draw a `'separator'` row's `label` as a separator, and a `'choice'` row's `label` where the string was drawn, with its `disabled`, `reason`, `description`, and `selected`. A label is plain text an application or a source may build from data, so draw it through `escapeControlCharacters` from `@loomcli/core`, as the default views do.
2. Handle `highlighted` of `undefined`, which a search with no choice to highlight draws.
3. Handle the `multiselect` member, which an override that switches on `kind` meets as a new case.
4. In hand-built frame data, build rows: `choices: [{ kind: 'choice', label: 'sqlite', description: undefined, disabled: false, reason: undefined, selected: false }]`.
5. Where an action compares a linked `select`'s answer with a choice string, compare it with the input's validated value, or give the input a validator whose output is the choice strings, such as `oneOf(['sqlite', 'postgres'])`.
6. Align each linked `select`'s choices with its input's validator: remove a choice the validator rejects, such as `mysql` beside `oneOf(['sqlite', 'postgres'])`, or widen the validator to accept it.
7. Where code reads `choices` from a `SelectSettings` value, check that it is present first, such as `settings.choices?.length ?? 0`, because a question with a `source` has none.
8. In a unit test that calls an action asking a linked `select` through `actionContext`, state `graph: application.inspect()` and `command` as that graph's node for the routed Command, because the chosen value now passes the input's validator, which core reads from that graph's build.

**Validation.** Run `tsc --noEmit` to type-check every hand-built frame, reader of `SelectSettings.choices`, and comparison with a linked `select`'s answer. `tsc` does not catch an override like the one before: a row object interpolated into a template string compiles and draws `[object Object]`. So run the application's test command, such as `vitest run` or `bun test`, with a test that draws each overridden `select` and `multiselect` frame through `viewContext` and asserts the text it draws, and that answers each linked `select` on `mockProcess` by choosing each of its choices. For each linked `select` whose input's validator transforms a string, such as `path()`, check the value its action compares the answer with.

- Add `editor`, a question that waits for Enter, opens the operator's editor, named by `VISUAL`, `EDITOR`, or `vi`, on a private temporary file that holds the prefill, and answers the text the file holds when the editor exits. It links a string option or a string argument that takes one value, prefills, skips, and validates as `text` does, takes an `extension` for the file, and fails with `EditorError` when the editor cannot start, exits with a code other than 0, or the question cannot write the editor's file.
- Add `out.lendTerminal(work)` to `@loomcli/core`, which holds every live region still while `work` runs a child program that draws on the terminal, and draws them again below whatever the child wrote once it settles.
- Add the `editor` member, `EditorFrame`, to `questionFrame`'s data, and to `answeredLine`'s data the `kind` `'editor'` and an optional `lines`.

### Migration

**Affected surface.** The type checker reports an override with an exhaustive check on `kind`, such as one that ends in `assertNever`. An override that falls through to a default case for a kind it does not know has no compile error: it draws whatever the default draws for an editor question. The surface is a view override of `questionFrame` from `@loomcli/prompts/views` that switches on its data's `kind`.

**Why.** An editor question draws through `questionFrame` with a frame of its own, `{ kind: 'editor', message, issue, editing }`, so the data's union gains a variant.

**Before and after.**

Before, in a `questionFrame` override with an exhaustive check:

```ts
switch (data.kind) {
  case 'text':
  case 'secret':
  case 'confirm':
    return drawTyped(data);
  case 'select':
  case 'multiselect':
    return drawList(data);
  default:
    return assertNever(data);
}
```

After:

```ts
switch (data.kind) {
  case 'text':
  case 'secret':
  case 'confirm':
    return drawTyped(data);
  case 'select':
  case 'multiselect':
    return drawList(data);
  case 'editor': {
    const hint = data.editing ? 'Waiting for your editor to close the file…' : 'Press Enter to open your editor';
    const line = `? ${data.message} › ${hint}`;
    return data.issue === undefined ? line : `${line}\n  ✘ ${data.issue}`;
  }
  default:
    return assertNever(data);
}
```

**Steps.**

1. In a `questionFrame` override, handle the `'editor'` kind: draw its `message`, its `issue` when it has one, and a hint that reads `editing`, which is `true` while the editor is open.
2. Where an override falls through to a default case for a kind it does not know, check that the default draws a frame an editor question can show.

**Validation.** Run `tsc --noEmit` to type-check every override with an exhaustive check. Run the application's test command, such as `vitest run` or `bun test`, with a test that draws the overridden `questionFrame` through `viewContext` with an `EditorFrame` and asserts the text it draws.

- Export a facts interface for each pack extension, the value its descriptor takes and the value `readExtension` reads back. `@loomcli/plugins/help/extension` exports `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `HelpSectionPath`, and `CommandExample`. `@loomcli/plugins/manifest/extension` exports `ManifestCommandInput` and `DeclaredFailureInput`, which an author supplies, `ManifestCommandFacts` and `DeclaredFailure`, which the schema outputs, and `CommandExample`. `@loomcli/plugins/mcp/extension` exports `McpCommandFacts`, `McpAnnotations`, `McpInputFacts`, and `McpArgumentFacts`. `@loomcli/plugins/config/extension` exports `ConfigInputFacts`.
- Allow read-only arrays in the values `helpCommand`, `helpInput`, and `manifestCommand` take, so a list declared `as const` or typed `readonly` passes as it is.
- Change the published `schema` of the pack's extension descriptors from valibot's schema types to `StandardSchemaV1` over the exported facts interfaces: `helpCommand`, `helpInput`, and `helpArgument`; `manifestCommand`; `mcpCommand`, `mcpInput`, and `mcpArgument`; and `configInput`. No published declaration of `@loomcli/plugins` names valibot any longer, so an application's type check with `skipLibCheck: false` loads no valibot declarations through the pack. Validation is unchanged: every value the descriptors accepted before they accept now, with the same messages.

### Migration

**Affected surface.** The type checker reports every affected site. The first surface is application code that reads a pack descriptor's `schema` as a valibot schema: it passes the schema to a valibot function such as `v.parse` or `v.InferOutput`, or reads a valibot member such as `entries`. A call of the descriptor, such as `helpCommand({ details })`, and a read through `readExtension` are not affected.

The second affected surface is code that assigns to or mutates a value typed from a descriptor's input or output, such as `Parameters<typeof helpCommand>[0]` or `StandardSchemaV1.InferOutput<typeof helpCommand.schema>`. The facts are readonly at every depth now, so an assignment to one of their fields, a `push` on one of their lists, or reading one of their tuples or lists into a mutable-typed variable no longer compiles. Type such a value with the exported facts interface, and build it as a fresh object literal or a spread.

**Why.** A published type that named valibot loaded all of valibot's declarations into every author's type check. The descriptors now publish the [Standard Schema](https://standardschema.dev) contract, which every schema already implemented, over interfaces the pack exports.

**Before and after.**

Before:

```ts
import { helpCommand } from '@loomcli/plugins/help/extension';
import * as v from 'valibot';

type Facts = v.InferOutput<typeof helpCommand.schema>;
const facts = v.parse(helpCommand.schema, value);
```

After:

```ts
import { helpCommand, type HelpCommandFacts } from '@loomcli/plugins/help/extension';

const result = await helpCommand.schema['~standard'].validate(value);
if (result.issues === undefined) {
  const facts: HelpCommandFacts = result.value;
}
```

Code that built a facts value field by field builds it as one literal, and extends a list with a spread:

Before:

```ts
const facts: Parameters<typeof helpCommand>[0] = {};
facts.details = details;
facts.examples = [];
facts.examples.push({ command: 'notes add' });
```

After:

```ts
import { helpCommand, type HelpCommandFacts } from '@loomcli/plugins/help/extension';

const base: HelpCommandFacts = { details, examples: [] };
const facts: HelpCommandFacts = {
  ...base,
  examples: [...(base.examples ?? []), { command: 'notes add' }],
};
```

**Steps.**

1. Replace each valibot type computed from a descriptor's `schema` with the exported facts interface: `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `ManifestCommandInput` and `ManifestCommandFacts`, `McpCommandFacts`, `McpInputFacts`, `McpArgumentFacts`, or `ConfigInputFacts`.
2. Replace each valibot call that takes a descriptor's `schema` with the schema's `~standard.validate`, which returns the output or the issues.
3. Where code assigns to or mutates a value typed from a descriptor's input or output, type the value with the exported facts interface and build it as a fresh object literal or a spread.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its tests. The type check reports every remaining use of a valibot member on a descriptor's `schema`, and every assignment to a readonly facts value.

- Change `@loomcli/core/optional-argument-last` to refuse an optional argument declared before a content argument whose `min` is positive. Such a content argument must receive a source, so it counts as required. Bare words fill arguments left to right, so a lone file word bound to the optional argument and left the content argument short.

### Migration

**Affected surface.** No compile error: building the application throws a `DeclarationError` when it starts. The surface is applications that declare an optional argument before a content argument with a positive `min`, such as `app lint [profile] <files...>`. This includes a content argument that claims stdin, where a piped run such as `cat a.ts | app lint` omitted `profile` and worked: the declaration is refused all the same.

**Why.** `app lint a.ts` bound `a.ts` to `profile` and then failed for want of a file, so `profile` could not be omitted whenever files were named on the line. The declaration is now refused when it is written. A content argument with a positive `min` is variadic, and no optional argument may follow a variadic argument, so the optional argument cannot move after it: it becomes an option.

**Before and after.**

Before:

```ts
new Application('lint')
  .argument('profile', {})
  .argument('files', { min: 1, type: 'content', variadic: true });
```

After, with `profile` as an option:

```ts
new Application('lint')
  .option('profile', { type: 'string' })
  .argument('files', { min: 1, type: 'content', variadic: true });
```

An operator who typed `app lint strict a.ts` now types `app lint --profile strict a.ts`.

**Steps.**

1. Find each Command that declares an optional argument before a content argument with a positive `min`.
2. Make the optional argument an option. If a positional value is always expected, declare it `required: true` instead, so it stays an argument before the content argument.
3. Update scripts and documentation that passed the value as a bare word.

**Validation.** Run the application's test command, such as `vitest run` or `bun test`, with a test that builds each changed Command and expects no `DeclarationError`. Start the application and run each changed Command with its new option.

- Change `loom changelog write` so a feature fragment advances the minor below `1.0.0`, as a breaking fragment does. A feature cut from `0.4.7` now takes `0.5.0` instead of `0.4.8`, and a fix-only cut still takes `0.4.8`. The bump from `1.0.0` is unchanged, as [ADR-0145](docs/decisions/0145-below-1-0-0-a-feature-fragment-advances-the-minor.md) records.

### Migration

**Affected surface.** No compile error: the cut fails at run time and names the minimum. The surface is `loom changelog write` in a package below `1.0.0` with a feature fragment pending, when it passes `--target` at a patch version, or when its version is a prerelease of a patch version, such as `0.4.8-rc.1`.

**Why.** The fragment minimum for a feature fragment below `1.0.0` is now the next minor, so a target or a prerelease's release part below that minor no longer meets it, and the cut fails and names the minimum.

**Before and after.**

Before, from `0.4.7` with `feature.tags.md` pending:

```sh
loom changelog write --target 0.4.8
```

After:

```sh
loom changelog write --target 0.5.0
```

**Steps.**

1. Run `loom changelog write --dry-run` and read the next version it prints. From a prerelease, it fails and names the minimum instead.
2. Change any `--target` in release scripts or workflows to that version or higher.
3. For a prerelease such as `0.4.8-rc.1` with a feature fragment pending, cut a new prerelease with `loom changelog write --target 0.5.0-rc.1`, or finalize with `--target 0.5.0`.

**Validation.** From a stable version, run `loom changelog write --dry-run` and check that it prints the expected version and exits 0. From a prerelease, or with a pinned target, run `loom changelog write --dry-run --target` with the new version, such as `0.5.0-rc.1` or `0.5.0`, and check that it exits 0.

- Add an optional view to each semantic method, so a message keeps its level and takes another look: `out.info(text, view)` writes where `info` writes and hides under `-q` as `info` does, and the view replaces the lane view for that call, glyph and gutter included. Any view over a string works, bare, declared, or from the pack, and `out.debug(text, lanes.warn)` draws a warning's look at `-v`. The `out` an `onEnvironment` hook receives takes the same view on `warn`. See [Output](docs/core/output.md#a-messages-own-view).
- Change how a semantic method ends a message: it appends a line break only when the text its view drew does not already end with one, so every message ends with exactly one. A pack view such as `box({ title })` passed to a message writes no blank line after it, and a message that ends with a line break no longer prints a blank line after it, through the default lanes or an override.
- Add `step()` at `@loomcli/plugins/step`, a view over a string that marks a stage of the work with a `primary` pointer and the text in bold, wrapped under its gutter on a terminal. Write it at a level, as in `out.info('Building 3 packages', step())`. A note is a box with a title at a level, `out.info(text, box({ title: 'Next steps' }))`. See [Pack views](docs/plugins/pack-views.md#step).

### Migration

**Affected surface.** No compile error: the output changes at run time. The surface is calls to `out.print`, `out.info`, `out.success`, `out.warn`, `out.error`, `out.debug`, and `out.trace` whose message ends with a line break, and lane overrides under `views` whose text ends with one. A message that ends with no line break, which is how a message is usually written, writes the same bytes as before.

**Why.** A semantic method now ends every message with exactly one line break, whichever view drew it, so a pack view that owns its last line break can draw a message without a blank line after it. One rule covers the lane views and a passed view alike.

**Before and after.**

Before, `out.print('done\n')` wrote `done`, a line break, and an empty line:

```ts
await out.print(summary); // summary ends with '\n'; stdout held a blank line after it
```

After, it writes `done` and one line break. To keep the blank line, end the message with two:

```ts
await out.print(`${summary}\n`); // summary ends with '\n'; the blank line stays
```

**Steps.**

1. Search the application for semantic calls whose message can end with a line break, such as a printed file or a template literal that ends with a new line, and for lane overrides whose text ends with one.
2. Where the blank line after such a message is wanted, add one more `\n` to the message or to the override's text.
3. Where the blank line was unwanted and trimmed away, remove the trim if you like: the message now ends with one line break either way.

**Validation.** Run the application's output tests, and compare its stdout and stderr for the affected commands against the bytes they wrote before the upgrade.

- Change `loom changelog check`, `loom changelog write`, and `loom changelog notes` for a prerelease to refuse a fragment holding bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark (U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, U+061C), or the zero-width space U+200B, so `write` no longer copies a fragment's terminal escape or hidden reordering into `CHANGELOG.md`, nor `notes` onto a release page. The failure names the fragment, the line, and the first such character by its code point, such as `.changes/fix.md: line 1 holds the carriage return U+000D. Save the fragment with LF line endings.`, as [the package changelog](docs/toolchain/changelog.md) describes.

### Migration

**Affected surface.** No compile error: the commands fail when they read the fragment. Fragments in a package's `.changes/` folder, or the folder `paths.changes` names, that `loom changelog check`, `loom changelog write`, or `loom changelog notes` reads, when a fragment has CRLF line endings, is saved in an encoding other than UTF-8, or holds one of the refused characters.

**Why.** `write` copies a fragment's prose verbatim into the changelog and `notes` onto a release page, so a terminal escape, a carriage return, or an invisible bidirectional control in a fragment reached every reader of both.

**Before and after.**

Before, a fragment saved with CRLF line endings passed:

```sh
printf -- '- Fix output.\r\n' > .changes/fix.md
loom changelog check   # Checked 1 fragment.
```

After, the same fragment fails with exit 1:

```text
.changes/fix.md: line 1 holds the carriage return U+000D. Save the fragment with LF line endings.
```

**Steps.**

1. Run `loom changelog check` and read each failure it prints.
2. For a carriage return, save the fragment with LF line endings through your editor's line-ending setting. A repository whose checkout converts line endings can keep fragments at LF with `.changes/*.md text eol=lf` in `.gitattributes`.
3. For invalid UTF-8, save the fragment as UTF-8.
4. For any other character, delete it at the line the failure names.

**Validation.** Run `loom changelog check` and check that it prints `Checked <count> fragments.` and exits 0.

- Change the optional peer dependency of `@loomcli/loom` from `pnpm` 12.8.1 to 12.16.1, the version that prepares `pnpm-lock.yaml` for a release. The error for a missing pnpm now asks for 12.16.1.

### Migration

**Affected surface.** No compile error: `pnpm install` reports an unmet peer. An application that installs `pnpm` beside `@loomcli/loom` to prepare `pnpm-lock.yaml` for a release, and whose `pnpm` is 12.8.1.

**Why.** The peer is exact, because the pnpm that prepares `pnpm-lock.yaml` must be the version Loom was tested with. A project that keeps 12.8.1 now has an unmet peer.

**Before and after.**

Before:

```json
{ "devDependencies": { "pnpm": "12.8.1" } }
```

After:

```json
{ "devDependencies": { "pnpm": "12.16.1" } }
```

**Steps.**

1. Change the `pnpm` dependency that sits beside `@loomcli/loom` to `12.16.1`.
2. Run `pnpm install` to refresh `pnpm-lock.yaml`.
3. Update any pnpm version your CI or tool manager pins to match.

**Validation.** Run `pnpm install` and confirm it reports no unmet peer for `pnpm`.

- Add `ceiling` to `ProcessHandle` and `Host` in `@loomcli/core`: an optional directory above which the configuration plugin's project walk never looks. Core copies it into `host.ceiling` at entry. The real process's handle names none, so a real run walks as before, and `processHandle({ ceiling })` names one. See [Host](docs/core/host.md#the-process-handle).
- Change the project walk of `@loomcli/plugins/config` to end at the host's ceiling when it has one. The walk looks in the ceiling directory itself and never in an ancestor of it. A start directory that is outside the ceiling, being neither the ceiling, inside it, nor an ancestor of it, is looked in alone: the walk reads no ancestor of it. A start directory that is an ancestor of the ceiling looks nowhere. The walk ends at whichever it meets first of below home, the ceiling, a root marker, and the filesystem root. The home file, the XDG user file, `--config`, and the author's variable are not bounded. See [Lookup](docs/plugins/config.md#lookup).
- Change `mockProcess` in `@loomcli/testing` to name its `cwd` as its ceiling unless the test supplies `ceiling`, whether or not the `cwd` is inside `home`. A mock run's configuration walk reads from its working directory and never from a directory above it, so a configuration file above a test's sandbox, such as the developer's own above a checkout, no longer reaches the test. `MockProcess` reads the ceiling as `ceiling`. See [mockProcess](docs/libs/testing.md#mockprocess).

### Migration

**Affected surface.** The break has no compile error. It affects tests that run an application on `mockProcess` from `@loomcli/testing` with a `cwd` below the directory that holds the configuration file, and that expect the configuration plugin's walk to climb to that file, such as a test that starts in a project's `src` directory and reads the project's file. Such a test compiles unchanged, and its run now finds no file in the walk: it reads the schema's output for an empty file, or the home file or the XDG user file when the test wrote one. A test whose directory option names a start directory outside its `cwd` and expects the walk to climb from it is affected the same way, because that walk now looks in the start directory alone. A test whose file is in its `cwd`, a test that names its file with `--config` or the author's variable, and a test that reads the home file are unaffected.

**Why.** A mock with a temporary home and a `cwd` outside that home walked to the filesystem root, so a test run from a checkout under the developer's home read the developer's own configuration file in an ancestor of the checkout. The mock's ceiling keeps every mock run's walk inside its working directory.

**Before and after.**

Before, the walk from `src` climbed to the file in `root` and above it:

```ts
const root = mkdtempSync(join(tmpdir(), 'notes-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, '.notes.json'), '{ "limit": 5 }');

const mock = mockProcess({ argv: ['list'], cwd: join(root, 'src') });
await application.run({ process: mock }); // read root/.notes.json
```

After, the walk looks in `src` alone, so the test names `root` as its ceiling:

```ts
const mock = mockProcess({ argv: ['list'], ceiling: root, cwd: join(root, 'src') });
await application.run({ process: mock }); // reads root/.notes.json, and never looks above root
```

**Steps.**

1. Find each test that passes `mockProcess` a `cwd` and writes the configuration file into a directory above that `cwd`, or above the start directory its directory option names.
2. Add `ceiling` to that mock's fields, set to the directory that holds the file or to the test's temporary directory, whichever the walk should stop at. Keep the ceiling inside the test's temporary directory, so the walk never reads a file the test did not write.
3. Where a shared base of fields, such as a `MockFacts` constant, sets `cwd` for several tests, add `ceiling` beside it.

**Validation.** Run the application's test command, such as `vitest run` or `bun test`. A test that relied on the walk climbing above its `cwd` fails its assertion on the configured value before step 2 and passes after it.

- Change `loom changelog write --narrative FILE` to refuse a narrative file holding the bytes and characters a fragment refuses: bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark, or the zero-width space U+200B. `write` no longer copies a narrative's terminal escape or hidden reordering into `CHANGELOG.md`, nor `notes` onto a release page. The failure names the file as `--narrative` gave it, the line, and the first such character by its code point, such as `narrative.md: line 1 holds the carriage return U+000D. Save the narrative with LF line endings.`, as [the package changelog](docs/toolchain/changelog.md) describes.

### Migration

**Affected surface.** No compile error: `loom changelog write` fails when it reads the narrative. The surface is a file passed to `loom changelog write --narrative`, for a stable or a prerelease cut, that has CRLF line endings, is saved in an encoding other than UTF-8, or holds one of the refused characters.

**Why.** `write` copies the narrative's prose verbatim into the changelog, and `notes` copies the release section onto a release page, so a terminal escape, a carriage return, or an invisible bidirectional control in a narrative reached every reader of both.

**Before and after.**

Before, a narrative saved with CRLF line endings was copied into `CHANGELOG.md`:

```sh
printf 'This release fixes output.\r\n' > narrative.md
loom changelog write --narrative narrative.md   # exit 0, with the carriage return in CHANGELOG.md
```

After, the same cut fails with exit 1 and changes no file:

```text
narrative.md: line 1 holds the carriage return U+000D. Save the narrative with LF line endings.
```

**Steps.**

1. Run `loom changelog write --dry-run --narrative FILE` and read the failure it prints.
2. For a carriage return, save the narrative with LF line endings through your editor's line-ending setting.
3. For invalid UTF-8, save the narrative as UTF-8.
4. For any other character, delete it at the line the failure names.

**Validation.** Run `loom changelog write --dry-run --narrative FILE` and check that it exits 0 and, for a stable cut, prints the narrative above the entries.

- Change `loom pr check` to refuse a release PR whose `CHANGELOG.md` narrative holds the bytes and characters a `--narrative` file refuses: bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark, or the zero-width space U+200B. A narrative edited by hand in the release PR after the cut no longer carries a terminal escape or a hidden reordering onto `main` and the release page. The check reads the narrative from the bytes of `CHANGELOG.md`, and the failure names `CHANGELOG.md`, the line within it, and the first such character by its code point, such as `CHANGELOG.md: line 6 holds the carriage return U+000D. Save the narrative with LF line endings.`, as [the PR guard reference](docs/maintaining/pr-guards.md) describes. The compiled entries below the narrative come from fragments, which are already checked, and a release section without a narrative is checked as before.

### Migration

**Affected surface.** No compile error: `loom pr check` fails when it checks the release PR. The surface is a release PR whose `CHANGELOG.md` section holds a narrative, edited after the cut, with a carriage return, bytes that are not UTF-8, or one of the refused characters.

**Why.** The release plan copies the release section onto the GitHub Release page, so a terminal escape, a carriage return, or an invisible bidirectional control edited into the narrative reached every reader of `CHANGELOG.md` and of the release page, though `loom release cut --narrative` already refused the same file.

**Before and after.**

Before, a release PR whose narrative line ended with a carriage return passed:

```sh
pnpm loom pr check --base origin/main --title "chore(release): Release v0.4.8 - Improve output"   # exit 0
```

After, the same check fails with exit 1:

```text
CHANGELOG.md: line 6 holds the carriage return U+000D. Save the narrative with LF line endings.
```

**Steps.**

1. Run `pnpm loom pr check` with the release PR's base and title, and read the failure it prints.
2. For a carriage return, save `CHANGELOG.md` with LF line endings through your editor's line-ending setting.
3. For invalid UTF-8, save `CHANGELOG.md` as UTF-8.
4. For any other character, delete it at the line the failure names, and commit the change to the release branch.

**Validation.** Run `pnpm loom pr check` with the release PR's base and title, and check that it prints `PR checks passed.` and exits 0.

- Change `@loomcli/plugins/format` to declare a hidden `--format` on every group, the root of a group application included. A group's own option named `format`, or one with the short spelling `format({ short })` gives, now collides with it under the hook-collision rule, and every run of the application fails with exit 1. See [Formatter](docs/plugins/format.md).

### Migration

**Affected surface.** No compile error: every run of the application exits 1, `--help` and `--version` included, with the build diagnostic. A development build, and a test on `mockProcess`, prints it. For an option named `format`, the rule is `@loomcli/core/option-declared-twice` and the sentence `Plugin "@loomcli/plugins/format" declares option "format" on Command "cache", which is already declared as a local option.` For a short spelling, the rule is `@loomcli/core/spelling-taken` and the sentence `Plugin "@loomcli/plugins/format" declares option "format" with spelling "-f" on Command "cache", which "--force" already uses.` A distributed build prints `<app>: Something went wrong.` in its place. The surface is an application with `format()` installed whose group, a Command with children and no action, the root included, declares its own option named `format`, or, under `format({ short })`, an option with that short spelling. A Command with an action is unaffected.

**Why.** The formatter states at a group the media type the operator asked for, so `tool --version --format json` prints the extended version as one JSON object at the root of a group application, and `tool --format json` writes a group's missing subcommand as the formatter's JSON line. Routing reads the option as the group's own, and two options with one name or one spelling on one Command leave one of them unreadable.

**Before and after.**

Before, a `cache` group declared its own `format` option, and an application that gives the formatter `-f` declared `-f` on a group:

```ts
new Application('notes', { plugins: [format()] }).command(
  new Command('cache').option('format', { type: 'string' }).command(clear),
);

new Application('store', { plugins: [format({ short: 'f' })] }).command(
  new Command('cache').option('force', { short: 'f', type: 'boolean' }).command(clear),
);
```

After, the group's option takes another name, and the other option another short spelling:

```ts
new Application('notes', { plugins: [format()] }).command(
  new Command('cache').option('layout', { type: 'string' }).command(clear),
);

new Application('store', { plugins: [format({ short: 'f' })] }).command(
  new Command('cache').option('force', { short: 'F', type: 'boolean' }).command(clear),
);
```

**Steps.**

1. Run the application once in development, or its tests, under the new release. An affected application exits 1 with one of the two diagnostics, which names the group.
2. For `@loomcli/core/option-declared-twice`, rename the group's option named `format`, and every place that reads it.
3. For `@loomcli/core/spelling-taken`, change the short spelling of the group's option that the sentence names.

**Validation.** Run the application again, such as with `--help` when help is installed. It no longer exits 1 with the diagnostic, and `--help` prints the page and exits 0. Then run the application's test command, such as `vitest run` or `bun test`.

- Change `loom` to read `loom.config.json` strictly, so a broken file or a rejected value no longer leaves a CI run on conventions. A file the lookup finds that cannot be read, does not parse, or does not hold a JSON object, and a value the file's schema rejects, such as `"paths": { "changes": "" }`, now fail `build`, `init`, `changelog check`, `changelog write`, and `changelog notes` with code 2, where the command warned or dropped the value and ran on conventions. Before, `loom changelog check` over a broken file that names its fragment folder warned, checked the conventional `.changes/` instead, and exited 0, printing `Checked 0 fragments.` when that folder held none. Now it fails: `loom: Configuration file loom.config.json is not valid JSON at line 3, column 5. Correct its syntax, or remove it.` A missing file, an unknown key, and a run under `--no-config` behave as before. The [configuration file](docs/toolchain/build.md#the-configuration-file) reference states the rules.

### Migration

**Affected surface.** No compile error: the bin fails at run time. The surface is a package whose `loom.config.json`, or the file `--config` names, holds a value the schema rejects: a `paths` or `postInstall` that is not an object, a `paths` value that is not a nonempty string, a `postInstall.command` that is not a non-empty list of strings, or a `postInstall.message` that is not a string. A `loom.config.json` the lookup finds that cannot be read, does not parse, or does not hold a JSON object is affected too. `loom init` scaffolding a new application under a package whose file is such a file is affected too.

**Why.** A command that ran on conventions after a warning, or after dropping a value, read or wrote paths the package did not name, and a CI guard passed with nothing checked.

**Before and after.**

Before, a `loom.config.json` whose fragment folder is an empty string, which `loom` dropped while it read `.changes/`:

```json
{ "paths": { "changes": "" } }
```

After, name the folder, or remove the key to use `.changes/`:

```json
{ "paths": { "changes": "changes" } }
```

**Steps.**

1. Run `loom changelog check` in each package that keeps a `loom.config.json`, and each `loom` command CI runs with the `--config` argument it passes, so a file `--config` names is read too.
2. For each failure, correct the value or the syntax it names, or remove the key or the file to use the convention.
3. Where `loom init` scaffolds a new application under such a package, correct that package's file, or run `loom init --no-config`.

**Validation.** Run `loom changelog check` and `loom build` in each package. Each exits 0, and `changelog check` counts the fragments in the folder the file names.

- Change the first bare `--` so it ends option parsing and every later word is a plain word for the routed Command, as POSIX reads it. A word after `--` fills the next unfilled argument, so `rm -- -draft.txt` fills `rm`'s argument, and a word with no argument left to fill is the unexpected-argument usage error, with exit code 2. See [Passthrough](docs/core/options.md#passthrough).
- Add `.passthrough({ description? })`, which a Command with an action declares to keep a passthrough tail. With it, every word after the first bare `--` reaches the action in `passthrough` untouched, as every Command's did before. Without it, the action context has no `passthrough` member. The validation context and the middleware `request` keep `passthrough`, which is `[]` without the mode. `@loomcli/testing`'s `actionContext` reads an unstated `passthrough` as `[]` instead of throwing.
- Change `invoke` to refuse a non-empty `values.passthrough` on a Command that does not declare `.passthrough()`, with an `UnexpectedArgumentError`.
- Rename the declaration rule `@loomcli/core/variadic-argument-last` to `@loomcli/core/argument-after-variadic`, which now allows required scalar arguments after a variadic argument.
- Allow required scalar arguments after a variadic argument, so a Command can declare `copy <src...> <dest>` or `mv [src...] <dest>`. The arguments after the variadic fill from the end of the line, and the variadic takes the words between. An optional argument, a second variadic argument, an argument required only when input is not interactive, and a content argument still may not follow a variadic argument. See [Application declarations](docs/core/application.md).
- Add `passthrough` to `CommandNode` and the manifest's Command entry: the declared mode's description, or `null` on a Command without `.passthrough()`. Help's usage line ends with `[-- <args>...]` only on a Command that declares `.passthrough()`.
- Change the unknown-option sentence on a Command that declares an argument and does not declare `.passthrough()` to `Supply a declared option, or pass it as an argument after "--".`

### Migration

**Affected surface.** This change holds four breaks.

- The type checker reports every affected site. The surface is an action, or a test built with `@loomcli/testing`'s `actionContext`, that reads `passthrough` from the action context of a Command that does not declare `.passthrough()`.
- No compile error: behavior changes at run time. The surface is a Command without `.passthrough()` that an operator or a script gives words after a bare `--`. Those words now fill the Command's arguments, or fail with exit code 2 when no argument is left, where they were dropped into an unread `passthrough` before. The service plugin is in the surface: a `run` setting whose words after a bare `--` leave an extra word on a Command without the mode, such as `run: ['convert', '--', 'in.txt', 'extra']`, now fails the graph build, where an earlier release accepted it.
- No compile error: an `invoke` call fails at run time. A call by name types no `--`, so its tail is `values.passthrough`. The surface is an `invoke` call, or an `app.invoke` call, that passes a non-empty `values.passthrough` to a Command without `.passthrough()`. It now fails with an `UnexpectedArgumentError`, where the action ignored the words before.
- No compile error: a string no longer matches. The surface is code or documentation that names the rule identity `@loomcli/core/variadic-argument-last`, such as a test that matches a `DeclarationError`'s rule.

**Why.** Every Command used to accept a passthrough tail, so a word that starts with a hyphen could not fill an argument, and a Command that never read the tail dropped it in silence. Passthrough is now something a Command declares, and help shows `[-- <args>...]` only on a Command that takes a tail.

**Before and after.**

Before, an action that forwards its tail to another program:

```ts
new Command('exec')
  .argument('tool', { required: true })
  .action(({ args, passthrough }) => run(args.tool, passthrough));
```

After:

```ts
new Command('exec')
  .argument('tool', { required: true })
  .passthrough({ description: 'Arguments for the tool.' })
  .action(({ args, passthrough }) => run(args.tool, passthrough));
```

Before, a call by name that passed words the Command never read:

```ts
await invoke(['get'], { args: {}, options: {}, passthrough: ['user.name'] });
```

After, with the words as the argument the Command declares:

```ts
await invoke(['get'], { args: { path: 'user.name' }, options: {} });
```

**Steps.**

1. Run the type checker, and add `.passthrough()` to each Command whose action reads `passthrough`. Call it before `.action()`.
2. For each Command without `.passthrough()`, check the scripts and documentation that pass words after a bare `--`. Declare `.passthrough()` where the words are meant for a tail. Where they are meant as arguments, keep the `--`: the words after it now fill the Command's arguments, even a word that starts with `-` or names a child Command.
3. For each `invoke` and `app.invoke` call that passes `values.passthrough`, declare `.passthrough()` on its Command if the action reads a tail. Otherwise remove `passthrough` from the values, or move the words into `values.args` under the declared argument's name.
4. Check each service plugin `run` setting that carries a bare `--`. Declare `.passthrough()` on its Command where the words after `--` are a tail. Otherwise each word after `--` fills an argument, so remove a word that no argument takes, and the graph builds.
5. Replace `@loomcli/core/variadic-argument-last` with `@loomcli/core/argument-after-variadic` wherever code or documentation names the rule.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its test command, such as `vitest run` or `bun test`. Run each Command that declares `.passthrough()` with a tail after `--`, and check that the action receives it. Pick one Command without it whose arguments a line can fill completely, run it with every argument supplied and one more word after `--`, as `app <command> <arguments> -- extra`, and check that it fails with exit code 2. Run a Command without `.passthrough()` with a word that starts with `-` after `--`, as `app <command> -- -draft.txt`, and check that its action receives the word as the argument. After changing a service plugin `run` setting, run the application once, such as `app --help`, and check that it starts with no `DeclarationError`.

- Add `arity` to string options, so one occurrence takes a fixed number of words: `.option('point', { arity: 2, type: 'string', validate: integer() })` reads `--point 3 4` as `[3, 4]`, typed as a tuple of the validator's output. With `multiple: true`, each occurrence adds one tuple. The words are the separate words after the spelling, so `--point=3 4` and too few words each fail with exit 2 and a sentence that says what to type instead. One validator checks each word and reports an issue at the word's position. A scalar arity option binds `env` beside `envDelimiter`, whose value splits into exactly that many items, the configuration plugin answers it from an array of that many items, and `invoke` takes a tuple. See [Option value arity](docs/core/options.md#option-value-arity).
- Add `arity` to `OptionNode`'s string variant and to the manifest's option entry, `null` on an option without one. Help and the man page print the placeholder once per word, MCP publishes a fixed-length array, and completion offers a value for each word.
- Add `arity` to `MissingValueError`, with an optional third constructor parameter that carries the count, and the `'arity'` kind to `UnexpectedValueError`.
- Change `SuppliedInputs.options`, the type of `supplied.options` in the validation context, the action context, and a question's context, to admit a list of tuples, the raw value of a multiple arity option.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is code that reads a value from `supplied.options` and, after ruling out a string, a Boolean, and a number, treats each element of the remaining array as a string.

**Why.** A multiple arity option's raw value is a list of tuples, one per occurrence, so the supplied record's array values are now either a list of strings or a list of string tuples.

**Before and after.**

Before:

```ts
const fields = context.supplied.options['field'];
if (Array.isArray(fields)) {
  return fields.map((field) => field.toUpperCase());
}
```

After:

```ts
const fields = context.supplied.options['field'];
if (Array.isArray(fields)) {
  return fields.flat().map((field) => field.toUpperCase());
}
```

**Steps.**

1. Run the type checker and find each site that reads an array from `supplied.options`.
2. Where the option is never an arity option, narrow each element with `typeof element === 'string'`, or flatten the array as above.
3. Where the option is a multiple arity option, read each element as one occurrence's tuple of words.

**Validation.** Run `tsc --noEmit` on the application, then its test command.

- Add `requires(option, ...needed)` on a Command, on the Application root, on the attached Command a lifecycle hook receives, and on an option set, so supplying one option requires others while the others alone are accepted: `.requires('password', 'user')` accepts `--user` alone and fails `--password` alone with exit 2 and `Option "--password" requires option "--user". Supply it as well, or remove "--password".` The names are typed as the declared options. The command line, the environment, and the configuration source supply an option, a default does not, and a Boolean at its absent value triggers nothing. The sentence names only the options still lacking, and no option sets another's value. See [A one-way requirement](docs/core/options.md#a-one-way-requirement).
- Change `OptionGroup`, the type of each `CommandNode.optionGroups` entry and of the manifest's `optionGroups`, to a union that adds `{ kind: 'requires', option, requires }`, and add `'requires'` to the `reason` of `InputProblem`'s group variant. The manifest's stability rule now states that an `optionGroups` entry may arrive with a new `kind` that carries its own fields in place of `options`, which a consumer skips when it does not know the kind.
- Print a requirement on the help page and the man page as `Use --password only with --user.`, and project it into an MCP tool's input schema as `dependentRequired`. The man page now prints every option-group sentence the help page prints. An MCP tool that excludes an option a requirement needs, while it does not exclude the requirement's option, is a build fault under `@loomcli/plugins/mcp/required-input-excluded`.
- Report a discarded `requires()` call under `@loomcli/eslint-plugin`'s `discarded-declaration` rule.

### Migration

**Affected surface.** Two surfaces. The type checker reports every affected site in typed code: the surface is code that reads `options` from an entry of `CommandNode.optionGroups`, or of the manifest's `optionGroups` through its published type, without narrowing its `kind` first. No compile error for code that reads a manifest as parsed JSON: it fails at run time, and only on the manifest of an application that declares a requirement, where it reads `options` from an entry that has none.

**Why.** A requirement names one option and the options it needs, so its entry carries `option` and `requires` in place of `options`, and `OptionGroup` became a union of the two shapes.

**Before and after.**

Before:

```ts
const members = command.optionGroups.flatMap((group) => group.options);
```

After:

```ts
const members = command.optionGroups.flatMap((group) =>
  group.kind === 'requires' ? [group.option, ...group.requires] : group.options,
);
```

**Steps.**

1. Run the type checker and find each site that reads `options` from an option group.
2. Narrow `kind` at each site, and read `option` and `requires` for a `requires` entry.
3. Where code reads a manifest as JSON, handle an `optionGroups` entry whose `kind` is `requires`, which carries no `options` key, and skip an entry whose `kind` the code does not know, as the manifest's stability rule now states.

**Validation.** Run `tsc --noEmit` on the application, then its test command.

- Allow `out.print`, `info`, `success`, `warn`, `error`, `debug`, and `trace` to take an async iterable of text in place of the message, so text such as a model's answer shows as it arrives. A streamed message keeps its method's destination and verbosity, draws through the lane view, takes no view, and once its iterable ends has written what the method writes for the joined text. On a terminal each chunk shows as it arrives: a streamed `print` writes what each chunk adds at the cursor and holds every other write to the terminal until its line ends, and the other methods redraw their unfinished row above any live region, which `onLiveRegions` reports as it reports a region's frame. On a pipe, a file, or a captured run each line is written once it completes. A hidden streamed message is read to its end, one whose iterable throws keeps its text and rejects the call, and a failed action or a cancelled run ends an open one at once. The [output reference](docs/core/output.md#a-streamed-message) states the contract.
- Add the `MessageArguments` type to `@loomcli/core`, the two argument lists a semantic method takes. Each method keeps its string signature first and gains a second over `MessageArguments`, so a wrapper forwards either form whole.
- Change `@loomcli/testing`'s builders so an unstated semantic lane reads a streamed message to its end before it resolves. A stated lane whose parameter is typed from the context alone, such as `warn: async (message) => { lines.push(message); }`, no longer compiles, whether or not it uses the parameter, because the context types the parameter as either form and a lane typed that way does not fit the method's two signatures. The type checker reports every such site, and annotating the parameter, `(message: string)`, fixes it. See [Testing](docs/libs/testing.md).

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a semantic lane, `print`, `info`, `success`, `warn`, `error`, `debug`, or `trace`, whose parameter has no annotation, whether or not the lane uses it, written where an `Out` method is expected: a lane a test states in the `out` of a `@loomcli/testing` builder, such as `actionContext`, or one in an `out` built by hand, such as a context passed to `progress()` from `@loomcli/prompts`. A lane whose parameter is annotated, such as `vi.fn(async (_message: string) => {})`, and a lane that declares no parameter still compile.

**Why.** Each semantic method now takes a streamed message as well as a string, so the expected type gives a lane's unannotated parameter either form, and a lane typed that way fits neither of the method's two signatures.

**Before and after.**

Before, the parameter took its type from the context:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  options: {},
  out: {
    warn: async (message) => {
      lines.push(message);
    },
  },
  provided: {},
});
```

After, the parameter is annotated:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  options: {},
  out: {
    warn: async (message: string) => {
      lines.push(message);
    },
  },
  provided: {},
});
```

**Steps.**

1. Run the project's type check, such as `tsc --noEmit`, and note each stated lane it reports.
2. Annotate that lane's parameter, `(message: string)`, for an action that passes strings, or write `(...call: MessageArguments)`, imported from `@loomcli/core`, for one that streams.

**Validation.** Run the type check again and confirm it reports no stated lane, then run the tests that state those lanes.

- Add the plain switch, which turns off all redrawing so the screen is only ever appended to, for an operator whose screen reader or terminal copes badly with redrawing and one who keeps a readable record of a run. Core turns it on in every application when `ACCESSIBLE` is set and not empty, and the new plain plugin, `@loomcli/plugins/plain`, gives the operator `--plain` for one run. With it on, a progress line prints its start and end lines and nothing between, a streamed message is written a line at a time, and a question asks line by line: each piece is printed once, with no cursor movement or erase sequence, and the operator types the answer and presses Enter. The question reads its keys in raw mode, as it does when it redraws, and echoes what is typed itself, nothing at a secret, and a search offers its default by label, which Enter alone takes. Messages, color, verbosity, and whether a question asks are unchanged, so `-q`, `--no-input`, and `NO_COLOR` each keep their own job. The [output reference](docs/core/output.md#the-plain-switch) and the [prompts reference](docs/libs/prompts.md#asking-line-by-line) state the contract.
- Add the `plain` mark to `@loomcli/core`'s Boolean global options, which an application puts on its own option for another spelling, under the new rule `@loomcli/core/plain-mark`. `OptionNode`'s Boolean variant and the manifest's Boolean option entry gain `plain`.
- Add `questionLine`, `QuestionLine`, and `NumberedChoice` to `@loomcli/prompts/views`, the declared view and data that draw each piece of a question asked line by line, so an application restyles it with `override`.
- Change a question under `TERM=dumb` to ask line by line, as the plain switch makes it ask, rather than redraw with cursor movement the terminal cannot perform. An input region is not live under `TERM=dumb` or the plain switch, so its `live` reads `false` there, and it still takes its turn among the run's input regions: its `draw` writes nothing and resolves once its turn has come. Under CI nothing changes.

### Migration

**Affected surface.** No compile error: behavior changes at run time. The surface is an action, a middleware, or a library that opens `out.region({ input: true })` itself and draws its frames there, run on a terminal under `TERM=dumb` or with `ACCESSIBLE` set. Such a region's `live` now reads `false`, and its frames draw nothing. A region opened without `input: true` is not live with `ACCESSIBLE` set either, where it drew before, so code that draws one and writes nothing when `live` is `false` shows nothing there, as it already shows nothing on a pipe. A question from `@loomcli/prompts` needs no change, though a test that asks one on a mock terminal with `TERM: 'dumb'` now reads its line-based pieces in `mock.stderr.text` rather than frames.

**Why.** An input region redraws in place with cursor movement and erasure, which a terminal under `TERM=dumb` cannot perform and which the plain switch turns off.

**Before and after.**

Before, the region's frames were the only output:

```ts
const region = out.region({ input: true });
await region.draw(state, pickerFrame);
```

After, the region writes plain lines when it is not live, as `progress()` does:

```ts
const region = out.region({ input: true });
// A region that is not live writes nothing here, and resolves once its turn has come.
await region.draw(state, pickerFrame);
if (!region.live) {
  await out.draw(state, pickerLines);
}
```

**Steps.**

1. Find each `out.region({ input: true })` your code opens, and each `out.region()` without it that draws frames and writes nothing when `live` is `false`.
2. Await the region's `draw` as before: a region that is not live writes nothing, and an input region's `draw` resolves once its turn among the run's input regions has come. Then read the region's `live`, and when it is `false`, print each piece once. An input region prints through `out.draw` or a semantic method and then reads the operator's answer as a line. A region without `input: true` prints through `out.info` or another method that `-q` hides, as `progress()` writes its plain lines, so a quiet run stays quiet.

**Validation.** Run the application at a terminal with `TERM=dumb`, and again with `ACCESSIBLE=1`, through each region it opens, and confirm each region prints its lines and each input region takes its answer. Record such a run with `script`, and confirm the record holds no cursor movement.

- Add `skip(message?)`, `warn(message?)`, and `clear()` to the progress line of `@loomcli/prompts`, so work that had nothing to do, finished with a problem, or leaves nothing worth keeping ends as such. At a terminal that redraws, `skip` leaves a dim line under the info glyph, `warn` leaves a line under the warning glyph, and `clear` removes the line and leaves no blank row. Where the line is not live, `skip` writes its end line through `out.info`, `warn` through `out.warn`, and `clear` writes nothing after the start line. A line that fails or is cancelled keeps its text, and `track()` is unchanged. The [prompts reference](docs/libs/prompts.md#progress) states each end.
- Add `'skipped'` and `'warned'` to the states `Region.end` takes and to `ProgressEvent`'s `state`, so an `onProgress` observer, `invoke`, and an MCP client, whose progress message reads `(skipped)` or `(warned)`, tell those ends from a success. A cleared line reports `ended`. The progress view's `ProgressLine` state gains the same two values. [Progress events](docs/core/output.md#progress-events) states the end states.
- Change `ProgressContext` so its `out` also carries `warn`.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a context built by hand, such as a test's object literal, that omits `out.warn` and is passed to `progress()` from `@loomcli/prompts`. A context core hands an action, a middleware, or a configuration source, and one `@loomcli/testing` builds, already carries `warn`.

**Why.** A warned line that is not live writes its end line through `out.warn`, so `progress()` needs the warn lane.

**Before and after.**

Before:

```ts
const line = progress({ graph, out: { error, info, region, success } }, { label: 'Fetching records' });
```

After:

```ts
const line = progress({ graph, out: { error, info, region, success, warn } }, { label: 'Fetching records' });
```

**Steps.**

1. Add a `warn` method to each hand-built context passed to `progress()`, with the signature `Out['warn']` gives it, or build the context with `actionContext` from `@loomcli/testing`.

Note, not a break: `'skipped'` and `'warned'` are new values of a progress event's and a progress line's `state`, as a string-literal union core produces may gain a member in any release. Where an `onProgress` observer or an override of the `@loomcli/prompts/progress` view switches over `state` with no default branch, handle the two new values.

**Validation.** Run the application's type check, such as `pnpm exec tsc --noEmit`, and its tests.

- Add `task(settings)` to the progress line of `@loomcli/prompts`, so one line groups the steps of a piece of work under it as a task group, to any depth. A task is a full progress line with the same handle, and the action decides what runs when. At a terminal that redraws, the tree draws as one frame, each task indented two columns for each level, in the order the tasks opened, also when another line opened between them, and a finished task shows its end line until its parent ends. A task still open when its parent ends takes the parent's end. A group that ends as a success or a skip leaves its own end line alone and no blank row, and one that fails, warns, or is cancelled keeps its tasks under it in scrollback, each failed task's kept log lines directly above its end line. A tree's rows share the terminal's height, and a finished task's row gives way first. Where the line prints plain lines, each task prints its start and end lines through the lane, its text stepping in under its parent's after the glyph, and under an invocation by name the same lines land in `messages`. Each task reports its own progress events under its own label. See [Task groups](docs/libs/prompts.md#task-groups).
- Add `keepTasks` to a progress line's settings, which keeps a group's tasks when it succeeds too, and optional `depth` and `tasks` to `ProgressLine`, the progress view's data, so a view override draws the tree, while data you build by hand for `out.draw` draws without them.
- Change `ProgressContext` so its `out` also carries `draw`.
- Change every running progress line of `@loomcli/prompts`, in a task group or not, to keep to one row at a terminal that redraws. A label too wide for the row was wrapped by the terminal, which could leave copies of the frame's rows in scrollback; now, once the rate and the time left have given way, the label is cut and ends with `…`, and on a narrower row the bar, the elapsed time, and the counts drop in turn. A finished task's end line inside a running tree is cut the same way, while a line's end line left in scrollback keeps its whole text. See [Progress view](docs/libs/prompts.md#progress-view).

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a context built by hand, such as a test's object literal, that omits `out.draw` and is passed to `progress()` from `@loomcli/prompts`. A context core hands an action, a middleware, or a configuration source, and one `@loomcli/testing` builds, already carries `draw`.

**Why.** A task group whose tasks stay writes each of its end lines through `out.draw` and the progress view, so an application's override of the view draws them and each failed task's kept log lines stand directly above its own end line.

**Before and after.**

Before:

```ts
const line = progress({ graph, out: { error, info, region, success, warn } }, { label: 'Deploying' });
```

After:

```ts
const line = progress({ graph, out: { draw, error, info, region, success, warn } }, { label: 'Deploying' });
```

**Steps.**

1. Add a `draw` method to each hand-built context passed to `progress()`, with the signature `Out['draw']` gives it, or build the context with `actionContext` from `@loomcli/testing`.

Note, not a break: an override of the `@loomcli/prompts/progress` view written before `depth` and `tasks` draws a tree's root alone while the tree runs, and when a tree's tasks stay at its end, it draws every line of the written tree, flat, with the library's indented kept log lines between them, because the tree is written one line at a time. Draw `depth` and the entries of `tasks` to show a tree's tasks.

Note, not a break: a test that reads a running progress line's long label from stderr now reads it cut with `…` at the terminal's width, and the end line still whole.

**Validation.** Run the application's type check, such as `pnpm exec tsc --noEmit`, and its tests.

### Features

- Allow local multiple string options and scalar or variadic string arguments to require input only outside interactive runs with `required: 'non-interactive'`. Publish argument conditional requiredness through inspection, manifests, help, and MCP schemas.
- Allow text, secret, and select questions to link a scalar string argument for prefilling and skipping with its validated value.
- Add grapheme-aware cursor movement, word editing, hint acceptance, bracketed paste, and one-row fitting to typed questions. Question frame data gains an optional `cursor`, and frame data without one draws the cursor at the end of the typed line. Restore bracketed paste mode on every exit and discard secret typeahead after acceptance.
- Add the `key` table to `@loomcli/testing` and support separate reads, handed over 100 milliseconds apart, within a scripted keyboard entry.
- Fix MCP tool input schemas so a required multiple option or variadic argument declares `minItems: 1`, because an empty list reads as missing.

- Export ten types from `@loomcli/core` that its public signatures already used, so a helper an author writes can name them. `GlobalOptionConfig` is the configuration a plugin's global option takes. `ExtensionTarget` names the declaration kind an extension targets. `InputSchema` is the schema a graph node publishes. `InvokedBy` is the `invokedBy` an `onFailure` hook reads, which says whether the run came from argv or from an invocation by name. `EndingSignal` names the signal that a `CancellationReason`'s `source` reports. `Lane` names a key of `lanes`. `SwitchPolicy` is a `RenderingPolicy` setting. `Alignment` is the `align` option `pad()` takes. `Modifier` and `CoreToken` name the modifiers and core theme tokens a `Style` publishes.
- Mark every `@loomcli/core` export with the TSDoc tag `@public`, and mark with `@sealed` every type a Loom library builds and every class an author must not subclass, as the [public exports](docs/core/public-exports.md) page describes. An editor shows the tags on hover.

- Export `EnvBinding`, an option's environment binding, `StringBinding`, a scalar string option's binding that may let an empty value supply it, and `ListBinding`, a multiple option's binding with its delimiter, from `@loomcli/core`, so a helper that builds the same binding for several options can name its type. Mark `Content` and `LinkedValueContext` as input types, which an author may write and hand to Loom, as the [public exports](docs/core/public-exports.md) page describes, rather than output types only Loom builds.

- Mark `Host`, `HostTerminal`, `OnShutdown`, `OnSuspend`, and `OnResume` as input types, which an author may write and hand to Loom, such as a host a test states for a testing builder, as the [public exports](docs/core/public-exports.md) page describes, rather than output types only Loom builds. Core adds any new member to them as optional, with a default when it is missing.

- Let an application subclass `InternalError`, as it already may `LoomError`, `UsageError`, and `FatalError`, and mark `DiagnosticRule` and `InvokedBy` as types an author may write and hand to Loom, as the [public exports](docs/core/public-exports.md) page describes. A release adds any new member to them as optional.

- Export `ColumnDefinition` from `@loomcli/plugins/table` and `FieldDefinition` from `@loomcli/plugins/records`, the object form of one key's column or field, so a helper an author writes can name the entry for a known key. A table column's `align` is now core's `Alignment`, the same `'left' | 'right' | 'center'` union.
- Mark every export of the pack views, `@loomcli/plugins/box`, `heading`, `list`, `prose`, `records`, `rule`, and `table`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes. Their configuration types are input types, so none carries `@sealed`.

- Add an opt-in help Command to the help plugin. With `help({ command: true })`, `app help get` prints the page `app get --help` prints, for the root, groups, nested Commands, aliases, and hidden Commands, and pages it under the same `paging` setting. A word that names no Command fails as an unknown command. With no settings, help attaches no Command. See [The help Command](docs/plugins/help.md#the-help-command).

- Add `pipe(first, ...steps)` to `@loomcli/validators`. A pipe runs any validator, then one to eight steps that check or transform the value the validator or step before it accepted, each a Standard Schema value or a parse function, and publishes exactly the input schema the first validator publishes. See the [validators reference](docs/libs/validators.md#pipe).

  ```ts
  const pairs = pipe(integer({ min: 2 }), (count) =>
    count % 2 === 0 ? { value: count } : { issues: [{ message: 'Expected an even number.' }] },
  );
  ```

- Export `LoomThemeDefaults` from `@loomcli/plugins/theme`, the type of the seven tokens `loomTheme()` supplies, so an author can name the defaults the returned plugin carries. Export `EncodingConfig` from `@loomcli/plugins/format`, the configuration `json()` and `jsonl()` take, beside the two views; `@loomcli/plugins/format/views` already exported it.
- Mark every export of the output plugins, `@loomcli/plugins/format`, `format/views`, `theme`, `color`, `verbose`, and `background`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes. `BackgroundOptions`, `ColorOptions`, `VerboseOptions`, and `LoomThemeDefaults` are output types and carry `@sealed`; `FormatSettings`, `EncodingConfig`, and `LoomThemeOverrides` are input types, so none of them carries it.

- Add `epilog` to `helpCommand`: Markdown that ends the help page, such as where to report a bug or where the documentation lives. Every page prints the epilog of the routed Command and of each ancestor, its own first and the Application's last, on `-h` and `--help` alike, so an epilog set once on the Application ends every page. Each man page prints the same epilogs under NOTES. See [Epilogs](docs/plugins/help-page.md#epilogs).

- Add six validators to `@loomcli/validators`. See the [validators reference](docs/libs/validators.md#catalog).
  - `bytes()` reads a size such as `10MB` or `512KiB` into a byte count, with decimal prefixes as powers of 1000 and binary prefixes as powers of 1024.
  - `host()` reads a host name, and with `ip: true` an IP address too. `ip()` reads an IPv4 or IPv6 address. Both hand the action one canonical form, so two spellings of one address compare equal.
  - `cidr()` reads a network such as `10.0.0.0/8` into `{ address, prefix }`.
  - `keyValue()` reads a pair such as `env=prod` into `{ key, value }`.
  - `email()` reads an email address under the rule browsers apply to `<input type="email">`.

- Let `date()` and `dateTime()` read the forms operators type, such as `25/09/2026` or `25/09/2026 14:30`, through POSIX strftime `layouts` tried in order. A date read through a layout reaches the action as `YYYY-MM-DD`. See [Layouts](docs/libs/validators.md#layouts).
- Add `time()` to `@loomcli/validators`. It reads a time of day such as `09:30`, or `9:30pm` through a layout, into milliseconds since midnight, with `min` and `max` bounds. See the [validators reference](docs/libs/validators.md#time).

- Mark every export of the input plugins, `@loomcli/plugins/interaction`, `dotenv`, `config`, `config/extension`, and `suggestions`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes. `Configuration`, `ConfigProvider`, `ConfigOptions`, `InteractionOptions`, and `ConfigurationSchemaMustAcceptAnEmptyFile` are output types and carry `@sealed`; `ConfigurationSettings`, `DirectorySetting`, `Scope`, `ScopeSettings`, `ConfigInputFacts`, `DotenvSettings`, and `InteractionSettings` are input types, so none of them carries it.

- Mark every export of the help and version plugins, `@loomcli/plugins/help`, `help/extension`, `help/views`, `version`, and `version/views`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes. `HelpOptions`, `VersionOptions`, `HelpPage`, `HelpVariant`, and `VersionLine` are output types and carry `@sealed`; `HelpSettings`, `VersionSettings`, `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `HelpSectionPath`, and `CommandExample` are input types, so none of them carries it.

- Mark every export of the projection plugins, `@loomcli/plugins/manifest`, `manifest/extension`, `mcp`, `mcp/extension`, `completion`, `manpage`, and `skills`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes. `ManifestOptions`, `ManifestCommandFacts`, and `DeclaredFailure` are output types and carry `@sealed`; `RefreshContext`, `ManifestSettings`, `ManifestCommandInput`, `DeclaredFailureInput`, `McpCommandFacts`, `McpInputFacts`, `McpArgumentFacts`, `McpAnnotations`, `SkillsSettings`, `Skill`, and `SkillFile` are input types, so none of them carries it.

- Mark every export of the lifecycle plugins, `@loomcli/plugins/logging`, `self-update`, and `service`, with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes, so every subpath of `@loomcli/plugins` now carries its tags. `@loomcli/plugins/logging` now exports `WrittenLevel`, the levels `LoggingSettings`' `level` accepts, and `LoggingErrorKind`, the steps a `LoggingError`'s `kind` names. `AfterReplaceContext`, `ProbeContext`, `ServiceState`, and `ServiceStatus` are output types and carry `@sealed`, and `LoggingError` carries it because you must not subclass it; `LoggingSettings`, `WrittenLevel`, `LoggingErrorKind`, `SelfUpdateSettings`, `NoticeSettings`, `ServiceSettings`, and `ServiceDetail` are input types, so none of them carries it.

- Mark every export of `@loomcli/validators` with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes, so its exports now carry tags and `check:api` covers the package. `@loomcli/validators` now exports `BytesOptions`, `CidrOptions`, `DateOptions`, `DateTimeOptions`, `DurationOptions`, `HostOptions`, `IntegerOptions`, `IpOptions`, `KeyValueOptions`, `NumberOptions`, `PathOptions`, `TextOptions`, `TimeOptions`, and `UrlOptions`, the options each factory takes, with `IpVersion`, `PathKind`, `PathAccess`, and `SpelledBoundOptions`, the types those options use, and `ValidatorDefinition`, `ParseReturn`, `IssueCodeConfig`, and `Step`, the types `createValidator`, `issueCode`, and `pipe` take. It also exports `CidrBlock` and `KeyValuePair`, what `cidr` and `keyValue` output. `Validator`, `IssueCode`, `CidrBlock`, and `KeyValuePair` are output types and carry `@sealed`; the other types are input types, so none of them carries it.

- Mark every export of `@loomcli/prompts` and `@loomcli/prompts/views` with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes, so its exports now carry tags and `check:api` covers the package. `@loomcli/prompts` now exports `PromptContext`, the slice of the action context a question takes, so a helper that asks several questions can name the context it passes on. `Answer`, `ChoiceAnswer`, and `Progress` are output types and carry `@sealed`, and so do `InteractionUnavailableError` and `EditorError`, which you catch and must not subclass. The settings, choice, and context types are input types and carry no `@sealed`. Neither does `ChoiceValue`, which types both a select's answer and the `default` you write, nor do the view data types under `@loomcli/prompts/views`, which an application may build by hand for `out.draw`.

- Mark every export of `@loomcli/testing` with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes, so its exports now carry tags and `check:api` covers the package. `@loomcli/testing` now exports `MockFacts`, the facts a test hands `mockProcess` beside stdin and the terminal, so a test file can share a base across mocks, and `Write`, one entry of a mock's `transcript`, so a helper can name what it reads. `MockProcess`, `MockStdin`, `RecordingStream`, `ProgramCall`, and `Write` are output types and carry `@sealed`: only `mockProcess()` makes them, or Loom hands them to your `Program` script. The builder input types (`ActionValues`, `MiddlewareValues`, `FailureHookValues`, `ProviderValues`, and `ViewValues`), `MockFields`, `MockFacts`, `MockTerminal`, `Program`, `ProgramAnswer`, and `KeyLetter` are input types and carry no `@sealed`.

- Mark the default export of `@loomcli/eslint-plugin` with the TSDoc tag `@public`, as the [public exports](docs/core/public-exports.md) page describes, so `check:api` covers the package and every published Loom library now carries tags. The plugin's API report records each rule it ships, so a removed or renamed rule shows in review.

- Add `environmentContext`, `logEvent`, `logDestination`, and `progressEvent` to `@loomcli/testing`, so a test calls an `onEnvironment` hook, an `onLog` hook, or a progress observer with only the members it checks, as the testing reference's [environmentContext](docs/libs/testing.md#environmentcontext) and [value builders](docs/libs/testing.md#building-the-values-a-hook-reads) show. A log event, a log destination, or a progress event takes a fixed default for each member a test does not state, and an unstated `host` member of the environment hook's context throws a sentence that names it when read. A release that adds a member to `Log`, `LogEvent`, `LogDestination`, `EnvironmentContext`, or `ProgressEvent` leaves such a test compiling, apart from a test that states a nested member, such as a log event's `failure`, whole. A test that compares a whole value with a fixed one sees the new member's default.

- Add a doc comment to every export and member of the published libraries, and an example to every function, class, constant, enum, and namespace, so an editor's hover on any part of Loom's API says what it is for, shows a use, and links its reference page. A member of the type a public type is written over, such as `.option()` on a `Command`, carries one too. The [public exports](docs/core/public-exports.md#doc-comments-and-examples) page states the rules.

- Add the authoring skill to `loom init`, which writes `SKILL.md` and its references to `.agents/skills/loom/` under the piece `skill`, beside the changelog skill, so a coding agent learns how a Loom application fits together. Each file is a managed file, and its links to the documentation name the installed version.
- Remove an unedited file of the authoring skill that the installed `loom` no longer ships, when `loom init` writes the piece `skill`. An edited one stays with a warning, and `--force` removes it.

- Name each unknown key in a configuration file at `-v`, as a dropped value is named, so an operator who misspells a setting such as `state_dir` for `stateDir` learns that the application did not read it: `Ignored state_dir in .collector.toml: Unknown key. Check its spelling, or remove it.` The configuration plugin judges the file against the JSON Schema the configuration schema publishes, by the rule its link check already uses, so a record, a loose object, and a `z.unknown()` section name nothing, and a schema with no JSON Schema, such as valibot's, prints no line. The lines follow the lines for values the schema removed, a key at or below a dropped value prints none, and the default verbosity is unchanged. The [configuration plugin](docs/plugins/config.md#naming-unknown-keys) reference states the rule.

- Add `strict` to `configuration()`, so a service that a supervisor runs, where nobody reads `-v`, fails on a broken setting instead of falling back in silence. `strict: true` covers the whole file, and a list of dotted key paths, such as `strict: ['delivery']`, covers each path at or under a listed one. A value the schema rejects, an unknown key, or a linked option's value that `strict` covers fails the run with code 2 instead of being dropped, and one failure names every such key with its file and what to do: `collector: Configuration value delivery.retries in .collector.toml: Invalid input: expected number, received string. Correct the value, or remove it.` An unknown key fails the run only where the schema publishes a JSON Schema, so under valibot only a rejected value fails it. Under any `strict`, a configuration file the variable names or the lookup finds that cannot be read, does not parse, or does not hold an object or a mapping fails the run with code 2 instead of warning while the run reads no configuration: `collector: Configuration file .collector.toml is not valid TOML at line 3, column 5. Correct its syntax, or remove it.` Without `strict`, the plugin writes the same bytes as before. The [configuration plugin](docs/plugins/config.md#the-strict-setting) reference states the rules.
- Add `strict` to `SourceAnswer`, so a configuration source can mark an answer whose rejection by the option's validator fails the run with code 2, as an environment value's does, instead of falling back. The [input sources](docs/core/input-sources.md#configuration-sources) reference states the rule.

- Show an unknown configuration key whose difference is invisible, so the line no longer reads as a correctly spelled key. When a key of the path is empty, has whitespace at an edge, or holds a character a reader cannot see, such as a zero-width space, a no-break space, or a soft hyphen, the `-v` line and the `strict` failure print that key in double quotes with each such character as its code point: `Ignored "stateU+200BDir" in .collector.toml: Unknown key. Check its spelling, or remove it.` Every other key and every other line keeps its bytes. The [configuration plugin](docs/plugins/config.md#naming-unknown-keys) reference states the rule.

- Add `extended` to `version()`'s settings. With `version({ extended: true })`, `-V` and `--version` print the version line, then one row each for the run's release channel, build, release asset, installation method, runtime, and platform, with an absent fact printed as an empty value. When the run's media type is `application/json` or `application/jsonl`, as `--format json` and `--format jsonl` state with the formatter installed ahead of the version plugin, at the root of a group application as on a Command that declares a result, they print the same facts as one JSON object instead, with `null` for an absent fact. `versionFacts`, exported from `@loomcli/plugins/version/views` with its data type `VersionFacts`, restyles the rows. Without the setting, the version line is unchanged. See [Extended output](docs/plugins/version.md#extended-output).
- Add `mediaType` to the middleware context: the run's media type, which a takeover reads to choose its encoding. On a Command that declares a result it is the media type the selected view declares; on one that declares none, a group included, it is the one a middleware assigned. A failure encoder reads the same value, and `middlewareContext` from `@loomcli/testing` takes it as an optional value. See [Middleware](docs/core/middleware.md).
- Read a group's own options in routing, as a parent's own options are read: an occurrence at a group binds to the Command routing reaches by the spelling the operator typed. An author's option on a group still reaches no action, so `tool cache --force clear` with `--force` declared on `cache` sets `clear`'s own `--force`, where it failed with `Command "cache" accepts no arguments.`, and a lifecycle hook's option on a group reaches its plugin's middleware. See [Nested Commands and groups](docs/core/commands.md#nested-commands-and-groups).
- Put a hidden `--format` on every group with the formatter installed, so `tool --format json` reports a missing subcommand as the JSON line, `tool --format json list` runs `list` with its `json` view, and completion offers `json` and `jsonl` after `tool --format`. See [Formatter](docs/plugins/format.md).
- Add `runtime` to the host and the process handle: the JavaScript runtime's name, `bun` or `node`, and its version. The real process's handle reads it, `processHandle({ runtime })` and `mockProcess({ runtime })` replace it, and `mockProcess` defaults it to `{ name: 'node', version: '24.0.0' }`. It is optional on the handle and on the host, so a hand-built handle and a host a test states whole compile unchanged; core always sets the host's member, `undefined` when the handle holds none. See [Host facts](docs/core/host.md#host-facts).

- Add `patchConsole()` at `@loomcli/plugins/patch-console`, an opt-in plugin that keeps a dependency's `console` writes from tearing a live region. While a frame is on the stack, `console.log`, `info`, and `debug` write to the run's stdout and `console.warn` and `error` to its stderr through `out`, above the regions and under the run's rendering policy, and on Node a process warning follows `console.error`. The console comes back when the last frame leaves the stack and before the run ends, a failure included, and outside a region nothing is patched. A dependency's `console.error(message)` followed by `process.exit(1)` while a frame is drawn prints the message above the frame. The [patch-console plugin](docs/plugins/patch-console.md) page states the rules.
- Add the `onLiveRegions` lifecycle hook, with the `LiveRegionsHook` and `LiveRegionsHookContext` types. Core calls it with `'drawn'` when the run's first live region draws a frame and with `'closed'` when the last frame leaves the stack, in stderr's write order, for every region of the run, and hands it the run's `out`. [Observing live regions](docs/core/lifecycle-hooks.md#observing-live-regions) states the rules.
- Fix a message lost when the process ends before core writes it. At the process's `exit` event, from a `process.exit()` an action or a dependency calls or an uncaught exception, and at a shutdown's end, core now writes every write still queued on the run's stdout and stderr, in the order queued, where it wrote only live-region frames before. So `out.error(message)` followed by `process.exit(1)` prints the message, with or without the patch-console plugin, and a run with nothing queued prints what it printed before. [At the process's end](docs/core/output.md#at-the-processs-end) states the rules.

- Allow a Command with an action, the root included, to declare arguments and hold children, in either order, with no opt-in call. `argument()` no longer removes `command()`, and `command()` no longer removes `argument()`, so a root that declares arguments installs the plugins that bring Commands, such as completion, man pages, MCP, skills, self-update, and service. The rule `@loomcli/core/arguments-beside-children` is retired. A group, a Command with children and no action, that declares an argument fails with [`@loomcli/core/command-without-action`](docs/core/diagnostics.md#loomclicorecommand-without-action), as a group that declares stdin or the passthrough mode does. See [Nested Commands and groups](docs/core/commands.md#nested-commands-and-groups).
- Route a plain word that is exactly a child's name or alias into that child, and read any other plain word on a Command that declares arguments as its first argument, so `textstat completion bash` runs the plugin and `textstat a.txt completion` counts two files. On a Command without the passthrough mode, a word after the first bare `--` fills an argument, so `textstat -- completion` counts a file named `completion`; on one with the mode, it reaches `passthrough`. A child that a later release adds shadows that word as an argument. See [Global consumption and routing](docs/core/commands.md#global-consumption-and-routing).
- Add `argument` to the `command` position `locate()` returns: the argument the word fills when it names no child, which is the routed Command's first argument when it declares one and `null` otherwise. See [Locating a word](docs/core/graph-inspection.md#locating-a-word).
- Add `argument` to `NonCallableCommandError` and an optional third `argument` parameter to its constructor. On an argv run, when a group is reached through one word from a parent that declares arguments and no passthrough mode, the message ends with `To pass "completion" as an argument, write -- before it.` and `argument` holds the word the operator typed. See [Failure classes](docs/core/failures.md#failure-classes).
- Add a `--` row to the ARGUMENTS block of a help page and a man page, for a Command that declares arguments, holds a visible child, and declares no passthrough mode: `Read every later word as an argument, even a command name.` See [The help page](docs/plugins/help-page.md).
- Offer a Command's children and then the values its first argument offers at a word that may name either, so `textstat co<Tab>` offers `completion`. With an argument that has no closed set, the answer ends with directive `0`, so a prefix that no child's name starts leaves the shell its file names. See [Completion](docs/plugins/completion.md).

- Add `lastWins` to string options, so a later occurrence on the command line replaces an earlier one instead of failing as a repeat: with `.option('editor', { lastWins: true, type: 'string' })`, a shell alias `alias draft='mailer --editor vim'` lets `draft --editor nano` run with `nano`. Occurrences count across every accepted spelling, a bare spelling that supplies an implied value included, and on an arity option the last occurrence's whole tuple replaces the earlier one. Only the last value reaches the validator, and a replaced value is dropped with nothing printed. Every occurrence still takes its words, so a missing value is still a usage error wherever it occurs. The types reject `lastWins` beside `multiple: true` and on a Boolean, counted, or content option. The winning occurrence beats the environment, the configuration source, and the default, as any command-line value does. On a background-marked option that declares it, the run's background choice follows the occurrence that won, so a replaced `light` never settles the background. See [Last occurrence wins](docs/core/options.md#last-occurrence-wins).
- Add `lastWins` to `OptionNode`'s string variant and to the manifest's string option entry, `false` unless the declaration says `true`. Completion offers a last-wins option again after the earlier words supplied it.

- Add `optionSet()` and `options(set)`, so a group of Commands that share several options declares them once: `const output = optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } }).exclusive('json', 'yaml')`, then `.options(output)` on each Command that reads them. Each entry takes what `option()` takes and is checked as `option()` checks it, a set may carry `exclusive`, `oneRequired`, and `requiredTogether` groups over its own members, and the action reads each option with the type one `option()` call gives it. A name the Command already declares, locally or as a global option, is a compile error. `options()` exists on a Command and on the Application root. Nothing inherits: a parent that applies a set gives its children nothing. Help, the manifest, inspection, and every other projection read a Command built with a set exactly as one that declared the same options and groups one by one. See [Sharing options](docs/core/options.md#sharing-options).
- Report a discarded `options()` call, and a discarded group call on an option set, under `@loomcli/eslint-plugin`'s `discarded-declaration` rule, and read the entries of an option set in its `undescribed` and `name-shape` rules, so an option keeps those checks when it moves into a set.

- Add visible aliases, so an author advertises a short form operators should learn: `.visibleAlias('ls')` on a named Command and `visibleAliases: ['minimum']` on an option declare an alias that routes and parses as `alias()` and `aliases` do, under the same name rules, the same namespace, and the same declaration faults. Help prints it as the first fact of its member's row, `(alias: ls)` for a Command and `(alias: --minimum)` for an option, `(aliases: ls, dir)` for several, and a Command's own page prints `Alias: ls` in its masthead before its deprecation line. The man page follows help, and completion offers a visible alias only where the canonical name does not match what was typed. Usage lines, failure sentences, suggestions, routing-error candidates, and MCP tool names and input schemas keep the canonical name. `alias()` and `aliases` still declare an alias no listing shows. See [Visible aliases](docs/core/commands.md#visible-aliases) and [Visible option aliases](docs/core/options.md#visible-option-aliases).
- Add `visibleAliases` to `CommandNode` and `OptionNode`, the visible aliases in the order `aliases` holds them, while `aliases` keeps every alias. The manifest's Command entries and option entries gain `aliases`, which holds the visible aliases alone and reads `[]` when there is none.
- Read `visibleAlias(...)` calls and `visibleAliases` arrays in `@loomcli/eslint-plugin`'s `name-shape` rule, an option set's entries included, and count `visibleAlias` among the authoring calls of its `discarded-declaration` rule.
- Fix an option alias whose spelling the option already accepts, such as `no-color` on a `both` option `color`: it adds nothing, as the options reference states, where it used to add a `--no-no-color` spelling.

- Add `-v` and `-vv` lines to the first-party plugins that act on files, programs, or the environment. At `-v` a plugin says what it did, such as `Read configuration from .notes.json.`, `Imported 3 variables from .env.local.`, `Replaced /home/me/.local/bin/notes.`, `Ran systemctl --user daemon-reload.`, or `Logging to /home/me/.local/state/notes/notes.jsonl.`, and at `-vv` how it decided, such as `Looked for .notes.json: not found.` or `Skipped API_TOKEN from .env: already set.` No line repeats a confirmation the default verbosity prints, and no dotenv line holds a value. Each plugin's page lists its lines under [At -v and in the log](docs/plugins/README.md).
- Add one `info` log event for each change a first-party plugin makes outside the process: `File written.` and `File removed.` with `path`, `Program run.` with `program`, `arguments`, and `code`, and `Binary replaced.` with `path`, `from`, and `to`, as [Change events](docs/core/logging.md#change-events) states.
- Change the `plugin` field of a log event an action of a plugin Command logs from `null` to that plugin's identity, such as `@loomcli/plugins/service`.
- Add `debug` and `trace` to an `onEnvironment` hook's `out`, and `out`, the outermost run's `debug` and `trace` lanes, to `LogDestination`. `@loomcli/testing`'s `logDestination` fills it with lanes that write nothing, and its `environmentContext` fills an unstated `out.debug` and `out.trace` the same way.
- Add `name` and `out` to the self-update plugin's `AfterReplaceContext`, and the same two as optional members of `RefreshContext`.
- Change the completion, man page, and skills refreshes after a self-update to start no child when the installation record holds none of the plugin's files, so the child's line that nothing is installed no longer prints after an update.

- Add `estimate` and `unit` to a progress line's settings in `@loomcli/prompts`. With `estimate: true`, a running line also shows its rate and time left after the elapsed time, `◓ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3 files/s · about 24s left`, computed from the counts you report through `update()` over a window that reaches back to the latest report at least 10 seconds older than the newest and never past a report whose count went backward, so reports a minute apart are measured over that minute, and counting down between reports, with no timer on your work. Neither part shows until a second of reports has passed, and neither shows on an end line or where the line prints plain lines. On a narrow row the rate gives way first. See [Rate and time left](docs/libs/prompts.md#rate-and-time-left).
- Add optional `estimate`, `rate`, `remaining`, and `unit` to `ProgressLine`, the progress view's data. Every line supplies them whether or not `estimate` is set, so a view override can draw a rate or a time left of its own, and data you build by hand for `out.draw` draws without them.

- Add `log(text)` to the progress line of `@loomcli/prompts`, so a line shows a child program's output, or any other text, as its work runs. It takes a string or an async iterable of text, such as a `PassThrough` that `host.spawn` writes into. At a terminal that redraws, the newest 5 lines show under the running line, dim and clipped to one row each, and older ones scroll out. The open lines of a run share the terminal's height, so on a short terminal each logged line shows fewer rows, down to none, and the log rows fit the rows the lines' own rows leave. Rows another writer holds, such as an open question, are not counted. `end()`, `skip()`, and `clear()` remove the rows and leave no blank row, while `fail()`, `warn()`, and a cancelled run write the kept lines, the newest 1000, above the end line through `out.error` or `out.warn`, where they stay in scrollback, after a line such as `1203 earlier lines were dropped.` when earlier ones were. Where the line prints plain lines, nothing shows while it runs, and the kept lines print on the same ends. A child program's own `\r` progress shows its latest state, and its colors and control sequences draw nothing. See [A line's log](docs/libs/prompts.md#a-lines-log).
- Add `logRows` and `logLimit` to a progress line's settings, the count of rows the running line shows and the count of lines it keeps for a failure, an optional `host` to `ProgressContext`, which every action's, middleware's, and configuration source's context already carries and from which a line reads the terminal's height, and an optional `log` to `ProgressLine`, the progress view's data, which holds the rows a line draws on every frame, fitted to the height, and none on an end frame, so a view override can draw them, and data you build by hand for `out.draw` draws without it.

- Teach the authoring skill that `loom init` writes how to choose a Command's inputs: a catalog validator from `@loomcli/validators` and `pipe()`, `multiple`, `lastWins`, and `arity` for an option given more than once or with several words, `requires()` beside the other option groups, the first bare `--` and the `.passthrough()` mode, required arguments after a variadic one, and `required: 'non-interactive'` on an input a question asks for.
- Teach the skill how an action writes and asks: a message's own view such as `step()`, `patchConsole()` for a dependency's console writes, `out.lendTerminal()` for a child program that draws on the terminal, and which question kind to link to an input, `multiselect`, `editor`, and a searched list included. It also teaches a middleware's `mediaType`, `version({ extended: true })`, the configuration plugin's `strict` setting for a supervised run, the `graph` a unit test of a linked `select` states, and the `runtime` a `mockProcess` run reads.

### Fixes

- Fix the manifest leaving out facts a declaration did not state, against its rule that every field is present in every entry. A Command entry now always carries `stdin`, `null` when the Command declares no `.stdin()`, and a stdin declaration with no description reads `description: null`. A content argument or content option entry now always carries `min` and `max`, `null` when the declaration states no bound. The [manifest reference](docs/plugins/manifest.md) lists both fields.

- Install a smaller `@loomcli/loom`: the two programs that `loom init` and `loom build` run under Bun to read an application module no longer each carry a copy of `@loomcli/core`, so they take about 7 KB together, down from about 418 KB, a fifth of the installed package. What `loom init` and `loom build` print is unchanged.

- Fix the `@loomcli/host-bypass` message for `process.exit()` and `process.exitCode`, which suggested a result the action returns: it now suggests a return from the action or a thrown failure, because core reads no value an action returns.

- Fix help's pager so a live region an application holds waits for the pager to exit instead of drawing over it, and redraws once the pager closes.

- Fix the line `loom` reports for a `package.json` that is not valid JSON and ends its lines with a lone CR, so it names the place an editor shows. A line now ends at LF, at CRLF, or at a lone CR, as the configuration plugin counts.

- Fix a `configuration()` dropped-value line at `-v` to name an array item by its position in the file as read in every round. A line from a later round named the position after earlier rounds removed items before it, so one `-v` run could name the same item two ways. A file whose drops happen in one round prints as before.

- Fix Loom's own messages, in core, the plugins, the validators, the prompts, and the `loom` bin, so a control or bidirectional character in a value they repeat, such as a name or a path, prints as its `\uXXXX` escape instead of reaching the terminal.
- Fix the MCP server's error for a request id that is still in use, which no longer repeats the id.

- Fix the `loom` bin's own sentences, which no longer quote a Node.js reason and now name the cause and a fix.
- Fix `loom release plan` and `loom release record`, which now refuse a `--registry` or `--github-api` value that is not an http or https URL as a usage error, before any request, where they reported an unreachable network.

## v0.18.0 - 2026-11-03

### Fixes

- Start applications faster: declaring Commands and options no longer repeats work that grew with every option an application declared. Diagnostics, the call a declaration fault throws from, hook calls, and default validation are unchanged.

- Start applications faster on Node: a run looks up the operator's time zone only when its code first reads `host.timeZone`, so a run that never reads it skips the lookup. The value is unchanged, including a supplied `timeZone` and the one an action's `invoke` keeps from its run.

- Start applications faster on Node: a `node` bundle that `loom build` writes turns on Node's compile cache, so an operator's runs after the first skip compiling the bundle. The cache lives under the operator's temporary directory; `NODE_DISABLE_COMPILE_CACHE=1` turns it off and `NODE_COMPILE_CACHE` moves it. The entry's file keeps its name and shebang, and the application module leaves the cache off.

- Start applications faster and ship smaller bundles: core's Unicode width and grapheme tables take about 58 KB in a bundle, down from about 96 KB when the bundle is minified and 287 KB when it is not, and load in less than half the time. Width and segmentation answers are unchanged.

- Start applications faster: the completion, manpage, and MCP plugins load each Command's work only when that Command runs, and the first-party plugins load `node:crypto` only when a run hashes or stages an installed file. Declarations, graph hooks, help, the manifest, and every printed byte are unchanged.

- Remove Apache-2.0 from the license field of `@loomcli/loom`, which now reads `MIT AND ISC AND Unicode-3.0 AND BSD-3-Clause`. The `loom` bin bundles none of the Apache-2.0 completion scripts of `@loomcli/plugins`, so it no longer carries Cobra's license or the plugins notice either.
- Credit the glyph catalog's sources in `@loomcli/core`: its notice now names Inquirer's figures and Sindre Sorhus's figures, from which Inquirer's derives, and the package ships both license texts. The glyph module's license comment, which a bundle keeps, carries both notices.

## v0.17.0 - 2026-11-02

This release makes configuration first-rate and gives the `loom` toolchain a configuration file of its own. `configuration()` replaces `config()`: one Standard Schema describes the whole file, a Command that opts in reads the validated file as `provided.config`, and a value the schema or an option's validator rejects is dropped and named at `-v`, so an operator's file never breaks a run. The lookup walks up from the working directory to home, reads an author-named variable and the XDG user file, stops at a root marker the author names, and never falls back after a broken file. A JSON file may hold comments, a file that does not parse names its line and column, `--no-config` runs without a file, and the manifest publishes the file's JSON Schema.

Input sources gain words and bindings. A Boolean option's variable reads `yes`, `no`, `on`, and `off`; a multiple option binds a variable its author's delimiter splits; a string option may let a defined empty variable supply the empty string; in an exclusive group, the highest input tier that supplies a member wins; and both help pages print each option's variables and configuration key. The dotenv plugin reads `.env.<mode>`, `.env.local`, and `.env.<mode>.local` in Bun's order and expands references.

A package keeps `loom.config.json` beside its `package.json` to depart from a convention. Its `paths` move the source, entry, build output, changelog, and installer, its `postInstall` replaces the Application's, and its `sharedVersion` lets several binaries ship from one changelog. `loom changelog write --target` cuts a chosen or prerelease version, and `loom changelog notes` prints a release's notes. `skills({ folder })` reads a skills folder that `loom build` carries into every artifact, so the build now loads the application module. `loom` itself starts in about half the time.

Before upgrading, follow the seven breaking migrations: `configuration()` in place of `config()`, `postInstall` in `loom.config.json`, an application module that loads cleanly at build, Bun 1.4.4, an application's own `@types/node`, and the dotenv plugin's reading of `#` and `$`. Keep all installed `@loomcli` packages at the same exact version, `0.17.0`.

### Breaking Changes

- Replace `config()` from `@loomcli/plugins/config` with `configuration()`. It takes one settings object that holds the required `schema`, a Standard Schema for the whole configuration file, beside the `file`, `short`, `env`, `directory`, and `notice` settings, and returns `{ plugin, values }`. Install `plugin`; a Command that opts in with `uses: [values]` reads the validated file as `provided.config`, typed as the schema's output. The `ConfigSettings` type is now `ConfigurationSettings`.
- Require the schema to accept an empty file. Its types reject a schema that requires a key outside an array item or a record value, and a schema that still rejects an empty file throws a `DeclarationError` under `@loomcli/plugins/config/empty-file`.
- Change a configuration value the schema rejects to be dropped instead of failing the run. The plugin removes the value at each issue's path and validates again, names each removal at `-v`, and ignores keys the schema does not describe. Only a `--config` file that is missing, cannot be read or parsed, or does not hold an object or mapping fails a run.
- Change a value a linked option cannot take, such as a string for a Boolean option, to fall through to the option's default with one `-v` line instead of failing the run with code 2.
- Change a linked option to take the value the file holds once the file passes the schema, and a relative path it takes to resolve against the directory of the file. `provided.config` keeps each path as the file wrote it.
- Add the build faults `@loomcli/plugins/config/link-path` and `@loomcli/plugins/config/link-type` for an option linked to a path that a schema publishing its shape through Standard JSON Schema does not hold, or that holds a value the option cannot take.

### Migration

**Affected surface.** Applications that call `config()` or import `ConfigSettings` from `@loomcli/plugins/config`, and applications that rely on a wrong-shaped configuration value failing the run with code 2.

**Why.** One schema describes the whole file, so application code reads structured configuration as `provided.config`, and a value the schema rejects is dropped so an operator's configuration never breaks a run.

**Before and after.**

Before:

```ts
import { Application } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';

const app = new Application('textstat', {
  plugins: [config({ file: '.textstat.{toml,json}', short: 'c' })],
}).option('min-bytes', { extensions: [configInput({ path: 'minBytes' })], type: 'string' });
```

After:

```ts
import { Application } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { z } from 'zod';

const textstatFile = z.object({
  minBytes: z.union([z.number(), z.string()]).optional(),
  total: z.boolean().optional(),
});

const { plugin: configPlugin, values: config } = configuration({
  file: '.textstat.{toml,json}',
  schema: textstatFile,
  short: 'c',
});

const app = new Application('textstat', { plugins: [configPlugin] }).option('min-bytes', {
  extensions: [configInput({ path: 'minBytes' })],
  type: 'string',
});
```

A Command that reads the whole file opts in to the `values` the same call returns:

```ts
const show = new Command('show', { description: 'Show the threshold.', uses: [config] }).action(
  ({ out, provided }) => out.print(String(provided.config.minBytes)),
);
```

**Steps.**

1. Write one Standard Schema (zod, valibot, or ArkType) for the configuration file. Make every key optional outside an array item or a record value, or use a loose type such as `z.record(z.string(), z.unknown())` to keep the file loose. Keep the keys your `configInput` links read.
2. Replace `config(settings)` with `configuration({ ...settings, schema })`, install the returned `plugin`, and rename `ConfigSettings` to `ConfigurationSettings`.
3. Keep every `configInput({ path })` link. Fix a path that `@loomcli/plugins/config/link-path` or `@loomcli/plugins/config/link-type` reports at build.
4. Add the returned `values` to the `uses` list of each Command that reads the file's own values, and read them as `provided.config`.
5. Remove code or tests that expect a wrong configuration value to fail with code 2. Such a value now falls back and is named at `-v`.

**Validation.** Run `pnpm run build` and your type check, which fail where a schema requires a key outside an array item. Run the application with a configuration file that holds a wrong value and `-v` to see the `Ignored` line, then run your test suite.

- Fix `@loomcli/core` installing its own copy of `@types/node` beside a consumer's. The package listed `@types/node` as a dependency, so a package manager could hoist that exact version over the Node types an application installed and break its type-checking. It is now a development dependency, and the published declarations that import `node:` modules type-check against the consumer's own Node types.

### Migration

**Affected surface.** An application that type-checks `@loomcli/core`'s declarations with TypeScript and has no Node types installed of its own. Core's declarations import `node:` modules, and until now core's dependency supplied the types for them.

**Why.** Core no longer installs `@types/node`, so the Node types an application type-checks against are the ones it installs, and no copy of core's version can replace them.

**Before and after.**

Before, the application's `package.json` needed no Node types:

```json
{ "devDependencies": { "typescript": "^5.9.0" } }
```

After, it installs its own:

```json
{ "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.9.0" } }
```

**Steps.**

1. Check whether the application already installs Node types: `npm ls @types/node`, `pnpm why @types/node`, or `bun pm ls | grep @types/node`.
2. If it does not, add `@types/node` as a development dependency, at the major version of the Node.js line the application runs on.

**Validation.** Run the application's type-check, such as `tsc --noEmit`, and confirm it reports no error from a `node:` import in `@loomcli/core`'s declarations.

- Change the dotenv plugin to end an unquoted value at its first `#`, wherever it stands, as Node's `--env-file`, the `dotenv` package, and Bun read one. `URL=a#b` now reads `a`, and `PASSWORD=ab#cd` reads `ab`. Before, a `#` started a comment only at the start of a value or after whitespace.

### Migration

**Affected surface.** Applications that install `dotenv()` from `@loomcli/plugins/dotenv`, and any `.env` file whose unquoted value holds a `#` that follows another character, such as a URL fragment or a password.

**Why.** Node's `--env-file`, the `dotenv` package, and Bun end an unquoted value at any `#`, so one file read two ways. The plugin now reads the value they read.

**Before and after.**

Before, in `.env`, the value read `https://example.test/docs#intro`:

```sh
DOCS_URL=https://example.test/docs#intro
```

After, the same line reads `https://example.test/docs`. Quote the value to keep the `#`:

```sh
DOCS_URL="https://example.test/docs#intro"
```

**Steps.**

1. Find the unquoted values that hold a `#` after other text in every dotenv file the application reads: `.env`, `.env.local`, and the mode files.
2. Wrap each such value in double quotes, or in single quotes when it also holds a `$`.
3. Leave a value that holds no `#`, and a value that is already quoted, as it is.

**Validation.** Run the application and check that each variable holds its whole value, for example by printing the option the variable feeds. A value that stops at its first `#` was not quoted.

- Add variable references to a dotenv value. An unquoted or double-quoted value expands `$NAME`, `${NAME}`, and `${NAME:-default}` against the process environment and the values read before it, and `\$` reads as a literal dollar. Single quotes stay literal, and `$(command)` is never run. A value that held a `$` before now expands it, so `PASSWORD=pa$$word` reads `pa$`, and `\$` reads `$` where it read `\$`.

### Migration

**Affected surface.** Applications that install `dotenv()` from `@loomcli/plugins/dotenv`, and any unquoted or double-quoted value in a dotenv file the application reads that holds a `$`, such as a password or a URL.

**Why.** Bun's own loader expands references in every value, so one file read two ways. The plugin now expands them as Bun does.

**Before and after.**

Before, in `.env`, the value read `pa$$word`:

```sh
PASSWORD=pa$$word
```

After, the same line reads `pa$`, because `$$word` holds no name after its first `$` and `$word` is a reference to an unset name. Quote the value in single quotes to keep every `$`:

```sh
PASSWORD='pa$$word'
```

**Steps.**

1. Find the unquoted and double-quoted values that hold a `$` in every dotenv file the application reads: `.env`, `.env.local`, and the mode files.
2. Wrap each value that must keep its `$` literal in single quotes, or write each such `$` as `\$`.
3. Wrap a value that holds `\$` in single quotes, so its backslash stays.
4. Leave a value that holds no `$`, and a single-quoted value, as it is.

**Validation.** Run the application and check that each variable holds its whole value, for example by printing the option the variable feeds. A value that lost the text after a `$` was not quoted.

- Require Bun 1.4.4 or later. Every published package's `engines.bun` is now `>=1.4.4`, and CI tests Bun 1.4.4.

### Migration

**Affected surface.** Applications that run a Loom package, or a bin built with `loom build`, on Bun 1.4.0 to 1.4.3.

**Why.** Bun 1.4.0 renders an error's stack lazily, and when a garbage collection frees the code that created the error before anything reads `stack`, the stack loses its name and message and reads only `Error`. A defect's logged stack and a failure's Developer Diagnostic then lose the sentence that names the failure. Bun 1.4.4 fixes it.

**Before and after.**

Before, in the application's `package.json`:

```json
{ "engines": { "bun": ">=1.4.0" } }
```

After:

```json
{ "engines": { "bun": ">=1.4.4" } }
```

**Steps.**

1. Upgrade development, CI, and deployment Bun runtimes to 1.4.4 or later, for example with `bun upgrade` or the `bun-version` input of `oven-sh/setup-bun`.
2. Update the application's `engines.bun` requirement to `>=1.4.4`.

**Validation.** Run `bun --version` in each environment to check its runtime. Run the application's test command under Bun before deployment.

- Move the post-install declaration from the Application into `loom.config.json`. `new Application(name, options)` no longer takes `postInstall`, `inspect()` no longer reports it, and `@loomcli/core` no longer exports the `PostInstall` type. The package's `loom.config.json` now holds `postInstall`, with the same `message` and `command`, and `loom init` renders it into `install.sh` without loading the application module. See [the post-install command](docs/toolchain/install.md#the-post-install-command).
  - A `command` that is not a non-empty array of strings is dropped, so the script has no post-install command, and `loom -v` names the dropped value. The message stays.
  - The installer script behaves as before: it runs the command once the install is recorded, `--skip-post-install` skips it, and the message prints last.
- Remove `@loomcli/core/post-install-unrouted`. Nothing checks that the post-install command's words route to a Command with an action: not a development build, not `check()`, not `assertAssembles`, and not `loom init`. Words that route nowhere fail on the operator's install, where the script warns that the application is installed and prints the command to run again.
- Change `loom init`'s `install` piece, so an application module that cannot be loaded, that exports no Application, or that throws a declaration fault no longer stops `install.sh` from being written, and a declaration fault no longer makes `init` exit 1.

### Migration

**Affected surface.** Applications that pass `postInstall` to `new Application(name, options)`, and code that reads `postInstall` from `inspect()` or imports the `PostInstall` type from `@loomcli/core`.

**Why.** Only `loom init` reads the declaration, to render it into `install.sh`, so it belongs in the toolchain's configuration file beside the installer's location rather than in the Application.

**Before and after.**

Before, in `src/application.ts`:

```ts
export const notes = new Application('notes', {
  description: 'Take notes.',
  postInstall: { command: ['setup'], message: 'Run notes init in a project.' },
});
```

After, in `src/application.ts`:

```ts
export const notes = new Application('notes', { description: 'Take notes.' });
```

And in `loom.config.json`, beside `package.json`:

```json
{ "postInstall": { "command": ["setup"], "message": "Run notes init in a project." } }
```

**Steps.**

1. Remove `postInstall` from the options of `new Application(name, options)`.
2. Add the same value as the top-level `postInstall` key of the package's `loom.config.json`, creating the file beside `package.json` when the package has none.
3. Remove any read of `inspect().postInstall` and any import of the `PostInstall` type from `@loomcli/core`.
4. Run `loom init --only install` to render `install.sh` from the file.

**Validation.** Run `tsc --noEmit` to confirm the application compiles without `postInstall`. Run `loom init --only install` and confirm `git diff install.sh` shows no change against the script the previous release rendered, or `loom -v init --only install` to see whether the file's `postInstall` was dropped.

- Change `loom build` to import the application module before it bundles, for every target, in a Bun process of its own, so it can read the skills folder `skills()` names. A package that resolves `@loomcli/plugins` and has an application module apart from its entry now fails the build with `@loomcli/loom/application-load-failed` when that module throws while it loads, where an earlier build bundled it without running it. See [The skills folder](docs/toolchain/build.md#the-skills-folder).

### Migration

**Affected surface.** Packages built with `loom build` that depend on `@loomcli/plugins` and whose application module, `src/application.ts` by convention or the module `paths.application` or `--application` names, runs code at load that throws outside a real run, such as reading a file beside the installed binary or requiring an environment variable.

**Why.** The build learns the skills folder from the declaration, so it imports the module that declares the Application, as `loom init` already does.

**Before and after.**

Before, in `src/application.ts`:

```ts
const settings = JSON.parse(readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
export const notes = new Application('notes', { description: settings.description });
```

After, the work moves into an action or a function the action calls, so the module only declares:

```ts
export const notes = new Application('notes', { description: 'Take notes.' });
```

**Steps.**

1. Run `loom build` for each target the package builds.
2. If it fails with `@loomcli/loom/application-load-failed`, move the work the message names out of the module's top level, into an action, which runs only when its Command runs.

**Validation.** Run `loom build --target node` and `pnpm test` in the package; both pass with the module loading cleanly.

### Features

- Add the `@loomcli/strict-configuration-schema` rule to `@loomcli/eslint-plugin`, on at `error` in `configs.recommended` and `configs.oxlint`, under [ADR-0118](docs/decisions/0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md). It reports a zod strict object, `strictObject(...)` or `.strict()` on a zod schema, inside the `schema` an application gives the configuration plugin's `configuration()`, a section held in a `const` of the same module included, because zod reports an unknown key on the object that holds it and the plugin then drops that whole section. valibot's and ArkType's strict objects are not reported, because they report the unknown key alone. `loom init` writes the rule into a new scaffold's lint file. See the [plugin reference](docs/libs/eslint-plugin.md#strict-configuration-schema).

- Add the `env`, `directory`, and `notice` settings to `configuration()`. `env` names a variable whose value is the one configuration file a run reads, with no search; `directory: { name, short, description }` declares a global string option that starts the lookup's walk in another directory without changing `host.cwd`; `notice: true` writes one `out.info` line when the lookup finds no file. A variable name that is not a letter or underscore followed by letters, digits, or underscores throws a `DeclarationError` under `@loomcli/plugins/config/variable-name`, and the type rejects a `directory.name` of `config`.
- Change the configuration lookup to find the first file in this order: `--config`, the `env` variable, the start directory and each ancestor up to and including the home directory (or up to the filesystem root when the start is outside home), the home directory, then `config.<ext>` in `$XDG_CONFIG_HOME/<app>` or `~/.config/<app>`. An operator who ran an application from a subdirectory now reads the project file above it, and a per-user file under the XDG folder is now read.
- Change a broken or unreadable discovered file to end the lookup. The plugin warns once that this run reads no configuration, and no later location answers in its place, where an earlier release read the home file after a broken file in the working directory.

- Change a value the configuration source filled and the option's validator rejects to fall back instead of failing the run. The option reads as unfilled: its default applies, a `required` option reports its missing-value error, and `validateOmitted` receives `undefined`. A dropped fill activates no middleware, and one rejected item drops a multiple option's whole list. A content option's path from the configuration source that core cannot read falls back the same way. Core writes one `out.debug` line for each, `Ignored option "--limit" from limits.bytes in fixture.json: Supply a whole number.`, which shows at `-v`. A value from argv or the environment that its validator rejects still fails with code 2.
- Add an optional `directory` to `SourceAnswer`, the absolute path of the directory of the file a value came from. The option's validator receives a context whose `host.cwd` is that directory, so `path()` resolves a relative value against the file, and a content option reads a relative path against it. A `directory` that is not an absolute path is a defect of the source.
- Add `out`, `style`, and `graph` to `ProviderContext`, and to the context `@loomcli/testing`'s `providerContext` builds. An opener can warn the operator, write a line at `-v`, and read the application name.
- Add `invokedBy` to `ProviderContext`, and to the context `providerContext` builds. It reads `'name'` in a run `invoke()` started and `'argv'` otherwise, so an opener spells an option in a problem by its declared name in an invocation by name.

- Allow `//` and `/* */` comments and a trailing comma in every configuration file the configuration plugin reads as JSON, `.<app>.json` included, so a file can carry the reason for a value beside it. A strict JSON file reads as before.
- Allow `jsonc` in a `configuration({ file })` brace list, such as `.collector.{toml,jsonc}`. A `*` pattern tries `jsonc` after `json`, and a `jsonc` candidate looks for `config.jsonc` in the XDG user folder.

- Add `--no-config` to the configuration plugin: a run that passes it reads no configuration file, not the one the author's variable names, the walk's, the home file, or the XDG user file, so CI, tests, and agents get a run an operator's dotfile cannot change. A Command that opts in to `provided.config` reads the schema's output for an empty file. Passing it beside `--config` fails the run with code 2.

- Add `configuration` to the graph `inspect()` returns: the JSON Schema of the configuration the installed configuration source reads, derived at graph build through Standard JSON Schema as an input's schema is, or `null` when no plugin claims the source slot. A plugin's `source` takes an optional `schema` for it. A schema with no converter, or whose converter fails, publishes `schema: null` in every build with no fault, so a part JSON Schema cannot express, such as zod's `z.bigint()`, never fails a run. See [Input sources](docs/core/input-sources.md).
- Add `configuration` to the manifest's envelope, after `globals`, so an agent reads the configuration file's JSON Schema with the invocation's. The fixed `tokens` statement now scopes its schema clause to an input's schema.
- Publish the configuration file's JSON Schema from `configuration()` with no other call: the manifest carries it with a `$schema` string property added, and the plugin removes a top-level `$schema` key from the file before it validates, so a file can point an editor at a hosted copy. See [Publishing the schema](docs/plugins/config.md#publishing-the-schema).

- Allow `yes`, `no`, `y`, `n`, `on`, and `off` in a variable bound to a Boolean option, beside `true`, `false`, `1`, and `0`, in any case. An empty variable still counts as unset. Any other value is still a usage failure naming the variable, and its issue now lists every accepted word: `Use true, false, yes, no, y, n, on, off, 1, or 0.` See [Input sources](docs/core/input-sources.md#input-sources).

- Allow `mockProcess({ stdin })` in `@loomcli/testing` to take bytes as well as text. A `Uint8Array` is piped as one chunk, unchanged, so a test can state input that is not valid UTF-8. Under `stdin: 'inherit'`, a child program's recorded `input` stays text, decoded as UTF-8.

- Add each option's bound variable names and configuration key to both help pages, `-h` and `--help`. The option's dim parenthesis gains `env: <names>`, the variables in declaration order, and `config: <path>`, the option's `configInput` path, after `implied` and before `deprecated`, so textstat's `--min-bytes` reads `(default: 0, env: TEXTSTAT_MIN_BYTES, config: minBytes)`. Help prints names alone, never a value, and keeps each name whole when it wraps. `helpInput({ hideBindings: true })` keeps an option's bindings off both pages, while the man page, the manifest, and `inspect()` still publish them. See [Help variants](docs/plugins/help.md#help-variants).

- Add `booleans` to the option position `locate()` returns: the value the earlier words gave each Boolean option in scope, keyed by name, so `--no-json` holds `json` at `false`. A completion reader can tell whether a member of an exclusive option group gave its absent value and so claims nothing. See [graph inspection](docs/core/graph-inspection.md).

- Add a 5-second limit to each read `service status` makes of the service manager. A state read that runs out is ended with `SIGKILL` and reads `unknown` with a note naming the call and the limit, a session read that runs out adds no note, and `status` exits 0 either way, so a caller that waits on `status` always gets a report. `install`, `uninstall`, `start`, `stop`, and `restart` keep no time limit.

- Add layered files to the dotenv plugin. It reads `.env`, `.env.<mode>`, `.env.local`, and `.env.<mode>.local` in the working directory, the more specific file winning, in the order Bun and Next.js load them. The mode is the value of `NODE_ENV`; with `NODE_ENV` unset or empty the plugin reads `.env` and `.env.local`, and under `NODE_ENV=test` it skips `.env.local`. A missing file is silent, and every warning names the file it read. A variable the process has set still wins over every file.

- Allow a multiple string option and a multiple content option to bind an environment variable, beside an `envDelimiter` the declaration names. The types require the delimiter whenever a multiple option binds `env`, and reject it on every option that is not multiple or binds no variable, so `{ multiple: true, env: 'FIELDS' }` still fails to compile while `{ multiple: true, env: 'FIELDS', envDelimiter: ',' }` compiles. The variable's value splits at each occurrence of the delimiter into the option's list, untrimmed and with empty items kept, and each item passes the option's validator, which names the variable and the item's position. The list replaces the configuration source and the default, and argv still outranks it. An empty `envDelimiter` is a declaration error, `@loomcli/core/env-delimiter`. `inspect()` and the manifest publish the delimiter as `envDelimiter`, and the man page and both help pages print it beside the variables, so help reads `(repeatable, env: FIELDS as a list separated by ",")`. See [Environment lists](docs/core/input-sources.md).

- Allow a scalar string option that binds `env` to declare `envAllowEmpty: true`, so a defined empty variable supplies the empty string. Without the key an empty variable stays unset and falls through, as before. Under it, the first name in an ordered list that the environment defines supplies the option, its value empty or not, so `APP_PREFIX=` clears a prefix the configuration file supplies, as `--prefix=` does, and keeps the default from applying. The empty string satisfies `required`, passes the option's validator, and never fills the implied value, and a dotenv file's `FOO=` supplies it the same way. The types accept the key on no other option. `inspect()` and the manifest publish it as `envAllowEmpty` on a string option, and the man page says an empty value supplies the option. See [Empty values](docs/core/input-sources.md).

- Add the `scopes` and `root` settings to `configuration()` from `@loomcli/plugins/config`. `scopes` lists the scopes the lookup reads: `'project'`, the walk up from the start directory, and `'user'`, the home file and then the XDG user file. It reads both by default, and always reads the project scope first. `root` names one or more entries, such as `package.json` or `.git`, whose presence in a directory ends the project walk after the plugin looks for the file there, so a run inside a monorepo package never reads the repository root's file. `root: false` states that the project has no marker. A `root` name that is not one path segment throws a `DeclarationError` under `@loomcli/plugins/config/root-name`, and a `root` beside a `scopes` list without `'project'` throws under `@loomcli/plugins/config/root-without-project`. An application that sets neither setting finds its file as before. See the [configuration plugin](docs/plugins/config.md).
- Add the `unrooted-configuration` rule to `@loomcli/eslint-plugin`. The rule reports a `configuration()` call that reads the project scope and names no `root`. `configs.recommended` and `configs.oxlint` turn it on at `warn`, the one rule they do not turn on at `error`, so an existing application whose call sets no `root` now gets one lint warning. To silence it, name the entry that marks the project's root, such as `root: 'package.json'`, set `root: false` when the project has none, or list only `'user'` in `scopes`. A `.oxlintrc.json` that holds a copy of `configs.oxlint` gains the rule when the line `"@loomcli/unrooted-configuration": "warn"` is added to its `rules`. See the [ESLint plugin](docs/libs/eslint-plugin.md#unrooted-configuration).

- Add `loom.config.json`, the toolchain configuration file a package keeps beside its `package.json` to depart from a convention. `loom` reads the first `loom.config.json` from the working directory up to the package directory, and never one above it, so a package in a monorepo never reads the root's file. Its `paths` key names where the package keeps `source`, `application`, `entry`, `out`, `changes`, `changelog`, and `installer`, each resolved against the package directory and free to leave it, such as `"installer": "../../install.sh"` for a monorepo's root installer. `application` and `entry` follow `source` unless set themselves. A package with no file builds, checks, and scaffolds exactly as before. See the [build reference](docs/toolchain/build.md#the-configuration-file).
  - `loom build` takes its entry, its application module, and its output folder from the file, and `--entry`, `--application`, and `--out` still beat it. An `entry` or an `application` the file names that does not exist fails the build and names `paths.entry` or `paths.application`, while a missing conventional application module still leaves the bundle with the entry alone.
  - `loom changelog check` and `loom changelog write` read the fragment folder and the changelog the file names.
  - `loom init` writes the application module, the entry, the test, the fragment guide, and `install.sh` where the file places them, and what it writes names those paths: the entry and the test import the application module by its relative path, `bin` names the entry's bundle in `out`, `tsconfig.json`, the linter's file globs, and the `check` script name `source`, and the fragment guide and the changelog skill name the fragment folder and the changelog. A new application uses every convention whatever the file holds, and `init` writes no `loom.config.json`.
  - A value the file's schema rejects, such as an empty string, is dropped and its convention applies, and a file that does not parse warns once and the run uses conventions.
- Add `--config`, `--no-config`, `-v`, and `-q` to `loom`. `--config <path>` reads that file in place of the lookup, `--no-config` runs on conventions alone, and `-v` names each value the file's schema dropped.

- Add `--target` to `loom changelog write`, which cuts a chosen version, such as a minor for a milestone with no breaking change. The target must rank above the current version, and its release part must meet the version the pending fragments call for, so a fragment keeps its kind whatever version ships it. See [the package changelog](docs/toolchain/changelog.md).
  - A target with a prerelease part, such as `0.11.0-rc.1`, sets the version, writes no changelog section, and leaves the fragments pending. A later `loom changelog write` without `--target` finalizes to `0.11.0` and consumes them.
- Add `loom changelog notes <version>`, which prints a stable version's changelog section body, or a prerelease's pending fragments, for its release page.
- Add the `sharedVersion` key to `loom.config.json`, a list of `package.json` files that carry the package's version. `loom changelog write` sets each of them in the same replacement as the package's own, and fails with nothing changed when one is missing or holds another version, so several binaries can ship from one tag and one changelog.

- Add the skills plugin's `folder` setting, so an application names one folder whose subfolders are its agent skills, such as `skills({ folder: new URL('../skills/', import.meta.url) })`, in place of writing a loader for each skill. An entry whose name starts with `.`, such as `.DS_Store`, is skipped. `skills` becomes optional, and settings that hold neither `folder` nor `skills` throw `@loomcli/plugins/skills/settings`. A source run and a test read the folder from disk when `skills install` or `skills update` runs, and a folder the plugin cannot read as skills fails with `@loomcli/plugins/skills/folder`. See [The skills folder](docs/plugins/skills.md#the-skills-folder).
- Add the skills folder to `loom build`. Before it bundles, it loads the application module under Bun, judges the folder `skills()` names, and fails on a bad skill. A development build reads the source folder, a distributed bundle carries a copy in `loom-skills/` beside its chunks, and a distributed binary embeds it, so the artifact installs the skills wherever it runs. See [The skills folder](docs/toolchain/build.md#the-skills-folder).

### Fixes

- Change the configuration plugin's warning and `--config` failure for a file that does not parse to name the line and column where it breaks, such as `Skipped .collector.toml: the file is not valid TOML at line 3, column 7, so this run reads no configuration.` JSON, TOML, and YAML count the position the same way under Node and Bun: lines and columns from 1, and a column in characters. See the [configuration plugin](docs/plugins/config.md#missing-and-broken-files).

- Fix the MCP plugin's server refusing clients that open with `initialize`, such as Codex CLI, which reported every tool unavailable. The server now serves revisions `2025-11-25` and `2025-06-18` to a client that opens with `initialize`, beside `2026-07-28` per request on the same connection, so `mcp install`'s Codex registration serves. On those revisions a tool whose JSON view prints an array or a single value answers text alone, because they hold structured content as an object. `server/discover` and the unsupported-version error list all three revisions. See the [MCP plugin](docs/plugins/mcp.md#the-protocol-package).

- Fix an exclusive option group failing a run because a configuration file or an environment variable filled one member while the operator typed another. The highest input tier that claims a member now wins: a member a lower tier filled is withdrawn before validation, reads as unfilled with its declared default, and is absent from the `supplied` record. So `json = true` in a configuration file with a typed `--yaml` runs with `yaml`, an environment member wins over a configured one, and the named values of an `invoke()` call win over both. Members one tier supplied still conflict, such as `--json --yaml` or two configured keys. A bound variable outside its grammar beside a typed sibling no longer fails the run.
- Fix a Boolean at its absent value claiming an exclusive option group. A Boolean member supplied at the value it takes when nobody supplies it, such as `--no-yaml`, `EXPORT_YAML=0`, or a configured `yaml = false` on a `positive` or `both` option, neither wins the group nor conflicts, and still reaches the action with its value. A typed `negative` member, absent as `true`, still claims its group. So `--json --no-yaml` runs, and `json = true` in a configuration file with a typed `--no-yaml` runs with `json`. Completion keeps offering `--yaml` after `--no-json`, and an MCP tool's schema accepts `{ "json": true, "yaml": false }`.
- Fix a `requiredTogether` group failing every run once an exclusive group withdrew one of its members. With `exclusive('token', 'user')` and `requiredTogether('user', 'password')`, a configured `user` beside a typed `--token` now runs whether the file holds `password` or not. `oneRequired` counts a withdrawn member as supplied, as before.

- Fix the time `loom` takes to start. The `loom` bin of `@loomcli/loom` is now one bundle, and each command loads its code only when it runs, so `loom --help` and `loom changelog check` no longer load the code of every command. Installing `@loomcli/loom` now installs no runtime dependency, and its optional peers, pnpm and TypeScript, are unchanged. The package now carries the license notices of the code its bundle holds in `dist/NOTICE` and `dist/licenses/`, and its license field reads `MIT AND ISC AND Apache-2.0 AND Unicode-3.0 AND BSD-3-Clause`.
- Change how a defect inside `loom` itself reports: the bin is a distributed build, so it shows the generic defect message a distributed application shows in place of the Developer Diagnostic. See [development builds](docs/core/release-facts.md#development-builds).
- Fix a distributed `loom build` shipping development code, for a bundle and a compile target alike: it now runs Bun with `NODE_ENV` set to `production`, so the artifact resolves each dependency's production export and bundled code reads `production` from `process.env.NODE_ENV`, whatever the shell holds. A development build and `--watch` keep resolving development exports. See the [build reference](docs/toolchain/build.md#loom-build).

## v0.16.0 - 2026-10-27

This release makes a run read the process through one process handle, ends a signalled process within one bounded shutdown, and gives tests, actions, and plugins new seams. A run reads its arguments, streams, environment, home, and temporary folder, and starts child programs, through `host`, which core builds from the `ProcessHandle` that `run({ process })` and `app.invoke` take. `run({ host })` and `HostOverrides` are removed. The new `@loomcli/host-bypass` lint rule names the host member to use where application code reaches the global `process`, `os`, or `child_process`.

An ending signal now starts one bounded shutdown. Core cancels every live run, gives the runs `shutdown.timeout` to unwind, 500 milliseconds by default, calls the synchronous `onShutdown` handlers, and lets the signal end the process. The plugin `signals` field and its slot are removed. Ctrl-Z suspends a question or a live region, and `fg` draws it again.

`mockProcess` from `@loomcli/testing` builds a process handle that reads nothing from the test's own process, and scripts keys and child programs. Five context builders call one action, middleware, failure hook, provider opener, or view with no Application. An action can opt in to providers, typed values such as a database pool that core builds and closes. The MCP plugin registers its server with Claude Code and Codex, an Application can declare a post-install command and message for `install.sh`, and help can page a long page through the operator's pager. A run under CI is not interactive, and it renders color and hyperlinks as supports-color and supports-hyperlinks do.

Before upgrading, follow the three breaking migrations: the process handle, the shutdown, and the home read from `host.home`. Keep all installed `@loomcli` packages at the same exact version, `0.16.0`.

### Breaking Changes

- Remove `RunOptions.host`, the `HostOverrides` type, and `app.invoke`'s `host` option. A run reads every process fact and makes every process effect through one process handle: `run({ process })` and `app.invoke(path, values, { process })` take a `ProcessHandle`, and a run given none binds the real process's handle. See the [host reference](docs/core/host.md#the-process-handle).
- Add `processHandle(fields)`, which builds the real process's handle with each supplied field replacing its whole field, and the types `ProcessHandle`, `ProcessFields`, `ProcessTerminal`, `SignalSource`, `SignalListener`, and `ProcessSignal`. `run()` writes its exit code to the handle's `exitCode`, which `processHandle` writes to `process.exitCode`, and core listens and re-raises on the handle's signal source.
- Add `arch`, `libc`, `uid`, `home`, `tmpdir`, `raise`, and `spawn` to the host. `raise(signal)` raises the signal a key read in raw mode stands for on the run's signal source when stdin is that source's own terminal, and otherwise raises nothing and answers `false`.
- Add `home` and `tmpdir` to the process handle and the host: the operator's home folder and the folder for temporary files. Each follows the handle's absolute `HOME` or `TMPDIR`, a supplied environment's included, and otherwise the user database's home and `/tmp` for the real process; a supplied `home` or `tmpdir` wins. Core copies both at entry, so a `HOME` or `TMPDIR` a `.env` file adds moves neither. See [The home and temporary folders](docs/core/host.md#the-home-and-temporary-folders).
- Add `host.spawn(command, args, options)`, the run's one way to start a child program, with no shell, and the types `SpawnOptions`, `Child`, `ChildExit`, and `ChildOutput`. The child runs in `host.cwd` with `host.env` unless the options name others; `input` or `stdin: 'inherit'` feeds its stdin; each output stream is captured, ignored, inherited from the run's own stream, or piped into a `Writable`; and `detached: true` releases it to outlive the run. `exited` never rejects and answers the exit code, 128 plus the signal's number for a child a signal ended, or that the child could not start. An abort of `signal` ends the child with `SIGTERM`, and `kill(signal)` delivers a signal to it, `SIGKILL` included. Under `app.invoke`, an action's `invoke`, and an MCP tool call, an inherited stream is the call's captured output. See [Child programs](docs/core/host.md#child-programs).
- Change a relative `cwd` given to the process handle to resolve against the process's working directory, so `host.cwd` is absolute.
- Change the background query to raise an interrupt key it read only when stdin is its signal source's own terminal. On any other stdin, Ctrl-C and Ctrl-\ cancel the run with 130 and Ctrl-Z is dropped.

### Migration

**Affected surface.** Code that calls `run({ host })` or `app.invoke(path, values, { host })`, or that imports the `HostOverrides` type from `@loomcli/core`, such as a test or an embedding host that supplies argv, streams, environment, or terminal facts.

**Why.** Host overrides left every fact a caller omitted, and every process effect, on the global `process`. The process handle holds every fact and receives every effect, under [ADR-0107](docs/decisions/0107-a-run-reads-the-process-through-one-process-handle.md).

**Before and after.**

Before:

```ts
import type { HostOverrides } from '@loomcli/core';

const host: HostOverrides = { argv: ['keys', 'user'], stdout: panel };
await jsonkit.run({ host });
const outcome = await jsonkit.invoke(['keys'], values, { host: { cwd: '/srv/doc' } });
```

After:

```ts
import { processHandle } from '@loomcli/core';
import type { ProcessFields } from '@loomcli/core';

const fields: ProcessFields = { argv: ['keys', 'user'], stdout: panel };
await jsonkit.run({ process: processHandle(fields) });
const outcome = await jsonkit.invoke(['keys'], values, {
  process: processHandle({ cwd: '/srv/doc' }),
});
```

**Steps.**

1. Replace each `run({ host: fields })` with `run({ process: processHandle(fields) })`. Where `fields` holds an `env` with no absolute `HOME`, also supply `home`, a temporary folder or `''`, because the handle's home otherwise falls back to the user database's, the operator's real home; a test can use `mockProcess` instead.
2. Replace each `invoke(path, values, { host: fields })` with `invoke(path, values, { process: processHandle(fields) })`.
3. Replace the `HostOverrides` type with `ProcessFields`, and `HostOverrides['terminal']` with `ProcessTerminal`.
4. Where code read a relative `host.cwd` it supplied, read the absolute directory it resolves to.

**Validation.** Run the TypeScript compiler over the application and its tests: no reference to `HostOverrides` or a `host` run option remains. Run the application's tests, which pass with the same results.

- Change `applicationDirectory(kind, application, from)` to read the home from `from.home`, the run's `host.home`, in place of `HOME` in `from.env`. The XDG variables are still read from `from.env`, and an absolute one still wins over the folder under the home. A home that is empty or not an absolute path still answers `{ variable: 'HOME' }`. See the [installation record reference](docs/core/installation-record.md).
- Change the configuration, completion, logging, manpage, service, skills, and self-update plugins to read the home from `host.home`, and the logging plugin from the log destination's new `home`, in place of `HOME` in the environment. An operator whose `HOME` is unset or relative now has the home the user database holds for them, where every lookup that needed a home used to refuse.
- Change the service plugin's `systemctl`, `loginctl`, and `launchctl`, the completion plugin's PowerShell profile query, the skills, completion, and manpage refreshes, and the update notices' refresh to start through `host.spawn`, so a run on a mock process starts no real program. The service managers now run in `host.cwd`.

### Migration

**Affected surface.** Code that calls `applicationDirectory` with an object it builds itself, `{ env, platform }`, rather than the run's host. A test or embedding host that builds `processHandle({ env })` without an absolute `HOME`: its home is now the user database's, the operator's real home, so a plugin that installs or logs writes there.

**Why.** The home is a host fact, `host.home`, which follows the process handle's absolute `HOME` and falls back to the user database, so every Loom lookup reads it in one place, under [ADR-0107](docs/decisions/0107-a-run-reads-the-process-through-one-process-handle.md).

**Before and after.**

Before:

```ts
const cache = applicationDirectory('cache', 'notes', { env: host.env, platform: host.platform });
```

After:

```ts
const cache = applicationDirectory('cache', 'notes', host);
// or, from an object of your own:
const logs = applicationDirectory('logs', 'notes', { env, home: '/home/me', platform: 'linux' });
```

**Steps.**

1. Where a call passes the run's host, leave it as it is.
2. Where a call builds its own `from`, pass the run's host instead, or add `home`, the run's `host.home`.
3. Where code builds `processHandle({ env })` with no absolute `HOME`, supply `home`: a temporary folder for a run that writes files, or `''` for a run with no home. A test can use `mockProcess` from `@loomcli/testing` instead, whose home is a folder that does not exist.

**Validation.** Run the TypeScript compiler over the application and its tests: every `applicationDirectory` call compiles. Run the application's tests, which pass with the same results.

- Change how a signal ends a run. `SIGINT`, `SIGTERM`, and `SIGHUP` each start one bounded shutdown while a `run()` is live, from the moment it is called: core aborts the signal of every live run on the signal source, `run()` and `app.invoke` alike, with the signal's name as the source, gives the runs the shutdown budget to unwind, and then calls every pending `onShutdown` handler and re-raises the signal, so the process dies by it with the shell's status. A second ending signal ends the shutdown at once, and `SIGQUIT` skips the budget. See [Signals, cancellation, and shutdown](docs/core/signals.md#the-shutdown).
- Add `shutdown: { timeout }` to the Application options: the milliseconds the runs get to unwind after an ending signal, 500 by default. A value other than a whole number from 0 through 2147483647 is the declaration error `@loomcli/core/invalid-shutdown-timeout`.
- Add `onShutdown(handler)` to the action and middleware contexts, scoped to the run, and export `onShutdown` from `@loomcli/core`, scoped to the process, with the types `OnShutdown`, `ShutdownEvent`, and `Synchronous`. An `onShutdown` handler is synchronous by type, runs once, newest first, at the end of a shutdown or at the process's own end, and receives the cause and the status the shell sees. Add `onSuspend` and `onResume` to the action and middleware contexts, scoped to the run, and export them from `@loomcli/core`, scoped to the process, with the types `OnSuspend` and `OnResume`: on each Ctrl-Z core calls every suspend handler, newest first, and re-raises `SIGTSTP`, then calls every resume handler in registration order once the process runs again; they receive no event and run at every suspend and resume. Each call returns a function that removes its handler.
- Add the cancellation codes 129 for `SIGHUP` and 131 for `SIGQUIT` to `ExitCode` and to a cancelled invocation outcome's `exitCode`, the signal names `'SIGHUP'` and `'SIGQUIT'` to `CancellationReason`'s `source`, and the two rows to the manifest's exit-code table.
- Remove the plugin `signals` field and the signals slot. Core listens for every ending signal itself, so no plugin claims one, and `@loomcli/core/slot-taken` no longer covers signals.
- Change `loom build` and `loom build --watch` to stop Bun and undo what the build wrote within the shutdown budget when a signal stops `loom`, and to remove Bun's leftovers synchronously when the budget runs out first.

### Migration

**Affected surface.**

- A plugin that declares `signals`, such as `plugin('@acme/signals', { signals: ['SIGINT', 'SIGTERM'] })`, and code that relied on that claim to keep a process alive after a signal.
- A raw `process.on('SIGINT')`, `process.on('SIGTERM')`, or `process.on('SIGHUP')` listener in an application's entry. It now runs beside core: its runs are cancelled by the signal, and it hears each signal twice, once as it arrives and once when core re-raises it at the shutdown's end.
- Code after `await app.run()` in an entry. After an ending signal it gets only its synchronous part, because the shutdown ends on the next turn of the event loop and the process dies by the signal, where before the run resolved 130 or 143 and the process went on to exit with that code.

**Why.** A cooperative claim let an action that ignores its signal hold the process without bound, and a claim beside `signal-exit` never ended it. Core now listens for every ending signal while a run is live and ends the process within one bounded shutdown, under [ADR-0106](docs/decisions/0106-a-signal-ends-the-process-within-one-bounded-shutdown.md).

**Before and after.**

Before:

```ts
import { Application, plugin } from '@loomcli/core';

const signals = plugin('@acme/signals', { signals: ['SIGINT', 'SIGTERM'] });
export const app = new Application('notes', { plugins: [signals] }).action(async ({ signal }) => {
  const scratch = createScratch();
  try {
    await convert(scratch, { signal });
  } finally {
    await removeScratch(scratch);
  }
});
```

After:

```ts
import { Application } from '@loomcli/core';

export const app = new Application('notes', { shutdown: { timeout: 500 } }).action(
  async ({ onShutdown, signal }) => {
    const scratch = createScratch();
    // Synchronous, so it completes even when the shutdown's budget runs out.
    const remove = onShutdown(() => {
      removeScratchSync(scratch);
    });
    try {
      await convert(scratch, { signal });
    } finally {
      remove();
      removeScratchSync(scratch);
    }
  },
);
```

**Steps.**

1. Remove the `signals` field from every plugin definition, and remove a plugin that declared nothing else.
2. Move the wind-down a signal needs into the run's own cancellation handling: read `signal` and finish within the budget, raising `shutdown.timeout` on the Application when a supervisor waits longer.
3. Move anything that must be restored however the process ends, such as raw mode, the cursor, a child process, or a scratch file, into a synchronous `onShutdown` handler, and remove the handler once the work no longer needs it.
4. Remove a raw `process.on` listener for `SIGINT`, `SIGTERM`, or `SIGHUP` from the entry, and move its wind-down into an `onShutdown` handler or the run's own cancellation handling. A listener that stays hears each signal twice.
5. Move work that code after `await app.run()` does on the way out, such as a final write or a cleanup, into an `onShutdown` handler or the action's `finally`, because after an ending signal only the synchronous part of that code runs.

**Validation.** Run `tsc --noEmit` in the application's package: it reports no `signals` field on a plugin definition. Run the application, press Ctrl-C during a long action, then run `echo $?`: it prints `130`, the prompt returns within the budget, and the terminal and any scratch files are restored. Run the application's tests with its own test command, such as `bun test` or `vitest run`.

### Features

- Add `mockProcess(fields)` to `@loomcli/testing`, with the types `MockFields`, `MockTerminal`, `MockProcess`, `RecordingStream`, `Program`, `ProgramCall`, and `ProgramAnswer`. It builds a [process handle](docs/core/host.md#the-process-handle) that reads nothing from the process the test runs in: every fact has a sealed default, `stdout` and `stderr` record what a run writes, `exitCode` records what `run()` writes, and its signal source is its own. A test runs an Application with `app.run({ process: mockProcess(...) })` and reads the mock. See the [testing reference](docs/libs/testing.md#mockprocess). When a shutdown on the mock's signal source ends and re-raises its signal, nothing listens any more, so the re-raise ends the mock: once a run resolves inside the shutdown, the next turn of the event loop ends it and `endedBy` records the signal.
- Add `home` and `tmpdir` defaults to `mockProcess`: the mock's absolute `env.HOME` and `env.TMPDIR`, else `/loom-test/home` and `/loom-test/tmp`, neither of which exists. A supplied `home` or `tmpdir` wins.
- Add `programs` to `mockProcess`, which scripts each child program a run starts through `host.spawn` by its exact command, answering its exit code and output with no program run. A command with no script throws `mockProcess has no program for "<command>". Add a "<command>" entry to programs.` from `spawn`, so the run fails; a script that throws stands for a program that could not start; and a spawn's abort or a `kill` of `SIGHUP`, `SIGINT`, `SIGKILL`, `SIGQUIT`, or `SIGTERM` ends the child with 128 plus the signal's number.

- Add the `@loomcli/host-bypass` rule to `@loomcli/eslint-plugin`, on at `error` in `configs.recommended` and `configs.oxlint`, under [ADR-0107](docs/decisions/0107-a-run-reads-the-process-through-one-process-handle.md). It reports the global `process`, `globalThis.process`, and `global.process`, an import of `process` or `node:process`, `homedir`, `tmpdir`, and `userInfo` from `os` or `node:os`, and an import of `child_process` or `node:child_process` in an application's source, a re-export of any of these modules and an `os` member a destructure reads included, and each message names the host member to use instead, such as `host.env`, `host.home`, `host.tmpdir`, or `host.spawn`. A file whose name holds `.test.` or `.spec.` is not linted by it. `loom init` writes the rule into a new scaffold's lint file. See the [plugin reference](docs/libs/eslint-plugin.md#host-bypass).

- Change Ctrl-C at a `@loomcli/prompts` question to end the process by `SIGINT` after the shutdown, so a shell loop that runs the application stops, as it does for any program Ctrl-C ends. Ctrl-\ at a question ends it by `SIGQUIT`, and Ctrl-Z suspends it: the question's frame is erased and the terminal restored before the process stops, and `fg` draws the frame again and the question goes on. On a stdin that is not the process's own terminal, such as one an embedding host gives `processHandle`, Ctrl-C and Ctrl-\ still cancel the run with 130 and Ctrl-Z does nothing. See [Leaving a question](docs/libs/prompts.md#leaving-a-question).
- Add suspend and resume to live regions: Ctrl-Z erases the open regions and shows the cursor before the process stops, and `fg` redraws them. See [Raw-mode readers](docs/core/signals.md#raw-mode-readers).
- Fix the background query so that Ctrl-C, Ctrl-\, or Ctrl-Z during its wait ends the wait at once instead of waiting up to a second for a terminal that does not answer, and so that a signal that ends the process during the wait leaves the terminal cooked.

- Add providers: typed values, such as a database pool or a session, that an action opts in to and reads under `provided`. Core builds them when the action is about to run and closes them when it settles. See the [providers reference](docs/core/providers.md).
  - Declare one with `provider(name, definition)` and annotate it `Provider<Name, Value, Globals, Lifetime, Uses>`. Its lazily loaded module's default export types itself as `Opener<typeof provider>`, and the opener reads the validated global options the annotation names, the values of the providers it uses, the host, `log`, the signal, and `onShutdown`.
  - Opt in through `uses` in `new Command(name, options)`, or in `new Application(name, options)` for the root's own action. Opting in adds the global options the providers read to the Command's global requirements, and `command()` passes a child's requirements up to its parent, so an Application that does not declare them fails to compile where it attaches the Command. A plugin's `commands` accepts a Command that requires that plugin's own options.
  - An `'ephemeral'` value, the default, lasts one run. A `'persistent'` value lasts the outermost run and is shared by every nested `invoke`, so an MCP server's tool calls share one pool.
  - Core closes each value through the provider's `close`, else `Symbol.asyncDispose`, else `Symbol.dispose`, in reverse build order. A failing opener or close takes the ordinary failure path. A close that fails on a run that already failed is logged as `A provider's close failed.`
  - Two different providers with one name anywhere among the providers a `uses` list reaches are rejected: by the types when their types differ, and as a declaration fault, `@loomcli/core/provider-name-taken`, when they share one type. A package that exports a provider prefixes its name with its own.

- Add a keyboard to `mockProcess`: `terminal.keys` puts stdin on the mock's terminal, so a test answers questions in its own process. Each entry is what the operator types while one reader holds the keyboard, handed over each time a question opens or a run resumes after Ctrl-Z. Ctrl-C, Ctrl-\, and Ctrl-Z raise their signals on the mock's own signal source, so Ctrl-C at a question ends the run with 130. The mock answers core's background query at once as a terminal that reports no background, and a switch to raw mode with no entry left fails the run with `mockProcess has no keys left for this read. Add an entry to terminal.keys.` The types make `keys` and piped `stdin` exclusive, and `MockStdin` types the mock's `stdin` with `isTTY` and `isRaw`. See the [testing reference](docs/libs/testing.md#mockprocess).
- Add `width(text)` to `@loomcli/core`, which counts the columns of text a stream received with the measure core renders with: it skips every terminal control sequence and counts the rest as the view context's `width` does. See [Measuring written text](docs/core/styles.md#measuring-written-text).
- Add `validationOptions(process, context)` and the type `ValidationOptionsContext` to `@loomcli/core`, which build the options a run passes to a validator in the `default` or `invocation` phase over a process handle, so a test calls a validator that reads its validation context, such as `path()` or `dateTime()`, with no Application. The [`@loomcli/validators/context-outside-run`](docs/core/diagnostics.md#loomclivalidatorscontext-outside-run) diagnostic now names it as the way to call such a validator alone. See [Validation options outside a run](docs/core/validation.md#validation-options-outside-a-run).

- Add five context builders to `@loomcli/testing`, so a test calls one author function with a context and assembles no Application: `actionContext` for an extracted action handler, `middlewareContext` for a middleware, `failureHookContext` for an `onFailure` hook, `providerContext` for a provider's opener, and `viewContext` for a view or a row view. Each infers its types from the function, such as a handler typed `ActionHandler<typeof get>`, and returns the context that function takes. See [Testing one function alone](docs/libs/testing.md#testing-one-function-alone).
  - The test states the function's inputs whole, typed as its context types them, such as an action's `args`, `options`, and `provided`. No default, validator, or input source runs, and the types reject a missing input and a key the context does not have.
  - Every other member is optional. `out` and `log` are stated member by member, and an unstated function that returns nothing does nothing. `out.draw` resolves `0`, `out.region()` answers a region that is not live, the signal never aborts, and `out.fatal` throws `FatalError`.
  - An unstated `next`, `invoke`, or view measure throws or rejects when called, and any other unstated member, such as `host`, throws when read, with a sentence that names the member and tells the test to state it, such as `actionContext has no host. Add host to its values.`
  - An unstated `style` answers every name with a style that returns its text unchanged, the same function on every read, so a test spies on the names its function asks for.
  - The types `ActionValues`, `MiddlewareValues`, `FailureHookValues`, `ProviderValues`, and `ViewValues` name what each builder takes.

- Add `mcp install`, `mcp uninstall`, and `mcp config` to the `mcp()` plugin. `install` registers the application's MCP server with Claude Code and Codex through each agent's own command-line interface, `uninstall` removes it, and `config` prints a client configuration for an agent that has no such interface. The `mcp` Command still serves when no child is named.

- Add `exclude` to `invoke`'s options, a list of declared option names the call leaves out of its run. No tier supplies an excluded option, so a variable or a configuration key bound to it is never read, it takes its declared default, a key of `options` that names it is an unknown option, and a name the routed Command's table does not hold is an unknown option too. The exclusion lasts for the one call.
- Add `mcpInput({ exclude: true })`, which keeps one option off an application's MCP tools while help, the manifest, and completion still show it. The server passes every excluded option under `exclude` on each tool call, so the action reads the declared default. An option group that holds an excluded option constrains the tool's schema through its other members, so a `oneRequired` group requires one of the options the tool lists. A required local option that is excluded, a `oneRequired` group whose every member is excluded, and a `requiredTogether` group that excludes some members are the `@loomcli/plugins/mcp/required-input-excluded` build fault.
- Fix an MCP tool schema that dropped a `oneRequired` or `requiredTogether` group's constraints when a member carried only an `mcpInput({ description })` value.

- Change how `loom init` handles a directory that is neither empty nor inside a package. At a terminal, init asks to create a `package.json` there and then scaffolds the directory. Off a terminal, or when declined, it fails and says to create one with `npm init -y`, or the package manager's equivalent. See [loom init](docs/toolchain/init.md).
- Change every `loom` command's failure for a `package.json` it cannot read. The failure now names the file's path, the line and column where the JSON breaks, what JSON needs there, and the fix, on Node and Bun alike. Init checks `package.json` before it asks or writes anything, so an unreadable manifest, or one that names no application when a piece needs the name, leaves the package untouched.
- Fix `loom init` and `loom build` reading a `bin` written as an array, such as `["dist/main.js"]`, as an application named `0`. Such a `bin` names no application, so init fails before it writes and says to set the name.

- Add `raiseInterruptKeys(context, text)` and the `InterruptKeys` type to `@loomcli/core`, for an action that reads keys in raw mode. It raises the signal each Ctrl-C, Ctrl-\, and Ctrl-Z in `text` stands for on the run's signal source, in arrival order, so a key means in a picker what it means at the shell, and answers whether the process is `'ending'` or `'suspending'` and the `rest` of the text. See [raw-mode readers](docs/core/signals.md#raw-mode-readers).

- Add the `postInstall` option to `new Application(name, options)`, which declares a post-install `command`, as argument words, and a post-install `message` for the installer script. `inspect()` reports it as `CommandGraph.postInstall`, and `@loomcli/core` exports its type as `PostInstall`. A development `inspect()` and `run()`, `check()`, and `assertAssembles` report `@loomcli/core/post-install-unrouted` when the words route to no Command with an action. See [the post-install declaration](docs/core/application.md#the-post-install-declaration).
- Add the post-install step to the `install.sh` that `loom init` renders. Init now loads the application module on every run that writes `install.sh` and reads the Application's `postInstall` from its graph, so a module init cannot load, or one that exports no Application, leaves `install.sh` unwritten with a warning, and a declaration fault prints its Developer Diagnostic and fails init. Once the binary is installed and recorded, the script announces and runs the post-install command with the operator's terminal as its stdin when there is one and `/dev/null` otherwise, warns and still exits 0 when the command fails, skips it under `--skip-post-install`, and prints the post-install message last. An application that declares neither gets the same script as before. See [the installer script](docs/toolchain/install.md#the-post-install-command).

- Add `out.text(data, view)`, which returns the text `out.render(data, view)` would write at that moment, resolved for the same destination with its styles, color depth, live `columns`, and the application's override, and writes nothing. A view that throws makes the call throw that value. In `@loomcli/testing`, an `actionContext` or `middlewareContext` whose `out.text` the test did not state throws a sentence asking for it. See [a view's text without a write](docs/core/output.md#a-views-text-without-a-write).
- Add the `paging` setting to `help(settings?)` in `@loomcli/plugins/help`, exported with its type `HelpSettings`. With `help({ paging: true })`, a help page that holds at least as many lines as the terminal has rows goes to the operator's `PAGER`, `less` when it is unset, run through `/bin/sh -c` behind `exec` with `LESS=FRX` when `LESS` is unset, on a stdout terminal whose `TERM` is set and not `dumb`, outside CI. An empty or `cat` `PAGER` turns paging off, a pager that cannot start leaves the page printed as before, the run exits 0 whatever the pager exits with, and Ctrl-C ends the pager with the run. Without the setting, every page prints as before. See [help paging](docs/plugins/help.md#help-paging).

### Fixes

- Fix `loom` commands that ran on after an ending signal. `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGQUIT` now stop the git, pnpm, and Bun children `loom` starts, and the command with them, so `loom changelog write` and `loom init` stop before they write, and `loom release cut` leaves no lock or release stage behind. A cancelled command prints nothing and exits 129, 130, 131, or 143.

- Change when a live region an action leaves open closes after the action throws: it closes with `'failure'` as the action settles, before the action's provided values close and before its middleware unwinds, where it used to stay open until the chain had unwound. A middleware that catches the action's failure now finds the action's regions already closed, and the action's last frames reach scrollback above those of the regions a middleware or a configuration source opened, as they already did when the action returned.

- Fix keys typed with Ctrl-Z during the background query reaching the action after `fg`. A raised interrupt key now flushes the typeahead read with it, as a cooked terminal discards the input still unread.

- Fix progress lines and other live regions redrawing in place on a terminal that cannot move its cursor. When stderr is a terminal and `TERM` is `dumb`, as in Emacs `M-x shell`, or `CI` is set, nonempty, and not `false`, a region opened without `input: true` reads `live` as `false`, so a progress line writes its plain start and end lines, `out.draw` keeps the Application's `terminalControls` setting, and a signal that ends the run writes no show-cursor sequence unless the Application preserves controls. A question still asks. See the [live region](docs/core/output.md#live-region) rules.
- Fix update notices staying off under `CI=false`. The self-update plugin now reads `CI` as ci-info does, so `CI=false` says the run is not CI and notices show as usual.

- Fix questions waiting for an answer in CI. A run whose `CI` is set, nonempty, and not `false` is not interactive, even when a CI runner gives it a terminal, so a question takes its supplied linked option or fails with the error that names the option to supply, and a `required: 'non-interactive'` option is required. `CI=false` asks as before. See [Interaction](docs/core/interaction.md).

- Fix `createValidator` inferring `Output | undefined` when `parse` returns `{ issues }` or `{ value }` from one expression, such as a ternary, under a tsconfig without `exactOptionalPropertyTypes`, the one `loom init` writes included. The output type is now the `value` of the accepted branches, so a required argument's validated value types as the value alone, and a stated `createValidator<Output>(...)` still checks `parse` against it. See [createValidator](docs/libs/validators.md#createvalidator).

- Fix color, hyperlinks, and the background query on a CI terminal. Under CI, read as ci-info reads `CI`, a terminal takes automatic color only where supports-color expects the CI system's log viewer to render it: truecolor on GitHub Actions, Gitea Actions, and CircleCI, 16 colors on Travis CI, AppVeyor, GitLab CI, Buildkite, Drone, and Codeship, and none on any other CI. Automatic hyperlinks are off, and core sends no background query, so a run no longer waits on a terminal that never answers. `FORCE_COLOR`, `NO_COLOR`, and `--color` keep their precedence. See [Styles](docs/core/styles.md).

- Fix a view's throw that the action or a middleware lets propagate, or that no code awaited, skipping the translators. A view that calls a library whose error the application translates, such as a date library's `RangeError`, now reports the translated failure with its exit code instead of a defect with exit 1, as every other throw from the application's own work does. See [the ordinary failure path](docs/core/failures.md#the-ordinary-failure-path).

## v0.15.0 - 2026-10-22

This release moves author guidance into types, lint rules, and an assembly test. Install `@loomcli/eslint-plugin` for oxlint or ESLint and call `assertAssembles` from `@loomcli/testing` in the application’s test runner. `loom init` writes these files for new applications. Existing applications must replace `loom check` in their scripts and CI, as the migration below describes.

Loom trusts application code: a caught failure stays caught, declarations can repeat or nest without the removed limits, and values that bypass TypeScript get no special runtime rules. Parser checks and the checks Loom’s projections need remain. A closed stdout pipe now ends silently with exit code 141.

Review the breaking migrations before upgrading, especially argument config keys, `views()` defaults, dotenv’s `variables` setting becoming `only`, and Windows build targets and install paths. Keep all installed `@loomcli` packages at the same exact version, `0.15.0`. The [documentation map](docs/README.md) routes to the SDK, plugin, library, and toolchain references.

### Breaking Changes

- Remove `checkPluginSettings` and `checkShortSetting` from `@loomcli/core`. A plugin factory's typed settings already reject what they judged, and every first-party plugin stops calling them.

### Migration

**Affected surface.** A third-party plugin that imports `checkPluginSettings` or `checkShortSetting` from `@loomcli/core`.

**Why.** Each check judged a value that the plugin factory's settings type already rejects at compile time, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md), so core no longer exports them.

**Before and after.**

Before:

```ts
import { checkPluginSettings, plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  checkPluginSettings(settings, { call: 'notes', plugin: '@acme/notes' });
  return plugin('@acme/notes', { options: notesOptions(settings) });
}
```

After:

```ts
import { plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  return plugin('@acme/notes', { options: notesOptions(settings) });
}
```

**Steps.**

1. Delete each call to `checkPluginSettings` or `checkShortSetting`.
2. Remove both names from the `@loomcli/core` import.
3. Type the factory's settings parameter, such as `short?: NonNullable<BooleanOption['short']>`, so the compiler rejects a value the check rejected.

**Validation.** Run `tsc --noEmit` in the plugin package, and run its tests.

- Change the `default` option of `views()`, on a Command, on the Application, and on the Command a lifecycle hook receives, to take one of the keys the same call supplies, so a misspelled default is a compile error. `@loomcli/core/unknown-default-view` goes.

### Migration

**Affected surface.** TypeScript code that passes `views()` a `default` naming a view the same call's record does not supply, such as a view an earlier `result()`, `rows()`, or `views()` call declared.

**Why.** A `views()` default is typed from the record the call supplies, so a misspelled view name fails to compile in place of failing at attach.

**Before and after.**

Before:

```ts
const listed = paths.views({}, { default: 'table' });
```

After:

```ts
const listed = paths.views({ table: table({ columns: ['path', 'kind'] }) }, { default: 'table' });
```

**Steps.**

1. Find each `views()` call whose `default` names a view the call's own record does not hold.
2. Supply that view again in the same call's record, or declare the views in the order that makes the wanted view the first key.

**Validation.** Run `tsc --noEmit` in the application, and run its tests.

- Change a failure that author or plugin code catches to be final, under [ADR-0097](docs/decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The run's outcome is what the outermost middleware settles with, or the action when no middleware wraps it:
  - A middleware that catches the action's failure, or the held fault the dispatch boundary raises, and returns now exits 0 in place of the caught failure's code.
  - An action or a middleware that awaits an `out.render`, `out.draw`, lane, or region call and catches its view's rejection now exits 0.
  - An action that catches the rejection of a second `out.results` call now exits 0. A second call no code awaits still fails the run with exit 1.
  - A second `next()` call, or one after the middleware returned, still rejects and dispatches nothing. A middleware that catches the rejection decides the outcome, and core no longer reports it after the outcome. A misuse call no code awaits or attaches to still fails the run with its `@loomcli/core/next-misuse` defect.
  - A throw while a middleware unwinds, after its `next()` settled, is that middleware's failure, with its own class and exit code, and a translator is offered it, in place of an internal error reported after the earlier outcome.
  - A view failure or a row source failure in a call no code awaited still fails the run after the chain settles, now with the failure's own exit code. A thrown failure class keeps its code in place of 1, and a view's throw reports as `@loomcli/core/foreign-throw`. A middleware that never observes its `next()` takes the rejection as its own outcome.
  - A cancelled run still resolves 130, 141, or 143 when code catches the cancellation.

### Migration

**Affected surface.** A middleware or an action that catches a failure, a view's rejection, or a second `out.results` rejection on purpose and relies on the caught failure still deciding the exit code. A middleware that throws while unwinding and relies on the earlier failure's code.

**Why.** A caught failure is the code's to decide, as JavaScript defines `try`, `catch`, and `finally`, so a deliberate retry, fallback, or recovery is no longer overridden by core.

**Before and after.**

Before, the run exited 1 because core recorded the caught failure:

```ts
const middleware: Middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.warn(`The command failed: ${String(error)}`);
  }
};
```

After, the middleware rethrows the failure so the run still exits with its code:

```ts
const middleware: Middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.warn(`The command failed: ${String(error)}`);
    throw error;
  }
};
```

**Steps.**

1. Find each `catch` around `next()`, `out.render`, `out.draw`, a lane call such as `out.info`, a region's `draw`, or `out.results` in a middleware or an action.
2. Where the caught failure must still decide the exit code, rethrow it, or throw a failure class with the code you want.
3. Where a middleware throws in a `finally` or after `await next()`, expect that throw's class and exit code to be the run's outcome.

**Validation.** Run the application's tests, and run the affected commands with a failing action or view to check that each exits with the code you expect.

- Change `ResultError.kind` and `ResultFault` to `'missing' | 'repeated'`. The `undeclared`, `middleware`, and `source` kinds go, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the types give `out.results` no value it accepts on a Command with no result, in a middleware, and in a configuration source, and a JavaScript call there throws a plain `TypeError`.

### Migration

**Affected surface.** Code that compares `ResultError.kind` or a `ResultFault` value with `'undeclared'`, `'middleware'`, or `'source'`, or that constructs a `ResultError` with one of them.

**Why.** Each kind reported a call the types already reject, so core no longer raises it.

**Before and after.**

Before:

```ts
if (failure instanceof ResultError && failure.kind === 'middleware') {
  return 'A plugin wrote a result.\n';
}
```

After, the branch is deleted, because no failure carries that kind.

**Steps.**

1. Delete each branch on `'undeclared'`, `'middleware'`, or `'source'`.
2. Construct a `ResultError` with `'missing'` or `'repeated'` alone.

**Validation.** Run `tsc --noEmit` in the application, and run its tests.

- Remove `loom check`, under [ADR-0099](docs/decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md). The `loom` bin's commands are `build`, `changelog check`, `changelog write`, and `init`. An application checks its types with `tsc --noEmit`, its source with a linter, and its assembly with a test that passes the Application to `assertAssembles` from `@loomcli/testing`.

### Migration

**Affected surface.** Applications whose scripts, CI, or tooling run `loom check`, which now fails as an unknown command.

**Why.** Each job of `loom check` already belongs to a standard tool: `tsc` checks types, a linter guides the source, and a test runner verifies that the application assembles, in watch mode while the author works and in CI. The assembly check now runs as a test, so the author's own test runner runs it.

**Before and after.**

Before, in `package.json`:

```json
{ "scripts": { "check": "loom check" } }
```

After, with oxlint and `bun test`:

```json
{ "scripts": { "check": "tsc --noEmit && oxlint src && bun test" } }
```

Before, nothing tested the assembly. After, add `src/application.test.ts`, which imports the application module:

```ts
/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { application } from './application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

Under vitest, import `test` from `vitest` instead of `bun:test`, and run `vitest run`.

**Steps.**

1. Add the development dependencies. `@loomcli/testing` takes the same exact version as `@loomcli/core`. The test runner is Bun's own `bun test` with `@types/bun`, or `vitest`. To lint with Loom's rules, add `@loomcli/eslint-plugin` at the same exact version, and the linter: `oxlint`, or `eslint` with `typescript-eslint`. For example, with pnpm, oxlint, and `bun test`: `pnpm add --save-dev --save-exact @loomcli/testing@<version> @loomcli/eslint-plugin@<version> oxlint @types/bun`.
2. Add the test above to the application as `src/application.test.ts`, importing the Application the entry runs.
3. Replace each `loom check` call in scripts and CI with `tsc --noEmit`, the linter, and the test runner, or with `pnpm run check` when the script holds them.
4. Load the lint rules. In a package with no lint configuration, run `loom init --only lint`, which writes `.oxlintrc.json` or `eslint.config.js` from `@loomcli/eslint-plugin`. A package that already holds a lint configuration gets nothing from `loom init --only lint`, because init never overwrites a file, so add the plugin to that configuration as the [plugin reference](docs/libs/eslint-plugin.md#install-and-configure) shows.
5. Remove the `--application` option from any `loom check` call. The test imports the module itself.

An ESLint package on TypeScript 7 also needs the side-by-side install of the [plugin reference](docs/libs/eslint-plugin.md#eslint), because typescript-eslint does not support TypeScript 7: `typescript` aliased to `npm:@typescript/typescript6@^6.0.2` and the compiler installed as `@typescript/native`, so `tsc` stays on TypeScript 7.

**Validation.** Run `pnpm run check`, or `tsc --noEmit`, the linter, and the test runner it holds one after another, and confirm that each exits 0 and that the test runner reports the assembly test as passed. Run `grep -rn "loom check" package.json .github` and confirm that it prints nothing. Run `pnpm loom --help` and confirm that it lists `build`, `changelog`, and `init` and no `check`.

- Change `completion install`, `completion update`, and `completion uninstall` to serve `bash`, `zsh`, `fish`, and `pwsh` on Linux and macOS alone, under [ADR-0101](docs/decisions/0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md). On Windows each exits 1 with `<app> completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with <app> completion powershell and load it yourself.`, naming the print Command of the shell asked for. `completion powershell` still prints the PowerShell script.
- Remove `powershell`, Windows PowerShell 5.1, as a shell `install` and `uninstall` take, with its `completion.powershell.json` record file. `install` with `SHELL` unset no longer picks a PowerShell edition from `PSModulePath`, and the plugin reads no `LOCALAPPDATA` or `USERPROFILE`, checks no execution policy, and reads or writes no UTF-16LE startup file.

### Migration

**Affected surface.** Applications that install `completion()` and whose operators ran `completion install` on Windows, or ran `completion install powershell` or `completion uninstall powershell` anywhere, including in documentation or scripts the application ships.

**Why.** No CI job runs Windows, so the Windows install paths ran only under a faked platform, and support that no CI entry runs is not shipped, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md).

**Before and after.**

Before, on Windows:

```powershell
notes completion install powershell
```

After, on Windows, the operator loads the printed script from `$PROFILE` with this line:

```powershell
notes completion powershell | Out-String | Invoke-Expression
```

After, on Linux and macOS, PowerShell 7 installs as `pwsh`:

```sh
notes completion install pwsh
```

**Steps.**

1. Replace `completion install powershell` and `completion uninstall powershell` in the application's documentation and scripts with `completion install pwsh` and `completion uninstall pwsh` for Linux and macOS.
2. Tell Windows operators to add the `completion powershell` line above to `$PROFILE`, and to remove the line an earlier release added there, which ends with `# added by <app> completion install`.
3. Tell Windows operators that the script an earlier release wrote under `%LOCALAPPDATA%\<app>\completion\` and its record file under `%LOCALAPPDATA%\<app>\installation\` are no longer read, and that they may delete both.

**Validation.** On Linux or macOS, run `<app> completion install pwsh` and confirm that it exits 0, and run `<app> completion install powershell` and confirm that it exits 2 and lists `bash, zsh, fish, pwsh`. On Windows, open a new PowerShell session and confirm that Tab completes the application's Commands.

- Remove the `bun-windows-x64`, `bun-windows-x64-baseline`, `bun-windows-x64-modern`, and `bun-windows-arm64` targets from `loom build`, with their `.exe` output and asset names, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md). Each is now an option error that names the targets. On a Windows host, `--target` has no default, so a run without one fails with `Bun compiles for no target on this host (bun-win32-x64), so pass --target.` and exit 1.

### Migration

**Affected surface.** Packages whose scripts or CI run `loom build --target bun-windows-<arch>`, or run `loom build` without `--target` on a Windows host.

**Why.** No CI job runs the Windows binary these targets built, and support that no CI entry runs is not shipped.

**Before and after.**

Before:

```sh
loom build --target bun-windows-x64 --release
```

After, Bun compiles the Windows binary directly. The facts of a bundle name no release asset, so `self-update` does not replace that binary:

```sh
bun build src/main.ts --compile --target bun-windows-x64 --outfile dist/notes.exe \
  --define "$(loom build --target node --release --define)"
```

**Steps.**

1. Replace each `loom build --target bun-windows-<arch>` call with `bun build --compile --target bun-windows-<arch>`, as above.
2. On a Windows build host, pass `--target` to every `loom build` call, such as `--target node`.
3. Remove `.exe` assets from release automation that expected `loom build` to name them.

**Validation.** Run `loom build --target bun-windows-x64` and confirm that it exits 2 and names the targets. Run the replacement `bun build` command and confirm that it writes `dist/notes.exe`.

- Change `applicationDirectory` on `win32` to resolve the `installation`, `logs`, and `cache` directories from `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `HOME`, as on Linux, in place of `%LOCALAPPDATA%\<app>\installation\`, `Logs\`, and `Cache\`, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md). When the XDG variable gives no absolute path and `HOME` is unset, the answer is `{ variable: 'HOME' }`.
- Change the configuration, logging, skills, completion, and manpage plugins to read the home folder from `HOME` on every platform. They no longer read `USERPROFILE` on `win32`.
- Allow `manpage install`, `manpage update`, and `manpage uninstall` on `win32`, where each resolves its folder from `HOME` as on other platforms, in place of refusing `install` and skipping `update` and `uninstall`.
- Change core on `win32` to choose main glyph forms unless `TERM` is `linux`, to run the background query under the same rules as elsewhere, and to resolve a content operand with the running process's `node:path`, with no Windows exception for a stdin alias.

### Migration

**Affected surface.** Applications run on Windows that read `applicationDirectory`, write logs to the logging plugin's default directory or to a `~/` file, read a configuration file from the home folder, or install skills or man pages, and Windows operators whose environment sets `USERPROFILE` and no `HOME`.

**Why.** No CI job runs Windows, so these branches ran only under a faked platform, and support that no CI entry runs is not shipped, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md).

**Before and after.**

Before, on Windows, the installation record lived at:

```text
%LOCALAPPDATA%\notes\installation\
```

After, it lives where Linux keeps it, under `XDG_STATE_HOME` when that is an absolute path:

```text
%XDG_STATE_HOME%\notes\installation\
%HOME%\.local\state\notes\installation\
```

Before, a Windows operator's home configuration file was `%USERPROFILE%\.notes.toml`. After, it is `%HOME%\.notes.toml`.

**Steps.**

1. Tell Windows operators to set `HOME` where it is not already set, for example with `setx HOME "%USERPROFILE%"`.
2. Tell Windows operators to move a home configuration file, a log file, or an installation record from its `%USERPROFILE%` or `%LOCALAPPDATA%` path to the path above, or to delete it.
3. Where the application's own code read `USERPROFILE` to agree with Loom's folders, read `HOME` instead.

**Validation.** On Windows, with `HOME` set, run the application with a home configuration file at `%HOME%\.<file>` and confirm that it reads the file. Call `applicationDirectory('installation', name, host)` and confirm that it answers a path under `XDG_STATE_HOME` or `%HOME%\.local\state`.

- Change `dotenv()` to import every variable `.env` defines that the process has not set when it takes no settings, as the `dotenv` package, Node's `--env-file`, and Bun do, under [ADR-0102](docs/decisions/0102-dotenv-imports-every-variable-the-process-has-not-set.md).
- Add `dotenv({ only })`, an allow list that imports only the names it lists, and `dotenv({ except })`, a deny list that imports every name but the ones it lists. One call that gives both is a compile error.
- Change a single-quoted value in `.env` to span physical lines as a double-quoted one does, keeping every character with no escape, so a multi-line private key reads as one value. An unterminated single quote consumes the rest of the file and warns once for its starting line.
- Remove the `variables` setting, and replace `@loomcli/plugins/dotenv/variables` with `@loomcli/plugins/dotenv/variable-name`, which rejects a listed name that is not an environment variable name. A name listed twice, and an empty list, are no longer faults.

### Migration

**Affected surface.** An application that calls `dotenv({ variables })` from `@loomcli/plugins/dotenv`, or that builds a `DotenvSettings` value with a `variables` key.

**Why.** The allow list is optional now that the plugin imports every variable by default, and it takes the name `only` beside the deny list `except`. A JavaScript application that keeps `dotenv({ variables })` gets no type error and no run-time fault: the plugin reads no `variables` key, so it now imports every variable `.env` defines.

**Before and after.**

Before:

```ts
const app = new Application('notes', {
  plugins: [dotenv({ variables: ['NOTES_TOKEN'] })],
});
```

After:

```ts
const app = new Application('notes', {
  plugins: [dotenv({ only: ['NOTES_TOKEN'] })],
});
```

**Steps.**

1. Search every `dotenv(` call for a `variables` key, in TypeScript and JavaScript sources alike, because a JavaScript call that keeps one fails nowhere.
2. Rename each `variables` setting passed to `dotenv()` to `only`.
3. To import every variable `.env` defines, remove the setting and call `dotenv()`.

**Validation.** Run the application's type check, which rejects a remaining `variables` key in TypeScript, search the sources for `variables` beside `dotenv(` once more, and run a command that reads an imported variable from a `.env` file in the working directory.

- Change `argument()` on a `Command` and on an `Application` to reject, at compile time, every config key that `ArgumentConfig` does not declare, such as `hidden`, `deprecated`, `multiple`, `env`, `control`, `aliases`, `short`, and `implied`. Core reads none of them on an argument, so a config that set one compiled in 0.14.0 and had no effect.

### Migration

**Affected surface.** Applications and plugins that pass a key `ArgumentConfig` does not declare in the config of `Command.argument()` or `Application.argument()`.

**Why.** Core reads only the keys `ArgumentConfig` declares from an argument. The types now reject the rest, as they already did on the attached Command a lifecycle hook receives.

**Before and after.**

Before, this compiled and had no effect:

```ts
new Command('get').argument('path', { description: 'A path.', multiple: true });
```

After, remove the key:

```ts
new Command('get').argument('path', { description: 'A path.' });
```

**Steps.**

1. Find each `argument()` call that fails with `An argument declares no <key> key`.
2. Remove the key. To read many values, declare the argument `variadic: true`. To bind an environment variable or another option-only behavior, declare an option in place of the argument. To hide or deprecate the work an argument belongs to, set `hidden` or `deprecated` on its Command or on an option.

**Validation.** Run `tsc --noEmit` and confirm that no argument declaration reports the message. Run the application's tests, which behave as before because none of these keys ever had an effect.

### Features

- Allow a Command path to nest to any depth. `command()` attaches a child at any level, and routing, validation, help, completion, the manifest, MCP, and man pages serve the path. `@loomcli/core/nesting-depth` goes, under [ADR-0094](docs/decisions/0094-core-sets-no-structural-limit-and-a-projection-reports-its-own-limits.md).

- Allow a declared default to nest as deep as the author writes it. `@loomcli/core/default-depth` goes, and core no longer freezes a copy of a default: the graph and the default's validator read the value the author declared, and each invocation still receives its own copy of an array default.

- Allow any string as the identity of `plugin()`, `extension()`, and `view()`, and as a hand-built descriptor's identity. The package-name grammar is a naming convention, under [ADR-0096](docs/decisions/0096-the-identity-grammar-is-a-naming-convention.md), and `@loomcli/core/invalid-identity` goes. An identity installed twice, and two distinct descriptors or declared views under one identity, stay declaration faults, and `diagnosticRule()` keeps its rule-identity check.

- Allow a line break in a description or a deprecated message. Help, the manifest, MCP, man pages, shell completion, and the service unit print the text on one line and read each line break in it as a space, and a blank description prints as written. `@loomcli/core/not-one-line` goes.

- Allow an optional argument after another optional one. Bare words fill optional arguments left to right, and an argument that receives no word is omitted. `@loomcli/core/optional-argument-last` still rejects a required argument after an optional one.

- Allow a repeated declaration of one thing, which resolves instead of failing:
  - An option alias that repeats the option's name, another of its aliases, or a spelling the option already accepts adds nothing, and an `env` list that names one variable twice binds it once.
  - A Command alias that repeats its own name or another of its aliases adds nothing.
  - A signal claimed twice is claimed once.
  - A second value of one extension in one layer replaces the first whole, as a value in a later layer does.
  - A second override of one key in one contributor loses to the first, as overrides across contributors do.

  This removes `@loomcli/core/repeated-alias`, `@loomcli/core/signal-claimed-twice`, `@loomcli/core/extension-value-twice`, and `@loomcli/core/override-twice`. Two different declarations that collide, such as two options with one spelling or two plugins with one identity, stay declaration faults.

- Allow a configuration source binding that its plugin does not list under `extensions`. Core admits the binding's descriptor itself, and `@loomcli/core/source-binding` goes.

- Add `@loomcli/eslint-plugin`, the lint rules that guide an application author where a type cannot, under [ADR-0098](docs/decisions/0098-lint-is-the-author-guidance-lane.md). The plugin is ESLint-compatible, and oxlint loads it through `jsPlugins`. It ships three rules, `@loomcli/undescribed`, `@loomcli/discarded-declaration`, and `@loomcli/name-shape`, with a `recommended` flat config for ESLint and an `oxlint` config for `.oxlintrc.json`. See the [plugin reference](docs/libs/eslint-plugin.md).
- Export `isPortableName` and `isDeclaredName` from `@loomcli/core`. They are the predicates behind core's portable-name and declared-name rules, so a tool that checks a literal name judges it as core does.

- Add the assembly test, the lint configuration, and a `check` script to `loom init`. A new scaffold gets `src/application.test.ts`, `.oxlintrc.json` or `eslint.config.js`, a `check` script that runs `tsc --noEmit`, the linter, and the test runner, and `@loomcli/testing`, `@loomcli/eslint-plugin`, and the linter and test runner packages as development dependencies. `--linter oxlint|eslint` and `--test-runner bun|vitest` choose the tools, by default oxlint and Bun, and `--only` accepts `test` and `lint`. An existing oxlint or ESLint configuration file, a `vitest` dependency, or an `@types/bun` dependency selects its tool, and at a terminal init asks only when nothing does, so a re-run of a scaffold asks nothing. Init never overwrites an existing file or key, and it writes no `.oxlintrc.json` beside an `.oxlintrc.jsonc`, `oxlint.config.ts`, or `oxlint.config.mts`, because oxlint refuses to run with two. See the [toolchain reference](docs/toolchain/init.md).
- Add the side-by-side TypeScript install to an ESLint scaffold. It writes `typescript` as `npm:@typescript/typescript6@<range>` and the compiler as `@typescript/native`, because typescript-eslint does not support TypeScript 7 yet, so `tsc` stays on TypeScript 7. A package that already declares `typescript` as anything else keeps it, and init warns that `eslint .` fails there and links the [plugin reference](docs/libs/eslint-plugin.md#eslint).

- Add `@loomcli/testing`, which ships `assertAssembles(application)`. A test under `bun test` or vitest calls it with the Application. It returns when the application assembles, and otherwise throws an `Error` whose message is the Developer Diagnostic of each fault `Application.check()` returns, in order, with the fault list as its `cause`. The [testing reference](docs/libs/testing.md) describes what it covers.

- Remove `@loomcli/core/undescribed`, under [ADR-0098](docs/decisions/0098-lint-is-the-author-guidance-lane.md). A development `run()` and `app.invoke()` run a graph that holds a Command, an option, or an argument without a description, and `Application.check()` no longer returns the fault. The `undescribed` rule of `@loomcli/eslint-plugin` reports the gap in the editor and in CI.

- Add `isFailureCode` to `@loomcli/core`, which answers whether a value is a failure code in core's kebab-case grammar, so a plugin that lists failure classes, as the manifest does, checks a code against core's grammar instead of a copy.

- Allow `logging({ keep: 0 })`, which keeps no copies: before a write that would take the file past `maxBytes`, the plugin deletes the file and a new one starts, as logrotate's `rotate 0` does.

- Publish `@loomcli/testing` and `@loomcli/eslint-plugin` with the synchronized package set so applications can install the assembly check and lint rules.

### Fixes

- Remove the declaration rules that re-checked what TypeScript rejects at the call, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): `option-type`, `short-alias`, `flag-not-boolean`, `short-only-without-short`, `short-only-with-aliases`, `boolean-option-multiple`, `count-option-multiple`, `polarity-on-count`, `implied-on-boolean-or-count`, `implied-not-a-string`, `polarity-on-string`, `option-polarity`, `short-only-both-polarities`, `global-presence-rule`, `global-option-after-command`, `env-on-multiple`, `env-name`, `env-on-argument`, `omission-already-decided`, `omission-without-validator`, `boolean-option-value-rule`, `count-option-value-rule`, `required-with-default`, `not-a-validator`, `default-shape`, `content-declaration`, `command-globals`, `declared-after-action`, `multiple-actions`, `alias-without-names`, `group-option`, `multiple-results`, `views-without-result`, `view-shape`, `row-view-on-value`, `media-type`, `view-name`, `result-without-action`, `misplaced-listing-fact`, `not-a-list`, `not-a-function`, `not-a-command`, `middleware-activation`, `unknown-signal`, `source-bound-own-option`, `extension-without-schema`, `extension-target`, `override-key`, `translation-key`, `retired-application-option`, `rendering-policy`, `theme-name-taken`, `theme-mapping`, `rule-prose`, and `rule-docs`, each under `@loomcli/core/`. A value that bypasses the types now meets the platform's own error: a value passed to `command()` or listed under a plugin's `commands` that is not a Command throws a plain `TypeError`, and so does a theme entry that is not a style chain.
- Remove `@loomcli/core/not-an-object` and `@loomcli/core/unreadable-declaration`. A declaring call no longer reads its config, options, or definition through a guarded one-time copy, so a getter or proxy that throws reports its own error.
- Change the interaction, color, verbose, quiet, and background marks to check only two marked options in one Application and a configuration binding on a marked option. The types place each mark.
- Change stdin declared on a Command with no action to report `@loomcli/core/command-without-action`.
- Change a schema that does not answer synchronously to report `@loomcli/core/invalid-extension-value`, which replaces `@loomcli/core/async-extension-schema`.
- Change a views record that names no view to fail where the result renders, in place of `@loomcli/core/result-without-views`.
- Change `@loomcli/core/foreign-value` to report a plugin, extension value, view, override, translation, or failure encoding that another installed copy of `@loomcli/core` built, with a correction to install one copy.
- Change `@loomcli/core/portable-name` and `@loomcli/core/declared-name` to judge a name that is a string. A name that is not a string, which the types reject, gets no rule.

- Start applications faster. `@loomcli/plugins` and `@loomcli/loom` no longer depend on zod, so an application that installs the help plugin or any other first-party plugin no longer loads it on every run. They validate their own extension values and files with valibot, and their option and argument validators come from `@loomcli/validators`, which `@loomcli/plugins` and `@loomcli/loom` now depend on. An application that still imports zod itself declares it in its own `package.json`.
- Change the sentence a wrong `completion install` or `completion uninstall` shell and a wrong `skills install` or `skills uninstall` `--agent` draw. The rejection now reads `Expected one of: bash, zsh, fish, pwsh.` and `Expected one of: claude, agents.` where it read `Invalid option: expected one of "bash"|"zsh"|"fish"|"powershell"|"pwsh"` and `Invalid option: expected one of "claude"|"agents"`.
- Change what `loom release record` prints for a release plan file it cannot read: each problem now prints on its own line, led by the key it concerns, such as `publish: Invalid type: Expected boolean but received "yes"`, where it printed a JSON list of every problem. Manifest and registry responses that `loom` cannot read print the same way.

- Fix the completion plugin's `install`, `update`, and `uninstall` under Bun on macOS when they recover an interrupted run whose shell startup file the process may not read. They stopped with `EACCES`; they now finish the recovery, as they do under Node.

- Fix `app <command> | head -1` printing `Something went wrong.` and exiting 1 once the reader closed the pipe. A write to `run()`'s stdout that fails with `EPIPE`, or with `ENOTCONN`, which Bun reports for a socket stdout on macOS, now ends the run, following the `SIGPIPE` convention, under [Signals and cancellation](docs/core/signals.md) and [ADR-0104](docs/decisions/0104-a-closed-reader-on-stdout-ends-the-run-with-141.md):
  - Core aborts the run signal with the `CancellationReason` source `closed-pipe`, whose `cause` is the failed write's error, so a streaming row source or an action that reads `signal` stops as it does on cancellation.
  - The write and every later stdout write reject with the signal's reason, which is silent when the action lets it propagate. Core writes no failure report and no incomplete-result line for the closed pipe and logs no failure event.
  - `run()` resolves 141, and the process exits 141, in a distributed and a development build, under Node and Bun. `ExitCode` and a cancelled `invoke()` outcome's `exitCode` gain 141, and the manifest's `exitCodes` gains its row.
  - The completion plugin's print children and `__complete` write through `out`, so `app completion bash | head -1` ends the same way instead of crashing with an `EPIPE` trace under Node or reporting `Something went wrong.` under Bun.
  - The first cause to abort the run still fixes the code, so a pipe that closes after `SIGINT` keeps 130.
  - A failed stderr write and every other failed stdout write, such as `ENOSPC`, still report a broken destination and exit 1.
  - A translator an author wrote for an `EPIPE` error no longer receives a closed stdout pipe's error, so such a run now exits 141 in place of the translated class's code.

- Change a throw from a plugin's lifecycle hook to take the ordinary failure path, under [ADR-0097](docs/decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md):
  - An `onEnvironment` hook that throws a failure class, such as a `FatalError` subclass, now exits with that class's code and writes its message, in place of an internal error with exit 1.
  - An `onFailure` hook that throws ends the hooks for that failure. Core calls no later hook and writes the failure's default text with no plugin's hints, then the hook's throw as a defect, and still exits 1.
  - An `onLog` hook that throws keeps receiving every later event of the run. Core reports its first throw once after the run's outcome, and the run still exits 1.

- Remove the run-time rules that re-checked what TypeScript rejects, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md) and [ADR-0095](docs/decisions/0095-the-type-bounds-a-declared-exit-code.md): `@loomcli/core/failure-exit-code`, `@loomcli/core/unconstructed-failure`, and `@loomcli/core/broken-output-view`.
  - A failure class's exit code and failure code are read from its class, from the nearest ancestor that declares one, with nothing captured. A JavaScript class that declares a code outside 1 through 125, such as 130, exits with that code, and a static the application rewrites during a run is read as it stands.
  - A value that inherits from a failure class without being constructed reports as that class.
  - A view that throws in a call no code awaited reports as `@loomcli/core/foreign-throw`, as a view throw the action lets propagate already does.
  - A view value that carries both `render` and `row`, or neither, and a view that returns a value that is not a string, get no rule: the platform's own error or `String()` meets them. So does a lane message that is not a string. A failure view that returns a value that is not a string writes what `String()` reads.
- Keep `@loomcli/core/failure-code`, which still rejects a failure code outside its grammar where a failure of the class is constructed.
- Remove the run-time rules for a hook, a translator, or a region call that only re-checked what the types reject or that only a construction built to break the code reaches, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md) and [ADR-0097](docs/decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md): `@loomcli/core/broken-translator`, `@loomcli/core/broken-failure-hook`, `@loomcli/core/broken-log-hook`, `@loomcli/core/log-in-log-hook`, `@loomcli/core/broken-environment-hook`, and `@loomcli/core/region-call`.
  - A throw from a translator or an `onFailure` or `onLog` hook reports as `@loomcli/core/foreign-throw`, with the throw as the defect's cause. An `onEnvironment` hook's throw takes the ordinary failure path: a failure class keeps its class and exit code, and any other throw reports as `@loomcli/core/foreign-throw`. A translator's throw is never offered to a translator.
  - A translator answer, a hook's return, or a region call argument that the types reject, such as a promise, a non-string hint, an `onEnvironment` name with a dash or a value holding NUL, a value from another Command's `onCommandAttach` build, or a negative or `NaN` progress count, gets no rule. A value an `onCommandAttach` hook returns that core never built throws a `TypeError`.
  - `@loomcli/core/broken-graph-hook` no longer reports an `onGraphBuilt` hook that returns a value, and `@loomcli/core/broken-attach-hook` no longer reports an `onCommandAttach` hook that returns a value from another Command's build. Both still report a hook that throws anything but a `DeclarationError`, naming the plugin.
  - A result that iterates neither way throws a `TypeError` that reports as `@loomcli/core/foreign-throw`, in place of its `@loomcli/core/result-contract` defect.
  - A `log` call inside an `onLog` hook is an ordinary call. A log field whose getter throws throws from the call, in place of reading `"[Unreadable]"`. A thrown Error whose message cannot be read and a thrown revoked proxy get no special reading, and a Developer Diagnostic prints every link of a cause chain until one repeats, in place of stopping at eight.

- Change how the completion plugin treats a startup file it may not change, such as a read-only `.bashrc` that a home configuration manager links, under [ADR-0101](docs/decisions/0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md). `install` writes the script, prints the line for the operator to add, or states that the file already loads it, and records no line, dropping any line the record held for that file without writing the file. `update` drops such a line the same way, and prints the line to remove and the line to add in its place only when this version changes the line's text. `uninstall` prints a recorded line for the operator to remove and drops it from the record. A line the operator added by hand, in any startup file, is never recorded: `install` states that the file already loads the script, and `update` and `uninstall` no longer keep, print, or remove the line.
- Change a startup file in an encoding other than UTF-8, with or without its byte order mark, such as UTF-16, into one the completion plugin cannot change.
- Allow a script path or a PowerShell profile path that holds a control character. `completion install` writes the line in place of refusing the path.

- Remove `@loomcli/validators/path-check`, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). The type of `path()`'s options takes `kind` only beside an `access`, so `path({ kind: 'file' })` is a compile error, and an `access` or `kind` outside its set gets no rule.
- Change `path()` to resolve a token with the running process's `node:path`, in place of choosing Windows path rules by `host.platform`.

- Remove the plugin pack's settings checks that re-checked what TypeScript rejects, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A value that bypasses the types meets the platform's own error.
  - `@loomcli/plugins/logging/settings` goes. `logging()` fills its defaults and judges no setting.
  - `selfUpdate()` judges only `notices.env`, and `service()` judges only `label`: an `afterReplace` or `probe` that is not a function, a `notices` that is not a Boolean or an object, and `run` words that are not a list of strings get no rule, and a `run` word with a control character is no longer refused. The graph check that the run words route stays.
  - `skills()` judges only the skill names, and a skill's loaded files only for a path that is absolute or has a `..` segment, which reads `Skill "notes" lists a file path outside its folder: ../notes.md.`, and for a missing `SKILL.md`. A list that is not an array or is empty, an entry that is not a skill, a loaded result that is not a list of files, a path with a backslash, a control character, or an empty segment, and a path listed twice get no rule.
  - The manifest reads a failure class's exit code as the class declares it, under [ADR-0095](docs/decisions/0095-the-type-bounds-a-declared-exit-code.md), with no range check, and judges only its failure code's grammar. A static getter or a proxy that throws is no longer read through a guard.
  - Two man pages whose names differ only in ASCII case, such as `Get` and `get`, no longer fail the build under `@loomcli/plugins/manpage/page-name-taken`. Two Commands that give one page name still do.
- Change the configuration plugin's checks to what a projection or an operator's file needs.
  - `file` and a binding path no longer refuse a control character or a line separator. `file` stays a relative path with no empty, `.`, or `..` segment, and a binding path stays dotted nonempty keys.
  - A YAML file converts through the parser's own `toJS()`. A mapping key that is a mapping or a sequence reads as the text `toJS()` writes for it, in place of making the file not valid YAML, and a scalar key that is not a string reads as `toJS()` writes it, so `0x1F:` reads as `31`. An alias that names no preceding anchor still makes the file not valid YAML, and no parser warning prints.
- Fix `loom build`, which collected at most 64 MiB of Bun's output, so it now collects the whole output, as the toolchain's git calls do.

- Remove the prompts library's checks that re-checked what TypeScript rejects, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A question's settings, `skipIfSupplied` without `option`, a repeated select choice, a select `default` that is not a choice, and a progress line's label, counts, frames, spinner interval, bar cells, updates, and messages get no rule, so `@loomcli/prompts/progress` goes.
  - A select question with an empty `choices` list throws `@loomcli/prompts/link` before it resolves: `The select question "Database" has no choices. Supply at least one choice.`
  - An interactive stdin with no `setRawMode` method throws a `TypeError`, which a run reports as a defect, in place of a `DeclarationError`.

- Remove the validator catalog's checks that re-checked what TypeScript rejects, and its defenses against an author's schema, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): `@loomcli/validators/factory-options`, `@loomcli/validators/pattern-message`, `@loomcli/validators/validator-definition`, `@loomcli/validators/issue-code-config`, and `@loomcli/validators/issue-code-schema`.
  - `oneOf()` judges only a value listed twice. An empty list, a value that is not a string, and an empty string get no rule, and the list is no longer copied at the call.
  - A bound of `integer()` or `number()` is judged only for being finite, so `integer({ min: 0.5 })` is accepted. A `text()` length is a whole number of 0 or more, with no safe-integer limit. A `text()` pattern without its message, and a message without a pattern, are compile errors with no run-time check.
  - `url()` judges only that each protocol is a scheme name. `createValidator()` judges only an `inputSchema` that declares its own `$schema`, and its `validate` reads a value that is not a string as `String()` reads it.
  - `issueCode()` judges only the code's grammar. `issue()` and `read()` call the schema and read its result: a schema that throws throws from them, and a schema that answers with a promise accepts no parameters, so `issue()` throws `@loomcli/validators/issue-parameters`.
  - Validators, their `~standard` props, issue code descriptors, issues, and issue parameters are no longer frozen, and an input schema is no longer copied at the call.

- Remove `@loomcli/core/run-options` and `@loomcli/core/invoke-options`, which re-checked what TypeScript rejects, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
  - A `run()` `signal` that is not an `AbortSignal` meets the platform's own error, which the run reports as a defect.
  - An `invoke()` path, values record, `signal`, `failure` handler, or `onProgress` observer that the types reject meets the platform's own error, as a rejection of the call or as a defect of its run. A `host` field outside the five and a `values` key other than `args`, `options`, and `passthrough` are not read.
- Change a `view` that is not a string, assigned by a middleware or passed to `invoke()`, to report as the view-selection defect for a name the routed Command's result does not hold, or for a view on a Command that declares no result. The sentence for a view that is not a string goes.
- Change a validator's published input schema to the object its converter returned, neither copied nor frozen. A converter answer whose getter throws is no longer a `@loomcli/core/schema-converter-failed` fault: the getter throws where a reader reads it. An answer that holds itself is published as it is.

- Fix `Parameters<typeof command.option>`, and `Reflect.apply(command.option, ...)`, running the type checker out of memory, which hung the editor's TypeScript server instead of reporting a result. The same applies to `option()` and `globalOption()` on an `Application`. A default that does not fit its option's validator input, or its raw tokens, is still rejected with the same diagnostic, and editor diagnostics at an `option()` call are faster.
- Allow a readonly list, such as an `as const` array, as the default of a multiple option or a variadic argument. Core copies a declared list for each run, so the action still receives its own array.

## v0.14.0 - 2026-10-20

0.14.0 fits terminal output to the operator's screen and gives the operator control over it. Every render reads the destination's live width, so the semantic lanes, tables, records, and the help page wrap on a terminal, and a table that cannot fit shrinks its widest columns or falls back to one block per row. The pack adds list, heading, rule, prose, and box views. Optional plugins add `--color` and `--no-color`; `-v`, which shows the new `out.debug` and `out.trace` lines, and `-q`, which hides info and success messages; and `--background`. A theme entry can adapt to a light terminal's background, which core settles once per run. Actions can keep live regions at the bottom of stderr, where `@loomcli/prompts` now draws its questions and new progress lines, and progress events reach `invoke` callers and MCP clients. Off a terminal nothing wraps, tables and records keep their layout, help changes only its Details lists and headings, which now print as the list and heading views do, and each manifest option entry gains its `color`, `verbose`, `quiet`, or `background` field.

Pin the first-party packages together at exactly 0.14.0. The color, verbose, quiet, and background marks give meaning to option keys that earlier releases ignored, so remove any such stray key or move it to the one option that carries it. Run the application's type check: `out.render` now types a records view's formatters from the rows, and data that carries no row type, such as `any` or a helper's type parameter, must state one; an explicit row type argument such as `out.render<Row>(rows, view)` now names the data; a host override annotated `Partial<Host>` moves to `HostOverrides`, and a terminal annotated `Host['terminal']` to `NonNullable<HostOverrides['terminal']>`; and a select `questionFrame` override reads `context.columns`. The migration sections below give each step.

### Breaking Changes

- Remove `columns` from the select `questionFrame` data, which keeps `rows`. The default select view measures its height at the view context's `columns`, stderr's width narrowed by a valid `COLUMNS`, and its compact frame clips at that width, or at 80 columns when `columns` is `undefined`. The select window's visible count and `rows` are read when each frame draws, so a resize reaches the next frame.

### Migration

**Affected surface.** An override of `questionFrame` from `@loomcli/prompts/views` that reads `data.columns` for a select frame, and code that builds select frame data by hand with a `columns` member.

**Why.** A view now reads the width of its destination from `context.columns`, so the frame data no longer carries a second, stale copy of it.

**Before and after.** `clip` stands for the override's own clipping helper.

Before:

```ts
override(questionFrame, {
  render: (data, context) =>
    data.kind === 'select' ? clip(data.message, data.columns ?? 80) : questionFrame.render(data, context),
});
```

After:

```ts
override(questionFrame, {
  render: (data, context) =>
    data.kind === 'select' ? clip(data.message, context.columns ?? 80) : questionFrame.render(data, context),
});
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Replace `data.columns` with `context.columns` in every `questionFrame` override, keeping any fallback width you want for `undefined`.
3. Remove the `columns` member from select frame data your code builds by hand.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's test command. Ask a select question on a terminal narrower than its message, with and without `COLUMNS` set, and check that the frame fits the width.

- Change `out.render` to type a records view written as its second argument from the rows it renders, as a table and `json()` already were and as the new list view is. A `format` callback under `records({…})` received `any` for its value, so a callback that misread its field compiled; it now receives the field's own type over an array, a generator, or an async generator, and a key the rows do not carry is reported on that key. `Out.render` is one signature over both view shapes, `render<Data, Row = never>(data: RenderedData<Data, Row>, view: View<Data> | ([Row] extends [never] ? RowViewOver<Data> : RowView<Row>))`, with `RenderedData` and `RowViewOver` exported from `@loomcli/core`.

### Migration

**Affected surface.** An action or middleware that calls `out.render(rows, records({…}))` with a `format` callback whose parameter type, or whose use of its value, does not match the field's type in the rows. Calls that already typed their callbacks correctly, and calls that state `records<Row>({…})`, are unaffected. Also affected: a call whose data carries no row type, where an unstated `records({…})` or another pack view factory, or a row view written in the call, no longer reads one: data typed `any`, such as the result of `JSON.parse`; data whose type is a helper's type parameter, `<Source extends readonly Row[]>`; and inline literal rows under a row view whose row type is a literal union, such as `out.render([{ variant: 'compact' }], variants)` under a `RowView<{ variant: 'compact' | 'extended' }>`, where the literal widens to `string`. Also affected: a call that passes the row type as `out.render`'s type argument, `out.render<Row>(rows, view)`, which matched the earlier overload over rows; the type argument now names the data.

**Why.** The callback's value was `any`, so the mismatch was a latent bug the compiler could not see. The compiler now checks it, which takes one signature for both view shapes.

**Before and after.**

Before, with `count: number` on each row, this compiled:

```ts
await out.render(rows, records({ identifier: 'source', fields: [{ key: 'count', format: (value: string) => value.padStart(6) }] }));
```

After, the callback takes the field's type:

```ts
await out.render(rows, records({ identifier: 'source', fields: [{ key: 'count', format: (value) => String(value).padStart(6) }] }));
```

**Steps.**

1. Run the application's type check.
2. For each error under a `records({…})` call, correct the callback's parameter type or its use of the value to match the field's type.
3. For each error where the data carries no row type, state it: a factory's type argument, `records<Row>({…})`, a typed row view, `const view: RowView<Row> = { row: … }`, or, for inline literal rows, the array's type, `const rows: readonly Variant[] = [{ variant: 'compact' }]`.
4. For each call written `out.render<Row>(rows, view)`, drop the type argument, or name the data, `out.render<readonly Row[]>(rows, view)`.

**Validation.** Run the application's type check until it reports no error, then run its tests to confirm each records view prints as before.

- Add the color mark, `color: true` on one Boolean global option of an Application. Core reads the operator's color choice from argv right after host capture: the last spelling of the marked option before the first bare `--` sets the run's `color` policy field to `'always'` for a positive spelling and `'never'` for a negative one, over `NO_COLOR`, `FORCE_COLOR`, and the declared `rendering.color` from the Application and from `run()`. Modifiers, hyperlinks, and terminal controls keep their own policy, so `--no-color` on a terminal keeps bold. Everything the run prints after host capture follows the choice, including graph build's declaration errors, environment and configuration warnings, an unknown command, help, results, and failures. An invocation by name reads no choice and stays plain, and in an Application with no marked option the color choice changes no byte; only its `inspect()` and manifest output gain the `color` fact below. See [Color](docs/core/color.md).
- Reject a misplaced color mark under `@loomcli/core/color-mark`: `color` on a local or non-Boolean option, a value other than `true`, a short alias or an `env` binding beside the mark, a configuration binding of the installed source on the marked option, and a second marked option in one Application. The types reject each rule except the configuration binding and a second marked option, which depend on what joins the Application and are checked when the `globalOption()` call or the `new Application()` that brings them together runs, and they now also reject `interaction` on string and counted global options, which the runtime already rejected.
- Publish `color` on each Boolean `OptionNode` from `inspect()`, `true` on the marked option, and copy it into each Boolean option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/color`. `color()` takes no settings and declares the global Boolean option `--[no-]color`, described as `Turn color on or off, overriding NO_COLOR.`, marked `control` and with the color mark, so the operator turns color on or off for one run. Help lists it among the global options, the manifest marks it `control` and `color`, and MCP tool schemas leave it out. See [Color plugin](docs/plugins/color.md).

### Migration

**Affected surface.** An option declaration that carries a `color` key, which earlier releases ignored. A `color` key on a local option, on a string, content, or counted option, with a value other than `true`, beside `short` or `env`, on an option with a configuration binding, or on a second option of one Application now throws a `DeclarationError` under `@loomcli/core/color-mark`. An application that declares no `color` key needs no change.

**Why.** `color: true` now marks the one Boolean global option whose spellings carry the operator's color choice, so core reads the key and rejects a declaration that cannot carry it.

**Before and after.**

Before, a key core ignored:

```ts
new Application('app').option('theme', { type: 'string', color: true });
```

After, the key removed, or the color choice declared on a Boolean global option:

```ts
new Application('app').option('theme', { type: 'string' }).globalOption('color', {
  type: 'boolean',
  polarity: 'both',
  color: true,
  control: true,
  description: 'Turn color on or off, overriding NO_COLOR.',
});
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `color` key. Remove each one, or keep it on one Boolean global option with no `short`, `env`, or configuration binding, or install `color()` from `@loomcli/plugins/color` in place of the application's own option.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `color` key, and run the application once with `--help`, which throws any declaration fault the types cannot see.

- Add `out.debug(message)` and `out.trace(message)`, two semantic methods beside `info`, `warn`, and `error` that write a debug line and a trace line to stderr, a Command that declares a result included. They render through the new lane views `lanes.debug` (`@loomcli/core/lanes/debug`), a dim `›` gutter and a dim message, and `lanes.trace` (`@loomcli/core/lanes/trace`), nested two spaces deeper behind a `┆` gutter and fainter, and both wrap at the columns right of their gutter. A call creates no log event. See [Verbosity](docs/core/verbosity.md).
- Add the run's verbosity, which core settles right after graph build from argv, read against the built graph with the parser's own word reader, so `-vv`, `-vq`, a short group that holds a Command's own letters, aliases, and occurrences on both sides of the Command name read as the ordinary parse reads them. The verbosity is the verbose-marked option's count, read as 2 above 2, less the quiet-marked option's count, read as 1 above 1. Verbosity 1 writes `debug`, 2 writes `trace` too, and -1 hides `info` and `success`, while `print`, `render`, `draw`, results, `warn`, `error`, the failure report, and the incomplete-result line write at every verbosity. A hidden call still rejects a message that is not a string, and calls no lane view. A middleware's and a configuration source's `out` follow the verbosity, and `app.invoke` and an action's `invoke` settle their own from the values they lower, so `options: { verbose: 2 }` reads as `-vv` does. An Application with neither mark runs at verbosity 0, so `debug` and `trace` write nothing and the verbosity changes no other byte.
- Add the verbose mark and the quiet mark, `verbose: true` and `quiet: true` on one counted global option each, an application's or a plugin's. Reject a misplaced mark under `@loomcli/core/verbose-mark` and `@loomcli/core/quiet-mark`: a mark on a local option or on a string, content, or Boolean option, a value other than `true`, both marks on one option, a second option with one mark in an Application, and an `env` or configuration binding on a marked option. The types reject each rule except the configuration binding and a second marked option, which depend on what joins the Application. Help and man pages print a quiet-marked option with no `...` after its spellings, as `-q, --quiet`, because a further occurrence adds nothing. Shell completion reads the same rule: it no longer offers the quiet-marked option once given, or the verbose-marked option once given twice, while every other counted option is still offered again.
- Add `counts` to the `option` position `locate` returns, a `ReadonlyMap` from each counted option the earlier words gave to how many times they gave it, so `locate(graph, ['-v', '-vv', '--'])` holds `verbose` at 3.
- Publish `verbose` and `quiet` on each counted `OptionNode` from `inspect()`, `true` on the marked option, and copy both into each counted option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/verbose`. `verbose()` takes no settings and declares the counted global options `-v, --verbose`, described as `Show more detail. Repeat it for more.`, with the verbose mark, and `-q, --quiet`, described as `Hide info and success messages.`, with the quiet mark, both marked `control`, so MCP tool schemas leave them out. See [Verbose plugin](docs/plugins/verbose.md).

### Migration

**Affected surface.** An option declaration that carries a `verbose` or `quiet` key, which earlier releases ignored. Such a key on a local option, on a string, content, or Boolean option, with a value other than `true`, both keys on one option, either key beside `env` or a configuration binding, or a second option of one Application with the same key now throws a `DeclarationError` under `@loomcli/core/verbose-mark` or `@loomcli/core/quiet-mark`. An application that declares neither key needs no change.

**Why.** `verbose: true` and `quiet: true` now mark the counted global options whose occurrences set the run's verbosity, so core reads both keys and rejects a declaration that cannot carry them.

**Before and after.**

Before, a key core ignored, and a count the action checked by hand:

```ts
new Application('app')
  .globalOption('level', { type: 'count', short: 'v' })
  .option('loud', { type: 'boolean', verbose: true })
  .action(async ({ options, out }) => {
    if (options.level > 0) {
      await out.info('Reading doc.json.');
    }
  });
```

After, the key removed, the hand-counted option dropped, and the debug line written through `out.debug` under the verbose plugin's `-v`:

```ts
import { verbose } from '@loomcli/plugins/verbose';

new Application('app', { plugins: [verbose()] })
  .option('loud', { type: 'boolean' })
  .action(async ({ out }) => {
    await out.debug('Reading doc.json.');
  });
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `verbose` or `quiet` key. Remove each one, or keep it on one counted global option with no `env` or configuration binding, or install `verbose()` from `@loomcli/plugins/verbose` in place of the application's own options. `verbose()` declares the global options `verbose`, spelled `-v`, and `quiet`, spelled `-q`, so an application that installs it renames or removes its own option with either key or either spelling.
3. Move a message that only an operator's `-v` should reveal from a hand-written count check to `out.debug` or `out.trace`.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `verbose` or `quiet` key, and run the application once with `--help`, which throws any declaration fault the types cannot see. Run it with `-v` and check that its debug lines reach stderr.

- Add adaptive theme entries. `style.adaptive({ dark, light })` returns a theme entry that holds one unapplied concrete chain for each background, each with its own fallbacks, and core resolves its token to the side that matches the run's background at every color depth, taking the dark side when the background is unknown. A theme mapping may hold adaptive entries beside plain ones, and only the exported `style` carries `adaptive`, so a theme may still name a token `adaptive`. `style.adaptive` checks its argument when it is called and throws `TypeError('Adaptive styles take an unapplied concrete style chain for dark and for light.')` for anything else. See [Background](docs/core/background.md).
- Add the run's background, `'dark'`, `'light'`, or `undefined`, which core settles once per run, right after the color choice and before graph build, from the first source that answers: the operator's background choice, the author's new `rendering.background` (`'auto'`, `'dark'`, or `'light'`), a background a `run({ host: { terminal } })` override states, and then, only when an installed theme entry is adaptive or an option carries the background mark, `undefined` when stdin, stdout, or stderr is not a terminal, as in `app | fzf` or `app > file`, or with color off on both streams, dark when `TERM` is `linux`, the terminal's answer to a background query, `COLORFGBG`, and `undefined`. Actions, middleware, and hooks read it as `host.terminal.background`, and every view reads it as the view context's `background`. An invocation by name reads `undefined`.
- Add the background query. When settlement reaches the query and stdin, stdout, and stderr are all terminals, core writes OSC 11, `CSI ? 996 n`, and DA1 in one write to stderr, reads the replies in raw mode until the DA1 reply or one unreferenced one-second deadline, restores the mode it found, and pushes every byte that is not a reply back onto stdin, so typeahead reaches the action. A `Ctrl-C`, `Ctrl-\`, or `Ctrl-Z` read during the wait stays out of the typeahead, and core raises SIGINT, SIGQUIT, or SIGTSTP for it once the mode is restored, so `Ctrl-C` still ends the run. It writes nothing and reads nothing when stdin has no raw mode, when `TERM` is unset, empty, or `dumb`, when `STY` or `INSIDE_EMACS` is set, on Windows, and when the run is a background job of its terminal, which raw mode would stop.
- Add the background mark, `background: true` on one string global option, whose `dark` or `light` value core reads from argv beside the color choice. Reject a misplaced mark under `@loomcli/core/background-mark`: the mark on a local option or on a Boolean, content, or counted option, a value other than `true`, a second marked option, and a short alias, `env`, default, implied value, `multiple`, or configuration binding on the marked option. Reject a `rendering.background` other than `'auto'`, `'dark'`, or `'light'` under `@loomcli/core/rendering-policy`.
- Publish `background` on each string `OptionNode` from `inspect()`, `true` on the marked option, and copy it last into each string option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/background`. `background()` takes no settings and declares the global string option `--background`, validated to `dark` or `light` with the issue `Supply dark or light.`, marked `control` and `background`. Its mark also turns background detection on for a theme that does not adapt. See [Background plugin](docs/plugins/background.md).
- Change `loomTheme()` so its six colored tokens adapt: on a light background `dim` is `#5F6B7A`, `highlight` `#9C5A1E`, `success` `#4E6B50`, `warning` `#8A6D0E`, `error` `#C04532`, and `info` `#4A6B91`, with the 256-color fallbacks 243, 130, 65, 94, 131, and 60 and the dark side's 16-color names. A plain override stays one value on both backgrounds. See [Loom theme](docs/plugins/theme.md).
- Export the types `Background`, `AdaptiveStyle`, `HostTerminal`, and `HostOverrides` from `@loomcli/core`. `RunOptions.host` takes `HostOverrides`, whose `terminal` may omit `background`.

### Migration

**Affected surface.** An option declaration that carries a `background` key, and a `rendering` policy that carries a `background` field, both of which earlier releases ignored. Such a key on a local option, on a Boolean, content, or counted option, with a value other than `true`, beside a short alias, `env`, a default, an implied value, `multiple: true`, or a configuration binding, or on a second option of one Application now throws a `DeclarationError` under `@loomcli/core/background-mark`, and a `rendering.background` other than `'auto'`, `'dark'`, or `'light'` throws under `@loomcli/core/rendering-policy`. A host override annotated `Partial<Host>`, the type `RunOptions.host` had before, whose `terminal` is stated, and a terminal annotated `Host['terminal']`, no longer compile, because `Host['terminal']` is now `HostTerminal`, which requires `background`. An application that declares neither and annotates no override `Partial<Host>` and no terminal `Host['terminal']` needs no change.

**Why.** `background: true` now marks the string global option whose value sets the run's background, and `rendering.background` states the author's background, so core reads both and rejects a declaration that cannot carry them.

**Before and after.**

Before, a key core ignored, and a background the action guessed from the environment:

```ts
new Application('app', { plugins: [loomTheme()] })
  .globalOption('background', { type: 'string', short: 'b', background: true })
  .action(({ host, out }) =>
    out.print(host.env.COLORFGBG?.endsWith(';15') === true ? 'light' : 'dark'),
  );
```

After, the plugin's `--background` in place of the application's own option, and the settled background read from the host:

```ts
import { background } from '@loomcli/plugins/background';

new Application('app', { plugins: [loomTheme(), background()] }).action(({ host, out }) =>
  out.print(host.terminal.background ?? 'unknown'),
);
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `background` key. Remove it, or keep `background: true` on one string global option with no short alias, `env`, default, implied value, `multiple`, or configuration binding, or install `background()` from `@loomcli/plugins/background` in place of the application's own option. `background()` declares the global option `background`, so an application that installs it renames or removes its own option of that name.
3. Search the application's and `run()`'s `rendering` policies for a `background` field, and set it to `'auto'`, `'dark'`, or `'light'`, or remove it.
4. Search tests and harnesses for a host override annotated `Partial<Host>` and a terminal annotated `Host['terminal']`. Retype the override as `HostOverrides`, exported from `@loomcli/core`, and the terminal as `NonNullable<HostOverrides['terminal']>`, or add `background: undefined` to the terminal.
5. Replace code that reads `COLORFGBG` or guesses the terminal's background with a read of `host.terminal.background`, or of a view context's `background`. Core detects the background only when an installed theme entry adapts, as `loomTheme()`'s entries do, or an option carries the background mark, so an application with neither installs `background()` from `@loomcli/plugins/background`, whose mark turns detection on.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `background` key, a `rendering.background` outside the three values, and a `Partial<Host>` terminal that lacks `background`, and run the application once with `--help`, which throws any declaration fault the types cannot see. On a light terminal, run a command that prints themed text and check that `host.terminal.background` reads `'light'`.

### Features

- Fit `@loomcli/plugins/table` to the terminal. When the natural width exceeds `columns`, the widest columns shrink by levelling from the top, down to the widest unit `wrap` keeps whole in each column, and cells and headers wrap inside their columns with every line keeping the column's alignment. On a terminal each line ends at its rightmost cell that has text, with no padding or gap after it. A table whose columns cannot fit at those floors prints one `HEADER  value` block per row instead, and an empty sequence prints its header line at the fitted widths. On a terminal a tab in a cell or a header expands to spaces from the start of the cell before the table measures it, so no line overflows. Off a terminal the output is unchanged, a multi-line `format` cell and a tab included. See [Table](docs/plugins/pack-views.md#table).
- Wrap each value of `@loomcli/plugins/records` at the width left after its key column, with every continuation line indented under the value and a blank line left bare. On a terminal a line whose value is empty, in the records view and in the table's fallback blocks, ends at its key with no trailing spaces. On a terminal a value's tabs expand to spaces from the start of the value before it wraps. Each streamed row reads its own width, and off a terminal the output is unchanged, tabs included. See [Records](docs/plugins/pack-views.md#records).
- Keep each filesystem path and URL in the first-party completion, manpage, skills, service, self-update, and configuration messages whole when a lane wraps, with `nowrap`. The message text is unchanged, so a path that holds spaces copies exactly and pipes the same bytes.

- Add `@loomcli/plugins/list`, a whole view over items for `rows<Item>()` and `out.render`. Items print with `●` bullets or with numbers right-aligned against the widest sibling, `format` renders an item's text, and `children` nests items under their parent's text. On a terminal each item wraps with its continuation lines hanging under its text. See [List](docs/plugins/pack-views.md#list).
- Add `@loomcli/plugins/heading`, `@loomcli/plugins/rule`, and `@loomcli/plugins/prose`, views over a string. `heading()` prints a `dim` section heading, underlined at level 1. `rule()` draws a horizontal line across the terminal, or 80 columns off one, with the text as its label. `prose()` wraps paragraphs to the terminal and prints them as written off one. See [Views over a string](docs/plugins/pack-views.md#views-over-a-string).
- Add `@loomcli/plugins/box`, which frames text, or the output of another view passed as `content`, in a rounded border with an optional title. A framed view renders with `columns` narrowed by the frame, so a boxed table shrinks to fit inside it or falls back to the records layout. See [Box](docs/plugins/pack-views.md#box).

- Wrap the `@loomcli/plugins/help` page to the terminal's `columns`. The masthead description, a deprecation message, every right cell, Details text, the INPUT block's sentences, option-group sentences, example notes, and hints wrap with hanging indents, and a right cell continues under the right column. When a hanging text's continuation indent and its widest unbreakable word cannot fit, its continuation lines start at its block's indent instead. Usage forms, section titles and inner headings, left cells, Details code and table rows, the INPUT example line, and example commands stay whole, and a Details code span and a hint's command never break. See [Help wraps to the destination's columns](docs/plugins/help-page.md#help-wraps-to-the-destinations-columns).
- Stack the rows under one help heading when their indent, left column, and widest unbreakable word cannot fit `columns`: each left cell prints on its own line and its right cell wraps on the lines below, four columns past the furthest-in start of a left cell's text, so a long-only option's description never starts in its spelling's column. The rows under every other heading keep two columns.
- Reflow a help Details paragraph on a terminal: its authored lines join with one space and wrap to the width, in lists and quotes too, while code keeps every line. Consecutive Details lines that start with `|` form table rows that keep their lines on a terminal and off one, and they print as before off a terminal. On a terminal, tabs on the help page expand to spaces before it wraps. Off a terminal, as on a pipe, under `app.invoke`, and in an MCP tool call, nothing on the help page wraps or reflows and its tabs stay tabs, so the page prints as before apart from the Details lists and headings, which now print as the list and heading views do.

- Add `columns` and `wrap(text, columns)` to `ViewContext`, and so to `FailureViewContext`. `columns` is the effective width of the destination the view writes to, read just before each render call: the terminal's real width, or `undefined` on a pipe, a redirect, an invocation by name, and an MCP tool call. `wrap` breaks marked text at spaces so each line fits, measured as `width` measures, keeps a word wider than the width whole on its own line, and returns the text unchanged when `columns` is `undefined`. The idiom is `context.wrap(text, context.columns)`. See [width, padding, and multiline lanes](docs/core/styles.md#width-padding-and-multiline-lanes).
- Add `expandTabs(text)` to `ViewContext`, and so to `FailureViewContext`. It replaces each tab in marked text with the spaces that reach the next multiple of eight, counted from the start of its input line as `width` counts, so text a view places after a gutter, a label, or another column shows as it measured. Frames, escapes, and ANSI commands keep their bytes, and a tab inside `pad` is left to the frame.
- Read `host.terminal.stdout` and `host.terminal.stderr` `columns` and `rows` live, so a window resized during a run reaches the next render. A host override's plain numbers stay fixed, and a getter it supplies is read each time. `isTTY` is still read once.
- Narrow `columns` on a terminal by a valid POSIX `COLUMNS` variable, a positive integer, which never widens it past the terminal's real width. A terminal that reports no width takes `COLUMNS` alone, and a destination that is not a terminal ignores it. `host.terminal` keeps the real reading.
- Wrap the `info`, `success`, `warn`, and `error` lanes at the columns right of their glyph gutter, with the gutter on every continuation line. On a terminal they expand the message's tabs to spaces first, so a tab after the gutter no longer pushes a line past the width. Off a terminal their output is unchanged, tabs included, and `print` never wraps. A long self-update notice now wraps on an 80-column terminal.
- Add `nowrap(text)`, which keeps text such as a path that holds spaces whole when a line wraps. It adds no bytes to the printed text: ``out.info(`Wrote ${nowrap(path)}`)``.
- Add `splitLines(text)`, which splits marked text at its line breaks into lines that each stand alone. A style, a `pad` or `nowrap` frame, an embedded SGR color, or an OSC 8 hyperlink that spans a break closes at the line's end and opens again on the next, so a view can place wrapped lines side by side: `splitLines(context.wrap(text, width))`.
- Fill the Developer Diagnostic's banner and wrap its explanation at stderr's effective width, narrowed by `COLUMNS`, measured in terminal display columns. It keeps 80 columns off a terminal and in a thrown error's message.

- Add `out.region()`, which opens a live region at the bottom of stderr and returns its handle at once, with `draw`, `end`, `signal`, `report`, `live`, and `closedBy`. Core keeps every open region below every other write, in the order the regions opened, and redraws them after each write. It erases a region whole after a terminal resize rewraps it, holds the other regions still while an input region is open, and draws no region without input under `-q`. It closes a region left open when the action that opened it returns, or, for a region a middleware or a configuration source opened, once the middleware chain has unwound, and it closes every region before a failure report and on cancellation, aborting the region's signal first. `@loomcli/core` exports `Region`, `RegionOptions`, `RegionCloser`, `ProgressReport`, and `ProgressEvent`. The [core reference](docs/core/output.md#live-region) describes the region.
- Add `progress(context, { label, total?, spinner? })` to `@loomcli/prompts`. It draws a spinner, or a bar with counts, in its own live region, and its handle has `update`, `end`, `fail`, and `track`. Off a terminal and under an invocation by name, it writes one start line and one end line through the semantic lanes, and under `-q` only its failure line. The optional `progressStyle()` plugin sets the default spinner of every line, in the cli-spinners shape, which a line's own `spinner` overrides, and its bar cells, and `@loomcli/prompts/views` exports the `progressLine` view. The [prompts reference](docs/libs/prompts.md#progress) describes the lines.
- Change `@loomcli/prompts` questions to draw in input regions. A lane message written while a question asks lands above its frame, a frame that a terminal rewrapped after a resize is erased whole, and two questions asked at once take turns. A question whose region core closes for a failure, such as work beside it in `Promise.all` that rejects, or for the return of what asked it, draws its cancelled line, leaves raw mode, shows the cursor, and rejects, so stdin no longer holds the process open after the run.

- Add `onProgress` to `InvokeOptions`. An invocation by name, from `app.invoke` or an action's `invoke`, hands it each progress event of the call's run, `{ id, label, state, completed?, total? }`, in order and inside the `report` or region close that built it. A region ended with `end(state, label)` carries that label on its end event, and a progress line passes its `end`, `fail`, and `track` messages there, so the observer reads the end text the terminal shows. A call inherits no observer from its parent run. An observer that throws is called no more, and `invoke` rejects with its throw once the run settles. The [core reference](docs/core/invocation.md#invocation-by-name) describes the observer.
- Add MCP progress notifications. A `tools/call` request whose `params._meta` carries a `progressToken` receives one `notifications/progress` for each progress event of its run, with `progress` counting every event the call has sent and `message` holding the label, the counts, and the state, such as `Fetching records 1/3 (updated)`. A call without a token receives none, and the server sends none after the call's answer or cancellation. The [core reference](docs/plugins/mcp.md) describes the notifications.

### Fixes

- Change the help page's Details lists to print as the list view does, on a terminal and off one. A bullet item starts with a `dim` `●` instead of `-`, and an ordered item counts up from the author's first number with a `.` whatever delimiter the author wrote, so `3)` prints `3.`, and its markers right-align against the widest in the list, so ` 9.` lines up with the `10.` below it.
- Change the help page's Details headings to print as the heading view does. A level 1 heading is `dim` text with a `dim` underline as wide as its widest wrapped line, a heading at levels 2 to 6 is `dim` text alone, and neither is `primary` and `bold` as before.

- Speed up `ViewContext.width`, `ViewContext.plain`, and `@loomcli/plugins/table` on long text. Output is unchanged.

- Fix `loom pr check` and `loom release plan`, which failed with `spawnSync git ENOBUFS` when a file they read at a commit was larger than 1 MiB. A release check copies every tracked file at the base, so one large document failed every release PR.

## v0.13.0 - 2026-10-16

0.13.0 gives applications more ways to collect input. Native content inputs prepare lazy file or stdin handles, dotenv imports an explicit environment allowlist before input validation, and declared option groups check relationships between supplied options. Actions can ask text, secret, confirm, and select questions through the separately published `@loomcli/prompts` library. Linked questions can reuse supplied answers, and the interaction plugin adds `--no-input` for runs that must not ask.

Pin the first-party packages together at exactly 0.13.0, adding `@loomcli/prompts` only when the application asks questions. The migration sections below cover environment-binding readers and applications that construct complete host, output, view, or action contexts. Applications that use the contexts core produces need no context-construction changes.

### Breaking Changes

- Add the separately published `@loomcli/prompts` library for optional action-owned text, secret, confirm, and select questions. Questions render on stderr, can link local options, and return validated supplied values silently when skipped.
- Add one run-wide interaction decision, the `@loomcli/plugins/interaction` plugin's `--no-input` switch, and `required: 'non-interactive'` for single-value local string options. Help, the manifest, and MCP schemas expose conditional requiredness.
- Pass the captured run context to question validators, including the working directory and time zone used by `path()` and `dateTime()`.
- Add `ViewContext.plain(text)` to resolve marked text without styles or controls while preserving destination glyph forms. Select frames use it to fit short or narrow terminals while preserving complete returned choice values.
- Add `supplied`, `interactive`, and `cancel()` to action contexts, `missingInputError()` for action-owned missing inputs, and `out.draw(data, view)` for ordered terminal drawing on stderr with resolved row counts.

### Migration

**Affected surface.** Applications that construct `Out`, `ViewContext`, or `ActionContext` objects, including wrappers and test harnesses. Applications that only consume the context core produces need no code change.

**Why.** `Out` now requires `draw`, `ViewContext` requires the destination-aware `plain` helper, and `ActionContext` carries the run's `supplied`, `interactive`, and `cancel` members. Questions need core's ordered output and shared interaction and cancellation decisions.

**Before and after.** A wrapper that copies each output method must preserve `draw` too. Copying the runtime channel preserves its full contract:

Before:

```ts
function copyOutput(out: Out): Out {
  return {
    error: out.error,
    fatal: out.fatal,
    info: out.info,
    print: out.print,
    render: out.render,
    results: out.results,
    success: out.success,
    warn: out.warn,
  };
}
```

After:

```ts
function copyOutput(out: Out): Out {
  return { ...out };
}
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Preserve the runtime channel's `draw` in output wrappers and the runtime view context's `plain` in view-context wrappers. A custom channel implements the [drawing contract](docs/core/output.md), including stderr ordering and row measurement.
3. Run test actions through `Application.run()` with host overrides or `Application.invoke()` to obtain a complete action context. Hand-built contexts must provide `supplied`, `interactive`, and `cancel` with the same run semantics.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's test command. Verify that supplied linked answers resolve without question output and that cancellation restores terminal input.

- Add `dateTime()` and `duration()` validators to `@loomcli/validators`, and `host.timeZone` to the `Host` in `@loomcli/core`.
  - `dateTime()` reads an ISO 8601 or RFC 3339 date and time into a `Date`. A token with an offset or `Z` names that instant, and an offset may be `+05:00`, `+0500`, or the hour-only `+05`. A token without one is read in the `timeZone` option or, when none is given, in the operator's time zone from `host.timeZone`, which honours `TZ`. A time a clock change skips moves forward, and one it repeats takes the earlier instant.
  - `duration()` reads systemd.time(7) span spellings, such as `90s`, `2h30m`, `1.5h`, `2 hours`, or `1 hour 30 min`, or a bare number of seconds, into milliseconds. Whitespace may separate a number from its unit and the parts from each other. Units are case-sensitive, a capital `M` is rejected as ambiguous, and months and years are rejected. `min` and `max` take durations in the same grammar and are inclusive.
  - `run({ host: { timeZone } })` overrides the captured zone.

### Migration

**Affected surface.** Applications that construct a complete `Host` object, including validation-context fixtures and host wrappers. Partial host overrides passed to `Application.run()` need no change.

**Why.** `Host` now requires `timeZone`, the IANA zone that `dateTime()` uses for timestamps without an explicit offset.

**Before and after.** A helper that constructs a complete host must include its zone:

Before:

```ts
const host: Host = { ...hostFields };
```

After:

```ts
const host: Host = { ...hostFields, timeZone: 'UTC' };
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Add an appropriate IANA `timeZone` to complete host fixtures. Use a fixed zone such as `UTC` for deterministic tests, and preserve the captured zone in wrappers.
3. Prefer partial `run({ host: { ... } })` overrides when a test needs only selected host fields; core captures the remaining fields.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's tests. When using `dateTime()` without an offset, verify the resulting instant under the intended host zone.

- Allow an option to bind a list of environment variables, such as `env: ['AWS_REGION', 'AWS_DEFAULT_REGION']`. The first name in list order that holds a non-empty value supplies the option, an invalid Boolean or count value on it fails naming that variable, and a failure's source label names the variable that supplied the value. An empty list and a name repeated in one list are declaration errors, and a list claims every name it holds.
- Change the `env` fact on `OptionNode`, `inspect()`, and the manifest to an array of the bound variables in declaration order, empty when the option binds none. A binding declared as one name publishes a one-element array.

### Migration

**Affected surface.** Applications that read environment bindings from `OptionNode`, `inspect()`, or the manifest. Option declarations using one environment variable remain valid.

**Why.** An option can bind several names, so its published `env` fact is now a list instead of a string or `null`.

**Before and after.** Normalize no binding to an empty list and read all names in declaration order:

Before:

```ts
const names = node.env === null ? [] : [node.env];
```

After:

```ts
const names = node.env;
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Update inspection and manifest readers to accept an empty or populated array. Iterate all names, or read `env[0]` when only the first binding matters.
3. Update manifest schemas and snapshots that expect a string or `null`.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's tests. Check inspection and manifest output for unbound, single-name, and multiple-name options.

### Features

- Add local content arguments and options that prepare readable file paths into lazy `Content` handles, with one declared stdin target per Command and source-count bounds on collections.
- Add `.stdin()` for an input that accepts piped or redirected content without a file operand. Content preparation reads no bytes; the action selects `text()` or `stream()`.
- Describe content sources and count bounds in inspection, manifests, help, man pages, and MCP schemas, and support content inputs in completion. Named invocations and MCP calls accept file paths without content stdin.

- Allow `loom release cut --target VERSION` to select a synchronized release version at or above the fragment-derived minimum, including during a dry run, while keeping fragment classifications truthful. Omitting the target preserves automatic version calculation.

- Add `@loomcli/plugins/dotenv` to import an explicit allowlist from `.env` before defaults and inputs validate. Existing environment values, including empty values, win. Ordinary CLI runs also make additions available to libraries and child processes; supplied working directories or environments and every named invocation keep additions inside the run.
- Add the bounded `onEnvironment` plugin hook for environment additions, with merging and process isolation owned by core.

- Add immutable `exclusive()`, `oneRequired()`, and `requiredTogether()` declarations over local options. Core checks supplied presence across argv, environment, and configuration before dispatch, reports group and individual input problems together, and publishes the rules through inspection, help, the manifest, sound MCP schemas, and exclusive-option completion.
- Expand the produced `InputProblem` union with group problems carrying `inputs`, `spellings`, and `supplied`. Custom readers narrow `reason` before reading singular `input`, `spelling`, or `issues` fields.

### Fixes

- Fix `completion install` and `completion update` forgetting the startup line an operator added by hand to a startup file the application cannot change. When the script moves or the line's text changes, and that file already holds the new line, the command now records the new line as held instead of printing it to add, so `completion update` keeps it and `completion uninstall` prints it to remove. The application still never writes that file, and a startup file it cannot read records nothing.

## v0.12.0 - 2026-10-14

0.12.0 lets a Loom application put its own files on an operator's machine: shell completion, man pages, and agent skills. Each installer records what it wrote in the installation record 0.11.0 introduced. It refuses to overwrite a file it did not write, and `update` refreshes the files after a self-update.

The completion plugin now installs its script for Bash, Zsh, Fish, or PowerShell and adds the line that loads it to the shell's startup file. The new manpage plugin writes one roff page for each Command, either into a folder for packagers or into the home folder where `man` finds it. The new skills plugin installs an application's agent skills for Claude Code and for the shared agents folder that Codex reads. Help details are now Markdown, written inline or imported from a file, and the man pages render the same text.

A script-installed binary also learns when a newer release is out. The self-update plugin prints one notice after a run at a terminal and reads the answer from a cache that a detached copy of the application refreshes about once a day, so no run waits on the network.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.12.0`. The one migration concerns update notices: they are on by default, and an application that wants no notices passes `selfUpdate({ notices: false })`.

### Breaking Changes

- Change `selfUpdate()` to turn update notices on unless the application passes `notices: false`. An application that installs the self-update plugin and upgrades unchanged now prints a notice after a run at a terminal when a newer release exists on the binary's channel, and about once a day starts a detached copy of itself that asks the binary's GitHub repository for its newest release. See [Update notices](docs/plugins/self-update.md#update-notices).

### Migration

**Affected surface.** Applications that install `selfUpdate()` from `@loomcli/plugins/self-update` and ship a script-installed release binary. A source build, and a binary another installer placed, print no notice and start no lookup.

**Why.** An operator should learn that a newer release exists without running `self-update --check`, so the plugin tells them unless the author or the operator turns it off.

**Before and after.**

Before, an application that wants no notices and no daily lookup:

```ts
selfUpdate();
```

After:

```ts
selfUpdate({ notices: false });
```

**Steps.**

1. Decide whether the application should print update notices. To keep them, change nothing.
2. To keep the earlier behavior, pass `notices: false` to each `selfUpdate()` call. The plugin then declares no notice middleware, reads no cache, and starts no lookup.
3. To let operators turn notices off through a variable of the application's own beside `NO_UPDATE_NOTIFIER`, pass `notices: { env: 'NAME' }` instead.

**Validation.** Run a script-installed release binary at a terminal with an empty cache directory. With `notices: false`, no `update.json` appears in the application's cache directory and no notice prints. Run the application's tests to confirm `selfUpdate()` accepts the setting.

### Features

- Add the skills plugin, `skills({ skills })` from `@loomcli/plugins/skills`, which installs an application's agent skills where coding agents read them. It contributes `skills install`, `skills update`, and `skills uninstall`. See [Skills](docs/plugins/skills.md).
  - Each `Skill` is a `name` and a `files` function that returns the skill's files, each a relative `path` and its `content` as text or bytes, optionally `executable`. The function runs only when a `skills` Command runs, so every other run of the application loads no skill bytes. A name outside lowercase letters, digits, and single hyphens (64 characters at most), a repeated name, and a `files` that is not a function each throw `@loomcli/plugins/skills/settings` at the call. A loader whose result is not a list of files, lists a path that is not a plain relative path or lists one twice, or lists no `SKILL.md` throws `@loomcli/plugins/skills/files` when a child runs, before anything is written.
  - `--agent claude` writes `<home>/.claude/skills/<name>/`, or `$CLAUDE_CONFIG_DIR/skills/<name>/` when that variable is an absolute path. `--agent agents` writes `<home>/.agents/skills/<name>/`, which Codex and other agents read. With no `--agent`, a child acts on both, and once when a link makes both skills directories one folder. Files are written with mode 755 when `executable` and 644 otherwise, whatever the umask.
  - A skill's folder is replaced whole by every install and update, so a new version may restructure its files, and a file a newer version dropped does not survive. A global install lists each folder in its own file in the installation record, `skills.claude.json` or `skills.agents.json`, and an uninstall removes every recorded folder whatever someone changed inside it. A folder the record does not list refuses `install` and `update` for every target, writing nothing, unless the operator passes `install --force`, which replaces it and states each folder it took over.
  - `install --project` copies the skills into the repository, to `.claude/skills/` and `.agents/skills/` at the nearest directory holding `.git`, starting from the working directory or from `-C, --directory`, and records nothing. A project folder that is a target's global folder refuses.
  - `update` brings the targets whose record lists folders up to date, removing the folder of a skill the application stopped declaring, and never touches a project copy.
  - `refreshSkills` is an `afterReplace` function for `selfUpdate({ afterReplace: refreshSkills })`. It runs the replaced binary's path with `skills update`, so the new version's skills are written, and passes the child's output through. A child that fails or cannot start adds a `warn` log event and resolves, because the binary update succeeded.
  - The pack exports the `Skill`, `SkillFile`, `SkillsSettings`, and `RefreshContext` types.

- Add [Markdown Details](docs/plugins/help-page.md#markdown-details) to extended help, with paragraphs, headings, lists, code, quotes, emphasis, and links. Allow blank lines and text imports while keeping the Markdown source unchanged in the manifest. Existing details are now read as Markdown, so plain-text uses of lines starting with `- `, words between asterisks, and backslashes before punctuation render, and whitespace at either end of a line is trimmed.

- Add the manpage plugin, `manpage()` from `@loomcli/plugins/manpage`, which writes one section-1 man page for the root and each Command that is neither hidden nor under a hidden Command, and installs the set where `man` finds it. It contributes `manpage generate --out <folder>`, `manpage install`, `manpage update`, and `manpage uninstall`. See [Man pages](docs/plugins/manpage.md).
  - A page is named like git's, `<name>-<command>-<subcommand>`, and holds NAME, SYNOPSIS from help's usage forms, DESCRIPTION from the Command's Markdown `details`, the Command sections, ARGUMENTS, and the option sections in help's order, EXAMPLES, ENVIRONMENT, and SEE ALSO. Global options appear on the root page alone. Each option's entry names its environment variable and its configuration key. The page reads the help and configuration values each Command carries whether or not those plugins are installed.
  - A page is ASCII roff with an empty date and no host fact, so a graph gives the same bytes on every host and through `generate` and `install` alike.
  - `generate` writes the set into a folder, creating it with mode 755, each page with mode 644, and records nothing, so a packager runs it on any platform.
  - `install` writes `~/.local/share/man/man1`, records each page by its digest in the installation record's `manpage.json`, refuses a file it did not write or a page someone changed, and prints a line that sets `MANPATH` when `man` will not find the folder. `update` refreshes the recorded folder, and `uninstall` removes the unchanged pages. On Windows, `install` refuses and points at `generate`.
  - Two Commands whose page names are equal without ASCII case fail every build under `@loomcli/plugins/manpage/page-name-taken`, because a file system that ignores case holds them as one file.
  - `refreshManpages` is an `afterReplace` function for `selfUpdate({ afterReplace: refreshManpages })`. It runs the replaced binary with `manpage update`, and a child that fails or cannot start adds a `warn` log event and resolves. The pack exports `RefreshContext` from `@loomcli/plugins/manpage` as the same declaration `@loomcli/plugins/skills` exports.

- Add `completion install`, `completion update`, and `completion uninstall` to the completion plugin, so an operator installs shell completion with one command. See [Installing completion](docs/plugins/completion.md#installing-completion).
  - `install [shell]` writes the script for `bash`, `zsh`, `fish`, `powershell`, or `pwsh` to a file and, for every shell but Fish, adds one line that loads it to the shell's startup file. With no shell it follows `SHELL`, and on Windows it picks `pwsh` or `powershell` from `PSModulePath`. Bash and Zsh scripts go under `XDG_DATA_HOME`, Fish's under `XDG_CONFIG_HOME/fish/completions`, and the PowerShell line goes into the profile PowerShell reports.
  - Each shell's script and line are recorded in the installation record as `completion.<shell>.json`. An install refuses a file at the script's path that it did not write, or a script someone changed since, and changes nothing.
  - A startup file the process cannot change, such as one a read-only home configuration manager links, or a PowerShell execution policy of `Restricted` or `AllSigned`, keeps the script installed and prints the line for the operator to add or remove by hand.
  - `update` rewrites every recorded script at its recorded path and replaces a recorded line whose text changed where it stands. `uninstall [shell]` removes the recorded scripts and lines, or every installed shell's when no shell is named.
  - The `completion` group's description is now `Print or install a shell completion script.`
- Add `completion powershell`, which prints a PowerShell completion script for Windows PowerShell 5.1 and PowerShell 7. Like the Bash, Zsh, and Fish scripts, it is ported from Cobra's, calls the program with each typed word as one exact argument, and never evaluates what was typed.
- Add `refreshCompletion`, an `afterReplace` function for `selfUpdate({ afterReplace: refreshCompletion })`. It runs the replaced binary with `completion update`, so a self-update keeps installed scripts current. A child that fails or cannot start adds a `warn` log event and resolves. `@loomcli/plugins/completion` also exports the `RefreshContext` type, the same declaration `@loomcli/plugins/skills` exports.

- Add update notices to the self-update plugin. After the action of a run at a terminal, a script-installed release binary prints `notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.` through `out.info` when its cache names a newer release on the running binary's channel. See [Update notices](docs/plugins/self-update.md#update-notices).
  - The run reads `update.json` in the application's cache directory and never waits on the network. A cache older than 24 hours, missing, or damaged is refreshed by a detached copy of the application, `self-update --refresh-notice`, started through `host.program`, so a slow or failing network costs one lookup a day. Its faults are silent and never change the exit code.
  - No notice prints, and no lookup starts, for a failed or cancelled run, `self-update` itself, a stdout or stderr that is not a terminal, `CI`, a source build, or a binary another installer placed.
  - Turn notices off with `selfUpdate({ notices: false })`, or name a variable of the application's own with `selfUpdate({ notices: { env: 'NOTES_NO_UPDATE_NOTICE' } })`. An operator turns them off by setting `NO_UPDATE_NOTIFIER` to a value that is not empty. A `notices` that is not `true`, `false`, or an object, and an `env` that is not an environment variable name, throw `@loomcli/plugins/self-update/settings` at the call.
  - The pack exports the `NoticeSettings` type.
- Add the `cache` kind to `applicationDirectory`. `applicationDirectory('cache', name, host)` resolves `$XDG_CACHE_HOME/<app>/`, or `$HOME/.cache/<app>/` for an unset, empty, or relative `XDG_CACHE_HOME`, `$HOME/Library/Caches/<app>/` on macOS, and `%LOCALAPPDATA%\<app>\Cache\` on Windows. See [Installation record](docs/core/installation-record.md).

## v0.11.0 - 2026-10-13

0.11.0 gives a Loom application the pieces it needs to live on an operator's machine: it can log, install, update itself, and run as a service.

A run now has a `log` on every context. Core turns each call into a frozen log event, logs each failure it reports, and hands every event to `onLog` hooks. It writes no record of its own. The logging plugin, `@loomcli/plugins/logging`, is one such hook. It writes each event as a JSON line, either to a file in the platform's log directory that it rotates by size, or to stderr.

A compiled binary also learns how it was installed. `loom init` now writes `install.sh` for a package whose `repository` names a GitHub repository. The script installs the platform's binary from a GitHub Release, verifies it against `SHA256SUMS`, and records the installation in `install.json`. Core reads that record into `host.release.installation`. The self-update plugin, `@loomcli/plugins/self-update`, replaces only a binary that the script installed, and only with a verified release on the binary's release channel. The service plugin, `@loomcli/plugins/service`, installs one of the application's own Commands as a systemd user unit or a launchd user agent. It records the unit through the same installation record, so it never overwrites a file it did not write.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.11.0`. The one migration renames the release facts' `lane` member to `channel`.

### Breaking Changes

- Rename the release facts' `lane` member to `channel`. `host.release.release.channel` holds the release channel: the first prerelease identifier of the version, or `stable` when the version has none. See [release facts](docs/core/release-facts.md).

### Migration

**Affected surface.** Application code that reads `host.release.release.lane`, and tests that pass a `release` host override whose release group holds `lane`.

**Why.** Operators know a release line as a channel, and core already uses lane for its output areas, such as the results lane and the lane views.

**Before and after.**

Before:

```ts
const { release } = host.release;
out.print(`${release.version} (${release.lane})`);
```

After:

```ts
const { release } = host.release;
out.print(`${release.version} (${release.channel})`);
```

**Steps.**

1. Replace each read of `release.lane` with `release.channel`.
2. In each `run({ host: { release } })` or `app.invoke` override that spells a release group, rename `lane` to `channel`.

**Validation.** Run the application's type check: TypeScript reports every remaining read of `lane`. Run the application's tests to cover overrides in JavaScript files.

### Features

- Add `log` to the action, middleware, configuration source, and `onFailure` contexts, with the levels `trace`, `debug`, `info`, `warn`, and `error`. Each call becomes a frozen log event that carries a JSON copy of its fields, the application, a run id, the path, and the plugin whose context logged it. Core also logs each failure it reports, at `fatal` with the caught defect's name, message, and stack for a defect, in both builds. Core writes no log record of its own.
- Add the `onLog(event, destination)` plugin hook, which receives every event in installation order with the outermost run's `env`, `platform`, and `stderr`, and a `null` stderr under `app.invoke`. A hook that throws or returns a value is reported once after the run and makes it exit 1, though a cancelled run keeps its signal's code. A `log` call made during delivery throws `@loomcli/core/log-in-log-hook`. Export the `Log`, `LogFields`, `JsonValue`, `LogLevel`, `LogEvent`, `LogDefect`, `LogHook`, and `LogDestination` types.

- Add the logging plugin, `logging()` from `@loomcli/plugins/logging`, an `onLog` hook that writes each log event as one JSON line. The record keeps its keys in the order `time`, `level`, `message`, `fields`, `application`, `run`, `path`, `plugin`, `failure`, `defect`, and the file and the console write the same bytes.
  - `to: 'file'`, the default, appends each record with one synchronous write to `<app>.jsonl` in the platform's state or log directory (`$XDG_STATE_HOME/<app>/` or `~/.local/state/<app>/`, `~/Library/Logs/<app>/` on macOS, `%LOCALAPPDATA%\<app>\Logs\` on Windows). A `file` setting names another file in that directory, an absolute path, or a path under `~/`, and never resolves against the working directory. The directory is the one `applicationDirectory('logs', ...)` resolves, so a `HOME`, `XDG_STATE_HOME`, or `LOCALAPPDATA` that is empty or not an absolute path counts as unset, and a `~/` path reads `HOME`, or `USERPROFILE` on Windows, the same way.
  - The file rotates by size, before a write that would pass `maxBytes` (10 MB by default), into numbered copies (`collector.1.jsonl`), keeping `keep` copies (5 by default). It sets no timer and takes no lock.
  - `to: 'console'` writes the same records to stderr, never stdout, and writes nothing under `app.invoke`.
  - `level` sets the lowest level written, `info` by default, and never filters a `fatal` event.
  - `onError` receives a `LoggingError` with `kind`, `path`, `variable`, and `cause` for each failure to resolve, create, append to, or rotate the file. Without it a failed write is ignored and the next record tries again.
  - `logging()` throws a `DeclarationError` of `@loomcli/plugins/logging/settings` for a setting out of its range, and for `file`, `maxBytes`, `keep`, or `onError` beside `to: 'console'`.

- Add the installation record, one directory per application and per user that says how the application was installed. A compiled binary built with `loom build --release` reads `host.release.installation`, `{ method, path, digest }`, from the record's `install.json` when its recorded path, resolved through symbolic links, is the running executable. A missing, unreadable, or malformed file, a copy run from another path, a Node or Bun bundle, the source run, and a `release` override read no installation, and none of them fails the run. Core never hashes the binary. See the [core reference](docs/core/installation-record.md) for the file format and the shell recipe an installer script writes it with.
- Add `applicationDirectory(kind, application, { env, platform })`, which resolves an application's `installation` or `logs` directory from a run's `env` and `platform` alone, and the `ApplicationDirectory` and `DirectoryLookup` types. It answers `{ path }`, or `{ variable }` naming a `HOME` or `LOCALAPPDATA` that is unset, empty, or not an absolute path; an `XDG_STATE_HOME` that is unset, empty, or relative falls back to `$HOME/.local/state`. It reads no file and creates nothing.

- Add the `install` piece to `loom init`. In a package whose `package.json` `repository` names a GitHub repository, init writes `install.sh`, an executable managed file whose header is a `#` comment on the line after its `#!` line. Under POSIX `sh` on Linux and macOS, `install.sh [--dir <directory>] [<version>]` downloads the platform's binary from the repository's GitHub Release, verifies it against the release's `SHA256SUMS`, moves it into `~/.local/bin` or the `--dir` directory, and writes `install.json` in the installation record with the method `script`. With no GitHub repository, init writes no script and prints a warning that names `repository`. `loom check` warns about an edited `install.sh` as it does for every managed file. See [the installer script](docs/toolchain/install.md) for its arguments, output, and the release shape a release workflow publishes for it.

- Add the self-update plugin, `selfUpdate()` from `@loomcli/plugins/self-update`. It contributes `self-update [<version>] [--channel <name>] [--check]`, which replaces a binary that `install.sh` installed with a release from the application's GitHub repository. With no version, it installs the newest release on the binary's release channel. A named version installs in either direction, and `--check` reports without replacing anything. It verifies the download against the release's `SHA256SUMS` over HTTPS, renames it into place, rewrites `install.json`, and then calls the application's `afterReplace` hook. It refuses a binary another installer placed, a symbolic link, and a binary changed since it was installed. See [self-update](docs/plugins/self-update.md).

- Add the service plugin, `service({ label, run, probe? })` from `@loomcli/plugins/service`, which installs one of the application's own Commands as a per-user service: a systemd user unit on Linux, run through `systemctl --user`, and a launchd user agent on macOS, run through `launchctl` in the `gui/<uid>` domain. It contributes `service install`, `uninstall`, `start`, `stop`, `restart`, and `status`. See [Service](docs/plugins/service.md).
  - `label` is a required reverse-DNS name, such as `com.acme.notes`, that names the unit file. `run` holds the argument words the unit runs the application with, such as `['serve', '--port', '8080']`. A label outside the grammar, a `run` that is not a nonempty list of strings or holds a control character, and a `probe` that is not a function each throw `@loomcli/plugins/service/settings` at the call.
  - Every graph build checks that the `run` words route to a Command with an action, as the command line takes them. Words that name an unknown Command, a group, an unknown or misplaced option, an option with no value, or an unexpected argument fail the build with `@loomcli/plugins/service/run-unrouted`, which `check()` reports.
  - `install` refuses a `source` or `development` build. It writes the unit through the installation record's `service.json`, so it refuses a file it did not write, keeps one changed since, and removes an earlier unit after the label or `XDG_CONFIG_HOME` changed. It writes the unit with mode 644 whatever the umask. The unit runs `host.program` and the `run` words from `HOME`, restarts the process whenever it exits, and redirects no output.
  - Manager calls run with the host's environment, with no shell and no time limit. On Linux, an environment with no `XDG_RUNTIME_DIR` gains `/run/user/<uid>`. The run signal ends a call with `SIGTERM`. A call's output is never printed; a failed call names itself, its exit code, and the manager command that reports why.
  - `status` returns a `ServiceStatus` result with a `text` view by default and a `json` view, and exits 0 whenever it produced a report. Its notes say when lingering is off or there is no login session. The optional `probe` adds the author's rows for an installed unit and receives the state, the host, the status action's `invoke`, the signal, and the log.
  - The pack exports the `ServiceSettings`, `ServiceStatus`, `ServiceState`, `ServiceDetail`, and `ProbeContext` types.
- Add `host.program`, the frozen runtime and script prefix that `host.argv` omits, so `[...host.program, ...host.argv]` starts the same application again. A compiled binary reads its own path alone, and any other run reads the runtime's path and the absolute path of the script it ran. `run({ host: { program } })` replaces the whole list, and an action's `invoke` keeps its run's. See [Host](docs/core/host.md).
- Add the `compiled` member to the facts `loom build` bakes into `__LOOM_RELEASE__`. A compile target bakes `compiled: true`, with or without `--release`, and `node` and `bun` bake none. `--facts` and `--define` print it. A baked `compiled` other than `true` fails the run with `@loomcli/core/invalid-release-facts`. The release facts on the host do not repeat it.

## v0.10.0 - 2026-10-09

0.10.0 makes `@loomcli/loom` the public toolchain for a Loom application. Its `loom` bin acts on the package whose directory it runs in: `loom init` scaffolds a new application or adds the pieces an existing package lacks, `loom build` bundles the application for Node, Bun, or a compiled binary, `loom check` runs the package's TypeScript and reports every declaration fault without running the application, and `loom changelog` checks the package's change fragments and cuts its version from them.

The release facts replace the packet. The build bakes them into the artifact, core reads them into `host.release` for every run, and `Application.check()` returns every declaration fault a development run reports. An application keeps no `loom.packet.json` and passes nothing to the Application. A run with no baked facts, such as a run from source, is now a development build, so a bundle shipped as a distributed build must bake `{ "build": "distributed" }`, which `loom build` does by default.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.10.0`. Two of the three migrations below share one step: delete the packet and its import, then build through `loom build` or bake `__LOOM_RELEASE__` through the bundler's `define`. The third affects only code that calls an authoring method on a value narrowed with `instanceof Application`.

### Breaking Changes

- Remove `packet()` and the `@loomcli/loom/build` subpath. `@loomcli/loom` exports no module. Build with `loom build`, which bakes the [release facts](docs/core/release-facts.md), or bake them through a bundler `define` instead.

### Migration

**Affected surface.** Build scripts that import `packet` from `@loomcli/loom/build` and pass `packet()` to `Bun.build`.

**Why.** Core reads the build from the release facts a `define` bakes in, which any bundler and the `bun build` command line accept, so no plugin answers a facts file any longer.

**Before and after.**

Before:

```ts
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

After:

```ts
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

**Steps.**

1. Remove the `@loomcli/loom/build` import and the `packet()` plugin from each build script.
2. Replace each build script with `loom build --target node`, or add the `__LOOM_RELEASE__` define to it, as the core migration for the release facts describes.

**Validation.** Run each build script, then run the bundle with a command that throws and confirm it prints `<application>: Something went wrong.`.

- Remove the Application's `packet` option, the `Packet` type, and the `@loomcli/core/invalid-packet` rule. Core reads the build of every run from the [release facts](docs/core/release-facts.md) the build bakes into the `__LOOM_RELEASE__` identifier through a bundler `define`, and `new Application()` given `packet` throws under `@loomcli/core/retired-application-option`.
- Change an application with no baked release facts, run from source or bundled without the define, to read `{ build: 'source' }`, a development build. Such a run shows a defect's Developer Diagnostic, checks every converter, and fails on an undescribed declaration, where an application given no packet was distributed before. A bundle that bakes `{ "build": "distributed" }` shows the operator `<application>: Something went wrong.` as before.
- Change `inspect()` to learn its build from the baked release facts, so from source it checks every validated input's converter.
- Add `release` to the host fields `app.invoke` accepts under `host`, now five. A malformed call reports by the release facts its `host` supplies, which the call now reads first.

### Migration

**Affected surface.** Applications that import `loom.packet.json` and pass it as the Application's `packet` option, code that imports the `Packet` type from `@loomcli/core`, and applications that shipped a bundle with no packet as a distributed build.

**Why.** The release facts say how the running application was built and released, and the build bakes them in, so an author keeps no facts file and wires nothing into the Application. A bundle built without them is unbuilt, so it shows its author the detail of a defect.

**Before and after.**

Before, the entry imported the packet and the build ran the `packet()` plugin:

```ts
// src/application.ts
import packet from '../loom.packet.json' with { type: 'json' };

export const notes = new Application('notes', { description: 'Keep notes.', packet });
```

```ts
// scripts/build.ts
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

After, the Application takes no packet, and the build bakes the release facts through a define:

```ts
// src/application.ts
export const notes = new Application('notes', { description: 'Keep notes.' });
```

```ts
// scripts/build.ts
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

**Steps.**

1. Delete `loom.packet.json`, its import, the `packet` option, and any `loom.packet.json` entry in `tsconfig.json`.
2. Bake `__LOOM_RELEASE__` into every bundle you ship with your bundler's `define`, `{ "build": "distributed" }` for a distributed build. The bundle must include `@loomcli/core`, so the define reaches it.
3. Run the application from source and describe every member the `@loomcli/core/undescribed` diagnostic lists, because a source run is a development build.
4. In a test that needs a distributed build from source, pass `host: { release: { build: 'distributed' } }` to `run()` or `app.invoke`.

**Validation.** Run the bundle with a command that throws and confirm it prints `<application>: Something went wrong.`. Run the source with `--help` and confirm it prints no diagnostic. Run the application's tests.

- Fix `instanceof Application`, which now holds for an Application after a declaring call, such as `.action()`, `.command()`, or `.globalOption()`, as it did for a bare `new Application()`. A tool that finds an exported Application by class, as `loom check` does, recognizes it in every authoring state. It narrows the value to an `Application` that publishes `check()`, `inspect()`, `run()`, `invoke()`, `extend()`, and `name`, the members every authoring state keeps.

### Migration

**Affected surface.** Code that narrows a value with `instanceof Application` and then calls an authoring method on it, such as `globalOption()`, `argument()`, `option()`, `command()`, or `action()`.

**Why.** `instanceof` now holds in every authoring state, and most states no longer accept those calls, so the narrowed type publishes only the members every state keeps. Before, it narrowed to a fresh Application, which was correct only because `instanceof` held for a fresh Application alone.

**Before and after.**

Before:

```ts
if (value instanceof Application) {
  value.globalOption('verbose', { description: 'Print more.', type: 'boolean' });
}
```

After, declare on the Application value where it is authored, and narrow only to read it:

```ts
const app = new Application('notes', { description: 'Keep notes.' }).globalOption('verbose', {
  description: 'Print more.',
  type: 'boolean',
});

if (value instanceof Application) {
  const faults = value.check();
}
```

**Steps.**

1. Find each `instanceof Application` check in the application and its tools.
2. Move any authoring call made on the narrowed value to the place the Application is declared.

**Validation.** Run the application's type check, such as `loom check`, and confirm it reports no error at the narrowed calls.

### Features

- Add the `loom` bin to `@loomcli/loom`, with `loom changelog check` and `loom changelog write`. They act on the package of the nearest `package.json`: `check` validates its breaking, `feature.`, and fix fragments in `.changes/`, and `write` cuts its `package.json` version from them, prepends the release section to its `CHANGELOG.md`, and consumes the fragments. See [The package changelog](docs/toolchain/changelog.md).

- Add `host.release`, the [release facts](docs/core/release-facts.md) of the running application, and export their `ReleaseFacts` type. An action reads `build`, which is `source`, `development`, or `distributed`, and, for a release, the `version`, the `lane` core derives from it, the `repository` as `owner/name`, and a compiled binary's `asset`. `run({ host: { release } })` and `app.invoke`'s `host: { release }` replace them, which is how a test supplies facts.
- Add `@loomcli/core/invalid-release-facts`, the defect a malformed baked value reports before the graph builds, as its Developer Diagnostic in every build.
- Add `Application.check()`, which builds the graph with nothing run and returns every declaration fault a development run reports before routing, a declared default or implied value its validator rejects aside, as a list of `DeclarationError` values. It runs the converter, undescribed, and `onGraphBuilt` checks whatever the build, and continues past each fault. See [Checking the declarations](docs/core/graph-inspection.md#checking-the-declarations).

- Add `loom build` to the `loom` bin. It bundles the package's application for one target, `node`, `bun`, or a Bun compile target such as `bun-linux-x64`, and bakes its [release facts](docs/core/release-facts.md) into the artifact: `{ build: 'distributed' }` by default, `development` under `--build development` or `--watch`, and with `--release` the package's version, its repository, and a binary's asset name. A bundle carries `src/application.ts`, or the module `--application` names, beside the entry, so a test imports the built Application. `--facts` and `--define` print the same facts for a custom build, and a failed build leaves earlier output in place. See [loom build](docs/toolchain/build.md#loom-build).
- Add `loom check` to the `loom` bin. It runs the package's own TypeScript against its `tsconfig.json`, imports the application module without running the entry, and prints every fault `Application.check()` returns, and every fault the module throws while it loads, as its Developer Diagnostic, exiting 1 for any fault. An edited managed file draws a warning that never fails the check. See [loom check](docs/decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md). Both commands do their work under Bun, so Bun must be on the `PATH`.

- Add `loom init` to the `loom` bin. In an empty directory it scaffolds a new application: a `package.json` with `bin`, `build` and `check` scripts, and `@loomcli/core` and `@loomcli/loom` pinned at the running version, `typescript` at the range `@loomcli/loom` declares and a `tsconfig.json` so `loom check` runs its type pass, an application module that passes `loom check`, an entry, the fragment guide `.changes/README.md`, and the changelog skill `.agents/skills/loom-changelog/SKILL.md`. In an existing package it adds only the pieces the package lacks. Scaffold files and keys are written once and never overwritten. The fragment guide and the skill are managed files with a checksum header: init re-renders an unedited one, warns about an edited one and leaves it unless `--force`, and leaves one whose header was deleted to the author. `--only <piece>` limits init to the pieces it names. See [loom init](docs/toolchain/init.md).

### Fixes

- Fix the `@loomcli/plugins` package shipping a second `package.json` under `dist/`. The copy held unpublished `workspace:*` specs and an `exports` map that Node ignores but some bundlers read.
- Change the plugin authoring guidance in the [core reference](docs/core/plugin-contract.md): a published plugin declares its package name as a constant instead of importing its `package.json`, because the compiler copies an imported manifest into the output directory. An application that `loom build` bundles still imports its manifest.

## v0.9.0 - 2026-10-06

0.9.0 lets an agent drive a Loom application without its command line. `invoke` runs a Command by name with named values, as `run()` runs the argv that spells them, and returns a structured outcome with no process effects. The MCP plugin, `mcp()`, serves every Command that opts in as one Model Context Protocol tool over stdio, each call run through `invoke`. Every failure now carries a stable code and a plain-data form, `{ code, exitCode, message, hints }`, which a tool error, an `invoke` outcome, and the formatter's one-line JSON failure output under `--format json` all report.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.9.0`.

The three migrations below are independent. The version line's view receives the postfix beside the graph. A development build fails on a Command or input with no description, because agents, MCP tools, help, and the manifest describe a Command by its descriptions. And a manifest failure entry reads its code from the failure class instead of a hand-written name, so a failure has one identity everywhere it is reported.

### Breaking Changes

- Add `postfix` to the version plugin's settings, so `version({ postfix: '(Report schema v1)' })` prints `app v1.2.0 (Report schema v1)`: the standard line, one space, and the postfix, dim and escaped. A postfix that is not one line of prose throws `@loomcli/plugins/version/postfix` from `version()`. See [Version](docs/plugins/version.md).
- Change the data `versionLine` renders from the `CommandGraph` to `VersionLine`, `{ graph, postfix }`, so an override reads the postfix beside the graph. `VersionSettings` and `VersionLine` are exported.
- Add `isProseLine` to `@loomcli/core`, the one-line rule every core fact string follows, so a plugin judges a setting printed inside one line against core's rule. See [Plugin settings](docs/core/plugin-contract.md#plugin-settings).
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

- Change a development build to fail every `run()` and every `app.invoke()` whose graph holds a Command, the root included, a global or local option, or an argument without a description. The run exits 1 with one Developer Diagnostic under `@loomcli/core/undescribed`, which lists each gap with the call that declared it, hidden and deprecated members and what a plugin or its `onCommandAttach` hook declares included. The check runs before routing, so `--help` and a completion request fail too. `inspect()`, an action's `invoke`, and a distributed build run no such check. See [Undescribed declarations](docs/libs/eslint-plugin.md#undescribed).

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

- Change a `manifestCommand` failure entry to read its failure code from the class: an entry is `{ failure, meaning }`, and the manifest document lists `{ code, exitCode, meaning }` in place of `{ name, exitCode, meaning }`. A stale `name` key is dropped, not rejected, and `exitCodes` rows name failure codes. A class whose code is outside the grammar is rejected at the call with core's own sentence. See [Manifest failures](docs/plugins/manifest.md#manifest-failures).
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

- Add `invoke(path, values, options?)`, which runs one Command by its path with named values in place of argv, captures what the run writes, and resolves a structured outcome: `completed` with `output` and `messages`, `failed` with the failure, its `exitCode`, and the captured text, or `cancelled` with `130` or `143`. An embedding host calls `app.invoke`, which builds the graph for each call and reads `env`, `cwd`, `platform`, and `readSource` from the process unless `host` replaces one. An action calls `invoke` on its context, which reuses the graph its run built and derives its signal from the run's. An invocation by name behaves as `run()` does on the argv that spells the same path and values, and it touches no process: it installs no signal listener, sets no `process.exitCode`, writes to no real stream, and reads an empty stdin on a host with no terminal. See [Invocation by name](docs/core/invocation.md#invocation-by-name).
  - Each value lowers to the tokens argv would give: a string or a finite number is one token, a Boolean a spelling or its absence, a whole number on a counted option that many occurrences, `true` on an option with an implied value the bare spelling, and an array one occurrence per element. Arguments bind by name. A value no token spells is an input problem with exit code 2, such as `Option "file": Use a string or a number.`
  - Every problem names an input by its declared name, the key the caller wrote, so `Unknown option "verbos". Supply the name of a declared option.` and `Command "get" declares no argument "pth". Supply the name of a declared argument.` replace the spelled sentences.
  - `view` selects the starting view, and a name the routed Command's result does not hold is the `@loomcli/core/view-selection` defect named for `invoke()`, such as `invoke() selected view "yaml", which Command "count" does not name.`
  - A `failure` handler maps the translated failure into the outcome after the failure's report is written to `messages`. A malformed call is a defect under the new rule `@loomcli/core/invoke-options`, such as `invoke() received a signal that is not an AbortSignal.`
- Export the types `InvocationValues`, `InvokeOptions`, and `InvocationOutcome`, and add `invoke` to `ActionContext`.
- Add `invokedBy`, `'argv'` or `'name'`, to `FailureViewContext`, `FailureHookContext`, and `SourceContext`, so a failure view, a hint, or a configuration source can tell a run `invoke()` started from one a command line started.

- Change help's failure hint to add no line for an invocation by name, where no command line exists to rerun with `--help`. See [Help's failure hint](docs/plugins/suggestions.md#helps-failure-hint).
- Change the suggestions plugin to offer the declared names of the visible options for an unknown option in an invocation by name, printed as names, such as `Did you mean "verbose"?`. See [Suggestions](docs/plugins/suggestions.md).
- Change the configuration plugin to name an option by its declared name in an invocation by name, as core does there, such as `Option "min-bytes" (from minBytes in .textstat.toml): Use a string or a number.` and `Option "config": File "missing.json" does not exist. Supply the path of an existing file.`

- Add `onGraphBuilt` to a plugin definition, typed by the exported `GraphBuiltHook`. Core calls it once per graph build, after every `onCommandAttach` hook, with the frozen graph `inspect()` returns, on every `run()`, `inspect()`, and `app.invoke()` and never again for an action's `invoke`. A hook rejects the graph by throwing a `DeclarationError`, which reports as itself with exit 1. Any other throw, and any returned value, a promise included, is the build fault `@loomcli/core/broken-graph-hook`, and an `onGraphBuilt` that is not a function is rejected by `plugin()`. See [Judging the built graph](docs/core/lifecycle-hooks.md#judging-the-built-graph).
- Add `mediaType` to every view shape, `View` and `RowView`, bare or declared through `view()`, and add `mediaTypes` to `ResultNode`: each view's declared media type by view name, or `null` where a view declares none. The call that stores a view reads its media type once, and core never checks the string against the text the view writes. A media type that is not a string throws `@loomcli/core/media-type`, such as `Command "count" names view "csv" with a media type that is not a string.` See [Media types](docs/core/results.md#media-types).
- Add `control` to every option config, a local option, a global option, a plugin's option, and an option a lifecycle hook declares, and to every `OptionNode` that `inspect()` returns. It marks an option that controls the invocation rather than feeding the Command's work, reads `false` when omitted, and changes nothing at run time. A value that is not a Boolean throws `@loomcli/core/flag-not-boolean`, and `control` on an argument throws `@loomcli/core/misplaced-listing-fact`. See [Control options](docs/core/commands.md#control-options).
- Change the formatter's `json()` and `jsonl()` to declare `application/json` and `application/jsonl` under every `map`, and mark `--format`, `--help`, `--version`, `--manifest`, and `--config` as control options.
- Change the manifest to carry `control` on every option entry and `mediaTypes` on every result. Its `encodings` statements now apply to the views whose media types they name, never to a view name.
- Fix a development build's converter failure to report as the other build faults do: no `onFailure` hook runs for it, so no hint prints under its Developer Diagnostic.

- Add a failure code to every failure class: a static, kebab-case `code`, read like `exitCode` from the nearest class that declares one and captured at the class's first construction. Core's classes carry fixed codes, such as `unknown-command`, `unknown-option`, `invalid-input`, and `fatal`, an author's class inherits its parent's, and `DeclarationError`, `InternalError`, and `ResultError` read `internal`. See [Failure codes](docs/core/failures.md#failure-codes).
- Add the failure form, `{ code, exitCode, message, hints }`, typed by the exported `FailureForm`: one failure as frozen plain data, with its message and hints as plain text and a defect reading `Something went wrong.` in a distributed build. `invoke()`'s failed outcome and its caller's `failure` handler context carry it as `form`. See [The failure form](docs/core/failures.md#the-failure-form).
- Add `view` and `mediaType` to `FailureViewContext` and `FailureHookContext`: the view the result would render through when the run failed, a middleware's assignment, else the view `invoke()` started with, else the routed Command's default view, and the media type that view declares. Both read `undefined` for a build fault, an unknown command, a Command with no result, and a selected name the result does not hold. See [Failure view context](docs/core/failure-views.md#failure-view-context).
- Add `ownOptions` to the middleware context: the validated value of each option the plugin declared, its global options and the local options its `onCommandAttach` hook declared on the routed Command, whatever fault core holds for another input. Under any held fault, such as an unknown option or a configuration file that cannot be read, core still validates a plugin's own options whose tokens parsed, for `ownOptions` alone, and the held fault stays the one reported. A validator runs at most once per run, so an option whose validator threw is absent and is not validated again. See [Middleware](docs/core/middleware.md).
- Add failure encoders: `encodeFailure(mediaType, encoder)`, typed by the exported `FailureEncoder` and `FailureEncoding`, listed under a plugin's new `failureEncoders`. When a failed `run()` selected a view whose media type an installed plugin encodes, core writes the encoder's text for the failure's form to stderr in place of the failure view and writes no incomplete-result line. A run whose failure no encoder writes, such as a stream cancelled mid-sequence, a stdout that fails, or a broken encoder, still writes that line. A development build writes a defect's Developer Diagnostic first. Two encoders for one media type throw `@loomcli/core/failure-encoder-taken`, and an encoder that throws or returns a value that is not a string reports `@loomcli/core/broken-failure-encoder` with exit 1. `invoke()` calls no encoder. See [Failure encoders](docs/core/failure-views.md#failure-encoders).
- Change the formatter to register encoders for `application/json` and `application/jsonl`, so a failed run under `--format json` or `--format jsonl`, or a Command whose default view is `json()`, writes one line to stderr, such as `{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--metric\": Expected one of: bytes, words, lines.","hints":["Run \"textstat --help\" to see the usage."]}}`. Its middleware reads `--format` from `ownOptions`, so the selection holds under a held fault, `textstat --format json --bogus one.txt` and `textstat --format json -c missing.json one.txt` included. See [Formatter](docs/plugins/format.md).

- Add `WorkingDirectoryError`, the failure a run reports when the process's working directory cannot be read, such as one another process removed. Its failure code is `working-directory-unreadable` and it exits 1. `run()` from a removed directory now writes `<app>: The current working directory cannot be read. Change to a directory that exists and run the command again.` to stderr and resolves 1 instead of rejecting with the platform's error, and `app.invoke` resolves `failed` instead of rejecting. A `host.cwd` override and an action's `invoke` read no working directory from the process, so they never meet it. See [An unreadable working directory](docs/core/host.md#an-unreadable-working-directory).

- Add the MCP plugin, `mcp()` from `@loomcli/plugins/mcp`. It attaches the visible Command `mcp`, which serves every Command that carries an `mcpCommand` value as one tool of a Model Context Protocol server over stdin and stdout, pinned to revision `2026-07-28`, until stdin ends or the run's signal aborts. Each tool call runs the Command through `invoke`, so a call meets the Command's own validation, failures, and exit codes. See [MCP](docs/plugins/mcp.md).
  - A tool's name is the Command's path joined by `_`, each `-` written as `_`, with no application-name prefix, so `scratch create` serves `scratch_create`, and the root's tool is the application name, so jsonkit serves `jsonkit`, `get`, `keys`, and `select`. Its input schema lists the Command's arguments, its local options, and every global option by declared name, minus hidden and control options, each with its published input schema or one derived from its kind.
  - A completed call answers the output and the messages as text, and the output of the first `application/json` view as `structuredContent`. A failed call answers `isError: true`, the failure's report as text, and `structuredContent` `{ exitCode, failure }`, where `failure` is the failure form. A key outside the input schema answers a tool execution error, and an unknown tool or `arguments` that are not an object answer the JSON-RPC error `-32602`.
- Add `mcpCommand`, `mcpInput`, and `mcpArgument` from `@loomcli/plugins/mcp/extension`. `mcpCommand` opts a Command in as a tool, with an optional description for an agent and the effect hints `readOnly`, `destructive`, `idempotent`, and `openWorld`, which the listing projects as the protocol's tool annotations. `mcpInput` and `mcpArgument` give an option or an argument its description for an agent.
- Add three build faults the MCP plugin reports on every build: two opted-in Commands that serve one tool name, `@loomcli/plugins/mcp/tool-name-taken`; `mcpCommand` on a Command with no action, `@loomcli/plugins/mcp/tool-without-action`; and an argument and an option that one tool would list under one name, `@loomcli/plugins/mcp/property-name-taken`, such as `Command "get" declares argument "path" and option "path", which one MCP tool lists under one name.`

## v0.8.0 - 2026-10-05

0.8.0 gives every option one system. A plugin's options are ordinary global options, validated with the application's and typed in every action, and an invocation parses in one pass: routing reads the global options, then the routed Command's words are read against one table of its own options and every global option. Options also gain unadvertised aliases, counted options such as `-vvv`, implied values for a bare `--backup`, and ordered help sections.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.8.0`.

The three migrations below follow from that one change. A plugin option needs no class of its own, so its types and rules become the global option's. A short group may mix a global letter with a Command's letter, so a group that once failed now parses. And an option reads its words by one of four value classes, so a counted or implied option is an ordinary option that every declarer, help page, manifest, and completion script reads the same way.

### Breaking Changes

- Change a plugin's options into global options, with no difference from the ones `globalOption()` declares. Each entry of a plugin's `options` record takes `GlobalOptionConfig`, the configuration `globalOption()` takes: everything `option()` takes except `required` and `validateOmitted`. A plugin's option may now carry a validator, a default of its validator's input type, and every other rule an option declaration meets. `plugin()` rejects `required` and `validateOmitted`, whatever their value, under `@loomcli/core/global-presence-rule`, such as `Plugin "@acme/log" option "level" declares required. Remove required, and check for the value in each Command that needs it.` The rule `@loomcli/core/plugin-option-rule` is removed. See [Global options from plugins](docs/core/plugin-contract.md#global-options-from-plugins).
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

- Change how core reads an invocation. Routing reads the words before the first bare `--` against the global options and the own options of each Command with an action and children, the routed Command's words are read against one table of its own options and every global option, and each owner reads its values, under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md). See [Global consumption and routing](docs/core/commands.md#global-consumption-and-routing).
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

- Add counted options. `type: 'count'` declares an option that takes no value and reads, as a `number`, how many times it was supplied across every spelling, alias, and word, so `-vvv`, `-v -v -v`, and `--verbose -vv` each read `3` and an omitted one reads `0`. A global counted option adds its occurrences on both sides of the Command name. A value attached to a counted spelling, as in `--verbose=3`, is the unexpected-value error, worded to tell the operator to repeat the spelling instead. An environment variable of ASCII decimal digits and a configuration answer of a whole number of 0 or more fill it when no occurrence did. A counted option declares no `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`, which TypeScript rejects and the call rejects under `@loomcli/core/count-option-value-rule`, `@loomcli/core/count-option-multiple`, `@loomcli/core/polarity-on-count`, and `@loomcli/core/implied-on-boolean-or-count`. Help prints its row as `-v, --verbose...`. See [Counted options](docs/core/options.md#counted-options) in the [core reference](docs/core/README.md).
- Add `implied` to a string option, the value a bare spelling supplies. `--backup` and `-b` supply it, an explicit value is attached as `--backup=numbered`, `-bnumbered`, or `-b=numbered`, and a bare spelling never takes the next word. Each run passes the implied value through the option's validator before it reads a token, and a rejected one is the declaration error `@loomcli/core/invalid-implied`. Input sources never supply it. `implied` on a Boolean or counted option and an `implied` that is not a string are rejected under `@loomcli/core/implied-on-boolean-or-count` and `@loomcli/core/implied-not-a-string`. Help prints the option as `-b, --backup[=<control>]` with the fact `implied: <value>`, and completion offers its values only after `=` or the letter. See [Implied values](docs/core/options.md#implied-values) in the [core reference](docs/core/README.md).
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

- Add `aliases` to every option config, a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares alike, so a renamed option keeps its earlier name. Each alias is one more long spelling of the same option, with `--no-<alias>` where the option's polarity generates a negative form, so repetition, input sources, and validation see one option whichever spelling the operator typed. Help, the manifest, completion, and suggestions never list an alias, and `inspect()` reports the declared names as `aliases` on each `OptionNode`. The [core reference](docs/core/options.md#option-aliases) describes the rules.

- Add `manifest({ short })` so an application can choose a short spelling for `--manifest`. Without the setting, the option keeps no short spelling.

- Add ordered help sections for Commands and options through `helpCommand` and `helpInput`. Section paths contain one or two headings, each help page can prioritize its Command and option sections, and matching named sections combine local and global options. Both help variants use the same grouping; applications without section fields retain their existing layout.

- Add `reportedSpelling(option)` to `@loomcli/core`. It returns the spelling a reported problem names an `OptionNode` by, the one core's own validation reports: the long form, a negative-only Boolean option's `--no-<name>`, and otherwise the short form of a `shortOnly` option. A plugin that builds an `InputProblem`, such as a configuration source, names the option the way core does. The [core reference](docs/core/failures.md#failure-classes) describes the rule.

## v0.7.0 - 2026-10-03

0.7.0 is a hardening release. Every declaring call reads its declaration once and reports a declaration it cannot read at that call, a declared default nests at most ten levels, `override()` takes one signature derived from its key, and the configuration plugin reads one TOML, YAML, or JSON file per run. Core also carries its Unicode tables as a JavaScript module, so any bundler can bundle a Loom application.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.7.0`.

The four migrations below share one idea: a fault surfaces where its author can fix it. A throwing getter or an over-deep default fails at the call that declares it rather than inside `inspect()` or a run, a mismatched `override()` replacement names its own type against the one its key expects, and an operator's settings live in one file the application names.

### Breaking Changes

- Add the rule `@loomcli/core/unreadable-declaration`. Every declaring call now reads its declaration once, at the call, copying every own string key, enumerable or not: `argument()`, `option()`, `globalOption()`, and an input a lifecycle hook declares read their config, its `extensions` list included; `plugin()` reads its whole definition, the `options` record and each option's config included; and `new Application()` and `new Command()` read their options. Every later check, every finding, and the graph read that one copy, so a getter runs once and a finding prints the value the rule judged. A read that throws, such as a getter or a proxy trap that throws, or one at any depth of a default, throws a `DeclarationError` from that call, such as `Option "format" config could not be read: boom.`, `Plugin "@acme/log" definition could not be read: boom.`, or `The Application options could not be read: boom.`, with the thrown value as its `cause`. Before, the throw escaped as the raw error, or, inside a default, broke `inspect()` and every plugin that reads the graph.
- Change a declared default to one frozen snapshot that the declaring call takes. The graph publishes it, and a run passes the same frozen copy to the default's validator, so a validator, or an action that receives the validator's output unchanged, can no longer write to an object default. An array default still reaches the action as its own mutable copy, holes included.
- Fix a converter's JSON Schema that holds itself. Core copies it with the same cycle instead of overflowing the stack, so a development build no longer reports it as `@loomcli/core/schema-converter-failed`, and the manifest reports that it cannot encode the schema as JSON. See the [core reference](docs/core/README.md).

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
- Add the exported types `AnyOverrideKey`, every value an override can key on, and `ReplacementView<Key>`, the replacement view one key takes, so a helper generic over the key can type its replacement. See the [core reference](docs/core/views.md).

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

- Change `@loomcli/plugins/config` to read one configuration file per run, never merged: the file `--config` names, or else the first found of the application's `file` in the working directory and then in the home directory, `USERPROFILE` on Windows and `HOME` elsewhere. A broken file in the working directory warns and the lookup goes on to the home directory. See the [core reference](docs/plugins/config.md).
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

- Add `format({ short })` to `@loomcli/plugins/format`, so an application can give `--format` a short spelling such as `-f`. `format()` judges its settings at its own call: settings that are not an object throw `@loomcli/core/not-an-object`, and a short spelling that is not one ASCII letter throws `@loomcli/core/short-alias`, the rule every option's short spelling answers, with a finding that quotes the `format()` call. A spelling another option already holds is the hook-collision build error naming both, and `format()` with no settings still declares `--format` with no short spelling. See the [core reference](docs/plugins/format.md).
- Add `checkShortSetting(settings, declarer)` to `@loomcli/core`, so a plugin factory that takes a short spelling as `{ short }` judges it at its call under core's own rules and names itself in the finding. See [Plugin settings](docs/core/plugin-contract.md#plugin-settings).

- Change `@loomcli/core` to carry its Unicode width tables as a JavaScript module, so it reads no file at run time and any bundler, such as `Bun.build` or Rolldown, can bundle a Loom application that starts under Node and Bun. A distributed build still needs `packet()`, the `Bun.build` plugin from `@loomcli/loom/build`; a bundle made without it is a development build. Core no longer depends on `@rockorager/uucode`, and text measures and pads to the same columns as before. Core's license field reads `MIT AND Unicode-3.0`, because the tables derive from Unicode data, and the package ships the license texts in `licenses/` with a `NOTICE`.
- Change `packet()` from `@loomcli/loom/build` to answer the packet alone. It no longer carries data files into the bundle, and an application bundled without it starts, reads its source packet, `development`, and is a development build. See [Development builds](docs/core/release-facts.md#development-builds).

- Change the optional peer dependency of `@loomcli/loom` from `pnpm` 12.3.2 to 12.8.1, the version that prepares `pnpm-lock.yaml` for a release. The error for a missing pnpm now asks for 12.8.1. `@loomcli/plugins` and `@loomcli/loom` now depend on `zod` `^4.6.5`, and `@loomcli/loom` on `yaml` `^2.9.1`, so a fresh install resolves the newer releases.

- Fix the compiler error for a view whose data type does not match. Under `exactOptionalPropertyTypes`, TypeScript opened it with advice to add `undefined` to the target's properties; it now opens with the data type that does not match. `View` and the failure view mark `row` as `undefined`, and `RowView` marks `render` as `undefined`, so a value with both functions is still rejected.

## v0.6.0 - 2026-09-30

0.6.0 is the failure handling release. A failure class declares its own exit code, a translator turns a foreign throw into one of the application's failure classes, plugins add hint lines under a failure, every message Loom ships says what went wrong and what to do instead, and the manifest lists the failures each Command can raise. `@loomcli/loom` joins the release set as the Loom toolchain. Install it as a development dependency for its `packet()` build plugin.

Pin `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/loom` to `0.6.0`.

An application now has a build. The `loom.packet.json` in the source tree reads `development`, so a defect or a declaration fault prints its Developer Diagnostic for the author. The `packet()` plugin writes `distributed` into the bundle, so an operator sees `<application>: Something went wrong.` An Application given no packet is distributed, so an application that does not adopt the packet shows the generic message for a defect.

The three migrations below share one idea: a fact is declared once, where its owner states it. A failure class declares its exit code on the class, a `text()` pattern carries the author's own sentence, and a plugin, extension, or view takes its identity from its package name.

### Breaking Changes

- Change `LoomError`'s constructor to `constructor(message: string, options?: ErrorOptions)`, which takes no exit code. A failure class declares its exit code once, as `static override readonly exitCode`, and core reads it from the nearest ancestor that declares one; `failure.exitCode` reports the same value. `LoomError` declares 1 and `UsageError` declares 2, so every core class keeps its code. See [Declared exit codes](docs/core/failures.md#declared-exit-codes) and [ADR-0045](docs/decisions/0045-a-failure-class-declares-its-exit-code.md).
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

- Change core's default text for every `UsageError` to open with the application name and a colon in place of `Invalid input: `, so `jsonkit nope` prints `jsonkit: Unknown command "nope". Use one of: doctor, completion, get, keys, select.` An `InputError` that reports several problems opens each problem line with the name, and hint lines from `onFailure` hooks carry no prefix. See [Failure messages](docs/core/failures.md).
- Change `candidates` on `UnknownCommandError` and `NonCallableCommandError` to leave out deprecated children, as completion does. A deprecated Command typed in full still routes. With no candidates, the sentence ends with its fix: `Supply the name of a declared command.` or `Supply the name of a declared subcommand.` See [Failure classes](docs/core/failures.md#failure-classes).
- Change the root's failure with no subcommand to `A command is required.`, followed by its candidates or its fix, and the issue for a validator that rejects with no issues to `The validator rejected this value without an explanation. Supply a different value.`
- Change core's failure sentences to escape every typed token, option spelling, and issue path they quote through `escapeControlCharacters`, so a quoted token cannot reorder the line. The failure's public fields keep the raw values.
- Change the mixed-scope `ShortGroupError` sentence to name only the two letters that disagree, `A short group mixes the global option "-q" with "-m", which is not a global option. Supply global options as separate tokens, and local options after their command name.`, because the rest of the group may hold an inline value such as a secret. `ShortGroupError.token` still holds the whole group. A global value option that is not last in its group, as in `-fhunter2`, is now the `'value-position'` fault that names that option alone, as a local value option is, and no longer a mixed-scope fault that names a letter of its value.
- Change the configuration plugin's `--config` failures to end with their fix: `File "<path>" does not exist. Supply the path of an existing file.`, `could not be read. Supply a file this process can read.`, `is not valid JSON. Correct its syntax, or supply another file.`, and `does not hold a JSON object. Write its settings as one JSON object.` Each warning about a discovered file ends with its fix too: `Make it readable, or remove it.`, `Correct its syntax, or remove it.`, or `Write its settings as one JSON object, or remove it.` See [Configuration](docs/plugins/config.md).
- Change the formatter's `json()` and `jsonl()` encode failure to `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, and for an `undefined` value to `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.` The message no longer includes the engine's reason, which differs between Node.js and Bun; the thrown error keeps the engine's error as its `cause`.
- Add `issueCode(code, { schema, message })` to `@loomcli/validators`. It declares one namespaced issue code, `<package>[/<subpath>...]/<rule-name>` as a diagnostic rule's identity reads, with its parameter schema and its sentence, and returns a frozen descriptor whose `issue(params)` builds a coded issue and whose `read(issue)` returns the typed parameters, or `undefined` for any other issue. See [Issue codes](docs/libs/validators.md#issue-codes).
- Add the catalog's 23 code descriptors, such as `integerRangeIssue` for `@loomcli/validators/integer-range`. Every catalog rejection now carries `code` and `params` beside its message, so an `InputError` view override can reword one catalog sentence with `integerRangeIssue.read(issue)`.
- Change `path()` with no `access` to reject with `Expected a nonempty path with no NUL character.` in place of `Expected a path.`
- Change `text()` to require `message` whenever `pattern` is given, and remove the default sentence `Expected a value that matches the required pattern.` See [text](docs/libs/validators.md#text).

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

- Change `plugin()`, `extension()`, and `view()` to check their identity at the call against one grammar: an npm package name, scoped or unscoped, of lowercase letters, digits, `-`, `.`, and `_` and at most 214 characters with its scope, then zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens. `help`, `@acme/config`, and `@loomcli/plugins/help/page` pass; `Help`, `@acme`, `x//y`, and `x/under_score` throw a `DeclarationError` under `@loomcli/core/invalid-identity`, such as `A plugin declares the identity "Help", which is not a package name with optional kebab-case subpath segments.` with the fix `Name it <package>[/<subpath>...], such as "@acme/notes" or "@acme/notes/page".` An empty identity and one that is not a string report under the same rule. A hand-built descriptor in a plugin's `extensions` list, and so a source binding, is checked when `plugin()` admits the list, with the sentence `Plugin "@acme/notes" holds the extension identity "Not A Valid/ID_", which is not a package name with optional kebab-case subpath segments.` See [Identity and installation](docs/core/plugin-contract.md#identity-and-installation).
- Add `isRuleIdentity(value)` to `@loomcli/core`. It answers whether a value is a string in the grammar of a diagnostic rule's identity, an identity followed by a kebab-case rule name, and `issueCode()` in `@loomcli/validators` checks its code with it. See [Developer Diagnostics](docs/core/declaration-faults.md#developer-diagnostics).

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

- Allow a failure class to declare its own exit code from 1 through 125 as `static override readonly exitCode`, so a `FatalError` subclass such as a registry failure exits 69 wherever it is raised: from an action, a middleware, or a configuration source. A subclass that declares nothing exits with its parent's code. A class that declares 0, a code from 126 up, or a value that is not a whole number throws a `DeclarationError` under `@loomcli/core/failure-exit-code` when it is constructed, whose sentence is `Failure class "RegistryUnavailableError" declares exit code 130.` and whose correction is `Declare a whole number from 1 through 125.` See [Declared exit codes](docs/core/failures.md#declared-exit-codes).
- Add the `sysexits.h` names to `@loomcli/core` as flat constants with literal types, `EX_USAGE` 64 through `EX_CONFIG` 78. `EX_OK` is not exported.
- Change a configuration source's thrown or rejected `LoomError` to report with its class's code, as an action's failure does. A source that calls `out.fatal()` now prints the message alone and exits 1, where it printed a plugin fault. A plain `Error` that no translator answers, and any failure thrown while core reads the answers, stays the plugin fault with code 1.
- Fix a thrown value that inherits from a failure class without being constructed by one, such as `Object.create(FatalError.prototype)`, to report a defect with code 1, whose sentence is `A thrown value inherits from a failure class but was never constructed as one.`, where it exited 0 with nothing on stderr. `run()` now resolves only 0, a code from 1 through 125, 130, or 143.

- Add `application`, `path`, and `hints` to every failure view's context, typed by the exported `FailureViewContext`. `path` holds the canonical Command names routing walked: `[]` before routing, the partial path for an unknown Command, and the routed path otherwise. `override(FailureClass, view)` now types its replacement as the exported `FailureView`, and an override written against `ViewContext` compiles unchanged. See [Failure view context](docs/core/failure-views.md#failure-view-context).
- Add the optional `onFailure` plugin hook, typed by the exported `FailureHook` and `FailureHookContext`. Core calls each installed plugin's hook, in installation order, for every failure `run()` renders after graph build, and the failure's view receives the hints they return. Core's default text prints each hint on its own line under its sentence, and a failure with no hints adds no lines. A hook that throws, returns something other than a string or an array of strings, or returns a promise loses its hints, is reported after the diagnostic as a defect, the generic defect message in a distributed build and a Developer Diagnostic naming the plugin and the reason in a development build, and makes the run return 1 unless it was cancelled. `plugin()` rejects an `onFailure` that is not a function. See [Failure hints](docs/core/lifecycle-hooks.md#failure-hints).
- Change validation to keep every own field of an issue a validator returns, rewriting only `path`, so a field such as a schema library's issue `code` reaches an `InputError` view. See [Issues and validator failures](docs/core/validation.md#issues-and-validator-failures).
- Add `escapeControlCharacters`, which replaces every control character and line separator in raw text, and every bidirectional control and mark, U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, and U+061C, with its lowercase `\uXXXX` escape, so escaped text stays on one line and cannot reorder the rest of it. Other format characters, such as a zero-width joiner or a soft hyphen, pass through. See [Strings and composition](docs/core/styles.md#strings-and-composition).
- Fix a thrown value whose message cannot be read, such as an Error whose `message` getter throws, suppressing the failure it caused. Wherever core reports a thrown value, from an action, a failure view, a hook, a plugin loader, or a configuration source, it now reports `The thrown value has no readable message.` as its reason. See [Failure contract](docs/core/failures.md#the-ordinary-failure-path).

- Add the suggestions plugin, `suggestions()` from `@loomcli/plugins/suggestions`. When an unknown Command or option is near a declared name, the failure's sentence offers that name as its fix, as in `jsonkit: Unknown command "gte". Did you mean "get"?` or `Did you mean one of these: --file, --field?`, in place of core's fix clause. It never offers an alias, a hidden member, a deprecated member, or a short spelling, and with no near name it prints core's text unchanged. An application's own override of either failure class, or of a class above them, still owns the sentence. See [Suggestions](docs/plugins/suggestions.md).
- Change `help()` to add one hint under every usage error that names the help page of the Command routing reached, as in `Run "jsonkit get --help" to see the usage.` A fatal error, an internal error, and a declaration error gain no line. See [Help's failure hint](docs/plugins/suggestions.md#helps-failure-hint).

- Add translators, so a foreign throw such as the `SyntaxError` from `JSON.parse` reports as one of the application's own failure classes, with that class's exit code and view, instead of an internal error with exit 1. `translate(ErrorClass, translator)` pairs an error class with a function that receives the thrown instance, typed from the class, and returns a failure or `undefined` to pass. The Application and each plugin list their translations under `translators`, and they resolve in the order view overrides do: the application's first, then each plugin's in installation order, the thrown value's prototype chain walked in full at each. A throw from an action, from a middleware before its `next()` has settled, and from a configuration source is offered, and so is a destination write failure such as `EPIPE` that the action awaits and lets propagate, and a row source's throw under `out.results()`, whether the action awaited the call, never awaited it, or caught its rejection; for the last two the translated failure replaces the deferred internal error, prints after the incomplete-result line, and sets the exit code a clean run would have left at 0; a `LoomError`, a thrown primitive, a cancellation echo, and a throw from a view, an `onFailure` hook, a validator, or a plugin loader are never offered. A throw no translator answers still reports as an internal error with exit 1. See [Translators](docs/core/failures.md#translators).
- Add the exported `translate`, `Translation`, `Translator`, and `ErrorClass`. A `translators` entry that is not a translation throws a `DeclarationError` from `plugin()` or the Application constructor, and so does `translate()` with a key that is not a class, a key that is a failure class such as `LoomError` or a subclass of `FatalError`, since a failure is never offered to a translator, or a translator that is not a function.
- Change a translator that throws, or returns a value that is not a failure, a promise included, to report a defect under the rule `@loomcli/core/broken-translator` with exit 1. No later translator is consulted. A development build prints its Developer Diagnostic, whose sentence names who registered the translator and the class it was keyed on, such as `The translator the Application registered for "SyntaxError" threw: <reason>`, and which shows the translator's throw and the original throw under it. A distributed build prints the generic defect message. The defect's `cause` is an `AggregateError` that holds the translator's throw and then the original throw, or the original throw alone for a returned value.
- Allow `LoomError`, `FatalError`, `InputError`, and `DeclarationError` to take the platform's `ErrorOptions` as their last constructor parameter, so a failure keeps the error it replaces as `cause`, as in `new InvalidJsonError({ cause: error })`. Core sets no `cause` on a failure it did not construct.

- Add `failures` to `manifestCommand` from `@loomcli/plugins/manifest/extension`, so an author or a plugin's `onCommandAttach` hook declares the failures a Command can raise, each as `{ failure, meaning, name }`: a class that extends `LoomError`, one line of meaning, and a kebab-case name. The value reads the class's declared exit code when it is made. A value that is not a failure class, a class whose static `exitCode` is outside 1 through 125 or whose `exitCode` getter throws, a value whose `prototype` read throws, a name that is not kebab-case, and a meaning that is not one line are rejected at the call. See [Manifest failures](docs/plugins/manifest.md#manifest-failures).
- Change `--manifest` to list each Command's declared failures under `failures` as `{ name, exitCode, meaning }`, in collection order with an identical entry printed once, and `[]` where a Command declares none. `exitCodes` gains a row for each declared code other than 1 and 2 anywhere in the application, hidden Commands included, such as `"65": "Declared failures: invalid-json, path-not-found"`. One failure name declared with two codes or two meanings makes `--manifest` report a declaration fault with code 1 under the rule `@loomcli/plugins/manifest/failure-name-conflict`, whose sentence is `Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".` and whose correction is `Declare one code and one meaning for each failure name.`, with a finding for each declaration that marks the code or the meaning the two disagree on, by build as [Development builds](docs/core/release-facts.md#development-builds) states.

- Add the `packet` Application option and the exported `Packet` type. An application imports its `loom.packet.json` as a JSON module and passes it as `packet`; its `build` reads `development` or `distributed`, and an Application given no packet is distributed. `new Application()` rejects a packet that is not a plain object or whose `build` is neither value, and ignores every other member. See [Development builds](docs/core/release-facts.md#development-builds).
- Change how `run()` reports a defect, an `InternalError` or a `ResultError`, and a declaration fault it meets, a `DeclarationError`. A distributed build writes `<application>: Something went wrong.` through the failure's view, at most once per run, so `override(InternalError, view)` and `override(DeclarationError, view)` replace it, and an `onFailure` hint prints under it. A development build writes the fault's Developer Diagnostic ahead of every view override, with the hints under it. A usage error, a `FatalError`, and an application's own failure class print the same bytes in both builds. The `Invalid declaration: ` and `Internal error: ` prefixes are gone.
- Change a broken failure view and a broken `onFailure` hook to report, after the failure's own text, the generic defect message at most once per run in a distributed build, and one Developer Diagnostic per broken contract in a development build, in place of their `Internal error: ` lines.
- Add `diagnosticRule(identity, { headline, explanation, docs })`, which declares one Developer Diagnostic rule and returns a frozen descriptor, and the exported `DiagnosticRule`, `Finding`, and `DiagnosticParts` types. A rule's identity is `<package>[/<subpath>...]/<rule-name>`, the package name, any kebab-case subpath segments that name the part of the package that owns the rule, and a kebab-case rule name, such as `@acme/retry/retry-limit` or `@loomcli/plugins/manifest/failure-name-conflict`. `new DeclarationError(rule, { sentence, findings, correction }, options)` and `new InternalError(rule, { sentence, correction, cause })` take a rule beside their earlier constructors, and each class carries `rule`, `sentence`, and `correction`, with `findings` on `DeclarationError`. See [Developer Diagnostics](docs/core/declaration-faults.md#developer-diagnostics).
- Change `DeclarationError.message` to hold the fault's whole Developer Diagnostic as plain text at 80 columns, a banner, the sentence, and the rule's other parts, so a fault thrown at an authoring call prints its diagnostic through the runtime's own uncaught-error output. `sentence` holds the sentence alone.
- Add the optional `Host.readSource(path, cwd)`. A development build reads a defect's source through it, for a frame under the working directory and outside `node_modules` alone, and prints the lines around the failing frame with a caret under its column, above the cause chain. The chain prints each error an `AggregateError` holds under `Holds `, and the source comes from the first of them with a frame under the working directory. Process capture supplies a reader that refuses a file outside `cwd` after resolving symbolic links, a path that is not a regular file, and a file larger than 1 MiB.
- Change a validator that throws, rejects, or returns a malformed result to report under the rule `@loomcli/core/validator-failed`, with a full stop after the thrown reason, a finding that marks `validate` on the call that declared the input, and the thrown value as its `cause`. A distributed build shows the generic defect message in its place.
- Publish `@loomcli/loom`, the Loom toolchain, whose public surface is `@loomcli/loom/build`. Install it as a development dependency. It exports `packet()`, a `Bun.build` plugin that writes `distributed` into the packet a bundle or a compiled binary carries and leaves the source packet reading `development`. It also carries into the bundle the data files core's Unicode tables read at run time, without which a bundled Loom application cannot start, and fails the build when a table module reads them in a shape it does not recognize. Build a compiled binary with `Bun.build` and its `compile` option, because the `bun build` command line takes no plugin.
- Change core's invocation-time defects to report under rules of their own: a middleware's bad `view` assignment under `@loomcli/core/view-selection`, a configuration source's rejected answers under `@loomcli/core/source-answers`, a `run()` signal that is not an `AbortSignal` under `@loomcli/core/run-options`, whose sentence and correction are now separate, a graph `inspect()` did not return under `@loomcli/core/foreign-graph`, and a failed destination write under `@loomcli/core/broken-destination`, which writes the generic defect message in a distributed build and its Developer Diagnostic in a development build.
- Change the declaration faults core raises for Commands, names, aliases, nesting, children, actions, results, views, and the description, version, `hidden`, and `deprecated` facts to carry a rule of their own, such as `@loomcli/core/portable-name` and `@loomcli/core/sibling-name-taken`, with findings that rebuild the faulty call under the Command path it sits on, the rule's explanation, and the fix. Each fault's `sentence` holds what is wrong and its `correction` the fix, which its `message` prints after the explanation. A `hidden` value that is not a Boolean reads `Command "fetch" declares hidden that is not a Boolean.` with the fix `Use true or false.` under `@loomcli/core/flag-not-boolean`, and options that are not an object read `Command "get" declares options that are not an object.` or `The Application declares options that are not an object.` under `@loomcli/core/not-an-object`. Every name, identity, and key a declaration sentence quotes prints each control character escaped, and a value that is not a string prints as code, such as `Command name 7 is invalid.` See the Rule columns of [Command declaration errors](docs/core/commands.md#command-declaration-errors) and [Result declaration errors](docs/core/results.md#result-declaration-errors).
- Change the declaration faults core raises for options, arguments, validators, defaults, global options, and environment bindings to carry a rule of their own, such as `@loomcli/core/boolean-option-multiple`, `@loomcli/core/spelling-taken`, and `@loomcli/core/invalid-default`, with findings that mark the key of the faulty call at fault, a finding for each side of a collision, and the rule's explanation. Several sentences now state the key at fault: a Boolean option reads `Option "verbose" is Boolean and declares default.` with the fix `Remove default; use polarity to control its absent value.`, a short alias reads `Option "file" declares a short alias that is not one ASCII letter.`, `shortOnly` with no short alias reads `Option "file" declares shortOnly and no short alias.`, and a global option with a presence rule is fixed by `Remove required, and check for the value in each Command that needs it.` A `multiple`, `shortOnly`, `required`, `variadic`, or `validateOmitted` value that is not a Boolean reads `Command "get" option "file" declares required that is not a Boolean.` with the fix `Use true or false.` A collision with a plugin option, or with an input a plugin's `onCommandAttach` hook declares, reports under the rule the same collision between the application's own inputs breaks, such as `@loomcli/core/option-declared-twice` or `@loomcli/core/spelling-taken`, and its sentence names the plugin. A hook-declared argument or option whose name an input of the other kind holds reports under `@loomcli/core/name-shared-across-kinds`. An `argument()`, `option()`, or `globalOption()` call whose config is missing or is not an object reports under the same rule as `Option "format" declares a config that is not an object.` with the fix `Supply an option config object, such as { type: 'string' }.`, or `Argument "path" declares ...` with `Supply an argument config object, such as {}.`, and no longer throws a TypeError. See [Input declaration errors](docs/core/options.md#input-declaration-errors).
- Change a validator whose JSON Schema converter throws, returns anything but a plain object, or answers with an object core cannot copy, such as one whose getter throws, to be a `DeclarationError` under `@loomcli/core/schema-converter-failed` in a development build, from `run()` and from `inspect()`, naming the input, the target, and the thrown reason, with the thrown value as its `cause`. A development build asks every validated input's converter at build on every run. A distributed build still reads the input's schema as `null`. See [Input schema](docs/core/validation.md#input-schema).
- Change the declaration faults core raises for plugins, extensions, extension values, declared views and overrides, translations, `onCommandAttach` hooks, a plugin theme, the Application's `plugins`, `packet`, `rendering`, and retired `globals` and `failures` options, a failure class's exit code, and `diagnosticRule()` itself to carry a rule of their own, such as `@loomcli/core/slot-taken`, `@loomcli/core/foreign-value`, and `@loomcli/core/invalid-extension-value`, with findings that rebuild the key, the list entry, or the key inside it at fault, and a finding for each entry of a repeat. Several sentences changed: a `plugins` value that is not an array reads `The Application declares plugins that are not an array.`, and a `translators`, `views`, or `extensions` value `... declares translators that are not an array.`, with `views` and `extensions` in its place; an extension descriptor's `collect` that is not a Boolean reports under `@loomcli/core/flag-not-boolean` with the fix `Use true or false.`; a failure class's exit code is fixed by `Declare a whole number from 1 through 125.`; an override keyed on neither a declared view nor a failure class reads `The Application overrides a key that is neither a declared view nor a failure class.`; `translate()` with a failure class as its key is fixed by `Key the translation on the foreign class it replaces.`; a rendering policy reads `The rendering policy is not an object.` and `Rendering color is not auto, always, or never.`; a plugin theme reads `Plugin "@acme/theme" declares a theme that is not a mapping.` and `... theme mapping "highlight" is not an unapplied concrete style chain without semantic tokens.`; and a throwing `onCommandAttach` hook now escapes its reason, keeps the thrown value as `cause`, and gains a fix, as does a hook's spelling collision. See the Rule column of [Plugin declaration errors](docs/core/plugin-contract.md#plugin-declaration-errors).
- Change the declaration faults `@loomcli/plugins` and `@loomcli/validators` raise to carry rules they declare through the public `diagnosticRule()` under their package names and, for a plugin the pack ships as a subpath, that plugin's subpath: `@loomcli/plugins/config/files` for a configuration `files` setting that is not a list of paths, and fifteen catalog rules such as `@loomcli/validators/bounds-order` and `@loomcli/validators/issue-code-config`, each with a finding that rebuilds the factory call and marks the argument or key at fault. A validator that reads the validation context outside a run gains the fix `Call the validator through an Application run, or leave the context unread.` See [Faults at the call](docs/libs/validators.md#shared-rules).

## v0.5.0 - 2026-09-27

0.5.0 is the operator ergonomics release. An option now takes its value from argv, an environment variable, a configuration file, or its default, in that order, through one core input-source stage; the configuration plugin reads layered JSON files; a plugin can attach ordinary Commands to the root; `-h` prints compact help and `--help` the extended page; and the completion plugin prints Bash, Zsh, and Fish scripts that complete Command names, option spellings, and closed-set values without ever evaluating typed text. `@loomcli/validators` joins the release set as a catalog of Standard Schema validators.

Pin `@loomcli/core`, `@loomcli/plugins`, and `@loomcli/validators` to `0.5.0`. The four migrations below share one idea: a rule is checked at the earliest point that knows it, once, in one place. A declaration fault throws at the call, the attach, or the build that first sees it rather than at the first run; each value of a multiple option or variadic argument passes the same validator instead of the list passing once; a global option declares no presence rule, so a Command that needs its value checks for it; and application, Command, and alias names hold to the portable filename set.

### Breaking Changes

- Change when a declaration fault throws. Every authoring call, both constructors, `plugin()`, and every `command()` attach throw `DeclarationError` the moment their data is known to be bad, so a JavaScript author's invalid declaration throws when its module evaluates, with a stack at the offending line, instead of being reported by `run()` or `inspect()`. Only the root's finished-Command rules and lifecycle hook faults still surface from `run()` or `inspect()`, and a default its schema rejects surfaces from `run()` alone. Diagnostics keep their text, except that an invalid Command name now reads `Command name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".` from `new Command()`. See [Declaration faults](docs/core/declaration-faults.md).
- Change the Command graph to nest at most two levels below the root. `command()` on a named Command rejects a child that has children of its own: `Command "cache" attaches child "clear", which has children of its own. Nest Commands at most two levels below the root.` See [Nested Commands and groups](docs/core/commands.md#nested-commands-and-groups).

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

- Change the rule for the application name, every Command name, and every alias to the portable name: `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`. `new Application()`, `new Command()`, and `alias()` throw a `DeclarationError` for any other name: `Application name "bad name" is invalid. Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".`, and the Command and alias diagnostics end with the same correction. Argument, option, and view names keep the declared-name rule: nonempty, not starting with `-`, and without whitespace or `=`. See [Application declarations](docs/core/application.md) and [Command declaration errors](docs/core/commands.md#command-declaration-errors).

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

- Add environment bindings. A local, global, or plugin option that is not `multiple` accepts `env`, the variable that supplies the option when argv does not. A filled value is supplied in every sense: it satisfies `required`, reaches the schema and the validation context's `supplied` record as the raw value, activates a plugin's middleware, and reads to the action exactly as the flag would. An empty variable is unset. A Boolean variable reads `true`, `1`, `false`, or `0`, case-insensitive, and any other value fails with `Option "--verbose" (from VERBOSE): Use true, false, 1, or 0.` A failure on a filled value names its source in parentheses after the option. See [Input sources](docs/core/input-sources.md).
- Add configuration sources. A plugin definition may declare `source: { binding, load }`, and core loads it lazily and calls it once, with the host, the plugin's own option values, the `OptionNode` of every in-scope option that argv and the environment left unfilled, that holds no environment fault, and that carries the binding, the graph `inspect()` returns, and the `out` and `style` a middleware and an action read. Its answers fill after argv and the environment and before the declared default. A resolver that throws an `InputError` reports it as a usage failure with code 2, held like a validation fault in place of every collected problem; every other throw is a plugin fault with code 1, and its `out.results()` call is a `ResultError` of the kind `source`. Core exports `SourceResolver`, `SourceContext`, `SourceAnswer`, and `ContextualStyle`. An application installs at most one source.
- Add `env` to every `OptionNode` that `inspect()` returns and to every option entry of the manifest: the bound variable, or `null`.
- Bind textstat's `--min-bytes` to `TEXTSTAT_MIN_BYTES` and `--total` to `TEXTSTAT_TOTAL`.

- Add plugin Commands. A plugin definition may declare `commands`, a list of Command values that core attaches to the root, in installation and list order and ahead of the application's own Commands. A plugin Command is an ordinary Command: it routes, validates, runs, and appears in help, `inspect()`, and the manifest like any other, and a name or alias that repeats another root child's fails the build. An application whose root declares arguments cannot install a plugin that brings Commands. See [Plugin Commands](docs/core/plugin-contract.md#plugin-commands).

- Add `@loomcli/validators`, a catalog of validators for common input shapes without a schema library: `text`, `integer`, `number`, `port`, `oneOf`, `url`, `uuid`, `date`, and `path`. Each factory returns a Standard Schema value that publishes a sound input schema, so help prints `One of: ...` for a `oneOf` input with no authored line. See the [validators reference](docs/libs/validators.md).
- Add `createValidator` to `@loomcli/validators`, which builds a validator from a parse function and an optional input schema, the same way every catalog factory is built.

- Add the configuration plugin, `config()` at `@loomcli/plugins/config`, with its binding `configInput({ path })` at `@loomcli/plugins/config/extension`. An option that carries the binding reads a dotted path from JSON files: a user file derived from the application name, `$XDG_CONFIG_HOME/<name>/config.json`, `$HOME/.config/<name>/config.json`, or `%APPDATA%\<name>\config.json` on Windows, and the project files `config({ files })` lists, most specific first. Files answer key by key, the first listed winning and the user file last. `--config <path>` reads that file alone. A discovered file that is missing is silent, and one that cannot be read, is not JSON, or is not an object warns once and is skipped, while the named file and a value the option cannot take fail the run with code 2. A string option takes a JSON string or number, a Boolean option a JSON Boolean, and a multiple option an array of strings or numbers. See [Configuration](docs/plugins/config.md).
- Install the configuration plugin in textstat with `.textstat.json` as its project file, and bind `--min-bytes` to `minBytes` and `--total` to `total`.

- Change `-h` to print a compact help page: the extended page without the details and EXAMPLES blocks, with the child hint spelled `-h` and a closing `Run <path> --help for details and examples.` when the extended page holds either block. `--help` prints the page it printed before. `HelpPage` gains `variant`, typed by the exported `HelpVariant` at `@loomcli/plugins/help/views`, so a `helpPage` override can print a page per variant. See [Help variants](docs/plugins/help.md#help-variants).
- Add `spellings` to the middleware context, typed by the exported `PluginOptionSpellings`: the spelling that supplied each of the plugin's own options given as a token, such as `-h`, `--help`, or `--no-total`. An option filled by an input source or left to its default has no entry. See [Middleware](docs/core/middleware.md).

- Add `locate(graph, words)` and the `WordPosition` type. `locate` reads the words of an unfinished invocation against a graph `inspect()` returned, with the parser's own grammar, and reports where the last word sits: a Command name, an option spelling, an option's value, an argument, the passthrough tail, or nowhere. It runs no validator, input source, or middleware, and it throws nothing for any list of strings. See [Locating a word](docs/core/graph-inspection.md#locating-a-word).
- Add `graph` and `command` to the action context. Every action, an application's or a plugin Command's, reads the frozen graph `inspect()` returns for the run and the routed node inside it, the same two values the run's middleware receive. See [Invocation](docs/core/invocation.md).
- Add the completion plugin, `completion()` from `@loomcli/plugins/completion`. It attaches a `completion` Command whose `bash`, `zsh`, and `fish` children print a script the operator's shell sources. On each Tab the script calls the application with the typed words and inserts the canonical Command names, option spellings, and closed-set values that fit the word under the cursor. The scripts are ported from Cobra and never evaluate typed text. See [Completion](docs/plugins/completion.md).
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

- Add accepted values to help pages. An option or argument row states the values its input accepts after its description: an authored `accepts` line, or `One of: …` derived from a closed set of strings in the input schema, up to eight values, when nothing beside the set could narrow it. See [Accepted values](docs/plugins/help.md#accepted-values).
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

- Add `schema` to every `ArgumentNode` and `OptionNode` that `inspect()` returns: the input-side JSON Schema a validated input's validator publishes through the Standard JSON Schema converter, requested for `draft-2020-12`, copied and frozen to every depth, or `null` where the graph holds no published shape. A validator with no converter, an unvalidated input, a Boolean option, and a converter that fails all read `null`. See [Input schema](docs/core/validation.md#input-schema).
- Add the `StandardJSONSchemaV1` type export beside `StandardSchemaV1`, so a hand-written schema declares its converter with the standard's own type.
- Change the formatter's `--format` validator so its declared shape is the enum of the view names and the unadvertised `ndjson` mapping is applied before it, so the option publishes the view names alone. Accepted values and diagnostics are unchanged.

- Add collecting extensions. An extension declared with `collect: true` keeps every value the author or a plugin's `onCommandAttach` hook supplies, in order, instead of replacing the earlier value, and `readExtension` returns them as a read-only list, empty where a declaration carries none. See [Collecting extensions](docs/core/extensions.md#collecting-extensions).
- Allow a lifecycle hook to read a Command's extension values through `AttachedCommand.extensions` and `readExtension`. A value a hook passes to `extend()` is validated at the call, so a hook that catches the rejection continues without the value, and build validates each value once.
- Add `@loomcli/plugins/manifest/extension`, whose collecting extension `manifestCommand` holds the prose and example invocations a Command's manifest entry prints. The help plugin now supplies each Command's help `details` and `examples` to it, so `inspect()` reports them under `@loomcli/plugins/manifest/command` whether or not a manifest plugin is installed.

- Add the manifest plugin, `@loomcli/plugins/manifest`. Installing `manifest()` adds `--manifest`, which prints the routed Command's slice of the graph as JSON for an agent to read before it invokes: the Application's name, version, description, and globals; fixed statements of the token rule, the exit codes, and what the `json` and `jsonl` views print; and the Command's entry with its visible descendants, arguments, options, input schemas, defaults, result, and the `details` and `examples` collected under `manifestCommand`. Hidden members and aliases are omitted, a deprecated member carries its message, and an absent value reads `null`. See [Manifest](docs/plugins/manifest.md).

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

**Validation.** Run the application's TypeScript check and invocation tests. Confirm detached actions infer global schema outputs, unknown keys fail, and existing global CLI spellings still reach their actions. See the [SDK reference](docs/core/commands.md#modular-authoring).

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

**Validation.** Run the application's TypeScript check and output tests under Node and Bun. Compare redirected and terminal output, `NO_COLOR=1`, `TERM=linux`, and multiline messages. Use `width(style.escape(value))` to verify literal data alignment. See the [style reference](docs/core/styles.md) for policy precedence and glyph selection.

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
- Add `result` to every node `inspect()` publishes: `null` where none is declared, and otherwise the unit, the view names in record order, and the default. The [core reference](docs/core/results.md) states the lane and its build rules.
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
- Add `onCommandAttach` to the plugin definition, a lifecycle hook core calls at graph build once per Command, the root first and then each child depth first, with the hooks of the installed plugins composing in installation order. It receives the declaration unlocked as `AttachedCommand`, the facts `inspect()` publishes beside the `argument`, `option`, `views`, and `extend` calls with their types erased, and returns the declaration to build. The exported types are `AttachedCommand`, `CommandAttachHook`, and `ResultView`. The [core reference](docs/core/lifecycle-hooks.md) states the hook and its build errors.
- Add `request` to the middleware context, the routed Command's parsed and validated invocation as the exported `Request`, `null` while core holds a fault and on a group, and `view`, the name of the view the result renders through, which a middleware assigns before the dispatch boundary and reads as the declaration's default until one does. A name the record does not hold is an internal error at the boundary naming the plugin.
- Change the middleware chain to run after local parsing and validation. Core parses the routed Command's tokens and validates the invocation before the first middleware runs, holds the fault it finds, and raises it at the dispatch boundary, the point the chain reaches when its last middleware continues, so a takeover still observes no fault and a wrapper installed ahead of help still reaches help's takeover. The [core reference](docs/core/invocation.md) states the order.

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
- Export the `CommandOptions` type from [core](docs/core/commands.md).

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

See the [core reference](docs/core/README.md) for the exit code table and the [signals and cancellation](docs/core/signals.md) section, and [ADR-0018](docs/decisions/0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) for the decision.

### Changes

- Add plugins. `plugin(identity, definition)` returns a frozen value that an Application installs through `plugins` in its options object, in the order every contribution composes. A plugin holds declarations alone and performs no work when it is created or installed. Build rejects an entry that is not a plugin, an identity installed twice, and an empty identity. See [the plugin contract](docs/core/plugin-contract.md).
- Add plugin options. A plugin declares options under `options` with the parsing keys `type`, `short`, `shortOnly`, `polarity`, `multiple`, `default`, `description`, and `extensions`, and no schema or presence rule. They join the globals table after the application's own globals, so the pre-scan consumes them at any placement with the same value rules and the same diagnostics. Every collision by key or by spelling is a build error. A plugin option reaches its own plugin's middleware alone: an action never receives it.
- Add middleware with declared activation and lazy loading. Core runs the middleware of each installed plugin whose activation matched between routing and the callable check, in installation order, and calls a plugin's `load` only when the chain reaches it. `activate` is `'always'` or a list of the plugin's own option names, evaluated from the pre-scan before any plugin code loads. A middleware receives `options`, `graph`, `command`, `host`, `out`, `signal`, and `next`, takes over by returning without calling `next()`, and reads what it wrapped from the `ChainOutcome` that `next()` resolves.
- Add extensions. `extension(identity, { schema, target })` returns a descriptor that is also a factory, and a declaration lists the values it produces under `extensions` on the Application, on a Command, on any option, and on an argument. Build validates each value once, synchronously, and stores its plain-data output on the graph node under the extension's identity. `readExtension(node, descriptor)` is the typed read; a fact whose plugin is not installed stays inert and is still reported.
- Add failure renderers from plugins. A plugin registers renderers under `failures`, which enter resolution after the application's own in installation order. The same class registered by two contributors resolves first-in-wins.
- Add `scope` and `extensions` to `inspect()`. `globals` holds the application's options and every plugin option in one list, and `scope` reads `'application'` or `'plugin'`. Every `CommandNode`, `ArgumentNode`, and `OptionNode` reports `extensions` as the frozen record its declaration carries, or an empty record.
- Add `signal` to the action context. It is the run's cancellation signal, and it never aborts until a caller or an installed signals owner can abort it.
- Export `plugin`, `extension`, and `readExtension`, with the types `Plugin`, `PluginDefinition`, `PluginOptions`, `PluginOptionValues`, `OptionsOf`, `AnyExtension`, `Extension`, `ExtensionValue`, `Middleware`, `MiddlewareContext`, and `ChainOutcome`.

- Add `@loomcli/plugins`, the first-party plugin pack, which ships each plugin as its own subpath export and has no root export. `@loomcli/plugins/help` contributes the Boolean option `help` with the short spelling `h`, and prints the help page of the routed Command, derived from the graph alone: the masthead, the details the node carries, USAGE, COMMANDS, ARGUMENTS, OPTIONS, GLOBAL OPTIONS, EXAMPLES, and the closing hint. `@loomcli/plugins/version` contributes the Boolean option `version` with the short spelling `V`, and prints `<name> v<version>`, so an Application that declares no version prints `v0.0.0`. Each one takes over the invocation, so the remaining tokens are never parsed and the exit code is 0. `@loomcli/plugins/help/extension` exports the two descriptors a declaration carries for the page: `helpCommand({ details, examples })` on the Application and on a Command, and `helpInput({ placeholder })` on a local, global, or plugin option. The pack declares `@loomcli/core` as a peer dependency at its own version, so one core instance serves the application and its plugins. See [First-party plugins](docs/plugins/README.md).
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

New applications install `@loomcli/core`. The migration below applies to applications built against the unpublished `@loom/core` source package. See the [core reference](docs/core/README.md) for the SDK contract.

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

