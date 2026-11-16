---
type: adr
title: ADR-0171 - A progress line may show its rate and time left, computed from its recent reports and the clock it reads
description: A progress line from @loomcli/prompts takes two optional settings, estimate and unit. With estimate set, a running line draws its rate and its time left after the elapsed time, each dim after a dim ·, such as 40/120 · 12.0s · 3.3 files/s · about 24s left. The line computes both from the completed counts the author reports through update() and the clock it already reads for the elapsed time, and adds no timer. The rate is measured over the last 10 seconds of reports, from the newest report back to the latest report at least 10 seconds older, or to the first report, and shows once those two reports are a second apart, so a count done before the first report never enters it. The time left is the work left at that rate, counting down from the newest report on each frame the existing timer draws and held at 0. A report that goes backward restarts the window, a rate of 0 shows 0/s with no time left, and no time left shows without a total or once completed reaches it. Neither part shows on an end line or where the line does not draw, and on a narrow row the rate gives way first and the time left next. The progress view's data gains optional estimate, rate, remaining, and unit, which every line supplies whether or not estimate is set. Progress events are unchanged. It extends ADR-0091's progress lines.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0171 - A progress line may show its rate and time left, computed from its recent reports and the clock it reads

## Context

A counted progress line from `@loomcli/prompts`, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md), reads `◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s`. The author reports `completed` and `total` through the handle's `update`, and the line reads the clock, `Date.now()`, for the elapsed time. The library animates the line on its own unref'd timer and puts no timer on the author's work, under ADR-0091's timer rule. Nothing computes how fast the work goes or how long it has left, and the [prompts reference](../libs/prompts.md#not-shipped) lists both as not shipped.

An operator who watches a long counted line wants to know when it will finish. Every progress library an operator meets offers it: tqdm draws `3.33it/s` and a remaining time, Rich has `TransferSpeedColumn` and `TimeRemainingColumn` over a speed it measures across its last 30 seconds of samples, cli-progress computes an ETA over its last 10 updates, and indicatif weights recent steps. Each computes from the counts the work reports and the clock, and none runs a timer on the work.

The owner settled the shape on 2026-11-16 (LM-530): an opt-in `estimate` setting shows both a rate and a time left; the rate follows recent reports, so it follows a speed that changes; both appear once there is enough progress to compute them; neither appears on the end line or where the line does not draw, as the elapsed time does not; an optional `unit` names what is counted; the progress view receives the computed values whether or not `estimate` is set; and the line puts no timer on the author's work.

## Decision

- **Two settings.** `ProgressSettings` gains `estimate?: boolean` and `unit?: string`. With `estimate: true`, a running line draws its rate and its time left once there is enough progress, `◓ Fetching records ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3/s · about 24s left`. Without it, or with `false`, the line draws as before. `unit` names what the line counts, as the author writes it, plural included, and the rate names it, `3.3 files/s`. Neither setting changes after `progress()` opens the line, so `ProgressUpdate` is unchanged.
- **Samples.** The line keeps one sample, a time and a count, for each `update` that states `completed`: the time of the update and its `completed`. The opening is no sample, so the first report is the window's first sample, and a count done before it, such as the share a resumed download or sync already had, never enters the rate. An update that states the same `completed` again is a sample, so reports through a stall slow the rate. An update that states only `total` or `label` adds none. Every time is read from `Date.now()`, the clock the elapsed time already reads, so the line reads no other clock and starts no timer of its own.
- **The rate window.** The rate is measured from the window's anchor to its newest sample. The newest sample is the latest report. The anchor is the latest sample whose time is at least 10 000 milliseconds before the newest sample's, or, when no sample is that old, the window's first sample, which is the first report or the restart below. With `c` the count and `t` the time in milliseconds, the rate in units per second is `(c_newest − c_anchor) × 1000 ÷ (t_newest − t_anchor)`. The window holds the last 10 seconds of reports and reaches back to one report before them, so reports that arrive many times a second measure over 10 seconds, and reports a minute apart measure between the last two. Samples older than the anchor are never read again, so the line drops them.
- **Enough progress.** The rate is known once `t_newest − t_anchor` is at least 1000 milliseconds, one report at least a second after the window's first sample, so a line knows it at its second report at the earliest. Before that, the line shows neither part, and its view's data reads `rate` and `remaining` as `undefined`.
- **The time left.** With a known rate above 0, a `total`, and `completed` below it, the time left in milliseconds at a frame is `(total − c_newest) × (t_newest − t_anchor) ÷ (c_newest − c_anchor) − (now − t_newest)`, held at 0, where `now` is `Date.now()` when the frame is built and `total` is the line's current total. So the estimate made at the newest report counts down with the clock between reports, and each report sets it afresh. A count that reaches 0 before the next report holds at 0, which draws as `about 1s left`, until that report.
- **The edges.** A rate of 0, a window whose anchor and newest sample have the same count, draws `0/s` and no time left, because no finite time follows from it. A report whose `completed` is below the newest sample's restarts the window: every earlier sample is dropped, that report is the window's first sample, and neither part shows until a report at least a second after it. Once `completed` reaches or passes `total`, no time left shows and the rate still does. A `total` that an update changes takes effect in the time left at the next frame, and the rate, which reads only counts, is unchanged by it. A line without a `total` shows the rate alone once it is known, `◑ Reading rows 1204 · 3.0s · 400/s` after reports of 204 at 500 milliseconds and 1204 at 3000, and a line that reports no `completed` never knows its rate.
- **A worked sequence.** A line opens at time 0 with `total: 120` and `estimate: true`, and its author reports these counts and no others. Each row is the frame drawn at the report. The first report is the window's first sample, so its frame shows neither part.

  | Time (ms) | `completed` | Anchor       | Rate                        | Time left                                      |
  | --------- | ----------- | ------------ | --------------------------- | ---------------------------------------------- |
  | 500       | 1           | None         | Not known, neither part     | Not known                                      |
  | 3000      | 10          | 1 at 500     | 9 × 1000 ÷ 2500, `3.6/s`    | 110 × 2500 ÷ 9 = 30 555.6, `about 31s left`    |
  | 12 000    | 40          | 1 at 500     | 39 × 1000 ÷ 11 500, `3.3/s` | 80 × 11 500 ÷ 39 = 23 589.7, `about 24s left`  |
  | 13 000    | 70          | 10 at 3000   | 60 × 1000 ÷ 10 000, `6.0/s` | 50 × 10 000 ÷ 60 = 8333.3, `about 9s left`     |
  | 14 000    | 100         | 10 at 3000   | 90 × 1000 ÷ 11 000, `8.1/s` | 20 × 11 000 ÷ 90 = 2444.4, `about 3s left`     |

  At 13 000 the anchor moves to the report at 3000, the latest at least 10 000 milliseconds before the newest, so the rate follows the faster work. A frame the timer draws at 12 500, between the reports at 12 000 and 13 000, reads `about 24s left`, from 23 589.7 − 500 = 23 089.7 rounded up. Frames at 16 000 and 17 000, with no report after 14 000, read 444.4 and 0, and each draws `about 1s left`.
- **The rate's format.** A rate of 0 reads `0/s`, and `0 files/s` with a `unit`. Otherwise the rate reads per second when it is at least 1 per second, per minute when it is at least 1 per minute, and per hour below that, with the suffix `/s`, `/min`, or `/h`. In its unit of time, a rate of 10 or more reads as a whole number and a rate under 10 with one decimal, each rounded down, as the elapsed time rounds down: `1204/s`, `3.3/s`, `15/min` for 0.25 per second, and `0.5/h`. With a `unit`, a space and the unit stand between the number and the suffix: `3.3 files/s`, `15 files/min`.
- **The time left's format.** The time left reads `about`, a space, the span, a space, and `left`. The span counts whole seconds, rounded up, and at least 1: under 60 of them it reads seconds, `about 24s left`; otherwise it reads minutes, the seconds ÷ 60 rounded half up, `about 3m left`, while that is under 60; otherwise hours, the seconds ÷ 3600 rounded half up, `about 2h left`. So 89 seconds reads `about 1m left`, 90 reads `about 2m left`, and 3570 reads `about 1h left`. `about` hedges the figure, so a span keeps one unit of time, where the elapsed time keeps two.
- **Where they draw.** Both parts draw on a running line alone, after the elapsed time, the rate first, each after a dim `·` and drawn dim, as the elapsed time is. An end line, success, failure, skipped, warned, or cancelled, draws neither, and where the line does not draw, under ADR-0091's not-live rule, its plain start and end lines carry neither, as they carry no elapsed time. `progressStyle()` gains no setting.
- **A narrow row.** Today the view neither wraps nor clips a progress line: the terminal wraps a long one, and core counts the rows it takes. That stands for everything but the two new parts, which never make a line wrap. While the running line, measured with the view context's `width`, is wider than the view context's `columns`, or 80 columns when `columns` is `undefined`, the rate gives way first, with its `·`, and then the time left, with its `·`. A line still wider without both draws as it does today. The rate gives way first because the time left is what an operator waits on.
- **The view's data.** `ProgressLine` gains four optional members, `estimate`, `rate`, `remaining`, and `unit`. Every line supplies all four on every frame, whether or not its settings set `estimate`, so an application's own view can draw a rate or a time left the default view does not. They are optional so data an application builds by hand for `out.draw(data, progressLine)` draws without them, as `cursor` is on a question frame: an absent `estimate` reads `false`, and an absent `rate`, `remaining`, or `unit` reads `undefined`. The default view draws the rate and the time left only when `estimate` is `true` and the state is `running`. An end frame's data carries the values computed at that frame, which the default view does not draw.
- **The words.** `about`, `left`, `/s`, `/min`, and `/h` are fixed labels of the progress view, as `(cancelled)` is, so they stay with the view that prints them, in `src/views.ts`, under ADR-0164's rule that fixed labels stay where they are, and the package's message module, which holds sentences, gains none. The `unit` is the author's text and a marked string, as the label is: the view writes it as given, and an author escapes raw data with `style.escape` first.
- **No timer on the work.** The line computes both parts from the reports the author makes and from `Date.now()`, and draws them on the frames it already draws: at each report, and at each tick of the unref'd frame timer ADR-0091 gives the line, which now counts the time left down as it advances the elapsed time. It cancels and limits nothing, so ADR-0091's timer rule stands.
- **Progress events.** No event changes. A `ProgressEvent` carries the counts and the label a program reads, and an observer or an MCP client that wants a rate measures it against its own clock. The rate and the time left belong to the drawn line.
- **The types.** `@loomcli/prompts`'s `ProgressSettings` reads:

  ```ts
  /**
   * The settings of one progress line: its label, an optional total that makes it a bar, an
   * optional spinner of its own, and whether it shows its rate and time left.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress
   * @public
   */
  interface ProgressSettings {
    /** The text the line shows while it runs. */
    readonly label: string;
    /** A bar with counts; without it, a spinner. */
    readonly total?: number;
    /** This line's own spinner, over the application's style. */
    readonly spinner?: Spinner;
    /**
     * Whether the running line shows its rate and time left once there is enough progress, as in
     * `40/120 · 12.0s · 3.3/s · about 24s left`. Absent, false.
     */
    readonly estimate?: boolean;
    /** What the line counts, as the rate names it: `files` reads `3.3 files/s`. A marked string. */
    readonly unit?: string;
  }
  ```

  `@loomcli/prompts/views`'s `ProgressLine` reads, with its other members unchanged:

  ```ts
  /**
   * What one progress line's view draws: its state, its counts, its spinner frame, its time, and
   * its rate and time left.
   *
   * @public
   */
  interface ProgressLine {
    /**
     * Whether the default view draws the rate and time left: the line's `estimate` setting. A line
     * always supplies it; absent, false.
     */
    readonly estimate?: boolean | undefined;
    /**
     * Units done per second over the line's last 10 seconds of reports, or `undefined` until there
     * is enough progress. A line always supplies it, whether or not `estimate` is set.
     */
    readonly rate?: number | undefined;
    /**
     * Milliseconds of work left at `rate`, counting down from the newest report and held at 0, or
     * `undefined` while `rate` is `undefined` or 0, without a total, and once `completed` reaches
     * `total`. A line always supplies it, whether or not `estimate` is set.
     */
    readonly remaining?: number | undefined;
    /** What the line counts, as the author wrote it, or `undefined` without one. */
    readonly unit?: string | undefined;
  }
  ```

  No export is added, and none is removed.

The contract is in the [prompts reference](../libs/prompts.md#rate-and-time-left), its [progress view](../libs/prompts.md#progress-view), the authoring skill's [middleware and actions reference](../../packages/loom/skills/loom/references/middleware-and-actions.md), and the [glossary](../glossary.md#product-surface).

## Considered options

- **A window of the last N reports, as cli-progress keeps the last 10.** Not taken. Reports that arrive many times a second would measure over a few milliseconds, where `Date.now()`'s whole milliseconds make the rate jump, and reports a minute apart would measure over ten minutes, which follows a change of speed slowly. A window of time measures over the same span however often the author reports.
- **A smoothed rate, as tqdm's exponential moving average and indicatif's weighted estimator compute.** Not taken. Its value depends on every report since the start and on the spacing between them, so a test cannot state the expected number from the last few reports by hand, and the ruling asks for a rate that follows recent reports.
- **Rich's 30-second window.** Not taken. Rich drops every sample older than 30 seconds, so reports more than 30 seconds apart leave one sample and no speed. The anchor here reaches back to the report before the window, and 10 seconds follows a change of speed sooner.
- **An opening sample of 0 at the time `progress()` opened the line.** Not taken. A line whose first report states the count a resumed download, sync, or batch already had would measure that count as work done since the opening: a line that opens with `total: 1000`, reports 900 at once, and then goes 1 a second, would read `896/s` and `about 1s left` at 1005 milliseconds, for about 10 seconds, until the window passed the report of 900. Measuring from the first report costs a line one report before it knows its rate, and tqdm's `initial` and Rich's `completed` leave a starting count out of the speed too.
- **A starting `completed` in `ProgressSettings`, as tqdm's `initial` and Rich's `add_task(completed=)` take.** Not taken. It would let an author state the count a line opens with, but an author who reports that count through `update` instead would still read a burst rate, and the first report as the first sample serves both without a new setting.
- **A rate measured to the current time, so a stall lowers it between reports.** Not taken. Reports that arrive every few seconds would draw a rate that rises at each report and sinks until the next. The rate holds between reports, and the time left counts down instead.
- **A time left that holds between reports, as Rich's and cli-progress's do.** Not taken. The line redraws on its own timer while the elapsed time advances, and a time left that stands still for the seconds between two reports reads as stuck. Counting down from the newest report is computed from the same clock and the same reports.
- **A time left that keeps counting below 0, or that drops when its count runs out.** Not taken. A negative time is false, and a part that leaves and comes back at the next report flickers. `about 1s left` holds until a report corrects it.
- **Seconds per unit below one unit per second, as tqdm draws `3.52s/it`.** Not taken. It needs the unit in the singular, and the author writes `unit` in the plural. Per minute and per hour read in the unit as written.
- **A rate or a time left on `ProgressEvent`.** Not taken. The ruling concerns the drawn line, an event has no clock of its own, and a new member of an output type would reach the MCP plugin's message and every observer for a value a program measures itself.
- **Required `rate` and `remaining` on `ProgressLine`.** Not taken. `ProgressLine` is an input type, because an application may build it by hand for `out.draw`, so a new required member would break that code, and absent has an honest reading, `undefined`, as `cursor` has on a question frame.
- **Clipping the label, the bar, or the counts on a narrow row.** Not taken. Those parts wrap today, and the ruling adds the two parts alone. Fitting the whole line would change every line, with or without `estimate`, and is its own change.

## Consequences

`ProgressSettings` and `ProgressLine` are input types, `@public` without `@sealed`, and each gains optional members alone, which the [change-fragment rules](../../.changes/README.md) class as not breaking. `ProgressLine` reaches an override's `render` too, where a new member is not breaking either. The fragment is a feature. An application that sets neither `estimate` nor `unit` draws the same bytes as before, and its view override receives four more members it may ignore. Progress events, the plain lines, `ProgressUpdate`, `Progress`, `ProgressContext`, and `progressStyle()` are unchanged, and core changes no code.

The line keeps the samples of its last 10 seconds of reports and the one before them. An author who reports thousands of times a second keeps that many samples for 10 seconds, which a line can do without a bound of its own.

This extends ADR-0091's rule Progress lines in the prompts library: a line whose settings set `estimate` draws its rate and its time left while it runs. ADR-0091's timer rule stands, because the line adds no timer and reads no clock but the one it reads for the elapsed time, and its rule that a line off a terminal writes one start line and one end line stands, because neither line carries the two parts. ADR-0091 carries a dated entry.

The glossary gains Progress estimate, and its Progress line entry names it.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract (LM-530). It extends ADR-0091's progress lines, which carries a dated entry.
