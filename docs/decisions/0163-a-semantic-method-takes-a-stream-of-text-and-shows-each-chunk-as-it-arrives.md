---
type: adr
title: ADR-0163 - A semantic method takes a stream of text and shows each chunk as it arrives
description: Each of the seven semantic methods takes an async iterable of text in place of its string message, so text such as a model's output shows as it arrives. A stream keeps the method's lane, destination, and verbosity, takes no view, and draws through the lane view; when it ends, what was written is what the method writes for the joined text. On a terminal that redraws, each chunk shows as it arrives, a finished row is permanent, and the unfinished row is redrawn as it grows above any live region. Elsewhere, a captured run included, each line is one write once it completes, and the last line is written at the end with the one closing line break. A hidden stream is read to its end, a throw keeps the text and rejects the call, open streams are independent, and core runs no timer. At the process's end and a shutdown's end, the text an open stream has received is written with the rest of the queue. It widens ADR-0148's signature and extends ADR-0090's hidden call, ADR-0110's inert lanes, and ADR-0157's queued writes.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0163 - A semantic method takes a stream of text and shows each chunk as it arrives

## Context

[ADR-0148](0148-a-semantic-method-takes-a-view-for-its-message-and-ends-it-with-one-line-break.md) gives each semantic method the form `(message: string, view?: View<string>)`. The message is whole when the call is made, so an action whose text arrives over time, such as a model's answer streamed from a service, either waits for all of it or writes each piece through a call of its own, which ends every piece with a line break. `out.results` and `out.render` already take an async iterable of rows under [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md), but a row is a unit of a result and carries no message level.

On a terminal, core erases the live regions before every write to stderr, writes it, and draws them again below it, under [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md). The default lane views give a message its glyph, wrap it on a terminal at the columns right of the gutter, and indent continuation rows under [ADR-0086](0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md). A text that arrives in chunks has to keep all three: the regions below it, the gutter on its first row, and the wrap of the rows after it.

The resolved text of a message keeps a style open across a line break: `out.print(style.bold('abc\ndef'))` writes `\u001b[1mabc\ndef\u001b[22m\n`. A stream that wrote those bytes cut at the line break would leave the style on while another write landed between its lines.

The owner settled the shape in grooming (LM-389): every semantic method takes the stream, a plain iterable is refused, a stream takes no view, the joined text decides what is written, a terminal shows each chunk as it arrives, a pipe receives whole lines, a hidden stream is drained, a throw keeps the text and rejects the call, open streams are independent, a captured run follows the pipe's rule, and core runs no timer.

## Decision

