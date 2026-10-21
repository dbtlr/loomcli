---
description: "The logging plugin: JSONL log files, rotation, and the console destination."
---

# Logging plugin

This page documents the logging plugin, which writes core's log events as JSONL records to a rotating file or to stderr. An author installs it to keep a record of what an application did.

```ts
// @loomcli/plugins/logging
import type { LogLevel, Plugin } from '@loomcli/core';

type WrittenLevel = Exclude<LogLevel, 'fatal'>;
export type LoggingSettings =
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
    };
export declare class LoggingError extends Error {
  readonly kind: 'unresolved-directory' | 'create-directory' | 'append' | 'rotate';
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
  plugins: [help(), logging({ file: 'collector.jsonl', level: 'debug' })],
});
```

A `log.info('Indexed sessions.', { count: 3 })` in that application's `serve` action appends one line to `~/.local/state/heimdall/collector.jsonl` on Linux:

```json
{"time":"2026-10-10T14:03:22.418Z","level":"info","message":"Indexed sessions.","fields":{"count":3},"application":{"name":"heimdall","version":"0.0.0"},"run":"4bf92f3577b34da6a3ce929d0e0e4736","path":["serve"],"plugin":null}
```

The logging plugin writes each [log event](../core/logging.md) as one JSON record, appended to a file that rotates by size, or written to stderr for a system that captures its own logs. It is an `onLog` hook and nothing else: no option, middleware, view, or slot. [ADR-0070](../decisions/0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) records the decision.

- **Settings.** `logging()` fills each omitted setting with its default and judges none of them, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the settings type bounds each key, and it holds no file key beside `to: 'console'`.
- **The record.** One event is one line: the event as `JSON.stringify` writes it, with its keys in the order `time`, `level`, `message`, `fields`, `application`, `run`, `path`, `plugin`, `failure`, `defect`, an absent key omitted, followed by one newline. Both destinations write the same bytes.
- **The level.** An event below `level` is skipped. A `fatal` event is never skipped by `level`; the destination and failed-write rules still apply to it.
- **The file.** With `to: 'file'`, the default, the plugin writes to a file in the default directory, which it reads from `destination.env` and `destination.platform` alone:

  | Platform | Default directory |
  | --- | --- |
  | `darwin` | `$HOME/Library/Logs/<app>/` |
  | any other | `$XDG_STATE_HOME/<app>/`, or `$HOME/.local/state/<app>/` when `XDG_STATE_HOME` is unset or not absolute |

  `<app>` is the application's name. The plugin resolves the directory through core's [`applicationDirectory('logs', ...)`](../core/installation-record.md), so a `HOME` or `XDG_STATE_HOME` that is empty or not an absolute path counts as unset. The file is `<app>.jsonl` with no `file` setting. A `file` that is a bare or relative name resolves inside the default directory, an absolute one is used as written, and one that starts with `~/` resolves from `destination.env.HOME`, counting only when it is an absolute path. A relative `file` never resolves against the working directory. The plugin creates a missing directory and its parents.
- **Appending.** The plugin appends each record with one synchronous write before its hook returns, so a record survives a `process.exit()` or a kill that follows the call. Several processes may append to one file, and on a local file system each record lands whole.
- **Rotation.** Before a write that would take the file past `maxBytes`, the plugin renames the file to its first copy, shifting each older copy up one, deletes the copy past `keep`, and starts a new file, with no timer. With `keep: 0` the plugin keeps no copy: it deletes the file and starts a new one, as logrotate's `rotate 0` does. A copy's name puts its number before the file's last extension, `collector.1.jsonl`, or after a name with none, `hub.1`. A record larger than `maxBytes` is written whole to the new file. When a rename fails because another process rotated first, the plugin appends to the file now at the path. The plugin takes no lock. Several processes may append to one file and rotate it, and while their rotations follow one another every record stays in the file or a copy until its copy passes `keep`. Two processes that rotate one file at the same instant may each rotate it, and a rename of one can replace a copy the other just moved, so records in the copies can be lost early; every line still lands whole, and later records land in the file.
- **The console.** With `to: 'console'`, the plugin writes each record to `destination.stderr`, and writes nothing when it is `null`. It never writes to stdout, which carries the run's output and, under MCP, the protocol.
- **A failed write.** When the default directory cannot be resolved because a variable it needs is unset, or creating the directory, an append, or a rename fails, the plugin calls `onError` with a `LoggingError`: `kind` names the step, `path` the file or directory, `variable` the unset variable, and `cause` the runtime's error. It calls `onError` synchronously, once for each failure, every record included, ignores what it returns, and the next record tries the file again. With no `onError`, the failure is ignored: the record is lost and the run continues. The plugin writes nothing to stderr of its own. An `onError` that ends the process ends it. One that throws is an author's defect, as [When author code fails](#when-author-code-fails) states.
- **Invocation by name.** Events of an action's `invoke`, MCP tool calls included, reach the outermost run's file or stderr. An `app.invoke` writes the file from the `env` the call captured or its `host` replaced, and nothing to stderr.
- **Names.** `logging`, `LoggingSettings`, and `LoggingError` are exported from `@loomcli/plugins/logging`.

## When author code fails

`onError` is the one author function the plugin calls. An `onError` that throws throws from the plugin's hook, which core reports as a hook's throw under [Observing log events](../core/lifecycle-hooks.md#observing-log-events), and it takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path). An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The plugin calls `onError` once for each failed write and ignores what it returns.
