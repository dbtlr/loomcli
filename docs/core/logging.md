---
description: "The log events core publishes from the log member of each context, the fields a Log binds and the paths an Application redacts, the message templates they carry, the log lines -v shows, and the onLog hook through which a plugin observes them."
---

# Logging

This page states the log events core publishes from the `log` member of each context, the fields a `log` binds and the paths an Application redacts, the message templates they carry, the log lines `-v` shows, and the `onLog` hook through which a plugin observes them. An author calls `log` from an action or a middleware, the operator reads the log at `-v`, and the [logging plugin](../plugins/logging.md) writes the records.

```ts sketch
interface ActionContext<Args, Options = {}, Result = unknown, Provided = {}> {
  readonly log: Log;
  // ...
}
// MiddlewareContext, SourceContext, and FailureHookContext carry the same member.

interface Log {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  with(fields: LogFields): Log; // a Log whose every event carries these fields, under Bound fields
}
type LogFields = Readonly<Record<string, unknown>>; // any value: the copy turns it into JSON
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEvent {
  readonly time: string; // ISO 8601 UTC with milliseconds, read at the call
  readonly level: LogLevel; // fatal is core's alone
  readonly message: string;
  readonly fields: Readonly<Record<string, JsonValue>>; // the frozen copy
  readonly application: { readonly name: string; readonly version: string };
  readonly run: string; // 32 lowercase hex characters, one per run
  readonly path: readonly string[];
  readonly plugin: string | null;
  readonly failure?: FailureForm; // core's failure events alone
  readonly defect?: LogDefect; // fatal events alone
}
interface LogDefect {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
```

```ts
// src/commands/index.ts
import { Command } from '@loomcli/core';

import { readTranscripts } from '../transcripts.js';

// The action records what it did.
export const index = new Command('index')
  .argument('harness', { description: 'Name the harness whose transcripts to index.', required: true })
  .action(async ({ args, log }) => {
    const { sessions, skipped } = await readTranscripts(args.harness);
    for (const path of skipped) {
      log.debug('Skipped {path}: it holds no session id.', { path });
    }
    log.info('Indexed {count} sessions.', { count: sessions.length, harness: args.harness });
  });

// src/transcripts.ts
export async function readTranscripts(harness: string) {
  // Sample data stands in for reading the harness's transcripts.
  return { sessions: ['session-1'], skipped: [`${harness}/untitled.jsonl`] };
}
```

