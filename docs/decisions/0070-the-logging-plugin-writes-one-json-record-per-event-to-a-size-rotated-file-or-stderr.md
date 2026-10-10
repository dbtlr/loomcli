---
type: adr
title: ADR-0070 - The logging plugin writes one JSON record per event to a size-rotated file or stderr
description: The first-party logging plugin, @loomcli/plugins/logging, is an onLog hook that writes each log event as one JSON line, appended synchronously to a per-application file in the platform's state or log directory that rotates by size with numbered copies and no timer, or written to stderr for a system that captures logs. A failure to write the file goes to the author's onError, and is ignored without one.
status: proposed
created: 2026-10-10
modified: 2026-10-10
---

# ADR-0070 - The logging plugin writes one JSON record per event to a size-rotated file or stderr

## Context

[ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) makes core deliver log events and write nothing, so a record needs a plugin. The applications that asked for it run as supervised daemons and today keep a timestamped text log beside a rotation timer, because their supervisor held the file open and they could not rename it. Some deployments capture a process's stderr themselves, as journald, Docker, and log shippers do, and want records there instead of in a file. The record must also be readable by a machine, so that a later exporter to an OpenTelemetry collector translates it rather than parses prose.

## Decision

- **One plugin, one hook.** `logging(settings?)` at `@loomcli/plugins/logging` is an `onLog` hook and nothing else: no option, middleware, view, or slot. The author installs it and chooses, at the call, where records go and the lowest level written. A `fatal` event is never filtered by level.
- **One record format.** Each event is one line, the event as `JSON.stringify` writes it in a fixed key order, followed by a newline. The file and the console write the same bytes. A human-readable rendering is not part of logging.
- **The file by default.** Records go to `<app>.jsonl` in the platform's directory, read from the destination's `env` and `platform`: `$XDG_STATE_HOME/<app>/`, or `$HOME/.local/state/<app>/`, on Linux and other Unix systems, `$HOME/Library/Logs/<app>/` on macOS, and `%LOCALAPPDATA%\<app>\Logs\` on Windows, unverified under [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md). A `file` setting names another file inside that directory, an absolute path, or a path under `~/`, and never resolves against the working directory.
- **Synchronous appends.** Each record is appended with one write before the hook returns, so the record of a crash survives whatever follows it, and order needs no queue.
- **Rotation by size, with no timer.** Before a write that would pass `maxBytes`, 10 MB by default, the file becomes its first numbered copy, older copies shift up, the copy past `keep`, 5 by default, is deleted, and a new file starts. The process owns its file, so it renames rather than copying and truncating. The plugin takes no lock, so two processes rotating one file at once may each rotate it, which deletes the oldest copy early; every record still lands whole in the file or a copy.
- **The console as the author's choice.** `to: 'console'` writes records to the destination's stderr, never stdout, and writes nothing under `app.invoke`, whose stderr is `null`. It writes the full record, defect detail included, beside any failure encoder's line; the author who chose it chose that.
- **A failed write goes to the author.** When the directory cannot be resolved or created, or an append or a rename fails, the plugin calls the author's `onError` with a typed `LoggingError` naming the step, the path, the unset variable, and the runtime's cause, once for each failure, and the next record tries again. With no `onError` the failure is ignored and the run continues. Whether a process may continue unlogged has no single answer, so the author decides: ignore, count, alert, or end the process. An `onError` that throws throws from the plugin's hook, which [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) reports as a broken `onLog` hook.

## Considered options

- **Copy-and-truncate rotation on a daily timer.** Rejected. It exists for a file a supervisor holds open, which the plugin's own file is not, and core sets no timers.
- **Age-based rotation.** Deferred. Size bounds disk use, and a quiet daemon whose file never fills needs no rotation.
- **Asynchronous writes.** Deferred. They can lose the last records before a crash, which are the ones that matter; an asynchronous mode can come as a setting for a high-volume application.
- **A readable line on the console.** Rejected for logging. Log-capturing systems parse JSON lines, and one format keeps one rule; a readable rendering belongs to whatever a verbose mode becomes.
- **Withholding defect detail or failure events from the console.** Rejected. The console destination exists for the deployments where that detail is read, and the author chooses it.
- **Failing the run, or warning on stderr, on a failed write.** Rejected. Whether a process may continue unlogged depends on the application, so neither is a default; a warning per run also has no natural scope in a long-lived process.

## Consequences

`@loomcli/plugins` gains a subpath. A daemon's log file is the plugin's, so a service unit that supervises the daemon redirects nothing into a log file. [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) and [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) carry dated entries for the console's records, which are not rendered bytes and not failure text, and [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) for MCP's stderr.

## Status

Proposed. It moves to accepted in the release that ships the logging plugin.

## Changelog

- 2026-10-10: Proposed with the contract.
