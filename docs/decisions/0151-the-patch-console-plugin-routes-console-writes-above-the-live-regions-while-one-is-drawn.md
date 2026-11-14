---
type: adr
title: ADR-0151 - The patch-console plugin routes console writes above the live regions while one is drawn
description: An opt-in plugin, patchConsole() at @loomcli/plugins/patch-console, replaces console.log, info, debug, warn, and error for each span ADR-0156's onLiveRegions hook reports, and puts each member back at the span's close. Each write keeps its stream, formats as util.format, and goes through the hook's out to the run's own stdout or stderr, so it lands above the regions and obeys the run's rendering policy. Node's process warnings follow console.error and Node's flags keep working; Bun's are left to Bun. The plugin reads no member of process, so it adds no exception to ADR-0107's ban.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0151 - The patch-console plugin routes console writes above the live regions while one is drawn

## Context

[ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) has core write every write through `out` above the open live regions, and leaves a write that does not pass through core where the cursor is. A dependency that calls `console.log`, or a process warning the runtime prints, therefore lands inside a progress line's row while a region is drawn, and the next frame erases it or draws over it. Ink's `patchConsole` and Rich's `redirect_stdout` route such writes by default. Loom cannot route them by default: the console is a global the whole process shares, and under [principle 4](../principles.md#4-defaults-not-handcuffs) core installs no plugin and changes no global. An opt-in plugin is the lane, and [ADR-0156](0156-onliveregions-tells-a-plugin-when-a-runs-live-regions-first-hold-a-frame-and-when-none-does.md)'s `onLiveRegions` hook tells it when a frame is on the stack.

Process warnings reach the terminal differently on the two runtimes, measured on Node 24.22.3 and Bun 1.4.4. Node's warning printer calls the global `console.error` once per warning with its whole text, so a replaced `console.error` receives it, and Node's `--no-warnings`, `--disable-warning`, `--trace-warnings`, and `--redirect-warnings` act inside that printer. Bun's printer writes to stderr without calling the console, and its text and flags are Bun's own, which a replacement printer could not reproduce.

[ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) bans the `process` global, three `node:os` calls, and `node:child_process` in `@loomcli/plugins`, and names each exception in the lint configuration. The global `console` is under none of those bans.

## Decision

- **An opt-in plugin.** `patchConsole()`, at the subpath `@loomcli/plugins/patch-console` under [ADR-0020](0020-first-party-plugins-ship-in-one-package-as-subpaths.md), with the identity `@loomcli/plugins/patch-console`. It takes no setting and declares no option, middleware, Command, view, or extension, and it claims no slot. Its contribution is one `onLiveRegions` hook. The name `console()` was ruled out, because importing it shadows the global `console` in the author's module.
- **For each span.** The plugin patches at the hook's `'drawn'` call and puts the console back at its `'closed'` call, so it patches while a frame of the run is on the stack, for every region of the run wherever it was opened, and nothing outside that span. ADR-0156 closes every span before its run resolves, at a failure, a cancellation, and a shutdown's end included, so the plugin needs no middleware and no `onShutdown` handler.
- **Five members, each on its own stream.** `console.log`, `console.info`, and `console.debug` write to the run's stdout, and `console.warn` and `console.error` to its stderr. Every other member, and every runtime printer, is left alone; a member the runtime's console builds on one of the five, as Node's `console.trace` calls `console.error`, reaches the replacement.
- **The text.** A replaced member formats its arguments as `node:util`'s `format(...args)` and appends one `\n`, on both runtimes, so an object reads with no inspection colors.
- **Through the hook's `out`, never the console.** A replaced member writes its text through the context's `out`: a stdout text as `out.print` with a view that escapes it, and a stderr text as `out.warn` or `out.error` with the same view. A semantic method with a passed view keeps its stream and writes at every verbosity for `print`, `warn`, and `error`, and the text already ends with a line break, so nothing is added. While it holds the console, the plugin never calls the member it replaced, so a write reaches the stream the run was given, a mock's on `mockProcess`, whether or not that stream is a terminal.
- **The run's rendering policy.** The routed text resolves under the run's rendering policy for its stream, which applies to the control sequences already in the text, so a dependency's color is removed under `NO_COLOR` and on a pipe, a hyperlink follows the hyperlink policy, and a terminal control is removed unless the Application preserves controls. The plugin does not promise the bytes the replaced member would have written.
- **Queued, not written in the call.** A replaced member returns at once and its text joins core's write queue, ordered among writes through `out` and not among writes that bypass core. Core writes queued text at no shutdown's end and no process exit, so a text routed just before the process ends, as `console.error(message)` followed by `process.exit(1)` does, is cut off, where the unpatched member writing to a terminal would have printed it. The page states this rather than the plugin flushing text on the way out, which would need a synchronous write path for text that core does not have.
- **Process warnings.** On Node, the replaced `console.error` receives Node's own warning text, so a warning lands above the regions and Node's flags keep working. On Bun, a process warning is left to Bun and can still land in a frame. The plugin replaces no runtime printer and adds no `warning` listener.
- **No process read.** The plugin replaces members of the global `console` and reads no member of `process`, so it adds no exception to ADR-0107's lint configuration, and ADR-0107 carries no entry. Its writes reach the run's streams through `out`, which reaches them through the run's process handle.
- **What it puts back.** Each member it replaced holds again what it held at the patch. A member another library replaced meanwhile keeps that library's function, and a function of the plugin's that still runs afterward calls the member it replaced.
- **One holder per process.** The first run whose span opens holds the console until that span closes, and a span another run opens meanwhile patches nothing. Two copies of `@loomcli/plugins` in one process share the holder.