Core gives author and plugin code a `log`, shows each call as a log line when the run's [verbosity](verbosity.md) asks for it, under [At -v](#at--v), and delivers it as a frozen log event to every installed plugin's [`onLog`](lifecycle-hooks.md#observing-log-events) hook. Core writes no log record of its own: the [logging plugin](../plugins/logging.md) is the first-party plugin that writes records. `out` tells the operator and `log` records, one call for each job, and an operator who types `-v` reads the record as it is made. [ADR-0069](../decisions/0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) records the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) the log lines and message templates.

- **Where.** The action, middleware, [configuration source](input-sources.md), [provider](providers.md#the-opener), and [`onFailure`](lifecycle-hooks.md#failure-hints) contexts carry `log`, in every run, an action's `invoke` and `app.invoke` included. `onCommandAttach` and `onGraphBuilt` receive none: they run at graph build, under `inspect()` and `check()` as well, where no run exists. Each context's `log` is bound to it: a middleware's, a source's, and an `onFailure` hook's name the plugin core is calling, and an action's names the plugin whose `commands` list contributed its [plugin Command](plugin-contract.md#plugin-commands), or a Command above it, and none for any other Command, so the application's own actions, and a nested `invoke` of one, name none. A provider's names none either, because no plugin installs a provider. An [`onEnvironment`](plugin-contract.md#environment-preparation) hook's `log` names its plugin.
- **A call.** `log.info(message, fields)` and its siblings create one event and deliver it to every installed `onLog` before they return. A call returns `undefined`, and a hook's throw never reaches its caller, under [Observing log events](lifecycle-hooks.md#observing-log-events). A message or a field whose value the types reject gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A call creates its event when an installed `onLog` hook hears it or the run's verbosity shows its level, and otherwise creates none and reads nothing from the call, `fields` included.
- **The copy.** Core copies `fields` at the call into plain JSON data and freezes the copy, so a later change to the caller's object changes nothing. The copy is the value `JSON.stringify` produces, `toJSON()` included, so a `Date` reads its ISO string, `undefined`, a function, and a symbol are omitted from an object and read `null` inside an array, a number that is not finite reads `null`, and a class instance keeps its own enumerable properties. Three values differ: an `Error` reads `{ name, message, stack, cause }` with whichever of them it holds, its `cause` copied by the same rule; a `bigint` reads its decimal string; and a value that holds itself reads `"[Circular]"` where it repeats. A property whose read throws throws from the call. Omitted fields read `{}`. A path the Application redacts reads `"[Redacted]"` in the copy, under [Redaction](#redaction), and the fields `with` bound join it, under [Bound fields](#bound-fields).
- **The event.** `time` is `new Date().toISOString()` at the call. `application` is the graph's `name` and `version`, `0.0.0` when the Application declares none. `run` is 16 random bytes from `crypto.getRandomValues`, written as 32 lowercase hex characters: the same on every event of one run and new for each run, each `invoke` and `app.invoke` included, in the format of an OpenTelemetry trace id. `path` is the path a [failure view](failure-views.md#failure-view-context) reads: `[]` before routing, the partial path before an unknown Command, and the routed Command's path after. `plugin` is the identity of the plugin whose `log` it is, or `null`. The event and everything it holds are frozen.
- **Failure events.** Core logs one event for each failure it reports in a run, the primary failure, each fault reported after the outcome, and a host stream that fails a write (`@loomcli/core/broken-destination`), after translation and before `onFailure` hooks run: `message` is the failure form's `message`, `failure` is the [failure form](failures.md#the-failure-form) with no hints yet, and `plugin` is `null`. A defect, which is an `InternalError`, a `ResultError`, or a `DeclarationError` met during a run, logs at `fatal` and also carries `defect`, in both builds: the name and message of the value the run caught, read as a [Developer Diagnostic](declaration-faults.md#developer-diagnostics) reads a cause, from an `InternalError`'s `cause` or from the failure itself, and its `stack` as the runtime formats it, absent when the value has none. Every other failure logs at `error`. What the run writes to stderr is unchanged, so a distributed build still prints the generic defect message. A cancelled run that reports its cancellation silently logs no failure event, and a failure a cancelled run still renders logs like any other. A declaration fault raised at graph build logs none, as no hook runs for it. `fatal` is a level core alone logs: `Log` has no `fatal`, because `out.fatal()` throws and ends the run.
- **Shutdown handler failures.** A run-scoped `onShutdown` handler that throws, under [A handler that fails](signals.md#onshutdown), logs one `error` event: `message` is `A shutdown handler failed.`, `fields` holds `error`, the thrown value copied by the rule above, and `plugin` is the identity of the plugin whose middleware registered the handler, or `null` for an action's. Core delivers it to each `onLog` synchronously, as any call does, and the process ends once the shutdown returns. The shutdown's end has already written the run's queue by then, so its log line, and what a hook writes to the run's stderr for it, go straight to the stream and reach stderr before the process ends, under [A log event's writes](output.md#at-the-processs-end), as does what an `onShutdown` handler logs. A process-scoped handler's throw is dropped, because no run is there to log it. A run-scoped [`onSuspend` or `onResume`](signals.md#suspend-and-resume) handler that throws logs the same event with the message `A suspend handler failed.` or `A resume handler failed.`.
- **Provider close failures.** A provider's close that throws or rejects on a run that already failed or was cancelled, or after an earlier close of the run threw, under [Closing](providers.md#closing), logs one `error` event: `message` is `A provider's close failed.`, `fields` holds `error`, the thrown value copied by the rule above, and `provider`, the provider's name, and `plugin` is `null`.
- **Names.** `Log`, `LogFields`, `JsonValue`, `LogLevel`, `LogEvent`, and `LogDefect` are exported.

## Message templates

A message is a [Message Template](https://messagetemplates.org), as Serilog and the other Message Templates libraries read one: a constant text that names where each value goes, with the values in the event's fields. `log.info('Indexed {count} sessions.', { count: 3, harness: 'claude' })` records the message `Indexed {count} sessions.` with both fields, and `-v` shows `› Indexed 3 sessions. harness=claude`.

- **Placeholders.** `{name}`, where `name` is one or more ASCII letters, digits, and underscores, fills from the field of that name. A string fills as written, and any other value as its JSON text, so `{count}` reads `3` and `{tries}` reads `[1,2]`.
- **Braces.** `{{` writes `{` and `}}` writes `}`. Any other brace is written as it stands, and so is a placeholder whose field the event does not hold, so `{missing}` reads `{missing}`, as Serilog renders a property the event lacks.
- **The record keeps the template.** The event's `message` is the text as written. Core stores no filled copy, so the message stays constant and searchable, and a reader fills it from `fields` as the log line does.
- **What Loom reads.** Core fills named placeholders alone. The standard's capturing operators, `@` and `$`, and its format and alignment parts, such as `{count:000}`, are not placeholders to core, so their braces are written as they stand.

## Bound fields

```ts
// src/commands/serve.ts
import { Command } from '@loomcli/core';

import { answer, requests } from '../server.js';

// The action binds the request's id to every event it logs for that request.
export const serve = new Command('serve').action(async ({ log }) => {
  for await (const request of requests()) {
    const requestLog = log.with({ requestId: request.id });
    requestLog.debug('Received {method} {path}.', { method: request.method, path: request.path });
    requestLog.info('Answered with {status}.', { status: await answer(request) });
  }
});

// src/server.ts
export async function* requests() {
  yield { id: 'r1', method: 'GET', path: '/' };
}

export async function answer(request: { path: string }) {
  return request.path === '/' ? 200 : 404;
}
```

`log.with(fields)` returns a `Log` whose every event carries `fields`, as a pino or winston child logger does. Every `log` has it: the action's, a middleware's, a source's, a provider's, an `onFailure` and an `onEnvironment` hook's, a log destination's, and the self-update plugin's `afterReplace` and refresh contexts', which are an action's.

- **The copy.** `with` copies its fields at once, by the rule under The copy, redaction included, so a later change to the object changes nothing. A property whose read throws throws from `with`.
- **A call's own field wins.** An event's fields are the bound fields with the call's own copied fields beside them, and a field the call's copy holds replaces a bound one of the same name. A field the copy omits, such as one whose value is `undefined`, leaves the bound one in place.
- **Nesting.** `log.with(a).with(b)` carries `a` and `b`, and a field of `b` replaces one of `a` of the same name. The returned `Log` keeps its receiver's plugin and, for a destination's `log`, its rule that the event never reaches the hook whose destination it is. The receiver is unchanged.
- **Placeholders.** A bound field is a field like any other: it fills a placeholder of that name under [Message templates](#message-templates), and it trails at `-v` when the message does not place it, so for a request whose id is `r1`, `requestLog.debug('Answered {requestId}.')` shows `› Answered r1.`.

## Redaction

```ts
import { Application } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import { verbose } from '@loomcli/plugins/verbose';

export const app = new Application('notes', {
  log: { redact: ['password', 'session.token', 'accounts.secret'] },
  plugins: [verbose(), logging()],
});
```

An Application names the field paths whose values no reader of a log event may see, once, as `log: { redact }`. Core applies the list when it copies an event's fields, the bound fields included, so a redacted value reads `"[Redacted]"` in the event every `onLog` hook receives, on the log line `-v` shows, filling a placeholder or trailing, and in every record a logging plugin writes or exports, since each reads that one copy.

- **A path.** A path splits on `.` into object keys, each nonempty, with no escaping and no array index, as the configuration plugin's `strict` paths read. The first key names a field, and each later key a key inside the value before it: `session.token` redacts `token` inside the `session` field, and a `token` field elsewhere keeps its value. A path names keys from the top of the fields alone, so `password` redacts the `password` field and no `password` key below it.
- **Arrays.** A path steps through an array: its next key applies to every item, nested arrays included, so `accounts.secret` redacts `secret` in each item of an `accounts` list. A redacted key whose value is an array reads `"[Redacted]"` whole.
- **What it covers.** A redacted key's whole value reads `"[Redacted]"`, whatever it holds, and a path under a redacted one adds nothing. A path whose key the copy does not hold adds none, and a value the copy omits, such as `undefined`, stays omitted. An `Error`'s copy is an object like any other, so `error.stack` redacts the stack and keeps its name and message. When a declared path redacts an Error copy's `message`, core also redacts that copy's `stack`, because the stack repeats the message.
- **What it leaves.** The message is the template as written, so a value the author writes into the message text itself stays there. A failure event's form, a defect's detail, and the event's other facts are core's, outside the fields, and no path reaches them.
- **Nothing by default.** Loom redacts no name of its own, such as `password` or `token`: an Application that declares no paths keeps every value.
- **A bad path.** A path that is not dotted nonempty keys, such as `''`, `.password`, or `user..token`, is a [declaration error](declaration-faults.md) from the Application constructor, `@loomcli/core/invalid-redact-path`, `The Application redacts ".password", which is not a dotted path of nonempty keys.`, corrected by `List dotted paths of nonempty keys, such as password or user.token.`

[ADR-0176](../decisions/0176-a-log-binds-fields-with-with-and-an-application-redacts-field-paths-from-every-log-event-at-the-copy.md) records bound fields and redaction.

## At -v

```ts sketch
type LogLineLevel = Exclude<LogLevel, 'fatal'>;
interface LogLineField {
  readonly name: string; // marked text, escaped
  readonly value: string; // marked text, escaped
}
interface LogLine {
  readonly level: LogLineLevel;
  readonly text: string; // the message with its placeholders filled, marked text, escaped
  readonly fields: readonly LogLineField[]; // the fields the message does not place, in the event's order
  readonly event: LogEvent; // the event, as every onLog hook receives it
}
declare const logLine: DeclaredView<LogLine>; // @loomcli/core/log/line
```

At verbosity 1, which `-v` sets under the [verbose plugin](../plugins/verbose.md), core shows each log event at `debug`, `info`, `warn`, and `error` as one log line on stderr, and at verbosity 2 it adds `trace`. At 0 and -1 it shows none. A failure event never shows, because core already reported the failure. At `-vv` on a terminal, the example above prints this for a run that skipped one transcript:

```text
› Skipped /home/me/.claude/a.jsonl: it holds no session id.
› Indexed 3 sessions. harness=claude
```

- **Where.** Core shows the line before it hands the event to the `onLog` hooks, from the same frozen event every hook receives, with or without a hook installed. It goes to the outermost run's stderr at that run's verbosity, in call order among the run's other writes to stderr, on a terminal and off one. What an `onLog` hook writes to its destination's `stderr` joins the same order when that `stderr` is the run's, so a record the logging plugin's console destination writes follows its own log line and precedes the warnings, log lines, and progress lines of later calls. The line and the hook's write each reach the stream in the call when nothing waits ahead of them on stderr, so they survive an abort that follows, and otherwise wait behind the earlier writes, which an abort loses with them, under [A log event's writes](output.md#at-the-processs-end). On a terminal, the line goes above any open [live region](output.md#live-region). Under an action's `invoke`, an MCP tool call included, the line follows the parent run, and under [`app.invoke`](invocation.md#invocation-by-name) it lands in the call's `messages` when its values ask for it.
- **Errors.** An Error-shaped field, the `{ name, message, stack, cause }` copy described above under The copy, shows only its name and message, escaped onto one line, whether placed or trailing. Its stack and cause never show on the line; the event and the log record keep the full copy. Its `name: message` text follows the placed-value rule even when it trails, so it is never JSON-quoted.
- **The text.** `text` is the message with its placeholders filled, under [Message templates](#message-templates). `fields` holds every field the message does not place, in the order the event holds them, each shown as `name=value`: a string as written, or as its JSON text when it is empty or holds whitespace, a double quote, or an equals sign, and any other value as its JSON text, so `note=""`, `path="/home/me/My Notes"`, and `tries=[1,2]`. Every character of the message, each name, and each value passes through [`escapeControlCharacters`](styles.md#strings-and-composition) and then `style.escape`, so a line stays one line and writes no control character, and each placed value without whitespace and each `name=value` pair is kept on one row with `nowrap`; placed sentences wrap under the gutter.
- **The look.** The default view writes a gutter, then the text, then the fields, each separated by one space. A `debug`, `info`, `warn`, or `error` line opens with `glyph.pointerSmall` in its level's style, `dim`, `info`, `warning`, or `error`, keeps its text in the terminal's own style, and dims its fields. A `trace` line nests one step deeper, two spaces and `glyph.lineVerticalDashed0`, and fades whole, `dim.faint`. A long line wraps under its gutter, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states for a lane. Off a terminal, the gutter alone tells a trace line from the rest, as the example shows. On a terminal under `NO_COLOR`, a trace line still writes faint: `NO_COLOR` turns off colors, not modifiers.
- **Replacing it.** `logLine` is a declared view, `@loomcli/core/log/line`, so an application replaces its function through `views` as it replaces any [declared view](views.md), and a theme restyles the tokens it uses. Core adds one line break after the view's text unless it ends with one, and writes nothing for the empty string, so an override can drop a line.
- **Names.** `logLine`, `LogLine`, `LogLineField`, and `LogLineLevel` are exported.

## Change events

A first-party plugin records each change it makes outside the process as one `info` event, its change event, from four messages every plugin shares. Each is an `info` event, so `-v` shows it as a log line, such as `› File written. path=/home/me/.config/systemd/user/notes.service`:

| Message | Fields | The change |
| --- | --- | --- |
| `File written.` | `{ path }` | A file created or rewritten, a startup file whose line was added, replaced, or removed included, and an installation record file at each write. |
| `File removed.` | `{ path }` | A file deleted, a leftover staging file included. |
| `Program run.` | `{ program, arguments, code }` | A child program that changes something, once it exits with a code the plugin treats as success. |
| `Binary replaced.` | `{ path, from, to }` | The [self-update](../plugins/self-update.md) Command's rename over the recorded path, with the replaced and the new version. |

- **Fields.** `path` is an absolute path, `program` the program as the plugin starts it, `arguments` the array of words it passes, and `code` the number it exited with. No event carries a child's environment, input, or output, and no first-party plugin passes a secret in `arguments`: each plugin's page names the words it passes.
- **Which plugin.** The event's `plugin` field names the plugin whose `log` raised it, so the events of a plugin Command's action, a middleware, and a hook tell the plugins apart. A refresh after a self-update logs through the self-update action's `log`, so its events name `@loomcli/plugins/self-update`.
- **What records nothing.** A read, a request, a failed change, and a change inside the process record nothing. A failure has the event core logs for it. A directory a plugin creates for a file, or removes once it is empty, records no event of its own, while a skill folder, which the skills plugin places whole, records one under its own path. The configuration plugin, dotenv, the logging plugin, which changes only its own log file, and every plugin that changes nothing outside the process record none.
- **Each plugin's events.** Each plugin's page lists them under its **At -v and in the log** section. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the events.

## When author code fails

An `onLog` hook that throws takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Its timing differs: the throw never reaches the caller of `log`, core keeps calling the hook for every later event, and core reports the hook's first throw once, after the outcome, under [Observing log events](lifecycle-hooks.md#observing-log-events). A hook logs through its destination's `log`, whose events reach every other hook and never the hook itself, so a hook that logs about each event it hears never hears its own. A `log` captured from another context is an ordinary call that delivers its event to every hook, the calling one included, so a hook that logs through it on every event recurses until the runtime's stack overflows, and so do two hooks that each log on every event the other raises; the throw reports as any hook's throw.
