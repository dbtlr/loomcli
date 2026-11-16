---
type: adr
title: ADR-0169 - One plain switch turns off all redrawing, so progress prints plain lines and a question asks line by line
description: The run's plain switch turns off every redraw, so the screen is only ever appended to. It is on when an argv word before the first bare -- is a spelling of the option that carries the new plain mark, which @loomcli/plugins/plain declares as --plain, or when ACCESSIBLE is set and not empty, which core reads itself in every application, and nothing turns it off. With it on, a terminal stderr does not redraw in place, as under TERM=dumb, so no region is live, an input region included, a progress line prints its start and end lines alone, a streamed message is written a line at a time, out.draw keeps the Application's terminal controls setting, and a question asks line by line. A question asked line by line prints each piece once, through the new questionLine view, and never moves the cursor or erases: text, secret, and confirm ask on one row with the default in brackets, select and multiselect print a numbered list and ask for a number or numbers, a search asks for a term first, the editor keeps its interaction and prints each frame once, and the words around a question are fixed labels. TERM=dumb asks line by line too, CI is unchanged, and messages, color, verbosity, and the interaction decision are untouched. It narrows ADR-0082's look and kinds, ADR-0091's live rule, ADR-0106's raw-mode reader for a question asked line by line, ADR-0114's input-region clause, ADR-0138's search, ADR-0139's frames, and ADR-0163's terminal rule.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0169 - One plain switch turns off all redrawing, so progress prints plain lines and a question asks line by line

## Context

A terminal stderr redraws in place unless `TERM` is `dumb` or the run is under CI, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) and [ADR-0114](0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md). On a terminal that redraws, a progress line repaints its spinner every 80 milliseconds, a streamed message under [ADR-0163](0163-a-semantic-method-takes-a-stream-of-text-and-shows-each-chunk-as-it-arrives.md) redraws its unfinished row as each chunk arrives, and each of the six question kinds of [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md), [ADR-0138](0138-select-and-multiselect-questions-offer-choice-objects-may-search-them-or-read-them-from-a-source-and-draw-choice-rows.md), and [ADR-0139](0139-an-editor-question-opens-the-operators-editor-on-a-private-temporary-file-and-core-lends-it-the-terminal.md) reads raw keys through one shared reader and redraws its frame with cursor movement and erasure at every key. Even under `TERM=dumb` an input region still draws, under ADR-0114, so a question there moves the cursor on a terminal that cannot.

Two operators need the screen to be only ever appended to. A screen reader reads each redraw as new text, so a spinner or a select's frame reads as a stream of repeated lines, and some terminals, such as a serial console or an editor's shell buffer, cope badly with cursor movement. And an operator who records a run, with `script`, a terminal's logging, or a tmux pipe, wants a readable record, which a redraw fills with control sequences and overwritten text. Neither wants fewer messages, less color, a lower verbosity, or no questions: `-q`, `--no-input`, and `NO_COLOR` each already do one of those jobs.