- **The two forms.** `print`, `info`, `success`, `warn`, `error`, `debug`, and `trace` each take `(message: string, view?: View<string>)` or `(message: AsyncIterable<string>)`. The arguments are one exported type, so the types refuse a view beside a stream, a plain `Iterable`, and an array of strings:

  ```ts
  /**
   * The arguments a semantic method takes: a message and an optional view over it, which replaces the
   * lane view for that call, or the message as an async iterable of its text, which takes no view and
   * draws through the lane view as each chunk arrives.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/output.md#a-streamed-message
   * @public
   */
  export type MessageArguments =
    | [message: string, view?: View<string> | undefined]
    | [message: AsyncIterable<string>];
  ```

  `Out` declares each method over it, and `print`'s comment, which the other six share, carries the stream form's example:

  ```ts
  export interface Out<Result = unknown> {
    /**
     * A message on stdout at every verbosity, or on stderr from the action of a Command that declares
     * a result. Each semantic method draws its message through its lane view, or through `view` when
     * the call passes one, which replaces the lane view for that call, and ends it with exactly one
     * line break. The message may instead be an async iterable of its text, which takes no view: core
     * shows each chunk through the lane view as it arrives, and the call resolves once the iterable
     * has ended and its text is written.
     *
     * @example
     * ```ts
     * import { Application } from '@loomcli/core';
     *
     * import { answer } from './model.js'; // yields the answer's text as the service sends it
     *
     * const app = new Application('ask')
     *   .argument('question', { required: true })
     *   .action(async ({ args, out, style }) => {
     *     async function* text(): AsyncGenerator<string> {
     *       for await (const chunk of answer(args.question)) {
     *         yield style.escape(chunk);
     *       }
     *     }
     *     await out.print(text());
     *   });
     * ```
     */
    print(...call: MessageArguments): Promise<void>;
    /** An informational message on stderr, hidden under `-q`. */
    info(...call: MessageArguments): Promise<void>;
    /** A success message on stderr, hidden under `-q`. */
    success(...call: MessageArguments): Promise<void>;
    /** A warning on stderr at every verbosity. */
    warn(...call: MessageArguments): Promise<void>;
    /** An error message on stderr at every verbosity, which changes no outcome. */
    error(...call: MessageArguments): Promise<void>;
    /** A debug line on stderr, written from verbosity 1, as an operator's `-v` asks. */
    debug(...call: MessageArguments): Promise<void>;
    /** A trace line on stderr, finer than a debug line, written from verbosity 2, as an operator's `-vv` asks. */
    trace(...call: MessageArguments): Promise<void>;
    // ...the other members, unchanged...
  }
  ```

  `MessageArguments` is an input type, `@public`, under [ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md). The `warn` an `onEnvironment` hook receives is `Pick<Out, 'warn'>`, so it takes both forms too. A value the types reject, such as a chunk that is not a string, gets no rule, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **The governing rule.** A stream keeps the method's lane, its destination, `print` moving to stderr from the action of a Command that declares a result, and its verbosity. When the stream ends, what was written is what the method writes for the joined text, the chunks joined in the order they arrived: its lane view's text and the one closing line break of ADR-0148. Each chunk is marked text, as a message is, so an author escapes raw text chunk by chunk with `style.escape` and keeps each style call inside one chunk.
- **The lane view.** A stream draws through its lane view, the application's override included, and never through a passed view. Core renders the text received so far through it as each chunk arrives and writes what follows the rows it has already written. Every default lane view lays out a longer message as it laid out the start of it, so the governing rule holds for each of them; an override that changes its earlier rows as the message grows writes, row by row, the rows of the moment each was finished, and keeping them consistent is the override's, under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write).
- **On a terminal.** Where the message's destination is a terminal that redraws in place, not under `TERM=dumb` and not under CI, as ADR-0091 and [ADR-0114](0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md) read redrawing, each chunk shows as it arrives, and at every moment the terminal shows what the method would write for the text received so far, at the destination's `columns` read at that chunk:
  - The message shows nothing until its first chunk that holds text.
  - A row is finished once the method's text holds a row after it. A finished row is permanent: core writes it as it writes a finished message, above every unfinished row and every live region, and never draws it again.
  - The last row is the unfinished row. Core redraws it as it grows. It sits above every open live region, as a finished message does, and core erases it with the regions before every other write and draws it again below that write, so a message written meanwhile lands between the stream's finished rows and its unfinished row.
  - A word that outgrows the unfinished row moves to the next row when it does, where the lane view's wrapping places it, and the row it left is finished.
  - A `\r` that ends the text received so far shows once the next chunk, or the stream's end, says whether a `\n` follows it.
  - When the stream ends, the unfinished row is written as a finished row with the one closing line break, so the screen holds what the method writes for the joined text.
  - An open input region holds the regions' frames and not the unfinished row, which goes on growing above the stack. While the terminal is lent, core draws no unfinished row, as it draws no frame: a row the stream finishes is written as it is, as every write through `out` is during a lend, the row drawn before the lend stays on the screen as drawn, and the unfinished row is drawn again above the stack the lend's end draws.
  - A finished row stays as it was written when the terminal is resized, as every finished message does, and the unfinished row is drawn at the width read when it is drawn.
  - An unfinished row is not a live region: it opens no [ADR-0156](0156-onliveregions-tells-a-plugin-when-a-runs-live-regions-first-hold-a-frame-and-when-none-does.md) span, draws at every verbosity at which its message is shown, and builds no progress event.
