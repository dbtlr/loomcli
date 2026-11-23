---
type: adr
title: ADR-0172 - A progress line shows the newest lines of its log under it, removes them on success, and keeps them on failure
description: The progress handle of @loomcli/prompts gains log(text), which takes one line, text that holds several, or an async iterable of text, such as a child program's output, and adds its lines to the line's log. While the line draws, the newest 5 lines show under it, dim, indented two columns, each clipped to one row, and older ones scroll out; the line draws them on the frames it already draws and adds no timer. The open progress lines of a run share stderr's rows: each keeps its own row, and the rows left are divided among the lines with a log, so on a short terminal a line shows fewer than its logRows, down to none; the line reads the height through a new optional host on ProgressContext, at each frame. end, skip, clear, and a close for completion remove the rows and write nothing more. fail, a rejected track, a failing run, warn, and a cancellation write the kept lines, at most the newest 1000, as one message, a failure through out.error and a warning or a cancellation through out.warn, above the end line, dim and unclipped, after the sentence "1203 earlier lines were dropped." when earlier ones were dropped. ProgressSettings gains logRows, 5 when absent, and logLimit, 1000 when absent. A line splits at \n, keeps CRLF whole across chunks, starts over at a lone \r that text follows, draws its plain text with tabs expanded, other control characters dropped, and bidirectional controls escaped, and keeps at most its first 4096 code points. Where the line does not draw, log() shows nothing, and the kept lines are written above the plain end line on the same ends. A string's log() resolves at once and an iterable's at its end; a throw keeps the lines and rejects log() unchanged; an iterable open at an end or given after one is read to its end and discarded. The progress view's data gains an optional log, the rows on every frame, empty on an end frame. Progress events are unchanged. It extends ADR-0091's progress lines and ADR-0170's ends.
status: accepted
created: 2026-11-16
modified: 2026-11-17
---

# ADR-0172 - A progress line shows the newest lines of its log under it, removes them on success, and keeps them on failure

## Context

A progress line from `@loomcli/prompts`, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md), draws one row in its own live region, and text an action writes while the line is open lands above it. Under [ADR-0170](0170-a-progress-line-may-end-skipped-or-warned-or-be-cleared-and-a-regions-end-event-reads-skipped-and-warned.md) the line ends as a success, a failure, a skip, a warning, or a cancellation, or is cleared. Nothing shows or keeps a child program's lines inside a line. An author who runs `npm install` under a spinner either lets its output scroll past above the line, which buries the line's own text, or throws it away, and when the install fails the lines that say why are gone.

Other libraries show such output with the line. Clack's `taskLog` streams a subprocess's lines under its title, clears them on success, and keeps them on failure, and listr2 shows a task's output under the task.

[ADR-0163](0163-a-semantic-method-takes-a-stream-of-text-and-shows-each-chunk-as-it-arrives.md) gives each semantic method an async iterable of text in place of its string message, and states how a line completes at `\n`, how a CRLF that two chunks split is one line break, and that each chunk is marked text the author escapes. A question's frame draws a label as [`escapeControlCharacters`](../core/styles.md#strings-and-composition) writes it, so a control character never moves the frame, and it keeps a long line on one row with the `ellipsis` glyph. A region's frame is redrawn in place, and a stack taller than the terminal cannot be erased above its top row. A logged line's frame is 6 rows where a progress line's was 1, so several logged lines together outgrow a short terminal, such as two lines in a 10-row pane or five on 24 rows, and every frame would then leave copies of the stack's top rows in scrollback.

The owner settled the shape on 2026-11-16 (LM-531): a `log()` method on the handle that takes a string or an async iterable of text; the last 5 lines shown under the running line, dim, with older ones scrolling out, the count a setting; the rows removed on `end`, `skip`, and `clear`; the kept lines written above the end line on `fail`, `warn`, and a cancelled run, where they stay in scrollback; the last 1000 lines kept, also a setting, with a sentence that says how many earlier ones were dropped; and, where the line does not draw, nothing while it runs and the kept lines printed on failure.

## Decision