[Patch-console plugin](../plugins/patch-console.md) carries the contract.

## Considered options

- **On by default, in core.** Rejected under principle 4. A global the whole process shares changes only on the author's choice.
- **Patch for the whole run, or for the plugin middleware's span.** Rejected. The console would hold the plugin's functions where no frame can be torn, a write outside a region would change its order against a dependency's direct `process.stdout.write`, and a middleware's span misses a region a configuration source draws before the chain. ADR-0156 gives the plugin the regions' own span instead.
- **Call the replaced member when stdout is not a terminal.** Rejected. On `mockProcess` the replaced member is the test process's console, so a write the test expects in the mock's stdout would reach the test runner. The run's stdout is the stream the write belongs to.
- **Write the text as it is.** Rejected. Routed text passes through core's output path, so it follows the run's color, hyperlink, and terminal-control policy, as every other write through `out` does.
- **Route through the semantic lanes' own looks.** Rejected. A lane adds a glyph, a style, wrapping, and a verbosity gate that the dependency's write does not ask for; the passed view writes the text alone at the stream's level.
- **Replace Bun's warning printer with one of the plugin's.** Rejected. It cannot reproduce Bun's text, and it would drop Bun's own flags.
- **Drop process warnings from the plugin on both runtimes.** Rejected. On Node the replaced `console.error` routes them with no extra mechanism, and Node's flags keep working.
- **A `warning` listener beside the printer.** Rejected. A listener runs beside the runtime's printer and does not replace it, so Node would print each warning twice and Bun's line would still tear the frame.
- **Inspection colors that follow the run's color decision.** Rejected. Node's inspection styles include bold and underline, which `NO_COLOR` does not remove, so a colored `util.inspect` would leave a style where Node's console leaves none.

## Consequences

- An application that installs the plugin sees a dependency's console lines, and on Node its process warnings, above its progress lines and questions, on the stream each would use without the plugin, resolved under the run's rendering policy.
- A test that runs an Application with the plugin in its own process patches that process's console while a region is drawn, and the plugin puts the console back before the run resolves.
- The subpath is wired as every first-party plugin is: the package's exports map, the plugins README, its API report, a doc comment on each export and member and an `@example` on `patchConsole` under [ADR-0147](0147-every-published-export-and-member-carries-a-doc-comment-and-every-value-an-example.md), `@public` on `patchConsole` under [ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md), the plugins index page, and the packed-tarball check.
- ADR-0091's rule that a write that does not pass through core lands where the cursor is stands without the plugin. ADR-0091 carries a dated entry.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the patch-console plugin's contract (LM-390). It gives the console writes that ADR-0091 leaves where the cursor is an opt-in route above the regions, through ADR-0156's hook. ADR-0091 carries a dated entry.