- **Off a terminal.** Everywhere else, a pipe, a file, a terminal under `TERM=dumb` or CI, and a captured run, core writes each line of the method's text once it completes, as one write that holds the line and its line break, so another write can land between two of the message's lines and never inside one. A line completes at its `\n`, so a CRLF that two chunks split is one line break. The last line is written when the stream ends, with the one closing line break, which a text that already ends with one does not gain. A style open across a line break is closed at the line's end and opened again at the next line's start, so a write that lands between the two lines takes none of it; where no style crosses a line break, the writes, joined, are the bytes the method writes for the joined text.
- **A captured run.** An invocation by name, an MCP tool call, and a run on a `mockProcess` whose streams are its recording streams, as they are by default, follow the off-terminal rule, so `invoke`'s `output` and `messages` hold the joined text's plain text. A `mockProcess` whose `terminal` puts a stream on its terminal is a terminal to core, and a message there follows the terminal rule.
- **The order.** The call takes no place in its destination's order itself. Off a terminal each line takes its place when it completes, and on a terminal each chunk's redraw takes its place when it arrives, as a write issued at that moment does, so a write held behind a row sequence open on stdout waits as any stdout write does. Every write the stream makes follows the regions rule of ADR-0091.
- **A hidden stream.** A stream the run's verbosity hides calls no view and writes nothing. Core reads it to its end and discards its text. The call resolves when the stream ends and rejects when it throws, at every verbosity.
- **A throw.** When the iterable throws partway, the text already received stays: on a terminal the rows shown stay, and off a terminal the line not yet written is written, and the message gets its one closing line break. The call then rejects with the thrown value through the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), as a call whose view throws rejects. Loom writes no marker line.
- **Independent streams.** Each open stream keeps its own text and its own unfinished row. On a terminal their unfinished rows sit together above the regions, in the order each stream first showed a chunk, and a row any of them finishes is written above all of them.
- **No timer.** Core reads the iterable and writes as chunks arrive. It never writes a partial line off a terminal on a timer, and it never limits how long a stream may stay open; an application that needs a timeout sets one in its own iterable.
- **The call and the run.** The call resolves once the stream has ended and every write it made has completed. A run waits for every stream it issued, awaited or not, as it waits for every queued write. A write that fails ends the stream: core calls the iterator's `return` and the call rejects with the write's failure, which follows the destination row of the ordinary failure path.
- **A stop.** When the action fails while a stream it issued is still open, the action's failure stays primary, and when the run's signal aborts, every open stream stops. Either way core calls the iterator's `return`, ends the message as a throw does, its text received so far and its one closing line break written ahead of any failure report, and the call resolves. A stream a middleware or a configuration source issued is read on when the action fails, as a row sequence it issued is.
- **At the process's end.** At the process's `exit` event and at a shutdown's end, `SIGQUIT`'s included, the text an open stream has received and core has not yet written counts as queued under [ADR-0157](0157-core-writes-every-queued-write-at-the-processs-exit-and-a-shutdowns-end.md). Core writes it in the same step as every other queued write, at the place its last chunk took in the order, as the stream's end would write it: the unfinished row or the last line, and the one closing line break. Core reads no further chunk, so text the iterable has not yielded is not written, as a row a source has not yielded is not. A hidden stream has nothing queued.
- **The testing builders.** In a context `@loomcli/testing` builds, an unstated semantic lane reads a stream to its end and writes nothing, and its promise resolves when the stream ends and rejects when it throws, as a hidden call does, so an action's stream runs in its test as it runs at an operator's terminal.

