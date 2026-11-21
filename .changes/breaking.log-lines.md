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