No standard names such a switch the way [no-color.org](https://no-color.org/) names `NO_COLOR`. The closest convention is `ACCESSIBLE`, which Charm's huh forms library documents for its accessible mode, set and not empty, in which each field is printed once and answered as a typed line.

The owner settled the shape in grooming (LM-387): one switch turns off all redrawing; a new pack plugin, `@loomcli/plugins/plain`, supplies `--plain` through a new core mark, and core also reads `ACCESSIBLE` itself; `TERM=dumb` asks questions line by line too; CI is unchanged; plain progress prints its start and end lines alone; each question kind's line-based form; and fixed labels for the words the line-based form prints around a question.

## Decision

- **The plain switch.** Each run has one plain switch. It is on when either holds: a word of `host.argv` before the first bare `--` equals a spelling of the option that carries the plain mark, or `ACCESSIBLE` in `host.env` is set and not empty. Otherwise it is off. Nothing turns it off once either holds: the mark takes its positive spelling alone, and core reads `ACCESSIBLE=0` and `ACCESSIBLE=false` as set, so the operator's way back from a shell that exports `ACCESSIBLE` is to unset it or run with it empty, `ACCESSIBLE= app`. The switch is separate from `-q`, `--no-input`, and `NO_COLOR`: it reads none of them, and none of them reads it.
- **What it turns off.** With the switch on, a terminal stderr does not redraw in place, exactly as under `TERM=dumb`:
  - A region opened without `input: true` is not live, so a progress line prints its plain start and end lines, as it does through a pipe, and its updates print nothing.
  - A region opened with `input: true` is not live either, under the live rule below.
  - A streamed message follows ADR-0163's off-terminal rule: each line is written once it completes, and no row is redrawn.
  - `out.draw` keeps the Application's `terminalControls` setting, as a draw to a stderr that is not a terminal does, so a cursor movement its text holds is dropped unless the Application preserves controls, and a shutdown or a suspend writes no show-cursor sequence unless the Application preserves controls.
  - A question asks line by line, under the rule below.
- **What it leaves alone.** Every message still prints at its level, the run's verbosity still decides which lanes write, and color, modifiers, hyperlinks, glyph forms, and the background query follow their own rules, `NO_COLOR`, `FORCE_COLOR`, and `--color` included. The [interaction decision](../core/interaction.md) is unchanged, so whether a question asks at all is decided as before. A child program the run lends the terminal to, an editor question's editor or help's pager, draws on the terminal as it chooses, and the switch does not reach it.
- **The live rule.** A region is live when `host.terminal.stderr.isTTY` is true and either the region takes input and the terminal moves its cursor, which it does unless the switch is on or `TERM` is `dumb`, or the region takes no input, the run's verbosity is 0 or more, and the terminal redraws in place, which it does unless the switch is on, `TERM` is `dumb`, or the run is under CI. Under CI an input region stays as it was, because a CI run is not interactive and no question asks there.
- **The mark.** `plain: true` on a Boolean global option, the application's or a plugin's, marks the option whose spellings turn the switch on. Core reads the mark as it reads the color mark under [ADR-0089](0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md): right after host capture and before graph build, from `host.argv` alone, so every byte the run writes after capture follows the switch. The spellings are the option's long spelling and each alias's long spelling, and a word that attaches a value, such as `--plain=yes`, equals none of them and turns nothing on; the ordinary parse reports it later at its usual place. The marked option takes its positive polarity alone, no short alias, and no variable, and it carries no configuration binding, because argv is its one source and `ACCESSIBLE` is the environment's word for the switch. The types reject `polarity: 'negative'` and `'both'`, `short`, `shortOnly`, and `env` beside the mark, and the mark on every option type but `boolean` and on `option()`. A configuration binding on the marked option, and a second marked option in one Application, are declaration errors under the new rule `@loomcli/core/plain-mark`, whose fault throws where the color mark's does. The marked option still parses as an ordinary Boolean global option, so `options.plain` reads `true` after `--plain` and its absent value otherwise: it says what the operator typed, never whether the switch is on. A repeated `--plain --plain` is the repetition error every option that is neither multiple, counted, nor last-wins meets, and its failure line prints with the switch on. `app.invoke`, an action's `invoke`, and every MCP tool call read no spelling, because their `host.argv` is `[]`, and they have no terminal, so the switch changes nothing they write.
- **The type.** The Boolean option shapes gain a fourth member, and every other shape declares the key `never`:

  ```ts
  /**
   * A Boolean option: one polarity with any spelling, both polarities with long forms, the color
   * mark, which the run reads from argv before short groups and binds no variable, so it declares
   * no short alias and no `env`, or the plain mark, which the run reads the same way and which takes
   * its positive spelling alone, because nothing turns the plain switch off.
   *
   * @public
   */
  export type BooleanOption =
    | (OptionSpelling &
        BooleanFacts &
        EnvBinding & {
          color?: never;
          plain?: never;
          polarity?: 'positive' | 'negative';
        })
    | (BooleanFacts &
        EnvBinding & {
          color?: never;
          plain?: never;
          polarity: 'both';
          short?: ShortAlias;
          shortOnly?: false;
          aliases?: readonly string[];
        })
    | (BooleanFacts & {
        color: true;
        plain?: never;
        polarity?: 'positive' | 'negative' | 'both';
        short?: never;
        shortOnly?: never;
        aliases?: readonly string[];
        env?: never;
        envAllowEmpty?: never;
      })
    | (BooleanFacts & {
        /**
         * Marks the one option whose spellings turn the run's plain switch on. Core reads them from
         * argv right after host capture, so the option takes no short alias and no variable, and it
         * takes its positive spelling alone, because nothing turns the switch off.
         *
         * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/output.md#the-plain-switch
         */
        plain: true;
        color?: never;
        interaction?: never;
        polarity?: 'positive';
        short?: never;
        shortOnly?: never;
        aliases?: readonly string[];
        env?: never;
        envAllowEmpty?: never;
      });
  ```

  `Unmarked` gains `/** Never declared: the plain mark belongs to one Boolean global option. */ plain?: never;`, and `CountOption` and `BackgroundOption` each gain `plain?: never;`, as they declare `color?: never;`.
- **`ACCESSIBLE`.** Core reads `ACCESSIBLE` from `host.env` itself, as it reads `TERM` and `CI` for redrawing, in every application, with or without the plugin and with or without a marked option, so an operator who sets it once is served by every Loom application. No option binds it, and no projection lists it, as none lists `NO_COLOR`.
- **`TERM=dumb`.** Under `TERM=dumb` an input region is not live, so a question asks line by line there too, as the switch makes it ask. Every other rule ADR-0114 gives `TERM=dumb` stands.
- **CI.** Under CI nothing changes: the interaction decision is off, so a question does not ask, and a region without input is not live, as before.
- **A question asks line by line.** `@loomcli/prompts` opens a question's input region as before and reads its `live`, as a progress line reads its region's. When interaction is on and the region is not live, which on a terminal means the switch is on or `TERM` is `dumb`, the question asks line by line. Each piece it prints is printed once and never redrawn, through `out.draw` and the declared view `questionLine`, and the operator types an answer and presses Enter. It never moves the cursor up, never erases, and writes no control sequence of its own: no cursor movement, no erasure, no sequence that hides or shows the cursor, and no bracketed paste switch. Color and glyphs follow the theme and the run's rendering policy, as every frame's do.
  - **Text.** `Project name [my-app]: `, the message, the prefill in brackets when there is one, and `: `. Enter alone takes the prefill, and a typed answer replaces it. Without a prefill the row reads `Project name: `, and Enter alone submits the empty string.
  - **Secret.** `Token: `, with typing not echoed and no prefill. At Enter the question writes the line break the terminal did not echo.
  - **Confirm.** `Deploy now? [y/N]: `, the legend in brackets, where the capital letter is the prefill, `[y/n]` with none. Enter alone takes the prefill, and without one it is refused with `Type y or n.`, as any other answer but `y`, `yes`, `n`, and `no` in any case is.
  - **Select.** The message on a row of its own, then a numbered list, then `Enter a number [1]: `. The number in brackets is the choice the prefill matches, or the first numbered choice, and Enter alone takes it.
  - **Multiselect.** The message, then a numbered list, then `Enter numbers separated by commas [1,3]: `. The numbers in brackets are the choices the prefill selects, in its order, and Enter alone takes them; with none the row reads `Enter numbers separated by commas: `, and Enter alone submits the empty selection.
  - **Editor.** Its interaction and its words are unchanged: it waits for Enter, lends the terminal to the editor, and answers the saved text. Its frames are printed once each and never replace one another: the asking frame, the editing frame on the row after the Enter, and the answered line once the editor exits.
  - **A default.** A default shows in brackets, and Enter alone takes it.
  - **A rejected answer.** An answer the validator rejects, the question's own or the linked input's, prints the validator's sentence on a row of its own, and the question asks again by printing its asking row once more. A select or multiselect prints its asking row again, not its list.
  - **A disabled choice.** It is listed without a number, so no number chooses it, and every other choice is numbered from 1 in the list's order.
  - **A search.** A select or multiselect that searches, with `search: true` or a `source`, prints its message, asks `Search: `, prints the matches for the term the operator enters as a numbered list, and then asks `Enter a number, or text to search again: `. A line of numbers there chooses from the list just printed, and any other line is a new term, whose matches the question prints before it asks again.
  - **Reading.** The terminal stays in its own line mode, so it echoes what the operator types and edits the line with its own Backspace, Ctrl-U, and Ctrl-W, as at a shell's `read`, and the question reads the line when Enter ends it. A secret reads in raw mode with nothing echoed, as it does today, so its typing never reaches the screen.
  - **Leaving.** Ctrl-C cancels as it does today, and Ctrl-\\, Ctrl-Z, Ctrl-D on an empty line, and stdin ending keep their meanings. A question that ends without an answer prints its cancelled line once, on a row of its own.
  - **Turns.** Two questions asked at once take turns, as they do when they redraw: the second prints nothing until the first is answered or cancelled.
- **Fixed labels.** The words the line-based form prints around a question, `Enter a number`, `Enter numbers separated by commas`, `Search`, and `Enter a number, or text to search again`, are fixed labels of the default `questionLine` view. No question setting changes them, as no setting changes a select's key help, and an application that wants other words overrides the view.
- **The view.** `@loomcli/prompts/views` exports one declared view for the pieces and the types of its data:

  ```ts
  /**
   * One choice of the numbered list a select or multiselect prints when it asks line by line.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
   * @public
   */
  interface NumberedChoice {
    /** Marks the row as a choice. */
    readonly kind: 'choice';
    /**
     * The number the operator types to choose it, counted from 1 in the list's order, or
     * `undefined` for a disabled choice, which takes none.
     */
    readonly number: number | undefined;
    /** The text the row shows. */
    readonly label: string;
    /** The choice's description, which the row shows after its label, or `undefined` when it has none. */
    readonly description: string | undefined;
    /** A disabled choice's reason, when it has one. */
    readonly reason: string | undefined;
  }

  /**
   * One piece a question prints when it asks line by line, on a terminal that does not redraw in
   * place. The question prints each piece once and never draws it again: a text, secret, or confirm
   * question's asking row; a select's or multiselect's message, numbered list, and the row it asks
   * on; and the issue that refused an answer, before the question asks again.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
   * @public
   */
  type QuestionLine =
    | {
        /** The asking row of a text, secret, or confirm question, which the operator's answer follows. */
        readonly kind: 'text' | 'secret' | 'confirm';
        /** The question's message. */
        readonly message: string;
        /**
         * What Enter alone answers, which the row shows in brackets: a text question's prefill, or a
         * confirm question's legend, `Y/n`, `y/N`, or `y/n`. `undefined` when there is none, and
         * always for a secret.
         */
        readonly hint: string | undefined;
      }
    | {
        /** A select's or multiselect's message, on a row of its own above its list. */
        readonly kind: 'title';
        /** The question's message. */
        readonly message: string;
      }
    | {
        /** A select's or multiselect's numbered list, one row for each entry. */
        readonly kind: 'list';
        /** The rows in the list's order, which is empty when a search matched nothing. */
        readonly choices: readonly (NumberedChoice | SeparatorRow)[];
      }
    | {
        /**
         * The row a select or multiselect asks on: `number` after a select's list, `numbers` after a
         * multiselect's, `search` before a search, and `refine` after a search's list.
         */
        readonly kind: 'number' | 'numbers' | 'search' | 'refine';
        /**
         * The numbers Enter alone answers, which the row shows in brackets, such as `1` or `1,3`, or
         * `undefined` when there are none, and always at `search`.
         */
        readonly hint: string | undefined;
      }
    | {
        /** The sentence that refused the last answer, on a row of its own. */
        readonly kind: 'issue';
        /** The sentence. */
        readonly issue: string;
      };

  /**
   * The declared view that draws each piece a question prints when it asks line by line. Its
   * default rendering moves no cursor and erases nothing, and an application restyles it with
   * `override`.
   *
   * @example
   * ```ts
   * import { Command } from '@loomcli/core';
   * import { questionLine } from '@loomcli/prompts/views';
   *
   * export const preview = new Command('preview').action(async (context) => {
   *   await context.out.draw({ hint: 'my-app', kind: 'text', message: 'Project name' }, questionLine);
   * });
   * ```
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
   * @public
   */
  const questionLine = view<QuestionLine>('@loomcli/prompts/question-line', { render });
  ```

  `SeparatorRow` is the existing list frame's separator row. The default rendering is in [Asking line by line](../libs/prompts.md#asking-line-by-line).
- **The plugin.** `@loomcli/plugins/plain` declares the switch's option, as the color and interaction plugins declare theirs:

  ```ts
  const options = {
    plain: {
      control: true,
      description: 'Never redraw: print progress as plain lines and ask questions line by line.',
      plain: true,
      type: 'boolean',
    },
  } satisfies PluginOptions;
  /**
   * The options record `plain()` declares: the global `--plain` option.
   *
   * @public @sealed
   */
  export type PlainOptions = typeof options;

  /**
   * Gives the operator --plain, which turns the run's plain switch on, so nothing redraws: a
   * progress line prints plain lines, a streamed message is written a line at a time, and a
   * question asks line by line. Core turns the switch on for ACCESSIBLE too, with or without the
   * plugin, so the plugin takes no settings.
   *
   * @example
   * ```ts
   * import { Application } from '@loomcli/core';
   * import { plain } from '@loomcli/plugins/plain';
   *
   * export const app = new Application('notes', { plugins: [plain()] });
   * ```
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/plain.md
   *
   * @public
   */
  export function plain(): Plugin<PlainOptions>;
  ```

  It adds no middleware, no Command, no view, and no hook, and claims no slot.
- **Inspection and the manifest.** The Boolean variant of `OptionNode` gains `plain` after `color`, and the manifest's Boolean option entry copies it in the same place:

  ```ts
  /** Whether the option carries the plain mark, whose spellings turn the run's plain switch on. */
  readonly plain: boolean;
  ```

  Help lists `--plain` with its description among the global options, completion offers it, and the MCP plugin leaves it out of every tool's input schema, as it leaves out every control option.

The contract is in [The plain switch](../core/output.md#the-plain-switch), [Live region](../core/output.md#live-region), [A streamed message](../core/output.md#a-streamed-message), [Interaction](../core/interaction.md), [Asking line by line](../libs/prompts.md#asking-line-by-line), the [plain plugin](../plugins/plain.md), [Graph inspection](../core/graph-inspection.md), the [manifest plugin](../plugins/manifest.md), [Declaration faults](../core/declaration-faults.md), [Testing](../libs/testing.md#answering-questions), and the [glossary](../glossary.md#compilation-and-invocation).

## Considered options

- **One switch per behavior, such as a plain progress option beside a line-based question option.** Rejected by the owner's ruling. The operator's need is one: a screen that is only appended to.
- **Fold the switch into `-q`, `--no-input`, or `NO_COLOR`.** Rejected by the owner's ruling. Each does another job, and an operator who needs plain output still wants every message, its questions, and its color.
- **A way to turn the switch off, such as `--no-plain`, or `ACCESSIBLE=0` read as off, as `CI=false` is.** Not taken. The owner's ruling reads `ACCESSIBLE` as on when it is set and not empty, which is how huh reads it, and a negative spelling would be a second rule for one variable. Unsetting the variable is the way back.
- **Bind the marked option to a variable or the configuration source, as the interaction mark allows.** Not taken. `ACCESSIBLE` is the environment's word for the switch, and the switch must be known before the first region opens, which a configuration source answers too late for, as ADR-0089 found for color.
- **A question keeps raw mode and echoes what the operator types.** Not taken. Editing a line in raw mode means the question erases the character the operator deletes, which the ruling forbids, while the terminal's own line mode echoes and edits without a byte from the question.
- **An input region that appends each frame rather than one that is not live.** Not taken. Every kind but the editor draws a frame at each key, which appended would print a line for every keystroke, and core would gain a second kind of region.
- **Keep the input region live under the switch, and give the library a separate fact to read.** Not taken. An author's own input region would still redraw, against the ruling that one switch turns off all redrawing, and `live` is already the one fact a library reads to write plain lines.
- **Stop the editor and the pager under the switch.** Not taken. They are child programs the run lends the terminal to, the ruling leaves the editor unchanged, and the operator chose them through `VISUAL`, `EDITOR`, and `PAGER`.

## Consequences

An application that installs no plugin gains the switch through `ACCESSIBLE`, and one that installs `plain()` gains `--plain` too. A question under `TERM=dumb` now asks line by line, so its stderr holds no cursor movement. An input region an author opens is not live under `TERM=dumb` or the switch, so its `live` reads `false` there and its frames draw nothing, which changes a run at run time with no compile error; an author who draws in an input region by hand reads `live` and asks in plain lines, as the library does. The Boolean option shapes gain an optional member, `OptionNode`'s Boolean variant and the manifest's Boolean option entry gain `plain`, a new member of output types, `@loomcli/prompts/views` gains `questionLine`, `QuestionLine`, and `NumberedChoice`, and the plugin pack gains `plain` and `PlainOptions`. Core gains the rule `@loomcli/core/plain-mark` and no failure class.

[ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md)'s look clause, that a question asks on one line in the lane gutter and collapses once answered, and its kinds clause, which reads keys in raw mode, are narrowed for a question asked line by line, which prints the form above and reads in the terminal's line mode except at a secret. ADR-0091's rule that a region is live when stderr is a terminal and it takes input or the run's verbosity is 0 or more is narrowed: an input region is live only where the terminal moves its cursor, and a region without input only where the terminal redraws in place. Its rule that one input region is open at a time holds for a live one, and the library makes questions asked line by line take turns itself. [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md)'s rule that a question's raw-mode reader raises the signal its key stands for holds for a secret asked line by line; at the other kinds the terminal's line mode raises Ctrl-C, Ctrl-\\, and Ctrl-Z itself, with the same effect. ADR-0114's clause that an input region still draws under `TERM=dumb`, so a question there still asks, is narrowed: the question still asks there, line by line, and the input region is not live. ADR-0138's search, which calls a source at each change to the term and draws a key-help line, asks for a term and calls the source once for each term entered when the question asks line by line, and its supplied-value lookups are not made. ADR-0139's frames, which replace one another in the input region, are each printed once. ADR-0163's terminal rule, which applies on a terminal that redraws in place, does not apply with the switch on, so a streamed message follows its off-terminal rule there. ADR-0082, ADR-0091, ADR-0106, ADR-0114, ADR-0138, ADR-0139, and ADR-0163 carry dated entries.

The glossary gains Plain switch, Plain mark, and Line-based question, and its Live region, Input region, and Question entries name the switch.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract (LM-387). It narrows ADR-0082's look and kinds clauses, ADR-0091's live rule, ADR-0106's raw-mode reader for a question asked line by line, ADR-0114's clause that an input region still draws under `TERM=dumb`, ADR-0138's search, ADR-0139's frames, and ADR-0163's terminal rule, each of which carries a dated entry.
