---
type: adr
title: ADR-0156 - onLiveRegions tells a plugin when a run's live regions first hold a frame and when none does
description: A plugin definition gains a sixth lifecycle hook, onLiveRegions(state, context). Core calls it with 'drawn' at the write that gives a region of the run a frame while none holds one, and with 'closed' at the write after which none does, in stderr's write order, for every live region of the run wherever it was opened. The context carries the run's out with the default destinations. A failure, a cancellation, a shutdown's end, and the run's end all close the span; a run that invoke starts, and a stderr that is not a terminal, never open one. A throw is reported once after the run, as onLog's is.
status: proposed
created: 2026-11-14
modified: 2026-11-15
---

# ADR-0156 - onLiveRegions tells a plugin when a run's live regions first hold a frame and when none does

## Context

[ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) has core write every write through `out` above the open live regions, and leaves a write that does not pass through core where the cursor is, inside a frame. A plugin that moves such writes onto `out`, as the patch-console plugin of [ADR-0151](0151-the-patch-console-plugin-routes-console-writes-above-the-live-regions-while-one-is-drawn.md) moves `console.log`, needs to know when a frame is on the stack. No existing seam tells it:

- A `Region` handle reaches only the code that opened it, so a middleware never sees the action's regions or a question's.
- A middleware's `out` sees only the regions the middleware opens, and a configuration source draws before any middleware runs.
- A progress event reaches only an invocation by name's observer, never under `run()`, and only for a region that reports.
- No lifecycle hook observes a region.

The rejected alternative, a plugin that patches for its middleware's whole span and writes through the middleware's own `out`, patches where no frame can be torn and still misses the regions drawn outside the middleware's span.

[ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md)'s 2026-10-25 entry adds no hook at the start or end of a run and no progress hook, because each would be a second way to do one job, and [Lifecycle hooks](../core/lifecycle-hooks.md) admits a new hook when it reaches a point no `'always'` middleware reaches and serves a use the log events do not.

## Decision

- **A sixth lifecycle hook.** The plugin definition gains `onLiveRegions?: LiveRegionsHook`, where `LiveRegionsHook` is `(state: 'drawn' | 'closed', context: LiveRegionsHookContext) => undefined` and `LiveRegionsHookContext` holds `out`. It is named under ADR-0028's `on<Event>` rule, with the subject in the name and the event in its first argument, as `onLog` carries its event.
- **Every region of the run.** A live region holds a frame from the write of its first frame until the write that moves its last frame into scrollback. A frame an input region or a lend holds still is still held, and a region that closes meanwhile holds its last frame until that frame moves into scrollback. A region whose `live` reads `false` and a region that never draws hold none, and a frame `out.draw` writes is not a region's frame, because its caller erases it, so it opens no span. The hook sees every region of the run wherever it was opened: by the action, a middleware, a configuration source, or a library drawing through one of their `out` channels.
- **Two points, in stderr's write order.** Core calls each installed plugin's hook, in installation order, with `'drawn'` at the write that gives a region of the run a frame while no region of the run holds one, and with `'closed'` at the write after which no region of the run holds a frame. Core calls the `'drawn'` hooks in the same synchronous step as the frame's write, before its bytes, and the `'closed'` hooks in the same synchronous step as the closing write, after its bytes. A point at the `draw` or `end` call would let a write the hook's work releases land before frame bytes still queued, which the regions then erase by a count that no longer holds. Each `'drawn'` is followed by one `'closed'` before the next.
- **Where a span never opens.** A run that `invoke` starts has no terminal, so none of its regions is live and it calls no hook; a frame its parent holds while the action awaits the call keeps the parent's span open. A stderr that is not a terminal makes no region live, and on a terminal under `CI` or `TERM=dumb`, and at verbosity -1, only an input region is live.
- **Where a span always closes.** Core closes every region before it renders a failure report, so `'closed'` comes before the report's bytes. A cancellation closes every region at once. At a shutdown's end, and at the process's own `exit` event, core calls `'closed'` for a run whose span is still open in the step that writes the run's queued writes, frames and messages alike, under [ADR-0151](0151-the-patch-console-plugin-routes-console-writes-above-the-live-regions-while-one-is-drawn.md)'s rule, after their bytes and before the `onShutdown` handlers, so a plugin that moved writes onto `out` restores what it changed after those writes have been written. A run whose closing write never reached stderr, because stderr failed, calls `'closed'` once it has finished its output, before `run()` resolves. So no span outlives its run, and a plugin restores what it changed at `'closed'` without an `onShutdown` handler of its own.
- **The context.** It is the same object at every call of one run, so a plugin tells runs apart by it. `out` is a channel of the run with the default destinations on every Command, as a middleware's is, and follows the output contract a middleware's `out` follows, so a write through it lands above the regions and resolves under the run's rendering policy.
- **It observes.** It returns `undefined` and cannot hold back the write it came with, change a frame, or stop the delivery to a later hook. A hook that throws stays installed, and core reports the run's first throw once, after the outcome and every other report, as it reports an `onLog` hook's first throw; a throw raised after that point, such as one at a shutdown's end, at the process's exit, or at the run's end once stderr failed, is dropped, because no report follows it.
- **Per run.** Each run calls the hooks for its own regions alone, and core keeps no span across runs.
- **Tags and comments.** `LiveRegionsHook` is an input type, `@public`, because the author writes the function and hands it to Loom, as `LogHook` is. `LiveRegionsHookContext` is an output type, `@public @sealed`, under [ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md). Each export and member carries a doc comment under [ADR-0147](0147-every-published-export-and-member-carries-a-doc-comment-and-every-value-an-example.md). `PluginDefinition` gains an optional member, which breaks no author's definition.

[Observing live regions](../core/lifecycle-hooks.md#observing-live-regions) carries the contract.

## Considered options

- **A notice on the middleware's context.** Rejected. A plugin would need a middleware to receive it, and a middleware runs only when the chain reaches it: a configuration source draws before the chain, and a takeover earlier in the chain never loads a later middleware. A hook on the definition reaches every run the plugin is installed in.
- **Patching for the action's whole span, with no seam.** Rejected. It changes a global where no frame can be torn, misses a region a configuration source or a middleware draws outside the action, and would capture an invoked Command's console write that, without the plugin, reaches the process's stdout.
- **The points at the `draw` and `end` calls.** Rejected. A write released at the `end` call would reach the terminal before the closing bytes still queued, and the regions' erase counts rows that no longer match the screen.
- **A hook that returns the function core calls at the close.** Rejected. Every observing hook core calls returns `undefined`, and two calls with a state carry the same two points without a second kind of return.
- **A context with the run's raw streams, as `onLog`'s destination has.** Rejected. A raw write skips the rendering policy and the regions, which are what the hook's user needs. `out` is the one channel that writes above the regions.
- **A builder in `@loomcli/testing` for the context.** Not taken now. The context's `out` is the run's own, so a test runs a small Application on `mockProcess`, as the patch-console plugin's tests do. A builder can follow under [ADR-0146](0146-the-testing-package-builds-the-environment-hooks-context-and-the-log-and-progress-values-a-hook-reads.md)'s pattern.

## Consequences

`@loomcli/core` exports `LiveRegionsHook` and `LiveRegionsHookContext`, its API report gains both, and the plugin definition's report gains the member. An installed plugin with the hook pays two calls per span. The patch-console plugin of ADR-0151 is its first user. ADR-0028 and ADR-0091 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the patch-console plugin's contract (LM-390). It adds a sixth lifecycle hook under ADR-0028's rule, which carries a dated entry, and gives ADR-0091's regions two observed points, which that record's dated entry states.