- **One method.** The `Progress` handle gains `log(text: string | AsyncIterable<string>): Promise<void>`. One call adds one line, text that holds several lines, or an async iterable of text, such as a child program's output as it arrives, to the line's log. It is one signature over the union, because `log` takes no view, so the two forms of ADR-0163 need no second signature, and a generic answer typed as a string passes as one. The types refuse a plain `Iterable` and an array of strings, as ADR-0163's do. A chunk that is not a string gets no rule, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md): a Node `Readable` iterates as `any` and yields `Buffer` chunks unless its encoding is set, so an author passes one after `setEncoding('utf8')`, or a `PassThrough` built with `encoding: 'utf8'`.
- **Marked text.** The text is marked text, as the label, the end messages, and a streamed message's chunks are, so an author escapes a child program's raw text with `style.escape`, chunk by chunk, and keeps each style call inside one line.
- **What a line is.** The line splits the text into lines as ADR-0163 splits a streamed message's text off a terminal, and adds one rule for a lone `\r`:
  - A line ends at `\n`, and a `\r` directly before the `\n` is part of the line break, also when two chunks split the CRLF: a `\r` that ends a chunk waits for the next chunk to say whether a `\n` follows it.
  - A chunk that ends inside a line leaves the line unfinished, and the next chunk goes on with it. The end of a string, and the end of an iterable, finish its last line. A final line break ends the last line and starts none, so `'Done\n'` is one line, `'a\nb'` is two, and the empty string holds no line. A blank line is a line.
  - A lone `\r`, one no `\n` follows, is how a child program redraws its own progress line, so it starts the line over once text follows it: the line is the text after its last lone `\r` that text follows. `'Fetching 10%\rFetching 20%\n'` is the line `Fetching 20%`, and a `\r` that ends the text, `'Fetched\r'`, keeps `Fetched`.
  - While its iterable is open, an unfinished line shows as a row, and it leaves out a high surrogate that ends it, the first half of a character such as an emoji, until the chunk with its second half arrives, as ADR-0163 holds one back.