The contract is in [A streamed message](../core/output.md#a-streamed-message), [Output](../core/output.md), [Verbosity](../core/verbosity.md), [Testing](../libs/testing.md), and the [glossary](../glossary.md#output).

## Considered options

- **A plain `Iterable` as well.** Rejected by the owner's ruling. A string is itself an iterable of strings, so the types could not tell a message from its characters, and a synchronous iterable has every chunk at hand, which one joined string already writes.
- **A view with a stream.** Rejected by the owner's ruling. A passed view owns the whole layout under ADR-0148, and a box or a heading draws rows that depend on the whole text, so no row of it could be final before the stream ends.
- **A separate method, such as `out.stream(text, { level })`.** Rejected. It gives every level a second spelling, against [principle 5](../principles.md#5-one-system-per-concept) and ADR-0148's rejection of `out.message`.
- **Write each chunk as it arrives off a terminal.** Rejected by the owner's ruling. Another write could land inside a line, and a log reader would read a line torn in two.
- **Flush a partial line on a timer.** Rejected by the owner's ruling and [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write): core runs no timer, and how long a stream pauses is the application's.
- **The unfinished row as a live region.** Not taken. A region hides under `-q`, CI, and `TERM=dumb`, holds still under an input region, and opens an `onLiveRegions` span, while a stream is a message that shows wherever its level shows.
- **The exact bytes of the joined text, cut at each line break.** Not taken. The resolved text keeps a style open across a line break, so another write landing between two lines would take the style on, which the owner's ruling that a write lands between lines and never inside one rules out.
- **Overloads, or one generic signature whose view parameter is conditional on the message.** Not taken. Each relates a test's stated lane, `out: { print }` with `vi.fn(async (_message: string) => {})` as the [testing reference](../libs/testing.md) shows it, to a signature its string parameter cannot satisfy, so every test written that way would stop compiling. The union of two argument tuples keeps that stated lane assignable, because a method parameter is compared both ways.
- **A marker line when the stream throws.** Rejected by the owner's ruling. The failure report already says what went wrong, and a marker would put Loom's voice inside the author's text.
- **Drop an open stream's unwritten text at the process's end.** Not taken. The terminal already shows the unfinished row, so a log of the same run would hold less than the screen did, and ADR-0157 writes everything the author handed core.

## Consequences

`Out`'s seven methods take `MessageArguments`, a new `@public` export of `@loomcli/core`, and its API report changes for each method. A call that compiled before compiles and writes the same bytes. A test that states a lane with an annotated string parameter, as the testing reference shows, still compiles, and so does one that writes `(...call: MessageArguments)`. A stated lane whose parameter list is typed from the context alone, such as `warn: async (message) => {}`, no longer compiles, because the context is a union of two argument lists; it writes its parameter types out. `@loomcli/testing`'s unstated lanes read a stream to its end.

A message's call order on its destination no longer holds for a stream: its lines take their places as they complete, so a message issued after a stream can land before the stream's later lines, which is the ruling's point. A failure report follows the text an action's open stream received, because the stop ends the message first.

ADR-0148's signature, a string message with an optional view, gains the stream form, and its line-break rule applies to the joined text. [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md)'s hidden call, which calls no view and resolves, is extended: a hidden stream is read to its end, and its call resolves at that end or rejects at a throw. [ADR-0110](0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md)'s unstated lanes, which resolve and do nothing, read a stream to its end first. ADR-0157's queued writes gain the text an open stream has received and not written. ADR-0090, ADR-0110, ADR-0148, and ADR-0157 carry dated entries. ADR-0008's split holds, because a stream is a message's text, not a value, and ADR-0091 and ADR-0156 are unchanged: an unfinished row lands above the regions as every other write does and is not a region.

The glossary gains Streamed message and Unfinished row, and its Semantic output entry names the stream form.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract for streamed messages (LM-389). It widens ADR-0148's signature and extends ADR-0090's hidden call, ADR-0110's unstated lanes, and ADR-0157's queued writes, each of which carries a dated entry.
