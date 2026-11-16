---
type: adr
title: ADR-0170 - A progress line may end skipped or warned or be cleared, and a region's end event reads skipped and warned
description: The progress handle of @loomcli/prompts gains skip(message?), warn(message?), and clear(). skip leaves a dim line with the message or else the label, under the info glyph, and off a live region writes the same text through out.info. warn leaves a warning line under the warning glyph in the warning token, and off a live region writes it through out.warn. clear draws an empty last frame, so the line leaves nothing, and off a live region prints nothing after the start line. Only the author's own call clears a line: a line that fails or is cancelled keeps its text. After any end every end method does nothing and resolves, and track() is unchanged. Core's Region.end takes 'skipped' and 'warned' beside 'ended' and 'failed', and ProgressEvent's state gains the same two, so an onProgress observer, invoke, and an MCP client, whose message reads (skipped) or (warned), tell them from a success, while a cleared line reports ended. The progress view's state gains 'skipped' and 'warned', and ProgressContext's out gains warn. It extends ADR-0091's region end, its progress events, and its progress lines.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0170 - A progress line may end skipped or warned or be cleared, and a region's end event reads skipped and warned

## Context

A progress line from `@loomcli/prompts`, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md), ends in one of three ways. `end(message?)` leaves a success line, `fail(message?)` a failure line, and a cancelled run a cancelled line. Where its region is not live, off a terminal, under CI, under `TERM=dumb`, and under the plain switch of [ADR-0169](0169-one-plain-switch-turns-off-all-redrawing-so-progress-prints-plain-lines-and-a-question-asks-line-by-line.md), the line prints a start line through `out.info` and an end line through `out.success` or `out.error`. Each end reaches an `onProgress` observer and an MCP client as a typed progress event whose state is `ended`, `failed`, or `cancelled`.

Work often ends in a way that is neither. A fetch that finds the cache fresh did nothing, and a success line overstates it. A fetch that brought 118 of 120 records finished, and the operator should see that two are missing, but a failure line would claim the work failed. A step that only checks something, such as reading a cache, leaves nothing worth keeping in scrollback once the next line starts. Today the author picks the nearest of `end` and `fail`, and a program that reads the progress events cannot tell a skipped or partial end from a success.

Other libraries offer these ends. ora's spinner has `warn`, `info`, and `stop`, listr2's task has `skip`, and Rich's progress display takes `transient`, which removes the display when it stops.

The owner settled the shape on 2026-11-16 (LM-388): the handle gains `skip`, `warn`, and `clear`; the line each leaves where the region is live and the lane each writes through where it is not; `clear` as the author's own call alone; `track()` unchanged; the glyphs and theme tokens drawn from the existing set; and core's region end states and progress event states extended so a program reads the skipped and warned ends.

## Decision