- **What a row draws.** A row, and a kept line, draws the line's plain text, as the view context's `plain` resolves it: the author's styles, and the color, hyperlink, and terminal control sequences a child program writes, draw nothing. `plain` also removes every control character but the tab, so a backspace, a bell, and a carriage return left inside a line draw nothing either. Each tab then expands to the next multiple of eight columns, counted from the start of the line, as the view context's `expandTabs` expands it, and a line separator, a paragraph separator, or a bidirectional control that `plain` leaves draws as `escapeControlCharacters` writes it, such as `\u202e`, as a question's label draws. So no row can move the cursor, erase, or reorder the frame it sits in.
- **The rows while the line runs.** Where the line draws, its frame is the line's row and, under it, the newest lines of its log, at most `logRows` of them, the oldest on top and the newest at the bottom, so an older line scrolls out as a newer one arrives. Each row is two spaces and the line's text, all of it dim. The row never wraps: while it is wider than the view context's `columns`, or 80 columns when `columns` is `undefined`, measured with the view context's `width` in the form it draws, the text clips to its leading graphemes and the `ellipsis` glyph, down to the ellipsis alone, and a row still wider, at 2 columns or fewer, is its leading columns that fit. So the frame is the line's own rows and at most `logRows` more, 6 rows by default for a line that does not wrap, fewer on a short terminal under The terminal's height below, and a line whose log is empty draws as it did before. The line's own row keeps its rules: the terminal wraps a long label, core counts the rows it takes, and the rate and the time left of [ADR-0171](0171-a-progress-line-may-show-its-rate-and-time-left-computed-from-its-recent-reports-and-the-clock-it-reads.md) give way on a narrow row.
- **No frame of its own.** `log()` draws no frame. The rows show at the line's next frame, the next tick of the unref'd frame timer ADR-0091 gives the line or the next `update`, so a child program that writes thousands of lines a second costs no more frames than the spinner draws, and the line adds no timer.
- **A narrowed terminal.** Each frame reads `columns` when it draws, so the rows clip to a narrowed terminal at the next frame, and before it erases, core recounts the last frame at stderr's current width under ADR-0091's resize rule, so a frame the narrowing rewrapped is erased whole.
- **The terminal's height.** The open progress lines of a run share stderr's rows: each line keeps its own row, and the rows left are divided among the lines that have a log, so on a short terminal each shows fewer than its `logRows`, down to none. ADR-0091's rule stands that a stack taller than the terminal cannot be erased above its top row, and core's resize rule asks a view to keep its frame within stderr's `rows`, as the select question does. A line fitted to the height alone would not keep the stack within it, because each of several lines that run at once, such as four parallel installs, would fit itself to the whole screen, so the lines share one budget:
  - **Who shares.** The lines that share are the open progress lines whose region is live and that draw on one terminal in one process: the lines whose contexts carry the same `host.terminal.stderr`, the object an action's, a middleware's, and a configuration source's context of one run share, and two runs in one process do not. The package keeps them in a registry of its own, held weakly by that object, so a finished run leaves nothing behind. A line joins when it opens live, and leaves at its end, failure, skip, warning, or clear, and when core closes its region. A line that is not live never joins and is never fitted.
  - **The height.** A line reads `rows` from its context's `host.terminal.stderr` each time it builds a frame, as the select question reads it, so a resize takes effect at the line's next frame. `ProgressContext` gains an optional `host` for the read. With no `host`, or with `rows` `undefined` or not above 0, the line draws up to its `logRows`, as it would without the rule, and a line whose context has no `host` does not join.
  - **The budget.** The rows for log rows are `rows` less one row for each line in the registry, a line's own row counting as one row. When the budget is 0 or less, no line draws a log row.
  - **Each line's share.** A line's need is the smaller of its `logRows` and the rows its log has to show at that moment, an open iterable's unfinished row included, so a line with `logRows: 0` or an empty log needs none and takes none. The budget is divided among the lines with a need in equal shares. A line never gets more than its need, the rows it does not need go to the others, and a remainder that cannot be divided equally goes one row each to the lines that opened first. With the default `logRows` of 5:

    | `rows` | Open lines and the rows each log has to show | Budget | Shares, in opening order |
    | ------ | -------------------------------------------- | ------ | ------------------------ |
    | 10     | Two, each with 6 lines, so each needs 5      | 8      | 4, 4                     |
    | 24     | Five, each with 6 lines                      | 19     | 4, 4, 4, 4, 3            |
    | 6      | Two, one with 1 line and one with 6          | 4      | 1, 3                     |
    | 10     | Three: 6 lines, an empty log, and 6 lines    | 7      | 4, 0, 3                  |
    | 3      | Three, each with 6 lines                     | 0      | 0, 0, 0                  |

  - **Between frames.** Lines draw on their own timers, so a line learns of a change, a line that opened, a log that grew, a line that ended, or a resize, at its own next frame. At each frame a line draws the smaller of its share and what is left of `rows` after each registered line's own row and the log rows the other registered lines drew in their latest frames, and it draws the newest rows of its log, as before. So a line shrinks to its share, or below it, at its own next frame, and a line grows only into rows the others have already given up. Once every line has drawn a frame since a change, each line has drawn at most its share, so the stack is within the terminal, and each line's next frame draws its whole share. No frame makes the stack taller than the terminal. A line that opens adds its own row before any other line's next frame, so when the stack has no row left for it, each registered line that draws log rows first draws a frame again, in the order the lines opened, under the same rule, and the new line draws its first frame after them. So on a 6-row terminal, a line that opens beside a line drawing 5 log rows makes that line draw 4 first, and the new line draws no log row until the first line's frames leave it rows. A terminal that grows narrower or shorter between frames stays under core's resize rule, as it does for every view.
  - **What it leaves alone.** The kept lines a failed, warned, or cancelled line writes are every kept line, whatever the line drew. Plain output, progress events, `track()`, the settings and their defaults, and when `log()` resolves are unchanged, and `log()` still draws no frame of its own.
  - **Its limits.** Rows that other writers hold are not counted: an open question's region, a region an author opens by hand, and a streamed message's unfinished row. A line's own row counts as one row, also when the terminal wraps a long label. Lines alone, with no log rows, can still take more than the terminal's rows, which is ADR-0091's standing limit.
