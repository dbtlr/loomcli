---
type: adr
title: ADR-0173 - A progress line groups tasks under it as one tree, which collapses when the group succeeds and stays when it fails
description: The progress handle of @loomcli/prompts gains task(settings), which opens a task, a full progress line with the same handle, under the line it is called on, to any depth. The author's code decides what runs when. The root line's region draws the whole tree as one frame through the progress view, each task indented two columns for each level and its log rows two more, in the order the tasks opened, a finished task showing its end line, its figures stopped at its end, until its parent ends or, when its parent keeps its tasks, until a group above it collapses or its root ends; each task opens a region of its own through its root's context for its progress events and never draws in it, so it takes no rows and core's public surface is unchanged. A task still open when its parent ends takes the parent's end, deepest first. When a group ends as a success or a skip, or core closes it for completion, its tasks go and its own end line stays; when it fails, warns, or is cancelled, they stay under it; ProgressSettings gains keepTasks, absent false, which keeps them on success too and is not inherited. clear() removes a task with its own tasks, or the whole tree. A root whose tasks stay draws an empty last frame and writes the tree above the stack line by line, each line's kept log lines through out.error or out.warn and then its end line through out.draw and the progress view, so ProgressContext's out gains draw, which breaks a context built by hand without it. A task's kept lines wait for that write and go when a group above it collapses. A tree's rows share the terminal's height under ADR-0172, and a finished task's row gives way first, the first to finish first. Every row of a live frame keeps to one row: after the rate and the time left, a running line's label clips with the ellipsis and its other parts drop, while an end line written to stay keeps its whole text. Where the tree does not draw, each line writes its plain start and end lines when they happen through the lane like any message, a task's text stepping in two spaces for each level after the glyph. Each line keeps its own counts, estimate, and elapsed time, and reports its own events under its own label. The progress view's data gains optional depth and tasks. A task opened after its line ended has ended too. It extends ADR-0091's progress lines, ADR-0170's ends, and ADR-0172's log and height.
status: proposed
created: 2026-11-17
modified: 2026-11-17
---

# ADR-0173 - A progress line groups tasks under it as one tree, which collapses when the group succeeds and stays when it fails

## Context

A progress line from `@loomcli/prompts`, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md), draws in a live region of its own, and several lines stack flat, in the order they opened. Under [ADR-0170](0170-a-progress-line-may-end-skipped-or-warned-or-be-cleared-and-a-regions-end-event-reads-skipped-and-warned.md) a line ends as a success, a failure, a skip, a warning, or a cancellation, or is cleared, and under [ADR-0172](0172-a-progress-line-shows-the-newest-lines-of-its-log-under-it-removes-them-on-success-and-keeps-them-on-failure.md) it shows its log under it, keeps the log's lines on a failure, and shares the terminal's height with the run's other open lines. Nothing groups lines: a deploy that builds an image, pushes it, and runs migrations shows three lines that nothing ties together, and a step another part of the action opens lands below whatever line opened before it. The prompts reference lists a multi-step tree as not shipped.

Other libraries group steps under one heading. Clack's `tasks` runs steps under one spinner, listr2 nests tasks under their parent and collapses a parent's subtasks once it succeeds, and Rich's `Progress` shows several tasks in one display.

Four rules of core's live regions set how a tree can draw without a change to core:

