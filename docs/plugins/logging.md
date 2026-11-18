---
description: "The logging plugin: Destinations with independent levels, file rotation, console records, and OpenTelemetry export."
---

# Logging plugin

This page documents the logging plugin, which writes core's log events as JSONL records to rotating files and stderr, each with its own level. An author installs it to keep a record of what an application did.

```ts
// @loomcli/plugins/logging
import type { LogLevel, Plugin } from '@loomcli/core';

export type WrittenLevel = Exclude<LogLevel, 'fatal'>;
export type LoggingDestinationSettings =
  | {
      readonly to?: 'file';
      /** The log file: a name inside the default directory, an absolute path, or a path under ~/. */
      readonly file?: string;
      /** The lowest level written, info by default. A fatal event is never filtered by level. */
      readonly level?: WrittenLevel;
      /** The size in bytes past which the file rotates, 10_000_000 by default. */
      readonly maxBytes?: number;
      /** How many rotated copies are kept, 5 by default. With 0, a rotation deletes the file. */
      readonly keep?: number;
      /** Called for each failure to resolve, create, append to, or rotate the file. Absent, a failure is ignored. */
      readonly onError?: (error: LoggingError) => undefined;
    }
  | {
      readonly to: 'console';
      readonly level?: WrittenLevel;
    }
  | {
      readonly to: 'otel';
      readonly logger: OpenTelemetryLogger;
      readonly level?: WrittenLevel;
    };
export type LoggingSettings =
  | Exclude<LoggingDestinationSettings, { readonly to: 'otel' }>
  | { readonly destinations: readonly LoggingDestinationSettings[] };
export type LoggingErrorKind = 'unresolved-directory' | 'create-directory' | 'append' | 'rotate';
export declare class LoggingError extends Error {
  readonly kind: LoggingErrorKind;
  readonly path: string | null; // the file or directory; null for unresolved-directory
  readonly variable?: string; // unresolved-directory: the unset variable, such as HOME
  readonly cause?: unknown; // the runtime's error for create-directory, append, and rotate; absent for unresolved-directory
}
export declare function logging(settings?: LoggingSettings): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { logging } from '@loomcli/plugins/logging';

export const heimdall = new Application('heimdall', {
  plugins: [
    help(),
    logging({ destinations: [
      { file: 'collector.jsonl', level: 'debug' },
      { to: 'console', level: 'warn' },
    ] }),
  ],
});
```

A `log.info('Indexed sessions.', { count: 3 })` in that application's `serve` action appends one line to `~/.local/state/heimdall/collector.jsonl` on Linux:

```json
{"time":"2026-10-10T14:03:22.418Z","level":"info","message":"Indexed sessions.","fields":{"count":3},"application":{"name":"heimdall","version":"0.0.0"},"run":"4bf92f3577b34da6a3ce929d0e0e4736","path":["serve"],"plugin":null}
```

The logging plugin writes each [log event](../core/logging.md) as one JSON record, appended to files that rotate by size and written to stderr for a system that captures its own logs, and emits it as an OpenTelemetry log record through the author's own logger. Each logging destination has its own level. It is an `onLog` hook and nothing else: no option, middleware, view, or slot. It logs which file it writes, which `-v` shows, and each rotation, which `-vv` shows. [ADR-0070](../decisions/0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) records the record format and file behavior. [ADR-0177](../decisions/0177-one-logging-installation-writes-to-several-destinations.md) adds several destinations.