- **The settings.** `ProgressSettings` gains `logRows?: number`, the most rows the running line shows, 5 when absent, and fewer on a short terminal under The terminal's height, and `logLimit?: number`, the count of lines the line keeps to write when it fails, warns, or is cancelled, 1000 when absent. Each is a whole number of 0 or more. `logRows: 0` shows no row, while the line still keeps its lines. `logLimit: 0` keeps no line, so the line writes none when it fails, and no sentence. The two are independent: the rows are the newest `logRows` lines whatever `logLimit` says. Neither changes after `progress()` opens the line, and the library judges neither, under ADR-0093 and the prompts reference's No checks rule.
- **The bound.** The line holds the newest `logLimit` finished lines, or the newest `logRows` when that is more, and counts every finished line, so it knows how many earlier lines its kept lines leave out. A line longer than 4096 code points keeps its first 4096 and the `ellipsis` glyph after them, and the rest of that line is read and discarded up to its line break; a lone `\r` that text follows starts it over, as for any line. An unfinished line is bounded the same way. So a line's log holds at most the greater of the two counts, plus one unfinished line for each open iterable, of at most 4096 code points each, and a child program that writes one line of a gigabyte costs 4096 code points.
- **The ends that remove the rows.** `end`, `skip`, `clear`, a resolved `track`, and core's close of a line its opener left open for completion remove the rows. The line's last frame is its success line, its skipped line, or, for `clear`, the empty frame, with no rows under it, and core erases the whole running frame, its rows included, before it draws the last frame, so the rows leave no blank row. Where the line does not draw, these ends write nothing for the log.
- **The ends that keep the lines.** `fail`, a rejected `track`, a failing run, `warn`, and a cancellation write the kept lines as one message above the line's end line, where they stay in scrollback. The message goes through the lane of the end line's level, so the kept lines stay on stderr with it: `out.error` for a failed line, the lane its failure line takes where it does not draw, `out.warn` for a warned line, and `out.warn` for a cancelled line, which has no lane of its own and is not a failure of the work. Both lanes write at every verbosity, and under an invocation by name the kept lines land in `messages`, an MCP tool call's included. The call passes the library's own view in place of the lane view, under [ADR-0148](0148-a-semantic-method-takes-a-view-for-its-message-and-ends-it-with-one-line-break.md), so the kept lines carry no glyph and no gutter: each draws as a row does, two spaces and its text, dim, but whole, and the terminal wraps a long one. They stay dim in scrollback, so they keep the look the operator watched and the end line below them stays the line that stands out. The line writes the message and its end line at the same moment, so the kept lines stand directly above the end line. While an open input region or a lend holds the frames, the end line moves into scrollback when the hold ends, as every last frame does, so a write made meanwhile lands between the two. A line whose log is empty writes no message. The message is written before core renders a failure report, because a failing run's line writes it in its region's abort, so the report stays last.
- **The dropped lines.** When the line finished more lines than the message writes, the message opens with one more row, drawn as a kept line is, that says how many earlier lines it leaves out: every finished line less the newest `logLimit` it writes, also when the line holds more because `logRows` is greater. `1 earlier line was dropped.` for one, and `1203 earlier lines were dropped.` for 1203, so 2203 finished lines under the default `logLimit` read the second, and 20 finished lines with `logRows: 5` and `logLimit: 3` read `17 earlier lines were dropped.` It is a fixed operator sentence, so it lives in the package's message module, `src/messages.ts`, as `logLinesDropped(dropped)`, a function of the count it repeats through `String()`, under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md), and the package's voice test holds it. A line that keeps no line writes no sentence.
- **Where the line does not draw.** Off a terminal, under `TERM=dumb`, under CI, with the plain switch on, under an invocation by name, and at verbosity -1, `log()` shows nothing while the line runs, so the log rows never reach the plain output, and the line still keeps its lines and counts the dropped ones. The ends that remove the rows write nothing for the log. The ends that keep the lines write the same message through the same lanes, above the plain end line: above `✘ Installing dependencies` from `out.error`, and above `⚠ Installed 118 of 120 packages` from `out.warn`. A cancelled line writes no plain end line, under ADR-0091, so its kept lines stand alone.
- **When `log()` resolves.** For a string, `log()` resolves at once, once its lines are in the log, without waiting for a frame, as `update` draws without waiting. For an iterable, it resolves once the iterable has ended and its last line is in the log. An author awaits it before ending the line, so the end keeps every line.
- **An iterable that throws.** The lines it gave stay in the log, and its unfinished line is finished, as at its end. `log()` then rejects with the thrown value, unchanged, which takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path) unless the author catches it. The throw does not end the line: the author's code decides how the line ends, and a rejection that fails the run closes the line for the failure, which keeps its lines.
- **Several at once.** Each `log()` call keeps its own unfinished line, and no call waits for another. Finished lines take their places in the log in the order they finish, so the lines of two iterables open at once interleave line by line, and a line is never torn by another call's text. While several iterables are open, each one's unfinished line, when it holds text, shows after the finished lines, in the order the calls were made, and counts toward `logRows`.
- **At an end, and after it.** When the line ends, each open iterable's unfinished line that holds text is finished and joins the log first, so the kept lines hold what the operator last saw. After that, `log()` with a string does nothing and resolves. An iterable still open at the end, or passed to `log()` after it, is read to its end and its text discarded, and its call resolves at that end and rejects when it throws, as a hidden streamed message is read under ADR-0163. The line never stops an iterable and never calls its iterator's `return`, so a child program writing into a stream the author passed never blocks on a full pipe. A line started after the run was cancelled, whose region closed as it opened, follows the same rule.
- **Tracking work.** `track()` is unchanged. A line that fails through a rejected `track` keeps its lines as `fail` does, and one that ends through a resolved `track` removes them as `end` does.
- **The view's data.** `ProgressLine`, the data of the declared view `@loomcli/prompts/progress`, gains an optional `log`, the rows the line draws under it at that frame, already fitted: the newest lines of the log, at most `logRows` and at most what The terminal's height leaves the line, oldest first, each the author's text with no line break, after the `\r` rule and the bound, and an open iterable's unfinished line last. So an application's own view draws within the height without a rule of its own. Every line supplies it on every frame. A running frame holds its rows, which may be none, and an end frame holds none, because every end removes the rows from the line, so an override that draws `log` in every state draws no rows on an end line. It is optional, so data an application builds by hand for `out.draw(data, progressLine)` draws without it, and an absent `log` reads as no rows. The default view draws each entry as a row under the line, by the rules above, in every state. An application's own view draws the rows it chooses from `log`, and an override written before `log` draws its line without rows. The kept lines a line writes when it fails do not pass through the progress view, so an override changes the running rows and not the kept lines.
- **No timer, no limit.** The line puts no timer on the author's work and reads the iterable as its chunks arrive, so ADR-0091's timer rule stands. It never limits how long an iterable stays open, and an application that needs a timeout sets one in its own work.
- **Progress events.** No event changes. A `ProgressEvent` carries the counts and the label, and the log is the drawn line's and the plain lines'. An `onProgress` observer reads no log line, and an MCP client reads the kept lines in a failing call's `messages`, beside the progress notifications it already receives.
- **The types.** `@loomcli/prompts`'s `ProgressSettings`, `Progress`, and `ProgressContext` read:

  ```ts
  /**
   * The settings of one progress line: its label, an optional total that makes it a bar, an
   * optional spinner of its own, whether it shows its rate and time left, and how much of its log
   * it shows and keeps.
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
    /**
     * How many of the log's newest lines the running line shows under it at most, a whole number
     * of 0 or more, and fewer when the terminal's height leaves the line less. Absent, 5.
     */
    readonly logRows?: number;
    /**
     * How many of the log's newest lines the line keeps to write above its end line when it fails,
     * warns, or is cancelled, a whole number of 0 or more. Absent, 1000.
     */
    readonly logLimit?: number;
  }

  /**
   * The handle `progress()` returns for one line.
   *
   * @public
   * @sealed
   */
  interface Progress {
    /** Changes the line's counts or label while it runs. */
    update(update: ProgressUpdate): void;
    /**
     * Adds lines to the line's log: one line, text that holds several, or an async iterable of
     * text, such as a child program's output. The text is a marked string. Where the line draws,
     * its newest lines show under it, dim; `end`, `skip`, and `clear` remove them, and `fail`,
     * `warn`, and a cancellation write the kept lines above the end line. Resolves at once for a
     * string, and for an iterable once it ends, or rejects with what it threw.
     */
    log(text: string | AsyncIterable<string>): Promise<void>;
    /** Ends the line as a success, with an optional message in place of the label. */
    end(message?: string): Promise<void>;
    /** Ends the line as a failure, with an optional message in place of the label. */
    fail(message?: string): Promise<void>;
    /**
     * Ends the line as skipped, with an optional message in place of the label. Where the line draws,
     * it leaves a dim line. Where it does not draw, it writes the line through `out.info`.
     */
    skip(message?: string): Promise<void>;
    /** Ends the line with a warning, with an optional message in place of the label. */
    warn(message?: string): Promise<void>;
    /**
     * Ends the line and removes it. Where the line draws, it leaves nothing, except a frame drawn
     * before the terminal was lent, which stays where it was drawn. Where the line does not draw, it
     * writes nothing after the start line, which stays.
     */
    clear(): Promise<void>;
    /** Ends the line by how the work settles and returns the work's value, or rethrows its rejection. */
    track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value>;
  }
  ```

  `@loomcli/prompts/views`'s `ProgressLine` reads, with its other members unchanged:

  ```ts
  /**
   * What one progress line's view draws: its state, its counts, its spinner frame, its time, its
   * rate and time left, and its log rows.
   *
   * @public
   */
  interface ProgressLine {
    /**
     * The rows the line draws under it at this frame, already fitted: the newest lines `log()`
     * gave, at most the line's `logRows` and at most its share of the terminal's height, oldest
     * first, each the author's marked text with no line break. Empty on an end frame, because every
     * end removes the rows. A line always supplies it; absent, no rows.
     */
    readonly log?: readonly string[] | undefined;
  }
  ```

  `ProgressContext` gains an optional `host`, typed as narrowly as the read of `rows` needs, so every action's, middleware's, and configuration source's context satisfies it, and a context built by hand without `host` still compiles:

  ```ts
  /**
   * What `progress()` reads: an action's, a middleware's, or a configuration source's context.
   *
   * @public
   */
  type ProgressContext = Pick<ActionContext<unknown>, 'graph'> & {
    readonly out: Pick<Out, 'region' | 'info' | 'success' | 'warn' | 'error'>;
    /**
     * The run's host, whose stderr's `rows` the line reads at each frame to share the terminal's
     * height with the run's other open lines. Absent, the line draws up to its `logRows`.
     */
    readonly host?: { readonly terminal: { readonly stderr: Pick<OutputTerminal, 'rows'> } };
  };
  ```

  No export is added, and none is removed.