- **Three more ends.** The `Progress` handle gains `skip(message?)`, `warn(message?)`, and `clear()`, beside `end(message?)` and `fail(message?)`. Each ends the line, resolves once its last line is written, or, for `clear`, once the line is gone, and closes its region.
- **Skip.** `skip(message?)` ends the line as skipped. Where the region is live, the line clears its timer, draws its skipped line through the progress view with the message or else the label, such as `ℹ Fetched nothing: the cache is fresh · 0.3s`, all of it dim, and closes its region with `end('skipped', message)`. Where the region is not live, it writes the message or else the label through `context.out.info`, so the line reads `ℹ Fetched nothing: the cache is fresh`, and closes its region the same way.
- **Warn.** `warn(message?)` ends the line with a warning. Where the region is live, the line clears its timer, draws its warned line through the progress view with the message or else the label, such as `⚠ Fetched 118 of 120 records · 3.2s`, and closes its region with `end('warned', message)`. Where the region is not live, it writes the message or else the label through `context.out.warn`, so the line reads `⚠ Fetched 118 of 120 records`, and closes its region the same way. The warn lane writes at every verbosity, so under `-q` a warned line prints while a skipped line hides with the info lane.
- **Clear.** `clear()` removes the line. It takes no message, because it leaves no text. Where the region is live, the line clears its timer, draws an empty last frame, and closes its region with `end('ended')`. A region whose last frame is empty leaves nothing, under ADR-0091's closing rule, so the rows above the line stay as they were, the regions below close the gap, and no blank row is left. The empty frame is the library's own and does not pass through the progress view, so no override leaves text for a cleared line. Where the region is not live, the start line has already been written, and `clear()` writes nothing more.
- **Only the author clears a line.** A line leaves nothing only when its author calls `clear()`. A line that fails, through `fail`, a rejected `track`, or a failing run, keeps its failure line, and a cancelled line keeps its cancelled line, as ADR-0091's rule that each line ends in its failed state above the report requires. A line its opener leaves open still draws its success line when core closes it for completion. No setting clears a line when it ends.
- **After an end.** Once the line has ended, failed, been cancelled, been skipped, been warned, or been cleared, each of `end`, `fail`, `skip`, `warn`, and `clear` does nothing and resolves, `update` does nothing, and `track` only returns the value or rethrows, as `end` and `fail` do today. So a line started after the run is cancelled, which finds its region closed, ignores all five.
- **Tracking work.** `track(work, { done?, failed? })` is unchanged: it ends the line with `end` when `work` resolves and with `fail` when it rejects. An author who wants a skipped, warned, or cleared end awaits the work and calls that end.
- **The skipped and warned lines.** The default progress view draws two more rows, from the glyphs and theme tokens the other end lines use, and adds no glyph and no theme token. The skipped line is the glyph `info`, the message, the `·`, and the elapsed time, all `dim`. The warned line is the glyph `warning` in `warning`, the message, the dim `·`, and the elapsed time, the layout of the success line. Each glyph is the one the lane of its plain line draws, as the success line shares `success` with the success lane and the failure line shares `error` with the error lane, so a line shows the same glyph live and not live. The warned line also styles its glyph as the warn lane does, in `warning`, while the skipped line draws its glyph dim with the rest of the line, where the info lane draws it in `info`. Where the terminal takes compat forms, they read `i` and `‼`. The message is a marked string, as every end message is: the view and the lanes write it as given, and an author escapes raw data with `style.escape` first. Neither line draws a spinner frame, a bar, or counts, as the success line draws none, so `progressStyle()` gains no setting.
- **The view's data.** `ProgressLine`, the data of the declared view `@loomcli/prompts/progress`, gains two values of `state`, `'skipped'` and `'warned'`, and `label` holds the end message, or the label, once the line is skipped or warned. It gains no field. An application that overrides the view keeps rendering: its view receives the two new states only from a line whose author calls `skip` or `warn`, and never for a cleared line. An override whose switch over `state` has no default branch, such as a `render` that returns a string from one case per state, no longer compiles under `strict`, because the switch no longer covers every state; the type checker reports it, and the override handles the two states. So does an `onProgress` observer whose switch over `ProgressEvent`'s `state` ends in an exhaustiveness check.
- **The context.** `ProgressContext`'s `out` gains `warn`, because a warned line that is not live writes through it. An action's, a middleware's, and a configuration source's context, and the contexts `@loomcli/testing` builds, already carry it.
- **No fixed words.** Each new line repeats the author's message or label, so the prompts package's message module gains no sentence.
- **Core's end states.** `Region.end` takes `'skipped'` and `'warned'` beside `'ended'` and `'failed'`. Either closes the region as `end()` does: `closedBy` reads `'end'`, the last frame moves into scrollback, and the signal aborts. The region's end event reads the state `end` received, so `end('skipped')` builds `skipped` and `end('warned')` builds `warned`, and the label rule is unchanged. A close for completion, a failure, or cancellation builds `ended`, `failed`, or `cancelled` as before. `ProgressEvent`'s `state` gains `'skipped'` and `'warned'`. `RegionCloser` is unchanged, because each new end is the region's own `end()`. Nothing else in core changes: a region an author opens by hand may end skipped or warned too, and the state changes its end event alone, never a frame.
- **What a program reads.** An `onProgress` observer and an invocation by name read `skipped` from a skipped line and `warned` from a warned line, each with the message or else the last label, and `ended` from a cleared line, with its last reported label, because a cleared line reports as ended. The MCP plugin changes no code: its `message` already writes the event's state in parentheses, so a client reads `Fetched nothing: the cache is fresh (skipped)`, `Fetched 118 of 120 records 118/120 (warned)` for a line that reported a count of 118 and a total of 120, and `Reading the cache (ended)` for a cleared line, each on the next value of the call's counter. The start line and the plain end lines land in the call's `messages`, a cleared line's start line alone.
- **The testing values.** `@loomcli/testing`'s `progressEvent` takes `Partial<ProgressEvent>`, so a test states `state: 'skipped'` or `state: 'warned'` with no change to the helper. Its default `state` stays `'updated'`.
- **The types.** `@loomcli/core`'s `Region` and `ProgressEvent` read, with their other members unchanged:

  ```ts
  /**
   * The handle `out.region()` returns.
   *
   * @public
   * @sealed
   */
  export interface Region {
    /**
     * Closes the region, leaving its last frame in scrollback; `'failed'`, `'skipped'`, and
     * `'warned'` make its end event read that state, and a `label` replaces the reported label on
     * that event.
     */
    end(state?: 'ended' | 'failed' | 'skipped' | 'warned', label?: string): Promise<void>;
  }

  /**
   * The typed value a region's report builds, which a program reads without reading a frame.
   *
   * @public
   * @sealed
   */
  export interface ProgressEvent {
    /** Where the region is: its first report is `started`, and its close builds the end state. */
    readonly state: 'started' | 'updated' | 'ended' | 'failed' | 'cancelled' | 'skipped' | 'warned';
  }
  ```

  `@loomcli/prompts`'s `Progress` and `ProgressContext` read:

  ```ts
  /**
   * The handle `progress()` returns for one line.
   *
   * @public
   * @sealed
   */
  interface Progress {
    /** Changes the line's counts or label while it runs. */
    update(update: ProgressUpdate): void;
    /** Ends the line as a success, with an optional message in place of the label. */
    end(message?: string): Promise<void>;
    /** Ends the line as a failure, with an optional message in place of the label. */
    fail(message?: string): Promise<void>;
    /** Ends the line as skipped, a dim line with an optional message in place of the label. */
    skip(message?: string): Promise<void>;
    /** Ends the line with a warning, with an optional message in place of the label. */
    warn(message?: string): Promise<void>;
    /** Ends the line and removes it, so it leaves nothing. */
    clear(): Promise<void>;
    /** Ends the line by how the work settles and returns the work's value, or rethrows its rejection. */
    track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value>;
  }

  /**
   * What `progress()` reads: an action's, a middleware's, or a configuration source's context.
   *
   * @public
   */
  type ProgressContext = Pick<ActionContext<unknown>, 'graph'> & {
    readonly out: Pick<Out, 'region' | 'info' | 'success' | 'warn' | 'error'>;
  };
  ```

  `@loomcli/prompts/views`'s `ProgressLine` reads, with its other members unchanged:

  ```ts
  /**
   * What one progress line's view draws: its state, its counts, its spinner frame, and its time.
   *
   * @public
   */
  interface ProgressLine {
    /** How the line stands: running, ended, failed, cancelled, skipped, or warned. */
    readonly state: 'running' | 'ended' | 'failed' | 'cancelled' | 'skipped' | 'warned';
    /** The label while the line runs, and the end message once it has ended, failed, been skipped, or warned. */
    readonly label: string;
  }
  ```

  No export is added, and none is removed.

