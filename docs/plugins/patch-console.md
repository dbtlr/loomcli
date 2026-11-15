---
description: "The patch-console plugin: console writes routed through out, above the live regions, while one is drawn."
---

# Patch-console plugin

This page documents the patch-console plugin, which keeps a `console` write from tearing a [live region](../core/output.md#live-region). An author installs it when a dependency writes to the console while the application draws a progress line, a question, or a frame of its own.

```ts
// @loomcli/plugins/patch-console
import type { Plugin } from '@loomcli/core';

export declare function patchConsole(): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { patchConsole } from '@loomcli/plugins/patch-console';
import { progress } from '@loomcli/prompts';

import { migrate } from './database.js'; // calls console.log('applied 0042_users') for each migration

export const ship = new Application('ship', { plugins: [patchConsole()] }).action(async (context) => {
  const line = progress(context, { label: 'Migrating' });
  await migrate();
  await line.end('Migrated');
});
```

```text
$ ship
applied 0042_users
✔ Migrated · 1.2s
```

Without the plugin, core cannot see a write that does not pass through it, so `applied 0042_users` lands where the cursor is: inside the spinner's row, which the next frame then erases or draws over. With the plugin, the line is written through `out`, so core erases the region, writes the line, and draws the region again below it, as it does for every write through `out`.

`patchConsole()` is the patch-console plugin. Its identity is `@loomcli/plugins/patch-console`. It declares no option, no middleware, no Command, no view, no extension, and no setting, and it claims no slot. Its contribution is one lifecycle hook, [`onLiveRegions`](../core/lifecycle-hooks.md#observing-live-regions), so its position in `plugins` changes nothing it does. [ADR-0151](../decisions/0151-the-patch-console-plugin-routes-console-writes-above-the-live-regions-while-one-is-drawn.md) records the decision.

## Opt-in

The plugin replaces members of the global `console`, which the whole process shares, so it is opt-in under [principle 4](../principles.md#4-defaults-not-handcuffs): core installs no plugin, and an application patches a global only when its author installs the plugin that does. An application that leaves the plugin out keeps the rule [Live region](../core/output.md#live-region) states: a write that does not pass through core, such as `console.log` or `process.stderr.write`, lands where the cursor is.

## While a region is drawn

- **When it patches.** The plugin patches the console for one span of the run's live regions: from the `onLiveRegions` call with `'drawn'`, when the run's first region draws a frame, to the call with `'closed'`, when the last frame leaves the stack. [Observing live regions](../core/lifecycle-hooks.md#observing-live-regions) states both points, in stderr's write order. Every region of the run counts, wherever it was opened: the action's, a middleware's, a configuration source's, a question's [input region](../core/output.md#live-region), and a progress line's. A region whose `live` reads `false` draws no frame, so a run whose stderr is not a terminal, a run under `CI` or `TERM=dumb` that asks no question, and a run at verbosity -1 that asks no question leave the console alone for their whole length, and a run that an [invocation by name](../core/invocation.md#invocation-by-name) starts opens no span of its own. A frame `out.draw` writes is not a region's frame and opens no span either.
- **What it replaces.** `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error`, five members of the global `console`, each with a function of the plugin's. It replaces no other member, and no runtime printer. A member the runtime's console builds on one of the five reaches the replacement: Node's `console.trace` calls `console.error`, its `console.assert` calls `console.warn`, and its `console.table`, `console.count`, and `console.group` call `console.log`. Bun's members call none of the five, so on Bun every other member writes as Bun's console writes it.
- **Its stream.** Each write keeps the stream the replaced member writes to: `log`, `info`, and `debug` write to the run's stdout, and `warn` and `error` to the run's stderr. These are the streams the run was given: under `run()` on the real process, the streams the runtime's console writes to, and on a [mock process](../libs/testing.md#mockprocess), the mock's. While the plugin holds the console, its functions never call the members they replaced, so a write reaches the run's stream whether or not that stream is a terminal.
- **The text.** A replaced member formats its arguments as `format(...args)` from `node:util` does and appends one `\n`, on Node and Bun alike. That is the text Node's console writes to a destination that is not a terminal: an object reads as `util.inspect` shows it, with no inspection colors, so on a terminal it lacks the colors Node's console gives it, and on Bun it reads as Node's `util.inspect` shows it, not as Bun's console prints it. `console.group` indents no line a replaced member writes.
- **Through core's output path.** Core writes the text as a message on its stream, with a view that escapes it, so a markup delimiter in the text stays literal. The text then resolves under the run's [rendering policy](../core/styles.md) for that stream, as every write through `out` does, and that policy applies to the control sequences already in the text. So a color a dependency added is removed where color is off for the stream, under `NO_COLOR`, on a pipe, or after an operator's [`--no-color`](color.md). A hyperlink follows the hyperlink policy, and a terminal control such as a cursor movement is removed unless the Application preserves controls. The bytes can therefore differ from what the replaced member would have written.
- **Above the regions.** A write to stderr lands above the regions: core erases them, writes the text, and draws them again below it. A write to stdout does the same when stdout is a terminal too, because stdout then shares stderr's order, under [Live region](../core/output.md#live-region). When stdout is not a terminal, a write to it goes to the run's stdout in stdout's own order, where it cannot reach a frame.
- **Every verbosity.** A replaced member writes at every verbosity, as it does without the plugin, so `console.debug` prints at verbosity 0, and `console.log` prints at verbosity -1 while a question asks. The run's [verbosity](../core/verbosity.md) hides only what `out`'s own lanes hide.
- **Order and completion.** A replaced member returns `undefined` at once, as the runtime's does, but its text is not written inside the call. It takes its place in its stream's write order through `out`, after every write issued through `out` before it, and core writes it once those writes have been written, on a later turn of the microtask queue at the earliest. A run that ends normally waits for it, as it waits for every write through `out`, and an end that comes first writes it, below. A stdout text issued while a row sequence is open on stdout waits for the sequence's last row, as every stdout write does.
- **At the process's end.** A routed text still queued when the process ends is written then, as every queued write through `out` is, under [At the process's end](../core/output.md#at-the-processs-end): at the process's `exit` event, from a `process.exit()` an action or a dependency calls or an uncaught exception, and at a [shutdown](../core/signals.md#the-shutdown)'s end, `SIGQUIT`'s and a second `SIGINT`'s included. So a dependency's `console.error(message)` followed by `process.exit(1)` while a frame is drawn prints the message on stderr, above the region's last frame, which stays on the screen. Core writes it in the order it was queued among the run's writes, and the `'closed'` call that puts the console back comes after it. A region's first frame that the end writes opens no span, so the plugin patches nothing at an end. A write the stream refuses is dropped there as it is for every write at an end, and an end that is neither an `exit` event nor a shutdown's end, such as `kill -9`, writes nothing.
- **Against direct writes.** A routed text is ordered among writes through `out`, not among writes that bypass core. A `process.stdout.write` or `process.stderr.write` a dependency makes right after a routed `console.log` reaches the terminal first, because the direct write happens inside its call and the routed text waits its turn.
- **A failed write.** A write that fails follows core's rules for its stream: a closed reader on stdout ends the run with 141 under [ADR-0104](../decisions/0104-a-closed-reader-on-stdout-ends-the-run-with-141.md), and any other failed write fails the run as a broken destination, under the [ordinary failure path](../core/failures.md#the-ordinary-failure-path).
- **A terminal lend.** While the terminal is [lent](../core/output.md#lending-the-terminal), a replaced member's text is written without erasing or redrawing the stack, as every write through `out` is during a lend.
- **What it does not route.** A write that does not go through one of the five members still lands where the cursor is: `process.stdout.write` and `process.stderr.write`, a child program's output, a console member that calls none of the five, such as Node's `console.dir` and every other member on Bun, and a process warning on Bun.
- **What it does not protect.** A frame an author draws with `out.draw` and erases by its returned row count is not a live region's frame, so it opens no span, and a console write made while only such a frame is on the screen is not routed: it lands inside that frame and breaks the author's count, as it does without the plugin. An author who animates a frame and wants it protected draws it through `out.region()`.

## Process warnings

- **On Node.** Node prints a process warning, one that `process.emitWarning` raised or a deprecation Node reports, through `console.error`, so while the console is patched the warning lands above the regions on stderr, once, through the same route as any `console.error` text. Its text is Node's own. A dependency that raises `process.emitWarning('The cache is full.', { code: 'CACHE_FULL', detail: 'Raise cache.limit.' })` while a region is drawn, as the process's first warning, prints above the region:

  ```text
  (node:48210) [CACHE_FULL] Warning: The cache is full.
  Raise cache.limit.
  (Use `node --trace-warnings ...` to show where the warning was created)
  ```

  Node adds the last line after the process's first warning alone, and names `--trace-deprecation` in it for a deprecation.
- **Node's flags keep working.** The plugin leaves Node's warning printer in place, so `--no-warnings`, `--disable-warning`, `--trace-warnings`, `--trace-deprecation`, `--throw-deprecation`, and `--redirect-warnings` do what they do without the plugin. A warning Node would not print prints nothing with the plugin either.
- **The next tick.** Node prints a warning on the tick after `process.emitWarning` raises it. A warning that prints once the console has come back lands where the cursor is, as it does without the plugin; no frame is on the stack then, so it tears none.
- **On Bun.** Bun's warning printer writes to stderr without calling the console, and the plugin replaces no runtime printer, so a process warning is left to Bun. A warning Bun prints while a region is drawn lands where the cursor is and can tear the frame, as it does without the plugin. An application whose own code raises a warning while a region is drawn writes it through `out.warn` instead.

## When the console comes back

- **At the last frame.** The plugin puts the console back at the `'closed'` call, when the last frame leaves the stack, whether `end()`, the completion of the code that opened the region, a failure, or a cancellation closed the region. Core closes every open region before it writes a failure report, so the report and everything after it reach the console the plugin put back. The next span patches the console again.
- **At the run's end.** No span outlives its run, so the console comes back before `run()` resolves in every outcome: a result, a failure, a cancellation, and a run whose stderr failed. When a [shutdown](../core/signals.md#the-shutdown) ends the process, core makes the `'closed'` call at the shutdown's end, before it calls the `onShutdown` handlers, even when the shutdown budget has run out, and a `process.exit()` made while a frame is drawn gets the call at the process's `exit` event, after core has written the run's queued writes, routed texts included.
- **What it puts back.** Each member the plugin replaced holds again what it held when the plugin patched it, an author's own replacement, a test runner's console, or a test's spy included. A member another library replaced while the console was patched keeps that library's function. A function of the plugin's that still runs after the console came back, because such a library holds it, calls the member it replaced.
- **Outside a region.** While no frame is on the stack, the console holds exactly what it holds without the plugin, so a write behaves as it does without the plugin.

## One console per process

The console belongs to the process, not to the run. When two runs in one process draw live regions at once, such as two tests that run concurrently, the first run whose span opens holds the console, and the replaced members write to that run's streams until its span closes. A span another run opens meanwhile patches nothing, and when the holder puts the console back, a span another run still has open stays unpatched until that run's next `'drawn'` call, so its frames can be torn as they can without the plugin. Two copies of `@loomcli/plugins` in one process share the one holder.

A Command that an action runs through [`invoke`](../core/invocation.md#invocation-by-name) runs in the same process. While the parent run's span is open, a `console.log` its action makes writes to the parent run's stdout, not into the call's captured `output`, as it writes to the process's stdout without the plugin.

## Testing

A test that runs the Application in its own process on [`mockProcess`](../libs/testing.md#mockprocess), with stderr on the mock's terminal, patches the test process's console while a region is drawn, so a `console.log` the action makes then writes to the mock's stdout, and a `console.error` to its stderr. A mock whose terminal holds stderr alone, `terminal: { columns: 80, rows: 24, streams: ['stderr'] }`, keeps stdout off the terminal, and a `console.log` then lands in the mock's stdout in stdout's own order. A spy the test puts on `console.log` before the run sees no call made while the console is patched, so the test reads the mock's streams instead. The plugin puts the console back before the run resolves, a run that fails included, so a test that awaits its run leaves the console as it found it. A `console.log` made outside a region is the test runner's own, as it is without the plugin.

## Faults

`patchConsole()` declares no parameter, so TypeScript rejects an argument and the factory reads none. Installing it twice fails on its [identity](../core/plugin-contract.md#identity-and-installation), as every plugin does.

## Names

`patchConsole` is exported from `@loomcli/plugins/patch-console`, which exports nothing else.