- Open regions stack in the order they opened, and a region that has not drawn, or whose frame is empty, takes no rows, under [Live region](../core/output.md#live-region).
- Core closes the regions an opener left open together, for the opener's completion, for a failure, and for cancellation, and a frame a region's abort listener draws is that region's last frame, which moves into scrollback after whatever the listener wrote.
- A stack taller than the terminal cannot be erased above its top row, so a frame that holds a failed line's kept log lines, up to 1000 of them, cannot be a frame, under ADR-0172.
- `out.draw` renders a declared view through the application's overrides, writes above every open region in call order, and is never held by an open input region, under [Drawing on stderr](../core/output.md#drawing-on-stderr).

The owner settled the shape on 2026-11-16 and 2026-11-17 (LM-532): a `task()` method on the handle; a task is a full progress line with the same handle, so it has every end, `log()`, and `task()` of its own, to any depth, and draws indented under its parent; the author's code decides what runs when, and Loom schedules nothing; a task still open when its parent ends takes the parent's end, as an open line takes the run's end; when the group succeeds only its own end line stays, and when it fails, warns, or is cancelled its tasks stay under it; a setting on the group keeps the tasks on success too; where the line does not draw, each task prints its start and end lines through the lane, its text stepping in under its parent's; and a tree's lines and their log rows stay within the terminal by ADR-0172's rule, extended, not by a second mechanism.

ADR-0172 counts a line's own row as one row, also when the terminal wraps a long label. A tree makes that count wrong at scale: on a terminal 80 columns wide and 24 rows tall, a frame the count holds to 24 rows, whose finished tasks' labels are each a little wider than the terminal, takes 47 rows, so the frame outgrows the terminal and every redraw leaves rows in scrollback. The owner ruled on 2026-11-17 (LM-532) that a running progress line keeps to one row: the default progress view cuts a label too wide for the row and ends it with the ellipsis while the line runs, as question frames already do, and the end line stays whole in scrollback.

## Decision

- **One method.** The `Progress` handle gains `task(settings: ProgressSettings): Progress`. `deploy.task({ label: 'Building the image' })` opens a task under `deploy` and returns its handle at once, as `progress()` returns a line's.
- **A task is a progress line.** Its handle is a `Progress`, so it updates, logs, tracks, ends in each of ADR-0170's ways, and opens tasks of its own, to any depth. Its settings are its own: its label, total, spinner, estimate, unit, `logRows`, `logLimit`, and `keepTasks`, and none is inherited from its parent. The line `progress()` opens is a tree's root, the line `task()` is called on is the task's parent, and a line with tasks and its tasks, at every depth, are a task group. A line's depth is 0 for a root and one more than its parent's for a task.
- **The author schedules.** The library runs nothing and orders nothing. The author's code decides what runs when, one task after another or several at once, and when each ends.
- **One region draws the tree.** The root's region draws the whole tree as one frame, through the progress view over the root's data, which carries its tasks. Each task opens a region of its own through its root's context, for its reports and its end, and never draws in it, so under core's stacking rule the task's region takes no rows, and a task that opens after an unrelated line still draws directly under its parent. Because the region opens through the root's context, its opener is the root's opener, so core closes a tree's regions together. Core's public surface is unchanged.
- **The frame.** The frame is the root's row and its log rows, then each of its tasks in the order they opened, each drawn the same way: its row, its log rows, and its own tasks. A line's row is indented two columns for each level of its depth, and its log rows two columns more, so a task at depth 1 draws its row after 2 spaces and its log rows after 4. A running task draws its spinner frame or its bar, its counts, its elapsed time, and its rate and time left by the rules of its own line. A finished task draws its end line, with its glyph and its elapsed time, in its place for as long as its tree shows it: until its parent ends, and after that while its parent keeps its tasks under The tasks stay, until a group above it collapses, it is cleared, or its root ends. An end line's figures are the ones it had at its end: its elapsed time runs from its opening to its end, and its counts, rate, and time left are those of that moment, so a finished task reads the same at every later frame and in the written tree. The tree draws on its root's frame timer, at the root's spinner interval, and at each tick every running line in it advances its own spinner by one frame, so a task's own `spinner` draws its frames at its root's pace. A task's `update` draws the tree's next frame, as a line's `update` draws its own, and its `log()` draws no frame, so its rows show at the tree's next frame. A task adds no timer.
- **One row while it runs.** Every row of a frame that is still live keeps to one row of the view context's `columns`, or 80 columns when `columns` is `undefined`, measured with the view context's `width` and with the row's indent: a running root's row, a running task's, and the end line of a finished task that a running tree shows. The default progress view fits the row of every line whose data's `state` is `running` and the row of every line drawn under such a line, at any depth, so it fits the whole of a running tree's frame. A line written to stay keeps its whole text, and the terminal wraps a long one: a root's own end line, its region's last frame, and each end line a kept tree writes through `out.draw`, each of which the view draws in an end state with no running line above it, and every plain line. This holds for every progress line, in a group or not, so a long label on a line that never opens a task now draws cut while the line runs and whole on its end line.
  - **How a row fits.** While a fitted row is wider than the columns, its parts give way in this order, each step only while the steps before it still leave the row too wide:
    1. The rate drops, with its `·`, as ADR-0171 states.
    2. The time left drops, with its `·`.
    3. The label clips to its leading graphemes and the `ellipsis` glyph, down to the ellipsis alone, as a log row and a question frame clip. A clipped label draws as its plain text escaped as `escapeControlCharacters` writes it, without the author's styles, and a label that fits draws as before.
    4. The bar drops, with the space before it.
    5. The elapsed time drops, with its `·`, and on a cancelled line `(cancelled)`, with the space before it.
    6. The counts drop, with the space before them.
    7. The row is its leading columns that fit, at grapheme boundaries: of the indent, the spinner frame or the end glyph, the space after it, and the ellipsis.

    Once the label is the ellipsis alone it stays so while the later parts drop, so a row never shows more of its label at a narrower width. A step whose part the row does not have, such as the bar of a line without a total, changes nothing. So every positive width, down to 1 column, gives exactly one rendering, and none wraps.
- **A task's own end while its parent runs.** Each end ends the task, reports its end, and leaves the parent running, because what follows a task's end is the author's:
  - `end`, a resolved `track`, and `skip` draw its success or skipped line in its place, without its log rows.
  - `fail`, a rejected `track`, and `warn` draw its failure or warned line in its place, without its log rows. Its kept lines wait, under The log in a tree below.
  - `clear` removes the task and its own tasks from the tree, so the rows below close the gap, and they show again in no later frame and in no block.
  - A task with tasks of its own is a group: its end decides what stays of its tasks, under Collapse and The tasks stay below.
- **A parent's end with tasks open.** A task still open when its parent ends takes the parent's end, and so does every open task under it, at every depth: `end` and a resolved `track` end it as a success, `fail` and a rejected `track` as a failure, `skip` as skipped, `warn` as warned, and `clear` clears it. Each takes its own label, because the parent's message is the parent's. The tasks end before the parent, deepest first: each open task's own open tasks end before it, and siblings end in the order they opened, so each task's block ends before the next sibling's and every task's end event comes before its parent's.
- **Core's closes.** When core closes the tree's regions, for its opener's completion, for a failure, or for cancellation, the tree ends at the first of those closes, as if its root ended that way: completion as a success, a failure as a failure, and cancellation as a cancellation, so every open line takes that end. The library draws and writes the tree's end in that region's abort, so a failing run's tree is written before core's failure report, which stays last under ADR-0091. Each region's end event is the one core builds when it closes that region, in core's order: core closes regions in the order they opened, so the root's end event comes first and each open task's follows in the order the tasks opened, the reverse of a parent's own end. `Region.end()` cannot report a cancellation, so the library cannot end the tasks first under every close, and one order under all three closes is plainer than two. The plain lines are written deepest first all the same, under Where the tree does not draw, so under an invocation by name the events and `messages` of one such close read in different orders.
- **Collapse.** When a group ends as a success, through `end` or a resolved `track`, as skipped, or by core's close for completion, its tasks go, and its own end line stays alone. At the root, the tree's last frame is the root's end line, and core erases the whole running frame before it draws it, so the tasks' rows leave no blank row. A group under a running parent collapses in place: its end line stays in the tree, and its tasks' rows go from the next frame. A collapse takes every task of the group, whatever its own end, so a task that failed or warned in a group that then succeeds goes, with its end line and its kept lines: the group's end has the say, as the owner's ruling gives it. A skip falls on the side of success, because ADR-0172 already groups it with `end` and `clear` as an end that removes what the operator need not read: work with nothing to do is not a problem.
- **The tasks stay.** When a group fails, through `fail`, a rejected `track`, or a failing run, warns, or is cancelled, its tasks stay under it as they stood, each task that collapsed earlier as its own end line alone. A group under a running parent keeps them in place in the tree: each later frame draws the group's end line with its kept tasks under it, each as its own end line with its own kept tasks, and the view's data of the group carries them. At the root the tree is written into scrollback, under Writing the tree.
- **The setting.** `ProgressSettings` gains `keepTasks?: boolean`, false when absent. A group whose settings set it keeps its tasks when it ends as a success or a skip, or core closes it for completion, as it keeps them when it fails, warns, or is cancelled. It is the group's own setting, so a task with tasks of its own collapses by its own `keepTasks`, and a group whose parent sets it does not inherit it. `clear` removes a group's tasks whatever it says. It does not change after the line opens, and the library judges it no more than the other settings.
- **Clearing.** `clear()` on a task removes it and its tasks, under A task's own end above. `clear()` on a root removes the whole tree, which leaves nothing, with ADR-0170's exception for a frame drawn before the terminal was lent, and every open task in it takes the clear.
- **Writing the tree.** When a root ends with one or more tasks under it, tasks it holds and has not cleared, and its tasks stay, the root's region first draws an empty frame, which does not pass through the progress view, and the library then writes the tree above the stack, one line at a time, from the root down, each line followed by its tasks in the order they opened:
  1. The line's kept lines, when it failed, warned, or was cancelled and kept any, as one message through the lane of its level, `out.error` for a failed line and `out.warn` for a warned or a cancelled one, drawn as ADR-0172 draws them, each kept line two columns further in for each level of the line's depth, and opening with the sentence that counts the dropped lines when there are any.
  2. The line's end line, through `out.draw` with the progress view over the line's data, with no tasks, so the application's override draws it as it draws the tree's frames, followed by one line break.

  The region then closes and leaves nothing. The tree is written whole, every line the root holds, whether or not its row showed in the latest frame, because a finished row gives way to the terminal's height only within a frame, and the written tree is no frame. `out.draw` and the lanes write above every open region in call order, so each line's kept lines stand directly above its own end line, a task's end line stays inside its parent's block, and no last frame of another region lands inside the tree. A root with no task under it at its end, one that never opened a task or whose tasks were all cleared, ends as ADR-0172 ends a line: its kept lines above it, and its end line as its last frame. While an open input region holds the frames, the tree is written at once, because neither `out.draw` nor a lane is held, and the stack keeps showing the tree's running frame until the hold ends, as it shows every held frame. While the terminal is lent, the writes land where the child program's cursor is, as ADR-0172's kept lines do.
- **The context.** `ProgressContext`'s `out` gains `draw`, which writing the tree needs. An action's, a middleware's, and a configuration source's context, and the contexts `@loomcli/testing` builds, already carry it.
- **The log in a tree.** A task's log rows draw under its row, indented with it, by ADR-0172's rules, clipped so the whole row, its indent included, fits the view context's `columns`. When a task fails or warns while its root runs, its rows go from the tree, and its kept lines are held with it, unwritten: writing them above the stack then would put them above the root, outside the task's place, and leave them in scrollback after a collapse that removes the task. They are written when the tree is, directly above the task's end line, under Writing the tree, so they are written when every group above the task keeps its tasks, by failing, warning, being cancelled, or `keepTasks`. When the task's group or any group above it collapses, its kept lines go with it, and when it is cleared, too. ADR-0172's bound, its `logLimit`, and its dropped-lines sentence hold for each line unchanged. Where the tree does not draw, a task writes its kept lines at its own end, under Where the tree does not draw below.
- **The terminal's height.** A tree's rows share stderr's rows by ADR-0172's rule, extended to the rows finished tasks show:
  - **Tasks share as lines.** An open task whose region is live is a line that shares, as its root is: it joins when it opens and leaves at its end, it keeps its own row, and its log has its need. A task's region is live exactly when its root's is.
  - **Finished rows.** A finished task's end line that its tree shows while the root runs is a finished row. Finished rows give way first: the rows left after each sharing line's own row and each line's log share are the finished rows' budget, divided among the trees that show finished rows by ADR-0172's division of log rows, each tree's need its count of finished rows, and a remainder one row each to the trees whose roots opened first. A tree shows the newest of its finished rows its share allows, so the task that finished first gives way first, and a task that takes its parent's end finishes before the parent. A finished row that gives way is left out of the frame and of the view's data, and shows again at a later frame that has a row for it. Running lines never give way.
  - **Between frames.** A tree draws, at each frame, its lines' log rows and its finished rows within what is left of `rows` after each sharing line's own row and the log rows and finished rows the other lines and trees drew in their latest frames, so it grows only into rows the others have given up, and once each has drawn a frame since a change, the stack is within the terminal. A task's end turns its own row into a finished row in the same frame, so its end adds no row. A line or a task that opens when the stack has no row left for its own row first has each line that draws log rows and each tree that draws finished rows draw again, in the order the roots opened, as ADR-0172's opening rule has each line that draws log rows draw again.
  - **One row a line.** Each line's own row and each finished row counts as one row. Under One row while it runs, the default view draws each of them on one row, so for it the counts here and ADR-0172's are exact, and ADR-0172's limit that a line's own row counts as one row also when the terminal wraps a long label no longer holds for the default view. An application's own `progressLine` view that draws a row wider than the terminal is still counted as one row for each line, which is the limit that remains.
  - **The standing limit.** Roots and running tasks alone, with no log row and no finished row, can still take more rows than the terminal has, which is ADR-0091's standing limit, as lines alone are under ADR-0172. Rows other writers hold are not counted, as under ADR-0172.
- **Where the tree does not draw.** Off a terminal, under `TERM=dumb`, under CI, with the plain switch on, under an invocation by name, and at verbosity -1, each line writes its plain lines when they happen, as a line does under ADR-0091 and ADR-0170, and a task's text steps in two spaces for each level of its depth, inside the message and after the lane's glyph, so the glyphs stay in one column:
  - `task()` writes the task's label through `out.info`: `ℹ   Building the image` at depth 1.
  - `end` and a resolved `track` write the end message, or the label, through `out.success`, `fail`, a rejected `track`, and a failing run through `out.error`, `skip` through `out.info`, and `warn` through `out.warn`: `✔   Built the image`, `✘   Pushing the image`, `ℹ   Pushed nothing: the image is current`, `⚠   Pushed 2 of 3 layers`. `clear` and a cancellation write no end line.
  - A task that fails, warns, or is cancelled writes its kept lines above its end line at its own end, through the library's own unglyphed view of ADR-0172, each at the column where that task's text starts: 4 columns at depth 1 and 6 at depth 2, so `    npm error code E404` sits above `✘   Installing dependencies`.
  - A task's start and end line go through the lane like any message: the message is two spaces for each level of depth and then the text, and when the text holds several lines every line of it takes the same indent, so the block steps in whole. A row the lane wraps at a terminal's width continues under the lane's glyph column, as any message's does, without the task's step. The lane draws its glyph, one space, and the message, as it draws any message, so an application's lane override draws every line, a task's and a root's, and the library keeps no copy of core's lane layout. A root's lines are unchanged:
    ```
    ℹ Deploying
    ℹ   Build the image
    ✔   Built the image
    ✘   Push failed
    ✘ Deploying
    ```
  - The lines land in the order they happen, so the children of different parents interleave as they start and end, and the indent shows a line's depth, not which line is its parent. A parent's open tasks that take its end write their end lines first, deepest first, siblings in opening order, then the parent's kept lines and its end line, so every task's end line lands between its parent's start line and end line.
  - Nothing collapses, because every plain line is written when it happens and stays. Under an invocation by name the same lines, their indent included, land in `messages`, an MCP tool call's included, and under `-q` the start, success, and skipped lines hide with their lanes, as a line's do.
- **Each line's own figures.** A line's counts, bar, estimate, and elapsed time are its own, a task's included. A parent's bar shows the counts its own `update` reports and nothing its tasks report, and its elapsed time runs from its own opening. A finished line's figures stop at its end, under The frame. A roll-up would choose for the author what a parent's progress means.
- **Progress events.** Each task's region reports as a line's does: `{ label, total, completed: 0 }` with a total and `{ label }` without one when it opens, each `update`, and its end, with the task's own label. So an `onProgress` observer, an invocation by name, and an MCP client receive one `started` event and one end event for each task, each region numbered by its first report under ADR-0091, and the MCP plugin sends each as `notifications/progress` with the task's label. No event changes its shape, and none names its parent.
- **The view's data.** `ProgressLine` gains two optional members. `depth` is the line's depth, 0 for a root. `tasks` is the tasks the line shows under it at that frame, in the order they opened, each with its own data, its `depth` and its `tasks` included: a running line's running and finished tasks, and an ended line's kept tasks while its tree runs, none after a collapse, after The terminal's height has left out the finished rows that give way. An end line drawn inside a running tree's frame is not an end frame, so its data carries the tasks it kept. Every line supplies both on every frame. A root's last frame and each end line written under Writing the tree hold no tasks: a collapsed root has none left, and the tree writes each line's end line on its own. The default view draws the line's row after two spaces for each level of `depth`, its log rows two spaces further in, and each entry of `tasks` after them by the same rules, each on a row of its own, fitted under One row while it runs. Data an application builds by hand without them draws as before: an absent `depth` reads 0 and an absent `tasks` reads none. An application's own view draws the tree it chooses from them. One written before them draws the root alone in each running frame, but a tree whose tasks stay is written one line at a time through `out.draw`, under Writing the tree, so such a view draws every line of that tree, flat, with the library's indented kept log lines between them.
- **After an end.** `task()` on a line that has ended, failed, been cancelled, been skipped, been warned, or been cleared returns the handle of a task that has ended too: it opens no region, reports nothing, draws and writes nothing, its ends and `update` do nothing, its `log()` behaves as after an end under ADR-0172, its `track` only returns the value or rethrows, and its `task()` returns another such handle. A line started after the run is cancelled has ended at its start, so its `task()` does the same. Opening the task as a root would guess at what the author meant.
- **Not drawn.** `task()` on a line that does not draw opens a task that does not draw, under Where the tree does not draw.
- **Many tasks.** The library sets no limit on a group's tasks or on its depth, because how many steps a group has is the author's. A finished task holds its end line's data, and, when it failed, warned, or was cancelled, its kept lines, at most its `logLimit` by ADR-0172's bound; one that ended or was skipped holds no log line once it ends. A collapse and a clear release the tasks they remove, and a root's end releases the tree. So a long-running group holds its finished tasks' end lines and their kept lines until the group ends, and the finished rows its frame draws are bounded by the terminal's height.
- **No fixed words.** A tree adds no sentence: its lines repeat the author's labels and messages, and the dropped-lines sentence of ADR-0172 is unchanged. So the prompts package's message module gains none.
- **The types.** `@loomcli/prompts`'s `ProgressSettings`, `Progress`, and `ProgressContext` read:

  ```ts
  /**
   * The settings of one progress line: its label, an optional total that makes it a bar, an
   * optional spinner of its own, whether it shows its rate and time left, how much of its log it
   * shows and keeps, and whether its tasks stay when it succeeds.
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
    /**
     * Whether the line's tasks stay under it when it ends as a success or a skip, as they stay when
     * it fails, warns, or is cancelled. Absent, false: its tasks go and its own end line stays.
     * A task's own tasks follow the task's setting, not this one.
     */
    readonly keepTasks?: boolean;
  }

  /**
   * The handle `progress()` returns for one line, and `task()` for one task.
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
     * its newest lines show under it, dim, and `end`, `skip`, and `clear` remove them. `fail`,
     * `warn`, and a cancellation keep them to write above the end line. A root writes them at its
     * end. A task whose tree draws holds them and writes them with its tree when the tree's tasks
     * stay, so they go when a group above the task succeeds or the task is cleared. A task whose
     * tree does not draw writes them at its own end, and they stay. Resolves at once for a string,
     * and for an iterable once it ends, or rejects with what it threw.
     */
    log(text: string | AsyncIterable<string>): Promise<void>;
    /**
     * Opens a task under this line: a progress line with a handle of its own, drawn indented under
     * this line, after the tasks that opened before it. A task still open when this line ends
     * takes this line's end. When this line ends as a success or a skip its tasks go, unless its
     * `keepTasks` keeps them, and when it fails, warns, or is cancelled they stay under it. Once
     * this line has ended, the task returned has ended too.
     */
    task(settings: ProgressSettings): Progress;
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
     * Ends the line and removes it, with its tasks. Where the line draws, it leaves nothing, except
     * a frame drawn before the terminal was lent, which stays where it was drawn. Where the line
     * does not draw, it writes nothing after the start line, which stays.
     */
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
    /**
     * The run's output: `region` for each line and task, the lanes for plain lines and kept log
     * lines, and `draw` for the end lines of a tree whose tasks stay.
     */
    readonly out: Pick<Out, 'region' | 'draw' | 'info' | 'success' | 'warn' | 'error'>;
    /**
     * The run's host, whose stderr's `rows` the line reads at each frame to share the terminal's
     * height with the run's other open lines. Absent, the line draws up to its `logRows`.
     */
    readonly host?: { readonly terminal: { readonly stderr: Pick<OutputTerminal, 'rows'> } };
  };
  ```

  `@loomcli/prompts/views`'s `ProgressLine` reads, with its other members unchanged but for the doc comment of `elapsed`:

  ```ts
  /**
   * What one progress line's view draws: its state, its counts, its spinner frame, its time, its
   * rate and time left, its log rows, and the tasks under it.
   *
   * @public
   */
  interface ProgressLine {
    /**
     * Milliseconds since `progress()` or `task()` opened the line: to the frame while it runs, and to
     * its end on an end line, which reads the same at every later frame.
     */
    readonly elapsed: number;
    /**
     * How deep the line sits in its tree: 0 for a line `progress()` opened, and one more than its
     * parent's for a task. The default view indents the line's row two columns for each level and
     * its log rows two columns more. A line always supplies it; absent, 0.
     */
    readonly depth?: number | undefined;
    /**
     * The tasks the line shows under it at this frame, in the order they opened, each with its own
     * data: a running line's running and finished tasks, and an ended line's kept tasks while its
     * tree runs, less the finished ones whose rows give way to the terminal's height. Empty on a
     * root's last frame and on each end line a tree whose tasks stay writes. A line always supplies
     * it; absent, none.
     */
    readonly tasks?: readonly ProgressLine[] | undefined;
  }
  ```

  No export is added, and none is removed.

The contract is in the [prompts reference](../libs/prompts.md#task-groups), its [progress view](../libs/prompts.md#progress-view), the authoring skill's [middleware and actions reference](../../packages/loom/skills/loom/references/middleware-and-actions.md), and the [glossary](../glossary.md#product-surface).

## Considered options

- **A region for each task that draws its own rows.** Rejected. Regions stack in the order they opened, so a task opened after an unrelated line would draw below that line, away from its parent, and keeping it under its parent would need a core rule for nested regions.
- **A core rule that nests regions or closes them in opening order.** Not taken. The tree draws in one region with no change to core, and an opening order is not a tree's order: the tasks of two parents open interleaved.
- **The tree as the root's last frame, its kept lines included.** Rejected under ADR-0172's height rule: a frame of 1000 kept lines is taller than the screen, and core cannot erase it above its top row when another region redraws.
- **A task's kept lines written above the stack at its own end.** Not taken. They would stand above the root, outside the task's place, and stay in scrollback after a collapse that removes the task.
- **Every kept line of the tree above the tree.** Not taken. A task's kept lines would not stand above its own end line, so with two failed tasks nothing would say whose lines are whose.
- **The tree's end lines through the lanes, drawn by the library's own view.** Not taken. They would bypass the application's override of the progress view, so a tree whose tasks stay would not draw its end lines as the application draws its progress lines. `out.draw` resolves the override, at the cost of one more member on `ProgressContext`. For an override that draws `depth` and `tasks`, the written tree then looks like the tree the operator watched. One written before them draws the root alone while the tree runs and every line flat in the written tree, because each written end line is drawn on its own, and that is the cost of writing the tree line by line.
- **An optional `draw` on `ProgressContext`, with a second way to write the tree without it.** Not taken. The fallback would be a second layout for a context only an author builds by hand, and ADR-0170 took the same narrowing for `warn`.
- **A failed task's kept lines shown in the frame while its root runs.** Not taken. They would take rows from the running lines' log rows, which show the work still under way, and the full lines are written with the tree.
- **A skip that keeps a group's tasks.** Not taken. ADR-0172 removes a skipped line's log rows as it removes an ended line's, and a group with nothing to do leaves nothing the operator must read.
- **A `keepTasks` that a group's tasks inherit.** Not taken. No other setting of a line is inherited, and a nested group may collapse its own steps under a parent that keeps its own.
- **A timer for each task.** Not taken. The tree is one frame, so its root's timer animates every line in it, and a task's region draws nothing a timer of its own could animate.
- **A roll-up of a group's counts, rate, or time from its tasks.** Not taken, under Each line's own figures.
- **A parent on a progress event.** Not taken. ADR-0091's event shape stands, and each task's event already carries its own label.
- **A long label that wraps, each of its rows counted in the height.** Not taken. The shares would read every line's width at every frame, and a row the terminal wraps moves again when the terminal narrows. The ruling keeps a running line to one row, as a question frame and a log row keep theirs.
- **A row that counts the finished rows that gave way, such as `3 more finished`.** Not taken. It would be a new fixed sentence on a row that already has to give way, and the tree a failure keeps is written whole.
- **The indent before the glyph, through the library's own view.** Not taken. An application's lane override would then never draw a task's line, and the library would hold a copy of core's lane layout.
- **An indent that core's lanes take.** Not taken here. It changes core's lane contract.
- **Connector glyphs between a task and its parent, such as `├─`.** Not taken. The indent draws the tree with no new glyph, and it matches the indent of log rows.
- **A limit on a group's tasks.** Not taken under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write): how many steps a group has is the author's.
- **A `task()` after an end that opens a root.** Not taken, under After an end.

## Consequences

`Progress`, an output type, gains a method, which is not breaking. `ProgressSettings` and `ProgressLine` are input types, `@public` without `@sealed`, and each gains optional members alone, which the [change-fragment rules](../../.changes/README.md) class as not breaking, and `ProgressLine` reaches an override's `render` too, where a new member is not breaking either. `ProgressContext`, an input type, narrows: its `out` now requires `draw`, so a context a test or a helper builds by hand without `draw` no longer compiles where it is passed to `progress()`. The fragment is breaking for that one reason, and the type checker reports every such site. An application that never calls `task()` draws, writes, and reports the same bytes and events as before, and its progress view override receives two more members it may ignore. The prompts package's message module gains no sentence, and core changes no code and no rule.

A tree's memory grows with the tasks its author opens, each finished task holding its end line and at most its `logLimit` kept lines until its group collapses or its root ends. A tree's frame stays within the terminal, except that roots and running tasks alone can still take more rows than the terminal has, and an application's own view that draws a row wider than the terminal is still counted as one row.

Every running progress line with a label too wide for its row draws differently: the default view cuts the label with the ellipsis while the line runs, where the terminal wrapped it before, and its end line stays whole. No author code has to change, so the change is not breaking.

This extends ADR-0091's rule Progress lines in the prompts library: the handle gains `task()`, a tree draws in its root's region, each task reports through a region of its own that draws nothing, a task off a terminal writes its plain lines through the lane with its text stepping in after the glyph, and a running line keeps to one row. ADR-0091's stacking rule, its rule The report is last, and its timer rule stand. It extends ADR-0170's ends: a task still open takes its parent's end, a group's success or skip removes its tasks, so the rule Only the author clears a line now reads that only the author's code removes a line, through its own `clear()` or its group's success, `clear` removes a line's tasks with it, and the rule After an end gains `task()`. It extends ADR-0171's rule A narrow row, under which the view neither wrapped nor clipped the rest of a line: after the rate and the time left, a running line's label clips and its other parts drop. It extends ADR-0172's log, whose kept lines a task holds until its tree is written, and its rule The terminal's height, which counts each open task as a line and gives the finished rows what the log rows leave, and whose limit that a wrapped label counts as one row now holds only for an application's own view. ADR-0091, ADR-0170, ADR-0171, and ADR-0172 carry dated entries.

The glossary gains Task group, which holds a tree, its root, and a finished row, and its Progress line and Progress log entries name it.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-17: Proposed with the contract (LM-532). It extends ADR-0091's progress lines, ADR-0170's ends, ADR-0171's narrow row, and ADR-0172's log and height, each of which carries a dated entry.
