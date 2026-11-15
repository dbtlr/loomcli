---
type: adr
title: ADR-0157 - Core writes every queued write at the process's exit and a shutdown's end
description: At the process's exit event and at a shutdown's end, SIGQUIT's included, core writes each live run's queued writes to the run's stdout and stderr synchronously, once per run, in the order they were queued, where it wrote only region frames before, so a message queued just before process.exit prints, with the patch-console plugin or without it. The flush uses the lane's existing flush seam and adds no host surface. A run that ends normally is unchanged, and a run with nothing queued at an end writes what it wrote there before.
status: proposed
created: 2026-11-15
modified: 2026-11-15
---

# ADR-0157 - Core writes every queued write at the process's exit and a shutdown's end

## Context

A write through `out` is queued: the call returns before its bytes reach the stream, and core writes it once every write queued before it has been written. A run that ends normally waits for its queue. [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md) has core write the region frames still queued straight to the terminal at a shutdown's end, and core does the same at the process's own `exit` event, through the `flush` each run hands its signal lane. Neither end wrote any other queued write, so `out.error(message)` followed by `process.exit(1)` printed nothing.

The patch-console plugin of [ADR-0151](0151-the-patch-console-plugin-routes-console-writes-above-the-live-regions-while-one-is-drawn.md) routes a dependency's console writes onto `out` while a region is drawn, so each joins that queue. Without a flush at the end, the plugin would turn a `console.error(message)` followed by `process.exit(1)`, which prints without the plugin, into a message that never prints, at the point an operator most needs it.

## Decision

- **Every queued write, at two ends.** At the process's `exit` event, from a `process.exit()` an action, a middleware, a hook, or a dependency calls, an uncaught exception, or the process's normal end, and at a shutdown's end, `SIGQUIT`'s included, core writes each live run's queued writes to the run's stdout and stderr synchronously, once per run, in the step that writes the queued region frames under ADR-0106, before the `onLiveRegions` hooks' `'closed'` call and the `onShutdown` handlers.
- **What is queued.** The rule covers every write core queues for the run, whatever issued it: a message, a rendered value, a result's rows already rendered, an `out.draw` frame, a region's frame, a failure report, a failure encoder's text, the console text the patch-console plugin routes, and an `onLog` hook's stderr when that stderr is the run's terminal stderr, which is when core carries it through the run's queue. An `onLog` hook's write to any other stderr goes straight to that stream, as a write that bypasses core does. So an author's `out.error(message)` followed by `process.exit(1)` prints without the plugin.
- **Where and in what order.** Each write goes to the stream it was queued for, in the order the writes were queued, on each stream and across both while they share one order. Each is written as its turn would have written it, so a message lands above the regions and the last frame stays below it.
- **What does not change.** A run that ends normally is unchanged, and a run with nothing queued at an end writes, byte for byte, what it wrote there before.
- **What is not promised.** A write the stream refuses is dropped, a write queued after the step is not part of it, and a write the step wrote sends nothing when its turn comes. A write that bypasses core keeps no order against the queued ones, and an end that is neither an `exit` event nor a shutdown's end writes nothing.
- **No new host surface.** The seam is the one region frames already use: the signal lane calls each live run's `flush` at a shutdown's end and at the `exit` event, before the hooks and the handlers, and a stream's `write` hands bytes to it in the call. The flush writes more of the run's queue through that member, so `LaneRun`, `ProcessHandle`, and `SignalSource` keep their shapes.

[At the process's end](../core/output.md#at-the-processs-end) carries the contract.

## Considered options

- **Accept the loss at an early end and state it.** Rejected. The patch-console plugin would print less than the unpatched console at the point an operator most needs the message, an error a dependency reports just before it exits, and the same loss already cut off a message an author queued through `out` without the plugin.
- **A flush of the plugin's own.** Rejected. The plugin has no synchronous path for a text that sits in core's queue, and writing its text straight to the stream would skip the rendering policy and the order among the run's writes. The flush belongs to the queue's owner, and it serves every write, not the plugin's alone.
- **Write only the stderr messages, or only the routed ones.** Rejected. A stdout message that shares stderr's order, or an author's own message, would still be cut off, and the order among the queued writes and the last frame would no longer be the order they were queued in.
- **A synchronous write member on the process handle.** Not needed. A stream's `write` already takes the bytes in the call, which is what the frames' flush relies on, so the handle gains nothing.

## Consequences

- An application, with the patch-console plugin or without it, prints a message it queued just before the process ends, where it printed nothing before.
- ADR-0106's terminal users clause writes only the region frames still queued at a shutdown's end; this record widens it to every queued write and has the process's `exit` event write the same. ADR-0106 carries a dated entry.
- A `mockProcess` never calls its `exit` listeners, so a test of the exit event in its own process calls the listener core adds to the mock's signal source, as core's shutdown tests read the listeners it adds; `@loomcli/testing` gains nothing.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-15: Proposed with the patch-console plugin's contract (LM-390), whose routed console writes join core's write queue. It widens ADR-0106's terminal users clause, which carries a dated entry.
