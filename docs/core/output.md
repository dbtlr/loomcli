---
description: "The out methods an action writes through: the semantic lanes, rendered and drawn views, live regions, and progress events."
---

# Output

This page states the `out` methods an action writes through: the semantic lanes, rendered and drawn views, live regions, and progress events. An author uses it to decide what an action prints and where it goes.

| Method                       | Default destination | Return          |
| ---------------------------- | ------------------- | --------------- |
| `out.print(message)`         | stdout              | `Promise<void>` |
| `out.info(message)`          | stderr              | `Promise<void>` |
| `out.success(message)`       | stderr              | `Promise<void>` |
| `out.warn(message)`          | stderr              | `Promise<void>` |
| `out.error(message)`         | stderr              | `Promise<void>` |
| `out.debug(message)`         | stderr              | `Promise<void>` |
| `out.trace(message)`         | stderr              | `Promise<void>` |
| `out.render(data, view)`     | stdout              | `Promise<void>` |
| `out.draw(data, view)`       | stderr              | `Promise<number>` |
| `out.region(options?)`       | stderr              | `Region`        |
| `out.results(value)`         | stdout              | `Promise<void>` |
| `out.fatal(message)`         | Failure path        | `never`         |

The `results` row holds on a Command that declares a result, where the action's `print` and `render` move to stderr as [Results](results.md) describes; on every other Command `results` takes a `never` argument and the other rows hold as written. Messages are marked strings. The seven semantic methods render through core's lane views, described under [Views](views.md), and append one newline. `print` has no prefix. By default the other methods add their matching glyph and one space, `debug` and `trace` their gutters under [Verbosity](verbosity.md), and indent continuation lines by the measured gutter, without repeating the glyph; that gutter belongs to the lane view, which an application can override. Those six lanes also wrap the message at the destination's `columns`, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states. The run's [verbosity](verbosity.md) decides whether `info`, `success`, `debug`, and `trace` write, and `print`, `warn`, and `error` write at every verbosity. Semantic method identity remains distinct inside core. `out.render` is the neutral render call, and [Rendered output](#rendered-output) describes it.

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. What a caught rejection means for the run is under [the ordinary failure path](failures.md#the-ordinary-failure-path): a caught view rejection leaves the outcome to the code that caught it, and a failed destination write still fails the run.

Writes preserve call order within a destination. Separate stdout and stderr captures have no shared observable order. While a [live region](#live-region) is drawn and stdout is a terminal too, stdout writes share stderr's order, so a result row lands above the region. A row sequence open on stdout holds its place in stdout's order alone: a stdout write issued behind it waits for its last row, and a stderr write issued meanwhile, one its row source awaits included, does not. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns its class's code: 1, unless a subclass declares another under [Declared exit codes](failures.md#declared-exit-codes). A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

A closed reader on stdout ends the run with 141, and any other failed write returns 1, under [the ordinary failure path](failures.md#the-ordinary-failure-path).

## Rendered output

```ts
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: undefined; // a view has one shape; the row view of Results is the other
  mediaType?: string; // the media type of the text it writes, under Media types
}
```

A view is a pure synchronous value that turns one typed value into marked text. Its `render` function, the view function, receives the data and an immutable context with `style`, `width(text)`, `plain(text)`, `columns`, `wrap(text, columns)`, `expandTabs(text)`, and the run's [`background`](background.md), which a failure view's context extends with where the run was and the plugins' hints, under [Failure view context](failure-views.md#failure-view-context). It holds no output handle. Core reads the destination's width just before it calls the view function, so `columns` is the width at that render. Existing one-argument view functions remain valid. Escape raw data with `style.escape()` before interpolating it into authored text. `out.render` is the neutral render call: a rendered value has no purpose and no destination parameter.

Newline ownership belongs to the write site, not to the view type. `out.render` and a failure diagnostic append nothing, so a view rendered through either owns its trailing newline. A semantic method appends one newline after its lane view, so a lane view returns none. Each write site below states which rule it follows.

`out.render(data, view)` resolves the view's marked text for its destination, stdout, or stderr from the action of a Command that declares a [result](results.md), then writes it without adding a newline. The second argument is either a bare view, as below, or a [declared view](views.md) that a plugin or core exported. A bare view is a view the action chose at the call site, and nothing can replace it. A declared view carries an identity, so an application can replace its function through `views` without touching the call site. `out.render` also accepts an iterable with a row view, the shape [Row views](results.md#row-views) defines, and writes the sequence as the iterable yields it.

```ts
import { Application } from '@loomcli/core';
import type { View } from '@loomcli/core';

interface Row {
  count: number;
  source: string;
}

const table: View<readonly Row[]> = {
  render: (rows, { style }) => rows.map((row) => `${String(row.count)}  ${style.escape(row.source)}\n`).join(''),
};

const app = new Application('counts')
  .argument('files', { required: true, variadic: true })
  .action(({ args, out }) => {
    const rows: readonly Row[] = args.files.map((source) => ({ count: source.length, source }));
    return out.render(rows, table);
  });
```

A rendered value has no semantic identity: no purpose parameter and no destination parameter. The seven semantic methods keep their string-only signatures and their own destinations.

Core calls a whole view's function synchronously inside the `out.render` call, then queues its text on the destination; a row view's functions run as the iterable yields, under [Row views](results.md#row-views). Call order within a destination holds across both forms, so a rendered table and a plain `print` write in the order the action issued them. The optional-await contract is unchanged: the returned promise resolves on write completion and rejects on a view or write failure, and what a caught rejection means for the run is under [the ordinary failure path](failures.md#the-ordinary-failure-path).

The type parameter is inferred from the value, so `out.render(rows, table)` checks the view against the rows it receives. A view for another value type, and one that returns anything but a string, are compile errors.

### Drawing on stderr

`out.draw(data, view)` renders a view to stderr for a frame an operator watches, which the caller erases and redraws itself. It takes the arguments `out.render` takes, a bare view or a declared view and its data, and it renders the same way: the view function, the application's override when one applies, runs synchronously inside the call, its marked text resolves under stderr's rendering policy, the result is queued on stderr in call order with every other `out` write to stderr, and no newline is added. Three things differ. The promise resolves, on write completion, to the number of terminal rows the drawn text moved down: its line breaks, plus the extra rows each line wraps onto at `host.terminal.stderr.columns`, the real width read at that draw and never the `COLUMNS`-narrowed one, because the terminal soft-wraps at its real width, measured as [`width`](styles.md#width-padding-and-multiline-lanes) measures, and its line breaks alone when the width is unknown; control sequences count no width. A caller that redraws what it drew, whatever view rendered it, returns the cursor to column 0, moves up exactly the rows it drew, and erases to the end of the screen. The destination is always stderr, on a Command that declares a result as on any other. And when `host.terminal.stderr.isTTY` is true and the terminal [redraws in place](#live-region), terminal control sequences the text holds, such as cursor movement and erasure, are kept for that call alone, as `terminalControls: 'preserve'` keeps them for the whole application; every other write site, and a draw to a stderr that is not a terminal or does not redraw, keeps the Application's setting, so a redirected stderr or an invocation by name's `messages` never receives a cursor movement core would otherwise strip. The types reject a row view, and core adds no rule for one: from JavaScript, it fails the call as a view that breaks does. The caller decides when to draw.

On a terminal, `out.draw` is a region of one frame that core writes as it writes every other write to stderr: above every open [live region](#live-region), with no line break added, never held by an open input region, and at every verbosity. With no region open it writes exactly as before. Its count is still measured at the width read at its own draw, so a caller that erases by it keeps working, and its call order, its control sequences, and its bytes off a terminal are unchanged. A [question](../libs/prompts.md) opens an input region and does not draw through `out.draw`.

## Live region

```ts
import type { View } from '@loomcli/core';

interface RegionOptions {
  readonly input?: boolean; // the region reads the operator's keys, as a question does
}
type RegionCloser = 'end' | 'completion' | 'failure' | 'cancellation';
interface ProgressReport {
  readonly completed?: number;
  readonly total?: number;
  readonly label?: string;
}
interface Region {
  readonly live: boolean; // whether core draws this region's frames
  readonly signal: AbortSignal; // aborted whenever the region closes
  readonly closedBy: RegionCloser | undefined; // undefined while the region is open
  draw<Data>(data: Data, view: View<Data>): Promise<void>;
  end(state?: 'ended' | 'failed', label?: string): Promise<void>;
  report(progress: ProgressReport): void;
}
interface Out<Result = unknown> {
  // ...the members under Output and failures...
  region(options?: RegionOptions): Region;
}
```

```ts
import { Application, glyph } from '@loomcli/core';
import type { View } from '@loomcli/core';

import { waitForBuild } from './build.js';

const waiting: View<number> = {
  render: (tick, { style }) => `${style.highlight('.'.repeat((tick % 3) + 1).padEnd(3))} Waiting for the build`,
};
const built: View<string> = {
  render: (id, { style }) => `${style.success(glyph.success)} Build ${style.escape(id)} is ready.`,
};

const app = new Application('ship').action(async ({ out }) => {
  const region = out.region();
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    void region.draw(tick, waiting);
  }, 250);
  region.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  region.report({ label: 'Waiting for the build' });
  await region.draw(tick, waiting);
  const id = await waitForBuild();
  clearInterval(timer);
  await region.draw(id, built); // the last frame stays in scrollback
  await region.end();
});
```

A live region is an area at the bottom of stderr that core redraws in place while it is open. `out.region(options?)` opens one, and its handle draws frames into it until it closes. [Questions](../libs/prompts.md) and [progress lines](../libs/prompts.md#progress) both draw in regions, and an author draws in one by hand, as above. An action, a middleware, and a configuration source reach it on `out`. [ADR-0091](../decisions/0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) records the decision.

- **Stacked in open order.** Every open region sits at the bottom of stderr, below everything else the run wrote, in the order the regions opened, the oldest on top. `draw` replaces its region's frame in place, and the regions below it move with its height. A region that has not drawn, or whose frame is empty, takes no rows. Core starts each frame on a row of its own, separating it from the frame above with one line break when that frame does not end with one, and leaves the cursor at the end of the bottom frame. When the write before the stack ends partway along a row, the stack starts on the next row.
- **Every other write lands above.** While a region is drawn, core erases the regions before every other write to stderr, writes it, and redraws them below it. That covers the semantic lanes, the `debug` and `trace` lines of [Verbosity](verbosity.md) included, `print` and `render` on a result Command, `out.draw`, a failure report and its hints, the [incomplete-result](results.md#a-sequence-that-stops-early) line, and what an [`onLog`](lifecycle-hooks.md#observing-log-events) hook writes to its destination's `stderr` under `run()`. When stdout is a terminal too, a write to stdout, a result included, does the same, so stdout and stderr share one order while a region is drawn, apart from a row sequence open on stdout, which holds stdout's order alone. A write that does not pass through core, such as `console.log` or `process.stderr.write`, lands where the cursor is, because core cannot see it.
- **A frame.** `draw(data, view)` renders as `out.draw` does: a bare view or a declared view, with the application's override when one applies, called synchronously inside the call with stderr's view context and its live `columns`, its marked text resolved under stderr's rendering policy, its control sequences kept for the call at a terminal, and no newline added. The types reject a row view, and core adds no rule for one: from JavaScript, it fails the call as a view that breaks does. Core keeps the frame's text, and the promise resolves once the frame is written. The region's frame is the latest one drawn.
- **Live.** `live` is `true` when core draws the region: `host.terminal.stderr.isTTY` is true, and the region takes input, or the run's [verbosity](verbosity.md) is 0 or more and the terminal [redraws](#live-region) in place. When it is `false`, `draw` calls no view, writes nothing, and resolves at once, so a pipe, a log file, and an [invocation by name](invocation.md#invocation-by-name)'s `messages` never hold a frame. A library reads `live` to write plain lines instead, as a progress line does. It does not change while the region is open.
- **Closing.** `end()` closes the region. Its last frame moves into scrollback, ending with a line break core adds when the frame lacks one, and the regions below close the gap, so a region whose last frame is empty leaves nothing. `end('failed')` closes it the same way, and the end [progress event](#progress-events) the close builds reads `failed`; the events before it stay as they were. `end(state, label)` puts `label` on that end event in place of the last reported label, such as `end('ended', 'Fetched 3 records.')`; it builds no extra event, and an `end` with no label keeps the last reported label. The label reaches only the event and draws nothing: the terminal keeps the last frame drawn, so a caller that wants the terminal to show the same end text draws it as the last frame, as a progress line does. Once the region has closed, `draw` and `report` do nothing, and `draw` and `end` resolve at once, so a timer tick that races the close is harmless.
- **The signal.** `signal` aborts whenever the region closes, whatever closes it, so a library that animates a frame on its own timer stops the timer there. Core sets `closedBy` before it aborts the signal: `'end'` for `end()`, `'completion'` when what opened the region finishes with it still open, `'failure'` when the run is about to report a failure, and `'cancellation'` when the run's signal aborts. The abort listeners run synchronously, and a frame a listener draws during the abort is the region's last frame, so a library draws its finished, failed, or cancelled line there. Then core closes the region. When a signal ends the process, core writes every region frame still in its write queue, the cancelled lines drawn at the abort included, straight to the terminal at the [shutdown](signals.md#the-shutdown)'s end, and shows the cursor. A suspend erases the open regions and a resume redraws them, under [Raw-mode readers](signals.md#raw-mode-readers).
- **Core closes what is left open.** When the action returns, core closes every region the action opened that is still open with `'completion'`, and when it throws, with `'failure'`, before the action's [provided values](providers.md#closing) close. A region a middleware or a configuration source opens stays open through the action, so a middleware can show a line around the whole run, and core closes it with `'completion'` once the chain has unwound, after the first middleware returns, when it is still open; the same holds when a middleware takes over or the chain settles without dispatching the action. Before core renders any failure report, from the action, a middleware, a source, or a fault reported after the outcome, it closes every open region with `'failure'`, so each region's last frame is written above the report and the report is the last thing on stderr. When the run's signal aborts, core closes every region, open or waiting to open, with `'cancellation'` at once, and a cancellation writes no report. A region opened after the run's signal has aborted closes with `'cancellation'` as it opens.
- **Input regions.** `out.region({ input: true })` opens a region that reads the operator's keys, as a question does. While it is open, core draws no frame of any other region: their timers keep running, and core keeps each region's latest frame, a closed region's last frame included. When the input region closes, core moves each last frame that closed meanwhile into scrollback, in the order the regions closed, and draws every open region's latest frame once. Other writes still land above the stack, which shows the other regions as they were when the input region opened. One input region is open at a time. A second opens when the first closes, and until then its draws wait, each promise resolving once the region opens and its frame is written. A waiting region that closes before it opens leaves nothing, and its draws resolve then.
- **Redrawing.** A terminal stderr redraws in place unless `TERM` is `dumb`, a terminal that cannot move its cursor, such as Emacs `M-x shell`, or `CI` is set, nonempty, and not `false`, where the terminal feeds a build log. This is how ci-info, which npm uses, reads `CI`: CI systems set `CI=true`, and `CI=false` is an operator saying the run is not CI. A run under CI is not [interactive](interaction.md) either, and [ADR-0114](../decisions/0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md) records both rules. On a terminal that does not redraw, core draws no region opened without `input: true`, and its `live` reads `false`, so a progress line writes plain lines. Under `TERM=dumb` an input region still draws, so a question there still asks, and on either terminal `out.draw` still writes but keeps the Application's `terminalControls` setting, as a draw to a stderr that is not a terminal does, so a cursor movement its text holds is dropped unless the Application preserves controls. Unless the Application preserves controls, nothing there hides the cursor, so a shutdown and a suspend that restore the terminal write no show-cursor sequence. Color detection does not follow this rule: `TERM=dumb` turns automatic color off on its own, as [styles](styles.md) states, and under CI automatic color follows the CI system rule there.
- **Quiet.** At verbosity -1, which `-q` sets under the [verbose plugin](../plugins/verbose.md), core draws no region opened without `input: true`, and its `live` reads `false`. An input region draws at every verbosity, so a question still asks. Only `out.region` follows the verbosity: `out.draw` draws at every verbosity, because its caller decides when to draw.
- **Resize.** Before it erases the stack, core recounts each region's last frame at stderr's current width, counting rows as `out.draw` counts them, so a frame that a reflowing resize rewrapped is erased whole. A stack taller than the terminal cannot be erased above its top row, so a view keeps its frame within stderr's `rows`, as the [select question](../libs/prompts.md#the-kinds) does.
- **No timer in core.** Core never limits work by time, except the [shutdown budget](signals.md#the-shutdown), which bounds how long cancelled runs may unwind after an ending signal. An application that needs a timeout sets one in its own action. A timer that animates a frame is plain JavaScript that the author or the library drawing the frame runs, and it stops the timer when `signal` aborts. Core runs no timer for a region and redraws only when a frame or another write asks it to.
- **Reports.** `report({ completed?, total?, label? })` builds a typed [progress event](#progress-events) for whoever observes the run, and draws nothing. A region reports whether or not it is live.
- **Names.** `Region`, `RegionOptions`, `RegionCloser`, and `ProgressReport` are exported from `@loomcli/core`, and `Out` carries `region`.

A region call whose value the types reject, such as an `input` that is not a Boolean or an `end` state other than `'ended'` or `'failed'`, gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A `completed` or `total` that is negative or not finite, which the type allows, is carried into the progress event as it is.

### Progress events

```ts
interface ProgressEvent {
  readonly id: number;
  readonly label: string;
  readonly state: 'started' | 'updated' | 'ended' | 'failed' | 'cancelled';
  readonly completed?: number;
  readonly total?: number;
}
```

A progress event is the typed value a region's report builds, so a program that runs a Command reads its progress without reading a frame. An [invocation by name](invocation.md#invocation-by-name) delivers each event to its observer, and the [MCP](../plugins/mcp.md) plugin sends each one to a client as `notifications/progress`.

- **From reports.** A region's first report builds a `started` event, and each later report an `updated` event. When a region that reported closes, core builds its end event: `ended` after `end()` and after `'completion'`, `failed` after `end('failed')` and after `'failure'`, and `cancelled` after `'cancellation'`. A region that never reported builds none, so a question builds no event.
- **The fields.** `id` numbers the run's reporting regions from 1, in the order each first reported. `label`, `completed`, and `total` hold the latest value any report of the region gave, so an update that carries `completed` alone keeps the label. An end event built by `end(state, label)` carries that label instead, and its counts as reported. `label` reads `''` until a report gives one, and an absent `completed` or `total` was never reported. `label` is the plain text of the reported label: core removes its style markup, as the view context's `plain` does, so an observer and an MCP client never read a style delimiter. Each event is frozen.
- **Delivery.** Core delivers each event synchronously, inside the `report` call or the close that built it, in the order they were built. Under `run()` nothing observes them.
- **Not logging.** A progress event reaches no [`onLog`](lifecycle-hooks.md#observing-log-events) hook, and no log event is a progress event, under [ADR-0069](../decisions/0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md).
- **Names.** `ProgressEvent` is exported from `@loomcli/core`.

## When author code fails

A view that throws, a lane view or a region's frame view included, makes the `out.render`, `out.draw`, `region.draw`, or semantic-method call reject with the view's error. A rejection the action or a middleware lets propagate takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and a rejection the code caught is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A call no code awaited has no catcher, so core reports its rejection through the ordinary failure path after the chain has settled, as the output-view row of the [ordinary failure path](failures.md#the-ordinary-failure-path) states. A row view's pieces written before the fault stand, under [Results](results.md#row-views).