The contract is in the [prompts reference](../libs/prompts.md#a-lines-log), its [progress view](../libs/prompts.md#progress-view), the authoring skill's [middleware and actions reference](../../typescript/packages/loom/skills/loom/references/middleware-and-actions.md), and the [glossary](../glossary.md#product-surface).

## Considered options

- **A method per form, such as `logLine` and `logStream`.** Rejected under [principle 5](../principles.md#5-one-system-per-concept): one job is one operation, and the ruling names one method that takes both forms.
- **Raw text that the library escapes.** Not taken. Every text a line takes, its label, its unit, and its end messages, is a marked string, and so is each chunk of a streamed message under ADR-0163, so `log()` takes text the same way, and a row draws its plain text whatever it holds.
- **A frame for each line as it arrives.** Not taken. A child program that writes thousands of lines a second would make the line draw thousands of frames a second, each one an erase and a redraw. The line draws its rows on the frames it already draws, at the spinner's interval, and an operator reads no faster than that.
- **The kept lines as part of the last frame.** Not taken. A last frame is drawn into the stack before it moves into scrollback, and a frame of 1000 rows is taller than the screen, which core cannot erase above its top row when a region above or below it redraws. A write above the stack is permanent at once and erases nothing.
- **The kept lines through the end line's lane view.** Not taken. The error and warn lane views put their glyph before the first line and indent the rest under it, so the child program's first line would read as Loom's own failure line, beside the end line's glyph. The lane decides the level and the destination, and the library's view keeps the rows' look.
- **The kept lines at full contrast, or in the child program's colors.** Not taken. Dim keeps the look the operator watched while the line ran and leaves the end line below them as the line that stands out. A child program writes color only where it chooses, often only to a terminal, and its sequences would reach a redrawn frame, so a row draws its plain text, and a kept line keeps the row's look.
- **A terminal's reading of `\r`, which overwrites only the columns the new text covers.** Not taken. It needs a model of the terminal's row, and a child program that redraws its progress with `\r` writes each state whole, often padded with spaces, so the text after the last `\r` is the state it means.
- **Stopping an open iterable at the line's end by calling its iterator's `return`.** Not taken. For a stream the author passed, `return` destroys the stream, and a child program that writes into it then fails its write or, behind a pipe nothing reads, blocks. Reading it to its end and discarding the text ends neither, as ADR-0163 reads a hidden streamed message.
- **Ignoring an iterable passed after the end.** Not taken for the same reason: a stream nothing reads fills its buffer, and a child program writing into it stops.
- **A setting that keeps the rows on success.** Rejected by the owner's ruling: `end`, `skip`, and `clear` remove them.
- **The kept lines on a cancelled line only where the line draws.** Not taken. A line shows the same things live and not live, as ADR-0170 draws the same glyph on both, and the lines that say what the work was doing when the operator stopped it serve a log file as they serve a screen.
- **`out.error` for a cancelled line's kept lines.** Not taken. A cancellation is the operator's, not a failure of the work, and `out.warn` writes at every verbosity as `out.error` does.
- **A log line on a progress event, or a count of dropped lines on the view's data.** Not taken. The ruling concerns the drawn line, a program reads the work's progress from the counts and the label, and an MCP client already receives the kept lines in a failing call's `messages`.
- **A setting for the length a line keeps.** Not taken. 4096 code points is longer than any row a terminal draws and than the lines a build tool or a package manager writes, so a setting would only serve a probe.

## Consequences

`Progress`, an output type, gains a method, which is not breaking. `ProgressSettings` and `ProgressLine` are input types, `@public` without `@sealed`, and each gains optional members alone, which the [change-fragment rules](../../typescript/.changes/README.md) class as not breaking. `ProgressLine` reaches an override's `render` too, where a new member is not breaking either. `ProgressContext`, an input type, gains an optional member, `host`, which is not breaking: an action's, a middleware's, and a configuration source's context each carry a `host` that satisfies it, and a context built by hand without one compiles and draws as before. The fragment is a feature. An application that never calls `log()` draws, writes, and reports the same bytes and events as before, and its progress view override receives one more member it may ignore. The prompts package's message module gains one sentence. Core changes no code.

A line keeps at most the greater of `logLimit` and `logRows` lines of at most 4096 code points each, plus one unfinished line for each open iterable, so its memory is bounded by its settings, whatever a child program writes.

Logged lines on a short terminal draw fewer rows than their `logRows`, so a stack of them stays within the terminal and leaves no copy of its top rows in scrollback. The registry of open lines is the package's own and holds each terminal weakly, so it keeps nothing once a run's lines have ended. A line still counts no row another writer holds, such as an open question's region, and lines alone can still be more than the terminal's rows.

This extends ADR-0091's rule Progress lines in the prompts library: the handle gains `log()`, a running line draws its log rows under it, and a line off a terminal writes, beside its one start line and one end line, its kept lines above the end line when it fails, warns, or is cancelled. ADR-0091's rule The report is last stands, because the kept lines are written in the region's abort, before the report, and so does its timer rule, because the line adds no timer. It extends ADR-0170's ends: `end`, `skip`, and `clear` also remove the rows; `fail`, `warn`, and a cancellation also write the kept lines; its rule Only the author clears a line now reads that a line that fails, warns, or is cancelled keeps its log as well as its text; and its rule After an end gains `log()`, which does nothing for a string and reads an iterable to its end. ADR-0091 and ADR-0170 carry dated entries.

The glossary gains Progress log, and its Progress line entry names it.

## Status

Accepted in 0.19.0.

## Changelog

- 2026-11-16: Proposed with the contract (LM-531). It extends ADR-0091's progress lines and ADR-0170's ends, each of which carries a dated entry.
- 2026-11-17: [ADR-0173](0173-a-progress-line-groups-tasks-under-it-as-one-tree-that-collapses-when-the-group-succeeds-and-stays-when-it-fails.md), proposed, extends the log and the terminal's height to a task group, and keeps a running line to one row. The default view no longer lets the terminal wrap a running line's own row: under The rows while the line runs, a label too wide for the row clips with the `ellipsis` glyph while the line runs, after the rate and the time left give way, and the end line keeps its whole text. So under Its limits, a line's own row counts as exactly one row for the default view, and the limit that it counts as one row also when the terminal wraps a long label holds only for an application's own view that draws a row wider than the terminal. A task's log rows draw under its row, indented with it. A task that fails or warns while its root runs holds its kept lines until its tree is written, directly above the task's end line, and they go when a group above it collapses; where the tree does not draw, a task writes them at its own end. Under The terminal's height, each open task is a line that shares, and a finished task's end line that its tree shows takes the rows the log rows leave, the first to finish giving way first, so lines alone with no log row and no finished row are still the standing limit. It binds when that record is accepted.