The contract is in [Live region](../core/output.md#live-region), [Progress events](../core/output.md#progress-events), the [prompts reference](../libs/prompts.md#progress), the [MCP plugin](../plugins/mcp.md), the [testing reference](../libs/testing.md#building-the-values-a-hook-reads), the authoring skill's [middleware and actions reference](../../packages/loom/skills/loom/references/middleware-and-actions.md), and the [glossary](../glossary.md#output).

## Considered options

- **ora's `info` and `stop`.** Not taken: the owner's ruling names three ends. A skipped line already leaves an info line, and `clear` covers an end that leaves nothing. ora's `stop` leaves the running frame as it stands, which reads as work still under way.
- **A setting that clears a line when it ends, as Rich's `transient` does.** Rejected by the owner's ruling that nothing clears a line on its own. A setting would also clear a line that fails, which ADR-0091 keeps above the failure report.
- **A `cleared` progress event state, or a `cleared` view state.** Not taken. The owner's ruling reports a cleared line as ended. A view state would also let an override draw text for a line whose rule is that it leaves nothing.
- **A second field on `ProgressEvent`, such as an outcome beside `state`.** Rejected. Every reader already switches on `state`, and a string-literal union core produces may gain a member in any release, so two more values are the smallest change that lets a reader tell a skipped and a warned end from a success.
- **A `RegionCloser` for each new end.** Rejected. `closedBy` says what closed the region, and a skipped or warned line closes through its own `end()`, as an ended or failed one does.
- **An optional `warn` on `ProgressContext` with a fallback lane.** Rejected. A warning written through `info` or `error` would claim another level, and no lane is an honest default for it.

## Consequences

`Progress`, an output type, gains three methods, which is not breaking. `Region.end`'s state, a parameter in input position, widens, which is not breaking. `ProgressEvent`'s `state` and `ProgressLine`'s `state` each gain two members of a string-literal union. The [change-fragment rules](../../.changes/README.md) class that as not breaking for a member in output position, but `ProgressLine` also travels as input, to `out.draw`, and an exhaustive switch over either union with no default branch, in a view override or an observer, no longer compiles. `ProgressContext`, an input type, narrows: its `out` now requires `warn`, so a context a test or a helper builds by hand without `warn` no longer compiles where it is passed to `progress()`. The fragment is breaking for both, and its migration names each surface; the type checker reports every such site. An application that calls none of the new ends writes the same bytes and reports the same events as before. The MCP plugin and `@loomcli/testing` change no code, and core gains no export, closer, failure class, or rule identity.

This extends three rules of ADR-0091. Its One region call rule gains the end states `'skipped'` and `'warned'`, its Typed progress events rule gains the end event states `skipped` and `warned`, and its Progress lines in the prompts library rule gains `skip`, `warn`, and `clear`, with the not-live writes through `out.info` and `out.warn` and none for `clear`. ADR-0091's rule The report is last, and its rejection of erasing an open line before a failure report, stand: a line that fails or is cancelled keeps its text. ADR-0091 carries a dated entry.

The glossary's Progress event and Progress line entries name the new states and ends.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract (LM-388). It extends ADR-0091's region end, its progress events, and its progress lines. ADR-0091 carries a dated entry.
