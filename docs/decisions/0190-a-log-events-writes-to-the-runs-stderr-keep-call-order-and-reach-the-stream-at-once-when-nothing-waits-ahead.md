---
type: adr
title: ADR-0190 - A log event's writes to the run's stderr keep call order and reach the stream at once when nothing waits ahead
description: What an onLog hook writes to the run's stderr joins the run's stderr order on a terminal and off one, and so does core's log line at -v. Each such write reaches the stream in the call when nothing waits ahead of it, and waits behind the earlier writes otherwise. Once an end has written the run's queue, each goes straight to the stream after whatever was queued since, so a shutdown handler's record prints. A record that waited behind earlier writes is lost to an abort with them, which narrows ADR-0070's crash survival for the console destination. It supersedes ADR-0157's onLog clause.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0190 - A log event's writes to the run's stderr keep call order and reach the stream at once when nothing waits ahead

## Context

[ADR-0157](0157-core-writes-every-queued-write-at-the-processs-exit-and-a-shutdowns-end.md) carries an `onLog` hook's stderr through the run's queue only when that stderr is the run's terminal stderr. Off a terminal the hook writes straight to the stream, so the logging plugin's console destination wrote a record ahead of the warnings, log lines, and progress lines of earlier calls, which were still queued, under `2>run.log` and in CI.

Carrying the hook's write through the queue off a terminal as well fixes the order, but makes every record asynchronous: a queued write reaches the stream on a later turn of the microtask queue at the earliest. Two records were lost that printed before. A record logged and then followed by a long synchronous stretch and `process.abort()`, an out-of-memory crash, or `SIGKILL` never reached the stream, against [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md)'s promise that the record of a crash survives whatever follows it. A record an `onShutdown` handler logs, and the `A shutdown handler failed.` event, were queued after the end had written the queue, so the process exited or died by its signal before they were written.

## Decision

- **One order on stderr.** What an `onLog` hook writes to its destination's `stderr`, when that `stderr` is the run's, joins the run's stderr order, on a terminal and off one. So does core's log line at `-v`. A hook's write to any other stderr goes straight to that stream, as before.
- **At once when nothing waits ahead.** Such a write reaches the stream in the call that makes it when nothing waits ahead of it: no write is queued on the run's stderr, no write whose turn has begun has bytes left to hand to a stream, and no sequence or streamed line holds stderr's order. When stdout shares stderr's terminal, the same holds for stdout. The bytes are the ones its turn would hand to the stream, at the place in the order its turn would take, so the write lands above any open live region as a queued one does. Otherwise it waits behind the earlier writes, in call order.
- **After an end.** Once an end, the process's `exit` event or a shutdown's end, has written the run's queue under ADR-0157, the run has ended. A log line or a hook's write to the run's stderr then goes straight to the stream, after every write queued since the end, which it writes first, in the order queued. So a record an `onShutdown` handler logs, and the `A shutdown handler failed.` event, reach stderr before the process exits or the signal is re-raised. On a terminal it is written below the last frame, without redrawing the regions, because the end has already shown the cursor. Any other write queued after the end stays queued, as ADR-0157 states, until a log write writes it.
- **An abort.** `process.abort()`, `SIGKILL`, and an out-of-memory crash emit no `exit` event, so no end writes the queue. A record written at once survives them, as it did before off a terminal. A record that waited behind earlier writes is lost with those writes.

This supersedes ADR-0157's **What is queued** clause, so far as it carries an `onLog` hook's stderr only when that stderr is the run's terminal stderr, and its implied rule that every write core makes to the run's stderr is queued, for a log line and a hook's write. It narrows ADR-0070's **Synchronous appends** clause for the console destination: a record survives whatever follows it when nothing waits ahead of it on the run's stderr. The file destination is unchanged.

[Logging](../core/logging.md#at--v) and [At the process's end](../core/output.md#at-the-processs-end) carry the contract.

## Considered options

- **Write a hook's stderr straight to the stream off a terminal, as before.** Rejected. A console record lands above the output of earlier calls, the defect this record fixes.
- **Queue every write, the hook's included.** Rejected. Every record becomes asynchronous, so an abort loses a record that printed before, and an end loses every record its shutdown handlers log.
- **Write every pending write at once ahead of each record.** Rejected. A sequence that holds its place, or a streamed line that holds the terminal, would have its place jumped by the writes queued behind it, and the run's order would no longer be the order of its calls.
- **Write every later write straight to the stream after an end, not only log writes.** Rejected for now. A run that outlives a shutdown's end, because another listener holds the signal, still draws regions through the queue, and a straight write would land inside its frames. Log writes after an end are the ones the end's own handlers make.

## Consequences

- Off a terminal, the console destination's records keep call order with the run's log lines, warnings, and progress lines, and a record with nothing ahead of it reaches stderr in the call, so it survives an abort that follows.
- A write handed to the stream in the call leaves nothing behind it, no queued write, promise, or stream listener, so a synchronous loop of log calls with nothing ahead retains no memory for the records, as before the order was carried off a terminal. At `-vv`, each `-v` log line still holds a pending promise, as before this change.
- With `-v`, the log line comes first and is written at once when nothing waits ahead, so the record that follows it is written at once too.
- A record logged while a write is still queued ahead of it, such as right after an unawaited `out.warn`, waits for that write, and an abort before its turn loses both. An `await` on the earlier write before the log call writes the record at once.
- ADR-0157 and ADR-0070 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-19: Proposed with the fix to the console destination's call order off a terminal (LM-544). It supersedes ADR-0157's clause that carries an `onLog` hook's stderr only on a terminal, and narrows ADR-0070's crash survival for the console destination to records with nothing pending ahead of them. ADR-0157 and ADR-0070 carry dated entries.