- **Several destinations.** `logging({ destinations: [...] })` writes to each entry in list order. Each entry is `LoggingDestinationSettings`, a file with its own `file`, `level`, `maxBytes`, `keep`, and `onError`, a console with its own `level`, or an OpenTelemetry logger as described below. The list allows any number of file, console, and OpenTelemetry entries. An empty list records nothing. There is no predicate setting. A failed file write calls only that file's `onError` and, if the callback returns, later destinations still write. The same JSONL bytes reach every eligible file and console destination; OpenTelemetry entries receive the mapped record below.
- **Settings.** `logging()` fills each omitted setting with its default and judges none of them, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the settings type bounds each key, and each entry holds no file key beside `to: 'console'`.
- **The record.** One event is one line: the event as `JSON.stringify` writes it, with its keys in the order `time`, `level`, `message`, `fields`, `application`, `run`, `path`, `plugin`, `failure`, `defect`, an absent key omitted, followed by one newline. File and console logging destinations write the same bytes.
- **The level.** An event below a logging destination's `level` is skipped for that logging destination alone. A `fatal` event is never skipped by `level`; the logging destination's own rules and the failed-write rules still apply to it.
- **The file.** With `to: 'file'`, the default, the plugin writes to a file in the default directory, which it reads from the log destination's `env`, `home`, and `platform` alone:

  | Platform | Default directory |
  | --- | --- |
  | `darwin` | `<home>/Library/Logs/<app>/` |
  | any other | `$XDG_STATE_HOME/<app>/`, or `<home>/.local/state/<app>/` when `XDG_STATE_HOME` is unset or not absolute |

  `<app>` is the application's name, and `<home>` is `destination.home`, the run's [`host.home`](../core/host.md#the-home-and-temporary-folders). The plugin resolves the directory through core's [`applicationDirectory('logs', ...)`](../core/installation-record.md), so a home or an `XDG_STATE_HOME` that is empty or not an absolute path counts as unset, and an unresolved home is reported under `HOME`. The file is `<app>.jsonl` with no `file` setting. A `file` that is a bare or relative name resolves inside the default directory, an absolute one is used as written, and one that starts with `~/` resolves from `destination.home`, counting only when it is an absolute path. A relative `file` never resolves against the working directory. The plugin creates a missing directory and its parents.
- **Appending.** The plugin appends each record with one synchronous write before its hook returns, so a record survives a `process.exit()` or a kill that follows the call. Several processes may append to one file, and on a local file system each record lands whole.
- **Rotation.** Before a write that would take the file past `maxBytes`, the plugin renames the file to its first copy, shifting each older copy up one, deletes the copy past `keep`, and starts a new file, with no timer. With `keep: 0` the plugin keeps no copy: it deletes the file and starts a new one, as logrotate's `rotate 0` does. A copy's name puts its number before the file's last extension, `collector.1.jsonl`, or after a name with none, `hub.1`. A record larger than `maxBytes` is written whole to the new file. When a rename fails because another process rotated first, the plugin appends to the file now at the path. The plugin takes no lock. Several processes may append to one file and rotate it, and while their rotations follow one another every record stays in the file or a copy until its copy passes `keep`. Two processes that rotate one file at the same instant may each rotate it, and a rename of one can replace a copy the other just moved, so records in the copies can be lost early; every line still lands whole, and later records land in the file.
- **The console.** With `to: 'console'`, the plugin writes each record to `destination.stderr`, the log destination's stream, and writes nothing when it is `null`. It never writes to stdout, which carries the run's output and, under MCP, the protocol.
- **A failed write.** When the default directory cannot be resolved because a variable it needs is unset, or creating the directory, an append, or a rename fails, the plugin calls `onError` with a `LoggingError`: `kind` names the step, `path` the file or directory, `variable` the unset variable, and `cause` the runtime's error. It calls `onError` synchronously, once for each failure, every record included, ignores what it returns, and the next record tries the file again. With no `onError`, the failure is ignored: the record is lost and the run continues. The plugin writes nothing to stderr of its own: the two lines of [At -v and in the log](#at--v-and-in-the-log) are log events core shows. An `onError` that ends the process ends it. One that throws is an author's defect, as [When author code fails](#when-author-code-fails) states.
- **Invocation by name.** Events of an action's `invoke`, MCP tool calls included, reach the outermost run's logging destinations. An `app.invoke` writes the file from the `env` the call captured or its `host` replaced, and nothing to stderr.
- **Names.** `logging`, `LoggingSettings`, `LoggingDestinationSettings`, `WrittenLevel`, `LoggingError`, and `LoggingErrorKind` are exported from `@loomcli/plugins/logging`.

The existing single-destination shorthand remains supported: `logging()`, `logging({ file: 'collector.jsonl', level: 'debug' })`, and `logging({ to: 'console', level: 'warn' })` keep their behavior. With no settings, the plugin writes one default file at `info`. To add a destination, move the existing settings into the `destinations` list beside the new entry. Levels and file settings belong to the entries, with no shared level or file setting.

## At -v and in the log

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Logging to /home/me/.local/state/heimdall/collector.jsonl.` | Once per file entry per outermost run, after the first record the plugin appends to that file in it. A run that appends none writes no line. |
| `-vv` | `Rotated /home/me/.local/state/heimdall/collector.jsonl.` | After each rotation that renamed or deleted the file, with `keep: 0` included. |

The path is the file's absolute path as the plugin resolved it. Console entries write neither line. Each file entry tracks its announcement independently.

- **Where.** The hook logs both lines through the [Log destination's](../core/lifecycle-hooks.md#observing-log-events) `log`, `debug` for `Logging to` and `trace` for `Rotated`, each with the constant template `Logging to {path}.` or `Rotated {path}.` and the path in `fields`. Core shows them as [log lines](../core/logging.md#at--v) at the outermost run's verbosity: under an action's `invoke` and an MCP tool call they follow the parent run, and under `app.invoke` they land in the call's `messages` when its values ask for them. `-v -q` shows neither. Core logs no event before the outermost run's verbosity settles, so every line reads the settled verbosity, and every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition).
- **No recursion.** An event logged through the Log destination's `log` reaches every other installed `onLog` hook and never this plugin's own, so none of its logging destinations holds the plugin's lines, and a line about a record never leads to another record. Another plugin that records events, such as an exporter, receives them.
- **Log events.** The plugin records no [change event](../core/logging.md#change-events): it changes only its own log file. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto the destination's `log`.

## When author code fails

The plugin calls the author's `onError` for a failed file write and `logger.emit` for an OpenTelemetry record. An `emit` that throws takes the same hook failure path and stops later destinations for that event. An `onError` that throws throws from the plugin's hook, which core reports as a hook's throw under [Observing log events](../core/lifecycle-hooks.md#observing-log-events), and it takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path). An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The plugin calls `onError` once for each failed write and ignores what it returns.

## OpenTelemetry destination

Pass your configured OpenTelemetry logger in the destination list:

```ts
import { logs } from '@opentelemetry/api-logs';
import { logging } from '@loomcli/plugins/logging';

export const records = logging({ destinations: [
	{ to: 'otel', logger: logs.getLogger('notes'), level: 'debug' },
	{ to: 'console', level: 'warn' },
] });
```

The author installs and configures the OpenTelemetry SDK, its resource, processors, exporters, and shutdown. Loom adds no runtime OpenTelemetry dependency. `OpenTelemetryLogger` requires only `emit(record: OpenTelemetryLogRecord): void`, structurally compatible with the API Logger. `OpenTelemetryLogger`, `OpenTelemetryLogRecord`, and `OpenTelemetryLogValue` are exported from `@loomcli/plugins/logging`.

Each eligible event calls `emit` once, synchronously, in destination order. The default level is `info`; fatal events always reach it. File and console entries keep their JSONL format. The OpenTelemetry record maps as follows:

| Event | Record |
| --- | --- |
| `time` | `timestamp`, a Date with the same instant |
| `level` | `severityText`, unchanged; `severityNumber`: trace 1, debug 5, info 9, warn 13, error 17, fatal 21 |
| `message` | `body`, the template as written, with no interpolation |
| `fields` | `attributes['loom.fields']`, the complete map, already redacted by core |
| `application.name`, `application.version` | `attributes['service.name']`, `attributes['service.version']` |
| `run` | `attributes['loom.run']` |
| `path` | `attributes['loom.path']`, an array |
| `plugin` | `attributes['loom.plugin']`, the identity or null |
| `failure`, when present | `attributes['loom.failure']`, the complete failure form |
| `defect`, when present | `attributes['exception.type']`, `attributes['exception.message']`, and `attributes['exception.stacktrace']` when it has a stack |

The semantic conventions place `service.name` and `service.version` on the Resource, which the plugin leaves to the author's SDK: set the Resource's `service.name` to the application's name, or an SDK reports `unknown_service:<process>` there beside the record's `service.name`.

Fields and failure forms keep nested JSON values, including arrays and nulls. The bridge copies containers for the SDK and leaves the frozen event intact. Nesting fields under `loom.fields` prevents a field named `service.name` or `loom.run` from replacing record facts. Application identity uses semantic convention names as record attributes; the SDK's resource remains the author's configuration.

A run ID has the shape of a trace ID but establishes no span or trace context. The bridge leaves OpenTelemetry context unset so the SDK can use its active context. No exception detail is invented for a failure that has no defect detail. A logger that throws takes the ordinary hook failure path described above, without retries or a separate error callback. [ADR-0179](../decisions/0179-the-logging-plugin-emits-opentelemetry-records-through-the-authors-logger.md) records the mapping.
