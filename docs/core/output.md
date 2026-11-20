---
description: "The out methods an action writes through: the semantic lanes and the text they stream as it arrives, rendered and drawn views, a view's text without a write, live regions, lending the terminal to a child program, progress events, and the queued writes core writes when the process ends."
---

# Output

This page states the `out` methods an action writes through: the semantic lanes and the text they stream as it arrives, rendered and drawn views, a view's text without a write, live regions, lending the terminal to a child program, progress events, and what core writes when the process ends. An author uses it to decide what an action prints and where it goes.

| Method                       | Default destination | Return          |
| ---------------------------- | ------------------- | --------------- |
| `out.print(message, view?)`         | stdout              | `Promise<void>` |
| `out.info(message, view?)`          | stderr              | `Promise<void>` |
| `out.success(message, view?)`       | stderr              | `Promise<void>` |
| `out.warn(message, view?)`          | stderr              | `Promise<void>` |
| `out.error(message, view?)`         | stderr              | `Promise<void>` |
| `out.render(data, view)`     | stdout              | `Promise<void>` |
| `out.draw(data, view)`       | stderr              | `Promise<number>` |
| `out.region(options?)`       | stderr              | `Region`        |
| `out.lendTerminal(work)`     | None; holds the live regions while `work` runs | `Promise<Value>` |
| `out.text(data, view)`       | None; returns the text | `string`     |
| `out.results(value)`         | stdout              | `Promise<void>` |
| `out.fatal(message)`         | Failure path        | `never`         |

The `results` row holds on a Command that declares a result, where the action's `print` and `render` move to stderr as [Results](results.md) describes; on every other Command `results` takes a `never` argument and the other rows hold as written. Messages are marked strings. The five semantic methods render through core's lane views, described under [Views](views.md), or through a view the call passes, under [A message's own view](#a-messages-own-view), and end the message with one line break. Each also takes an async iterable of the message's text in place of the string, which shows as it arrives, under [A streamed message](#a-streamed-message). `print` has no prefix. By default the other methods add their matching glyph and one space, and indent continuation lines by the measured gutter, without repeating the glyph; that gutter belongs to the lane view, which an application can override. Those four lanes also wrap the message at the destination's `columns`, as [Width, padding, and multiline lanes](styles.md#width-padding-and-multiline-lanes) states. The run's [verbosity](verbosity.md) decides whether `info` and `success` write, and `print`, `warn`, and `error` write at every verbosity. `out` tells the operator, and `log` records: detail an operator reads only when they ask for it goes through [`log`](logging.md), whose events core shows as log lines at `-v` and `-vv`, under [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md). Semantic method identity remains distinct inside core. `out.render` is the neutral render call, and [Rendered output](#rendered-output) describes it. `out.text` returns the text `out.render` would write and writes nothing, under [A view's text without a write](#a-views-text-without-a-write).

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. What a caught rejection means for the run is under [the ordinary failure path](failures.md#the-ordinary-failure-path): a caught view rejection leaves the outcome to the code that caught it, and a failed destination write still fails the run.

Writes preserve call order within a destination, except a [streamed message](#a-streamed-message)'s, whose lines take their places as they complete. On a terminal, a write issued while a streamed `print` line is unfinished waits for the line's end. Separate stdout and stderr captures have no shared observable order. While a [live region](#live-region) is drawn and stdout is a terminal too, stdout writes share stderr's order, so a result row lands above the region. A row sequence open on stdout holds its place in stdout's order alone: a stdout write issued behind it waits for its last row, and a stderr write issued meanwhile, one its row source awaits included, does not. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns its class's code: 1, unless a subclass declares another under [Declared exit codes](failures.md#declared-exit-codes). A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

A closed reader on stdout ends the run with 141, and any other failed write returns 1, under [the ordinary failure path](failures.md#the-ordinary-failure-path).

## Rendered output

```ts sketch
interface View<Data> {
  render: (data: Readonly<Data>, context: ViewContext) => string;
  row?: undefined; // a view has one shape; the row view of Results is the other
  mediaType?: string; // the media type of the text it writes, under Media types
}
```

A view is a pure synchronous value that turns one typed value into marked text. Its `render` function, the view function, receives the data and an immutable context with `style`, `width(text)`, `plain(text)`, `columns`, `wrap(text, columns)`, `expandTabs(text)`, `localize(phrase)`, which renders a [phrase](localization.md#phrases) in the run's language, and the run's [`background`](background.md), which a failure view's context extends with where the run was and the plugins' hints, under [Failure view context](failure-views.md#failure-view-context). It holds no output handle. Core reads the destination's width just before it calls the view function, so `columns` is the width at that render. Existing one-argument view functions remain valid. Escape raw data with `style.escape()` before interpolating it into authored text. `out.render` is the neutral render call: a rendered value has no purpose and no destination parameter.

Newline ownership belongs to the write site, not to the view type. `out.render`, [`out.results`](results.md#emitting-a-result), and a failure diagnostic append nothing, so a view rendered through any of them owns its trailing newline. A semantic method ends its message with exactly one line break, appending one after the view's text unless that text already ends with one, so a lane view returns none and a pack view, which ends each line it writes, gains nothing; a pack view over an empty text renders the empty string, so the method writes one line break for it, except the rule, which draws a bare line. Each write site below states which rule it follows.

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

A rendered value has no semantic identity: no purpose parameter and no destination parameter. The five semantic methods take a string message, with an optional view over it under [A message's own view](#a-messages-own-view), or a stream of the message's text under [A streamed message](#a-streamed-message), and keep their own destinations.

Core calls a whole view's function synchronously inside the `out.render` call, then queues its text on the destination; a row view's functions run as the iterable yields, under [Row views](results.md#row-views). Call order within a destination holds across both forms, so a rendered table and a plain `print` write in the order the action issued them. The optional-await contract is unchanged: the returned promise resolves on write completion and rejects on a view or write failure, and what a caught rejection means for the run is under [the ordinary failure path](failures.md#the-ordinary-failure-path).

The type parameter is inferred from the value, so `out.render(rows, table)` checks the view against the rows it receives. A view for another value type, and one that returns anything but a string, are compile errors.

### A message's own view

```ts sketch
interface Out<Result = unknown> {
  print(message: string, view?: View<string>): Promise<void>;
  info(message: string, view?: View<string>): Promise<void>;
  success(message: string, view?: View<string>): Promise<void>;
  warn(message: string, view?: View<string>): Promise<void>;
  error(message: string, view?: View<string>): Promise<void>;
  // Each method also takes a streamed message, under A streamed message.
}
```

```ts
import { Application, lanes } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { step } from '@loomcli/plugins/step';
import { verbose } from '@loomcli/plugins/verbose';

const app = new Application('create', { plugins: [verbose()] })
  .argument('name', { required: true })
  .action(async ({ args, out, style }) => {
    await out.info(`Creating ${style.escape(args.name)}`, step()); // hidden under -q
    await out.info('The template cache is stale.', lanes.warn); // a warning's look, hidden under -q
    await out.success(`Created ${style.escape(args.name)}`);
    await out.info(`cd ${style.escape(args.name)}\npnpm dev`, box({ title: 'Next steps' }));
  });
```

On a terminal, `create my-app` prints this on stderr:

```text
❯ Creating my-app
⚠ The template cache is stale.
✔ Created my-app
╭─ Next steps ─╮
│ cd my-app    │
│ pnpm dev     │
╰──────────────╯
```

A semantic method is a message's level: its destination and the [verbosity](verbosity.md) it writes at. Its view is the message's look. A call that passes a view keeps the level and changes the look, so a line can carry an error's look and still be hidden by `-q`, or a step can be written at `info`'s level without `info`'s glyph. [ADR-0148](../decisions/0148-a-semantic-method-takes-a-view-for-its-message-and-ends-it-with-one-line-break.md) records the decision.

- **The level stays.** The method writes to its own destination, and `print` moves to stderr from the action of a Command that declares a [result](results.md) as it does without a view. The run's verbosity decides whether the call writes, as it does without a view, and a call it hides calls no view, the passed one included.
- **The view owns the layout.** The passed view replaces the method's lane view for that call alone. The method adds no glyph, gutter, wrapping, or indent of its own, so the view's text is the message's whole look. Without a view, the method renders through its lane view, as this page states for it.
- **Any view over a string.** The view is a bare view, a declared view, or a pack view, such as the pack's [step](../plugins/pack-views.md#step) or a [box](../plugins/pack-views.md#box) with a title, which is the note look. A declared view, a lane view included, resolves through the application's and the plugins' overrides as it does under `out.render`, so `out.info(text, lanes.warn)` draws an application's warning look. A bare view renders as it is, and nothing can replace it. The types reject a row view and a view over data that is not a string, and core adds no rule for one, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): from JavaScript, it fails the call as a view that breaks does.
- **One line break.** The method ends the message with exactly one line break. It appends `\n` after the view's text unless that text already ends with a line break. The test reads the text as core writes it, its control sequences set aside, as a [live region](#live-region) reads its last frame, so `style.dim('done\n')` and `nowrap('done\n')` each end with one, and so does a text that ends in CRLF. The rule holds whichever view drew the message, a lane view included, so `out.print('done\n')` writes `done` and one line break; a message that should leave a blank line after it ends with two. A view that returns the empty string writes one line break, so `out.info('', step())` writes an empty line.
- **Context.** The view receives the message and the view context of the method's destination, as a lane view does, with that destination's `columns`, capabilities, and glyph forms.

### A streamed message

```ts sketch
type MessageArguments =
  | [message: string, view?: View<string> | undefined] // a message and an optional view over it
  | [message: AsyncIterable<string>]; // the message's text as it arrives, which takes no view
interface Out<Result = unknown> {
  print(message: string, view?: View<string>): Promise<void>;
  print(...call: MessageArguments): Promise<void>;
  // info, success, warn, and error declare the same two signatures.
}
```

```ts
import { Application } from '@loomcli/core';

export const ask = (
  answer: (question: string, options: { signal: AbortSignal }) => AsyncIterable<string>,
) => new Application('ask')
  .argument('question', { required: true })
  .action(async ({ args, out, signal, style }) => {
    async function* text(): AsyncGenerator<string> {
      for await (const chunk of answer(args.question, { signal })) {
        yield style.escape(chunk); // raw text, escaped chunk by chunk
      }
    }
    await out.info(text());
  });
```

On a 44-column terminal, partway through the answer, stderr shows the rows so far, and the last one grows as the service sends more:

```text
ℹ Loom is a toolkit for command-line
  applications. It parses, rou
```

When the iterable ends, stderr holds what `out.info` writes for the whole answer:

```text
ℹ Loom is a toolkit for command-line
  applications. It parses, routes, and
  renders.
```

Each semantic method takes an async iterable of the message's text in place of the string, a [streamed message](../glossary.md#output), so text that arrives over time, such as a model's answer, shows as it arrives. [ADR-0163](../decisions/0163-a-semantic-method-takes-a-stream-of-text-and-shows-each-chunk-as-it-arrives.md) records the decision.

- **The two forms.** A method takes `(message: string, view?)`, under [A message's own view](#a-messages-own-view), or `(message: AsyncIterable<string>)`. It declares the string form first and then a signature over `MessageArguments`, exported from `@loomcli/core`, the union of the two argument lists. A generic answer passed straight to a method, such as `out.print(await text(context, settings))`, is read as a string, and a wrapper forwards `(...call: MessageArguments)` whole. The types reject a view beside a streamed message, a plain `Iterable`, and an array of strings. A message typed as either form is neither, so the caller narrows it and makes the call that fits. The `warn` an [`onEnvironment`](plugin-contract.md#environment-preparation) hook receives takes both forms. A chunk that is not a string gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): a Node `Readable` iterates as `any` and yields `Buffer` chunks until its encoding is set, so call `setEncoding('utf8')` before passing one.
- **The joined text decides.** A streamed message keeps the method's level: its destination, `print` moving to stderr from the action of a Command that declares a [result](results.md), and its [verbosity](verbosity.md). When the iterable ends, what was written is what the method writes for the joined text, the chunks joined in the order they arrived: its lane view's text and the [one line break](#a-messages-own-view). An empty iterable writes what the method writes for the empty string. Each chunk is marked text, as a message is, so escape raw text chunk by chunk with `style.escape`, and keep each style call inside one chunk.
- **The lane view.** A streamed message draws through its lane view, the application's override included, and takes no view of its own. Core renders the text received so far through the lane view as each chunk arrives, and writes what follows what it has already written. The view context is read once, at the message's first layout, so the whole message lays out at the `columns` read then. Before the end, the text laid out leaves out a trailing run of spaces, tabs, and carriage returns, which shows once text follows it or the iterable ends, because a space that overflows a row would push the word before it down and the next word would pull it back. A `\r` held that way shows once the next chunk says whether a `\n` follows it. The text laid out also leaves out a high surrogate that ends the text so far, the first half of a character such as an emoji, until the chunk with its second half arrives or the iterable ends, because half a character written alone reaches a terminal as a replacement character. It also leaves out an escape sequence that the text so far ends without finishing, and everything after the sequence's start: a lone ESC, a CSI without its final byte, or an OSC, DCS, SOS, PM, or APC string without its terminator. Core reads the text for it as resolution does, decoded from its frame markup, so markup between a sequence's bytes, as two chunks that each wrap part of it in a style call leave it, does not part them: the sequence is held back only while those bytes leave it unfinished. Part of a sequence written alone leaves a terminal reading the text after it as the sequence's own, so that text never shows. The sequence shows once the chunk that finishes it arrives, and at the iterable's end the message writes what the method writes for the joined text. With that run held back, each default lane view lays out a longer text's finished rows as it laid out the start of it, so the joined text's rule holds for it. An override that changes its earlier rows as the text grows writes the rows of the moment each was finished, which is the override's to keep consistent. For a lane view core ships, each chunk lays out the text after the last line the message has finished, behind one row that sets up what the finished lines leave open: the style, pad, and no-wrap frames open at that line's end, the raw SGR attributes set inside each, and the hyperlink open there. Each finished line is laid out once more to count its rows, and no finished line is laid out again, whatever raw sequences, control characters, frames, or rejected headers it holds. Where the rendering policy keeps terminal controls, the row carries every raw SGR command with a parameter Loom does not track, because resolution writes each one as it is, so a message that sets such a command on every line lays out text that grows with its square. A line break inside a frame header, a terminal control string, or a carried hyperlink is no place to split, so the message splits at a later line break, and until then each chunk lays out everything after the last line the message had finished. A frame header or a control string that never ends keeps the message from splitting for the rest of its text: a header an unescaped U+E000 opens, and an OSC, DCS, SOS, PM, or APC string, or one a C1 control from U+0090, U+0098, U+009D, U+009E, or U+009F opens, with no terminator after it. The message also stops splitting for the rest of its text once a finished line holds a style that names a token the application's palette lacks, which line breaking and resolution read as text and the row split reads as a frame. In either case each chunk from then on lays out everything after the last line the message had finished before that, so the cost of laying out that text grows with its square. A lane view the application overrode gets the whole text received so far at every chunk. The bytes written are the same in every case.
- **On a terminal.** Where the destination is a terminal that [redraws in place](#live-region), each chunk shows as it arrives, and at every moment the terminal shows what the method would write for the text received so far. Nothing shows until the text holds more than a trailing blank run. No streamed message erases or redraws text at a position core computed from grapheme widths across a row the terminal wrapped.
- **`print` only appends.** A streamed `print` writes what each chunk adds at the cursor, its unfinished line, and never erases or redraws any of it. On every lane, terminal controls after the text's last line break with no text after them, such as a title or a bell that the rendering policy keeps, take no row, so the message writes them at its end, with the line break the method adds after them for the joined text. The `print` lane never wraps, so a paragraph is one line longer than the screen, and the terminal wraps it as it wraps a whole `print`: a resize between two chunks, and a grapheme such as a VS16 emoji or a ZWJ sequence that the terminal draws at another width than core counts, leave the screen as a whole `print` of the same text leaves it. Each line is resolved on its own, so a style or a hyperlink kept open across a line break closes at the line's end and opens again at the next line's start, and within a line the control sequences after its last character wait for the next chunk's text or the line's end.
- **The line holds the terminal.** While a streamed `print`'s line is unfinished on the terminal, every other write to that terminal waits for the line to end: a message on either stream when both are on that terminal, a render, an `out.draw`, a [lend](#lending-the-terminal)'s start, and a live region's first frame and every frame after it are written at the next line break of the streamed text, or when the message ends or stops. It is the rule a pipe already has: another write lands between two lines and never inside one. The writes held behind the line keep the order they were issued in, stdout's and stderr's alike. Where stdout is a terminal and stderr is not, the line holds stdout alone. Two streamed `print` messages take the terminal in turn, a line at a time. A failure or a cancellation ends the message first, under **A stop** below, so a failure report is never held. A streamed `print` a middleware or a configuration source issued is read on when the action fails, so its unfinished line holds a failure report until the line ends or a cancellation ends the message. An iterable that awaits another write to the same terminal while its `print` line is unfinished waits on itself, as a row sequence's source that writes to its own destination does, until a stop ends it, so yield the line break before awaiting such a write, or issue the write without awaiting it, and it lands after the line.
- **Whole lines beside a redrawn screen.** While a live region is open, while another streamed message keeps an unfinished row, or while a row sequence holds the order of either stream on the terminal, a streamed `print` writes a whole line at a time, as off a terminal. It returns to chunk by chunk at the next chunk once none of those holds, and a line it has started at the cursor goes on growing there until it ends.
- **The lanes that wrap.** `info`, `success`, `warn`, and `error` lay out their rows through the lane view at the columns the first layout read, and core redraws the last one. A row is finished once the method's text holds a row after it, and a finished row is permanent: core writes it as it writes a finished message and never draws it again. Each row stands alone, so a style or a hyperlink the text keeps open across a line break closes at the row's end and opens again at the next row's start, and a write between the two takes none of it. The last row, the unfinished row, grows in place, and core redraws it as it grows. A word that outgrows the unfinished row moves to the next row when it does, where the lane view's wrapping places it, and the row it left is finished. When the iterable ends, the unfinished row is finished with the one closing line break, so the screen holds what the method writes for the joined text.
- **Above the regions.** The unfinished row sits above every open [live region](#live-region), as a finished message does. Core erases it with the regions before every other write and draws it again below that write, so a message written meanwhile lands between the message's finished rows and its unfinished row. While an unfinished row is shown and stdout and stderr are on the terminal, stdout writes share stderr's order, as they do while a region is drawn, apart from a row sequence open on stdout. An open input region holds the regions' frames and not the unfinished row, which goes on growing above the stack. While the terminal is lent, core draws no unfinished row, as it draws no frame: the row drawn before the lend stays on the screen as drawn, a row the message finishes is written as it is, as every write through `out` is during a lend, and the unfinished row is drawn again above the stack the lend's end draws. A suspend erases the unfinished row with the regions, and the resume draws it again. A resize leaves a finished row as it was written, and the message keeps the width its first layout read.
- **A row wider than the screen.** A word longer than the row, or a terminal that narrowed after the message's first layout, makes an unfinished row wider than the screen, and core never draws or erases such a row. One that would be wider than the screen at the terminal's real width, read at that chunk, is not drawn, and the row drawn before it leaves the screen. When a write would have to erase one that has become wider than the screen, core leaves every unfinished row on the screen as the terminal shows it, erases only the regions below them, and moves the cursor below them when nothing is. Either way the message then writes each later row once it is finished, as off a terminal, the row left on the screen included, so the text that row showed shows again below it.
- **The live-region hook.** An unfinished row and an unfinished `print` line are not regions: each shows at every verbosity at which its message is shown and builds no progress event. Each counts for [`onLiveRegions`](lifecycle-hooks.md#observing-live-regions) as a region's frame does, so the span opens at the write that puts the run's first frame, unfinished row, or unfinished line on the screen and closes at the write after which none is left. With the [patch-console plugin](../plugins/patch-console.md) installed, a console write made during a streamed message is routed through `out`: it lands above an unfinished row, and beside a streamed `print` it waits for the line's end.
- **Off a terminal.** On a pipe or a file, on a terminal under `TERM=dumb` or CI or with the [plain switch](#the-plain-switch) on, and in a [captured run](../glossary.md#output), core writes each line of the method's text once it completes, as one write that holds the line and its line break, so another write can land between two of the message's lines and never inside one. A line completes at its `\n`, so a CRLF that two chunks split is one line break. The last line is written when the iterable ends, with the one closing line break, which a text that already ends with one does not gain. The writes, joined, are the bytes the method writes for the joined text, so a style the text keeps open across a line break stays open from one write to the next.
- **A captured run.** An [invocation by name](invocation.md#invocation-by-name), an [MCP](../plugins/mcp.md) tool call, and a run on a [mock process](../libs/testing.md#mockprocess) whose streams are its recording streams, as they are by default, follow the off-terminal rule, so `invoke`'s `output` and `messages` hold the joined text's plain text. A mock whose `terminal` puts a stream on its terminal is a terminal to core.
- **The order.** The call takes no place in its destination's order. Off a terminal each line takes its place when it completes, and on a terminal each chunk's write takes its place when it arrives, as a write issued at that moment does, so a stdout line waits behind a row sequence open on stdout as any stdout write does. Core reads the next chunk once the writes of the last one have completed.
- **Independent streamed messages.** Each open streamed message keeps its own text and its own unfinished row or line. On a terminal their unfinished rows sit together above the regions, in the order each first showed, and a row any of them finishes is written above all of them.
- **Hidden.** A streamed message the run's verbosity hides calls no view and writes nothing. Core reads it to its end and discards its text, and the call resolves when the iterable ends and rejects when it throws, at every verbosity.
- **The call.** The call resolves once the iterable has ended and every write it made has completed, and a run waits for every streamed message it issued, awaited or not. Core runs no timer: it never writes a partial line on a timer and never limits how long an iterable stays open, so an application that needs a timeout sets one in its own iterable.
- **A throw.** When the iterable throws partway, the text already received stays: on a terminal the rows shown stay, and off a terminal the line not yet written is written. The message gets its one closing line break, and the call rejects with the thrown value, under [When author code fails](#when-author-code-fails). Core writes no marker line.
- **A stop.** A write that fails ends the message, and the call rejects with the write's failure, under [the ordinary failure path](failures.md#the-ordinary-failure-path). When the action fails while a streamed message it issued is still open, the action's failure stays primary, and when the run's signal aborts, every open streamed message stops, and one issued after the abort stops at once. Either way core ends the message at that moment as a throw does, ahead of any failure report, calls the iterator's `return`, and the call resolves once that end is written. Core waits neither for `return` to settle nor for a chunk it already asked for, and a chunk that arrives after the stop is discarded. A streamed message a middleware or a configuration source issued is read on when the action fails.
- **At the process's end.** The text an open streamed message has received and core has not yet written is queued, so the process's `exit` event and a shutdown's end write it with the rest of the queue, at the place its last write took, as the iterable's end would, with the one closing line break, under [At the process's end](#at-the-processs-end).

### Drawing on stderr

`out.draw(data, view)` renders a view to stderr for a frame an operator watches, which the caller erases and redraws itself. It takes the arguments `out.render` takes, a bare view or a declared view and its data, and it renders the same way: the view function, the application's override when one applies, runs synchronously inside the call, its marked text resolves under stderr's rendering policy, the result is queued on stderr in call order with every other `out` write to stderr, and no newline is added. Three things differ. The promise resolves, on write completion, to the number of terminal rows the drawn text moved down: its line breaks, plus the extra rows each line wraps onto at `host.terminal.stderr.columns`, the real width read at that draw and never the `COLUMNS`-narrowed one, because the terminal soft-wraps at its real width, measured as [`width`](styles.md#width-padding-and-multiline-lanes) measures, and its line breaks alone when the width is unknown; control sequences count no width. A caller that redraws what it drew, whatever view rendered it, returns the cursor to column 0, moves up exactly the rows it drew, and erases to the end of the screen. The destination is always stderr, on a Command that declares a result as on any other. And when `host.terminal.stderr.isTTY` is true and the terminal [redraws in place](#live-region), terminal control sequences the text holds, such as cursor movement and erasure, are kept for that call alone, as `terminalControls: 'preserve'` keeps them for the whole application; every other write site, and a draw to a stderr that is not a terminal or does not redraw, keeps the Application's setting, so a redirected stderr or an invocation by name's `messages` never receives a cursor movement core would otherwise strip. The types reject a row view, and core adds no rule for one: from JavaScript, it fails the call as a view that breaks does. The caller decides when to draw.

On a terminal, `out.draw` is a region of one frame that core writes as it writes every other write to stderr: above every open [live region](#live-region), with no line break added, never held by an open input region, and at every verbosity. With no region open it writes exactly as before. Its count is still measured at the width read at its own draw, so a caller that erases by it keeps working, and its call order, its control sequences, and its bytes off a terminal are unchanged. A [question](../libs/prompts.md) opens an input region and does not draw through `out.draw`.

### A view's text without a write

```ts sketch
interface Out<Result = unknown> {
  text<Data>(data: Data, view: View<Data>): string; // new: the text out.render would write, unwritten
}
```

```ts
import { Application } from '@loomcli/core';
import type { View } from '@loomcli/core';

const listing: View<readonly string[]> = {
  render: (items, { style }) => items.map((item) => `${style.escape(item)}\n`).join(''),
};
const summary: View<readonly string[]> = {
  render: (items) => `${String(items.length)} items. Pipe the output to list them.\n`,
};

const app = new Application('inventory')
  .argument('items', { required: true, variadic: true })
  .action(({ args, host, out }) => {
    // The bytes out.render(args.items, listing) would write now, styled and laid out for stdout.
    const text = out.text(args.items, listing);
    const lines = text.split('\n').length - 1;
    const rows = host.terminal.stdout.rows;
    return out.render(args.items, rows !== undefined && lines >= rows ? summary : listing);
  });
```

`out.text(data, view)` returns the text `out.render(data, view)` would write at that moment and writes nothing. A caller that needs the bytes before it decides where they go, such as [help paging](../plugins/help.md#help-paging) handing a long page to the operator's pager, reads them here, while core keeps sole ownership of how a view resolves. [ADR-0115](../decisions/0115-help-pages-a-long-page-through-the-operators-pager-on-opt-in.md) records the decision.

- **The same resolution.** It takes the arguments `out.draw` takes, a bare view or a declared view and its data. The view function, the application's override when one applies, runs synchronously inside the call with a fresh view context for `out.render`'s destination, whose `columns` is read just before the call. The marked text resolves under that destination's rendering policy, with its color, depth, modifiers, hyperlinks, glyph forms, and terminal controls, as `out.render` resolves it. The destination is `out.render`'s: stdout, and stderr from the action of a Command that declares a [result](results.md), so a middleware's `out.text` always resolves for stdout.
- **Nothing is written.** The call queues nothing on either stream, adds no newline, and holds no place in call order, so the run's completion waits on no write from it. Whatever the caller does with the text, writing it included, is the caller's.
- **A view that throws.** The call throws the value the view function threw, synchronously. It is a view's failure, as one under `out.render` is: when it escapes the action or the middleware it fails the run through [the ordinary failure path](failures.md#the-ordinary-failure-path), and a catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md).
- **Whole views alone.** The types reject a row view, because a sequence resolves as its source yields and a string cannot wait for it, and core adds no rule for one: from JavaScript, it fails the call as a view that breaks does, as under `out.draw`.
- **Every `out`.** Every `out` core builds carries it: an action's, a middleware's, and a configuration source's. Under an [invocation by name](invocation.md), the text is the plain text its destination's capture would hold, `output` for stdout and `messages` for stderr.

## Live region

```ts sketch
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
  end(state?: 'ended' | 'failed' | 'skipped' | 'warned', label?: string): Promise<void>;
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

const waiting: View<number> = {
  render: (tick, { style }) => `${style.highlight('.'.repeat((tick % 3) + 1).padEnd(3))} Waiting for the build`,
};
const built: View<string> = {
  render: (id, { style }) => `${style.success(glyph.success)} Build ${style.escape(id)} is ready.`,
};

export const ship = (waitForBuild: () => Promise<string>) => new Application('ship').action(async ({ out }) => {
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

- **Stacked in open order.** Every open region sits at the bottom of stderr, below everything else the run wrote, in the order the regions opened, the oldest on top. `draw` replaces its region's frame in place, and the regions below it move with its height. A region that has not drawn, or whose frame is empty, takes no rows. Core starts each frame on a row of its own, separating it from the frame above with one line break when that frame, its control sequences set aside, does not end with one, and leaves the cursor at the end of the bottom frame. When the write before the stack ends partway along a row, the stack starts on the next row.
- **Every other write lands above.** While a region is drawn, core erases the regions before every other write to stderr, writes it, and redraws them below it. That covers the semantic lanes, the log lines core shows at [`-v`](logging.md#at--v) included, `print` and `render` on a result Command, `out.draw`, a failure report and its hints, the [incomplete-result](results.md#a-sequence-that-stops-early) line, and what an [`onLog`](lifecycle-hooks.md#observing-log-events) hook writes to its destination's `stderr` under `run()`. When stdout is a terminal too, a write to stdout, a result included, does the same, so stdout and stderr share one order while a region is drawn, apart from a row sequence open on stdout, which holds stdout's order alone. A [streamed message](#a-streamed-message)'s unfinished row sits above the regions, and core erases and redraws it with them, and a streamed `print` writes whole lines while a region is open. A write that does not pass through core, such as `console.log` or `process.stderr.write`, lands where the cursor is, because core cannot see it. The opt-in [patch-console plugin](../plugins/patch-console.md) moves `console.log`, `info`, `debug`, `warn`, and `error` onto `out` while a region is drawn, or a streamed message's unfinished row or line is on the screen, so they land above it. While the terminal is lent, writes land as [Lending the terminal](#lending-the-terminal) states.
- **A frame.** `draw(data, view)` renders as `out.draw` does: a bare view or a declared view, with the application's override when one applies, called synchronously inside the call with stderr's view context and its live `columns`, its marked text resolved under stderr's rendering policy, its control sequences kept for the call at a terminal, and no newline added. The types reject a row view, and core adds no rule for one: from JavaScript, it fails the call as a view that breaks does. Core keeps the frame's text, and the promise resolves once the frame is written. The region's frame is the latest one drawn.
- **Live.** `live` is `true` when core draws the region: `host.terminal.stderr.isTTY` is true, and either the region takes input and the terminal moves its cursor, or the run's [verbosity](verbosity.md) is 0 or more and the terminal [redraws](#live-region) in place, under Redrawing below. When it is `false`, `draw` calls no view, writes nothing, and resolves at once, or, for an input region still waiting for its turn, under Input regions below, once the region opens or closes, so a pipe, a log file, and an [invocation by name](invocation.md#invocation-by-name)'s `messages` never hold a frame. A library reads `live` to write plain lines instead, as a progress line does. It does not change while the region is open.
- **Closing.** `end()` closes the region. Its last frame moves into scrollback, ending with a line break core adds when the frame lacks one, and the regions below close the gap, so a region whose last frame is empty leaves nothing. `end('failed')`, `end('skipped')`, and `end('warned')` close it the same way, `closedBy` reading `'end'`, and the end [progress event](#progress-events) the close builds reads `failed`, `skipped`, or `warned`; the events before it stay as they were. The state reaches only the event, so a [progress line](../libs/prompts.md#progress) that is skipped or warned draws its own last frame, and a region an author opens by hand may end skipped or warned as well. `end(state, label)` puts `label` on that end event in place of the last reported label, such as `end('ended', 'Fetched 3 records.')`; it builds no extra event, and an `end` with no label keeps the last reported label. The label reaches only the event and draws nothing: the terminal keeps the last frame drawn, so a caller that wants the terminal to show the same end text draws it as the last frame, as a progress line does. Once the region has closed, `draw` and `report` do nothing, and `draw` and `end` resolve at once, so a timer tick that races the close is harmless.
- **The signal.** `signal` aborts whenever the region closes, whatever closes it, so a library that animates a frame on its own timer stops the timer there. Core sets `closedBy` before it aborts the signal: `'end'` for `end()`, `'completion'` when what opened the region finishes with it still open, `'failure'` when the run is about to report a failure, and `'cancellation'` when the run's signal aborts. The abort listeners run synchronously, and a frame a listener draws during the abort is the region's last frame, so a library draws its finished, failed, or cancelled line there. Then core closes the region. When a signal ends the process, core writes every write still in its queue, the cancelled lines drawn at the abort included, straight to the terminal at the [shutdown](signals.md#the-shutdown)'s end, and shows the cursor, under [At the process's end](#at-the-processs-end). A suspend erases the open regions and a resume redraws them, under [Raw-mode readers](signals.md#raw-mode-readers), except while the terminal is [lent](#lending-the-terminal).
- **Core closes what is left open.** When the action returns, core closes every region the action opened that is still open with `'completion'`, and when it throws, with `'failure'`, before the action's [provided values](providers.md#closing) close. A region a middleware or a configuration source opens stays open through the action, so a middleware can show a line around the whole run, and core closes it with `'completion'` once the chain has unwound, after the first middleware returns, when it is still open; the same holds when a middleware takes over or the chain settles without dispatching the action. Before core renders any failure report, from the action, a middleware, a source, or a fault reported after the outcome, it closes every open region with `'failure'`, so each region's last frame is written above the report and the report is the last thing on stderr. While the terminal is [lent](#lending-the-terminal), the report and the [incomplete-result](results.md#a-sequence-that-stops-early) line wait until every lend has settled. When the run's signal aborts, core closes every region, open or waiting to open, with `'cancellation'` at once, and a cancellation writes no report. A region opened after the run's signal has aborted closes with `'cancellation'` as it opens.
- **Input regions.** `out.region({ input: true })` opens a region that reads the operator's keys, as a question does. It is live only on a terminal that moves its cursor, under Redrawing below, and a question whose region is not live asks [line by line](../libs/prompts.md#asking-line-by-line). While a live input region is open, core draws no frame of any other region: their timers keep running, and core keeps each region's latest frame, a closed region's last frame included. When the input region closes, core moves each last frame that closed meanwhile into scrollback, in the order the regions closed, and draws every open region's latest frame once. Other writes still land above the stack, which shows the other regions as they were when the input region opened. One input region is open at a time on a terminal stderr, live or not, so a question [asked line by line](../libs/prompts.md#asking-line-by-line) and an author's own input region take turns as live ones do. A second opens when the first closes, and until then its draws wait, each promise resolving once the region opens and, when it is live, its frame is written; one that is not live writes nothing when it opens. A waiting region that closes before it opens leaves nothing, and its draws resolve then. Off a terminal, where no question asks, an input region is never live and opens at once, so nothing waits for a turn there.
- **Redrawing.** A terminal destination, stderr or stdout, moves its cursor unless the run's [plain switch](#the-plain-switch) is on or `TERM` is `dumb`, a terminal that cannot move its cursor, such as Emacs `M-x shell`. It redraws in place when it moves its cursor and the run is not under CI, which holds unless `CI` is set, nonempty, and not `false`, where the terminal feeds a build log. This is how ci-info, which npm uses, reads `CI`: CI systems set `CI=true`, and `CI=false` is an operator saying the run is not CI. A run under CI is not [interactive](interaction.md) either, and [ADR-0114](../decisions/0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md) records both rules. On a terminal stderr that does not redraw, core draws no region opened without `input: true`, and its `live` reads `false`, so a progress line writes plain lines, and on a terminal destination that does not redraw a [streamed message](#a-streamed-message) follows its off-terminal rule. On a terminal stderr that does not move its cursor, under the plain switch or `TERM=dumb`, core draws no input region either, and its `live` reads `false`, so a question there asks [line by line](../libs/prompts.md#asking-line-by-line), under [ADR-0169](../decisions/0169-one-plain-switch-turns-off-all-redrawing-so-progress-prints-plain-lines-and-a-question-asks-line-by-line.md). Under CI an input region still draws, though no question asks there. On every terminal that does not redraw, `out.draw` still writes but keeps the Application's `terminalControls` setting, as a draw to a stderr that is not a terminal does, so a cursor movement its text holds is dropped unless the Application preserves controls. Unless the Application preserves controls, nothing there hides the cursor, so a shutdown and a suspend that restore the terminal write no show-cursor sequence. Color detection does not follow this rule: `TERM=dumb` turns automatic color off on its own, as [styles](styles.md) states, and under CI automatic color follows the CI system rule there.
- **Quiet.** At verbosity -1, which `-q` sets under the [verbose plugin](../plugins/verbose.md), core draws no region opened without `input: true`, and its `live` reads `false`. An input region draws at every verbosity where the terminal moves its cursor, so a question still asks, and it asks line by line where the terminal does not. Only `out.region` follows the verbosity: `out.draw` draws at every verbosity, because its caller decides when to draw.
- **Resize.** Before it erases the stack, core recounts each region's last frame at stderr's current width, counting rows as `out.draw` counts them, so a frame that a reflowing resize rewrapped is erased whole. A stack taller than the terminal cannot be erased above its top row, so a view keeps its frame within stderr's `rows`, as the [select question](../libs/prompts.md#the-kinds) does, and as a [progress line's log](../libs/prompts.md#a-lines-log) does, whose open lines share the terminal's height.
- **No timer in core.** Core never limits work by time, except the [shutdown budget](signals.md#the-shutdown), which bounds how long cancelled runs may unwind after an ending signal. An application that needs a timeout sets one in its own action. A timer that animates a frame is plain JavaScript that the author or the library drawing the frame runs, and it stops the timer when `signal` aborts. Core runs no timer for a region and redraws only when a frame or another write asks it to.
- **Observed by plugins.** A plugin's [`onLiveRegions`](lifecycle-hooks.md#observing-live-regions) hook is called when the run's first region draws a frame and when the last frame leaves the stack, in stderr's write order, wherever each region was opened.
- **Reports.** `report({ completed?, total?, label? })` builds a typed [progress event](#progress-events) for whoever observes the run, and draws nothing. A region reports whether or not it is live.
- **Names.** `Region`, `RegionOptions`, `RegionCloser`, and `ProgressReport` are exported from `@loomcli/core`, and `Out` carries `region` and [`lendTerminal`](#lending-the-terminal).

A region call whose value the types reject, such as an `input` that is not a Boolean or an `end` state other than `'ended'`, `'failed'`, `'skipped'`, or `'warned'`, gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A `completed` or `total` that is negative or not finite, which the type allows, is carried into the progress event as it is.

### The plain switch

```ts
import { Application } from '@loomcli/core';

const app = new Application('notes')
  .globalOption('plain', {
    type: 'boolean',
    plain: true,
    control: true,
    description: 'Never redraw: print progress as plain lines and ask questions line by line.',
  })
  .action(({ options }) => {
    // notes --plain and ACCESSIBLE=1 notes both run with the switch on.
    // options.plain reads true after --plain alone: it says what the operator typed.
  });
```

The run's plain switch turns off every redraw, so the screen is only ever appended to. It serves an operator whose screen reader or terminal copes badly with redrawing, and one who keeps a readable record of a run. [ADR-0169](../decisions/0169-one-plain-switch-turns-off-all-redrawing-so-progress-prints-plain-lines-and-a-question-asks-line-by-line.md) records the decision, and the [plain plugin](../plugins/plain.md) declares `--plain`.

- **When it is on.** The switch is on when a word of `host.argv` before the first bare `--` equals a spelling of the option that carries the plain mark, or when `ACCESSIBLE` in `host.env` is set and not empty. Otherwise it is off. Core reads `ACCESSIBLE` itself, as it reads `TERM` and `CI` for redrawing, in every application, with or without the plugin and with or without a marked option, so an operator who sets it once is served by every Loom application. `ACCESSIBLE=0` and `ACCESSIBLE=false` are set, so they turn the switch on, as Charm's huh reads the variable.
- **Nothing turns it off.** The marked option takes its positive spelling alone, so no spelling turns the switch off, and an operator whose shell exports `ACCESSIBLE` unsets it, or runs with it empty, `ACCESSIBLE= notes`, for a run that redraws.
- **What it turns off.** With the switch on, a terminal destination neither moves its cursor nor redraws in place, exactly as under `TERM=dumb`, under [Redrawing](#live-region): no region is live, an input region included, so a [progress line](../libs/prompts.md#progress) prints its plain start line and, unless it is cleared, its end line, with the kept log lines of a line that fails, warns, or is cancelled above its end line (a cancelled line writes them alone), under [A line's log](../libs/prompts.md#a-lines-log), and its updates print nothing, a [streamed message](#a-streamed-message) is written a line at a time, on stdout and on stderr, and a [question](../libs/prompts.md#asking-line-by-line) asks line by line. `out.draw` keeps the Application's `terminalControls` setting, and a shutdown and a suspend write no show-cursor sequence unless the Application preserves controls.
- **What it leaves alone.** Every message prints at its level, the [verbosity](verbosity.md) decides which lanes write, color, modifiers, hyperlinks, and glyph forms follow their own rules, `NO_COLOR`, `FORCE_COLOR`, and `--color` included, and the [interaction decision](interaction.md) decides whether a question asks. The switch reads none of `-q`, `--no-input`, and `NO_COLOR`, and none of them reads it. A child program the run [lends the terminal](#lending-the-terminal) to, such as an editor question's editor or help's pager, draws on the terminal as it chooses.
- **The mark.** `plain: true` on a Boolean global option, the application's or a plugin's, marks it. Core reads the mark's spellings as it reads the [color choice](color.md): right after host capture and before graph build, from `host.argv` alone, so every byte the run writes after capture follows the switch. The spellings are the option's long spelling and each alias's long spelling. A word that attaches a value, such as `--plain=yes`, equals none of them, turns nothing on, and the ordinary parse reports it later as `Boolean option "--plain" does not accept a value. Supply the flag alone.`
- **The option still parses.** The marked option is an ordinary Boolean global option to routing, parsing, validation, and activation, so `options.plain` reads `true` after a spelling and `false` otherwise. It says what the operator typed, never whether the switch is on. A repeated `--plain --plain` is the repetition error, `Option "--plain" can be supplied only once. Remove the repeated option.`, exit 2, and that line prints with the switch on.
- **One source.** The marked option takes its positive polarity alone, no short alias, and no variable, and carries no configuration binding, because argv is its one source and `ACCESSIBLE` is the environment's word for the switch. The types reject `polarity: 'negative'` and `'both'`, `short`, `shortOnly`, and `env` beside `plain: true`, and `plain` on `option()` and on every option type but `boolean`. A configuration binding on the marked option is a declaration error, thrown where the [color mark](color.md)'s is, under the rule [`@loomcli/core/plain-mark`](diagnostics.md#loomclicoreplain-mark).
- **One mark.** An Application declares one marked option. The fault throws from the call that brings the second mark into the Application, as a [spelling collision](options.md#declaration-and-invocation-errors) does, under the rule [`@loomcli/core/plain-mark`](diagnostics.md#loomclicoreplain-mark).
- **What the graph says.** `inspect()` publishes `plain` on each Boolean option node, `true` on the marked one, and the [manifest](../plugins/manifest.md) copies it. Help lists the option among the global options, and the [MCP](../plugins/mcp.md) plugin leaves a control option out of every tool's input schema.
- **Invocations by name.** `app.invoke`, an action's `invoke`, and so every MCP tool call read no spelling, because their `host.argv` is `[]`, and they have no terminal, so the switch changes nothing they write.

### Lending the terminal

```ts sketch
interface Out {
  // ...
  lendTerminal<Value>(work: () => Value | PromiseLike<Value>): Promise<Value>;
}
```

```ts
import { Command, FatalError } from '@loomcli/core';
import { progress } from '@loomcli/prompts';

export const commit = new Command('commit').action(async (context) => {
  const staging = progress(context, { label: 'Staging changes' });
  // ...
  const exit = await context.out.lendTerminal(
    () => context.host.spawn('git', ['commit'], { signal: context.signal, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }).exited,
  );
  if (exit.kind !== 'exited' || exit.code !== 0) {
    throw new FatalError('git could not commit. Run "git commit" to see why.');
  }
  await staging.end('Committed');
});
```

A child program that draws on the terminal, such as `$EDITOR` or `git commit` without `-m`, shares it with the run's live regions, whose frames would draw over the child's screen. `out.lendTerminal(work)` lends the terminal to the child for as long as `work` runs. The [editor question](../libs/prompts.md#the-editor-question) starts its editor inside one, and an action starts any interactive child the same way. [ADR-0139](../decisions/0139-an-editor-question-opens-the-operators-editor-on-a-private-temporary-file-and-core-lends-it-the-terminal.md) records the decision.

- **When it starts.** The lend takes its place in stderr's write order. Once every write queued before the call has reached the terminal, core ends the row its last write left the cursor on with a line break, unless that write ended a row, so whatever the child writes starts on a row of its own, and then calls `work`. A frame drawn just before the call so shows while the child runs.
- **While it lasts.** Core draws no region's frame, as an open input region holds the others, and keeps each latest frame, a closing region's last frame included. The stack drawn before the lend is no longer core's to erase: it stays on the screen as drawn and goes into scrollback as the child writes below it. So a child that leaves the screen alone, such as a graphical editor the operator works in elsewhere, leaves the frame drawn before the lend in view, and a full-screen child draws on the terminal's alternate screen and restores the screen that holds the frame when it exits.
- **A suspend.** While the terminal is lent, core's suspend and resume handlers write nothing. The stack ended at the lend's start, so a suspend has nothing to erase, and a resume redraws nothing, because a child that draws on the terminal draws its own screen when it continues, and a frame core drew then would land on that screen. Core cannot tell a graphical editor from a terminal editor: each is a child on the run's inherited terminal, and whether it draws there is the child's own. So after `fg` while a graphical editor is open, the shell's job-control lines stand below the frame drawn before the lend, and no frame shows below them until `work` settles.
- **When it ends.** Once `work` settles, core writes one line break (`\n`) and draws a fresh stack at the start of the row it opens. Core does not erase or overwrite anything the child wrote, so every row the child wrote stays intact, including one it left with a carriage return or partway along. The cost is one blank row after a child that leaves the cursor at the start of an empty row, such as an editor that restores the alternate screen. The frame drawn before the lend stays above, in scrollback, and so does every row the child wrote, such as a shell's `nano: 1: exec: nano: not found`, emacsclient's `Waiting for Emacs...`, a terminal editor's lines on the main screen, or keys the cooked terminal echoed. Core then moves into scrollback each last frame that closed while held, during the lend or before it while an open input region held it, in the order the regions closed, draws every open region's latest frame below them, and resolves with what `work` resolved, or rejects with what it rejected with, unchanged.
- **A failure during the lend.** When the run is about to report a failure while the terminal is lent, core closes every open region with `'failure'` at once, as it always does, and holds the failure report and the [incomplete-result](results.md#a-sequence-that-stops-early) line until every lend has settled. They then follow the stack the lend's end draws, so the report stays the last thing on stderr. A `work` that runs on holds the report until it settles: the [editor question](../libs/prompts.md#lending-the-terminal-to-the-editor) ends its editor when its region closes, and an author's `work` that should end with the failure ends on its own signal. Core adds no time limit.
- **What it leaves alone.** The lend changes no terminal mode and moves no stream: the caller leaves raw mode and shows the cursor before the child starts, if it set them, and starts the child with `stdin: 'inherit'`. Apart from a failure report and the incomplete-result line, a write through `out` while the terminal is lent is not held: core writes it as it is, without erasing or redrawing the stack, so it lands where the child's cursor is, as a write beside any interactive child does. A shutdown's end writes what it always writes, lent or not, the frames core held included.
- **Nesting.** A lend inside a lend changes nothing more: core ends the row when the outermost lend starts, and draws the stack when the outermost lend's `work` settles.
- **Nothing live.** When no region is drawn as the lend starts, the lend writes no line break at its start and calls `work`. A region that opens or first draws during the lend is held as every other one is: core draws none of its frames over the child, and a suspend or a resume writes nothing for it. When the lend ends with a frame held, core writes the line break and the stack, as above, because the child may have left the cursor partway along a row. When it ends with no frame held, such as when stderr is not a terminal or under an [invocation by name](invocation.md#invocation-by-name), where no region is live, the lend returns `work`'s result and writes nothing.
- **Author code.** `work` is the caller's: one that throws or rejects ends the lend and rejects the call, which takes the [ordinary failure path](failures.md#the-ordinary-failure-path). Core adds no time limit.

### Progress events

```ts sketch
interface ProgressEvent {
  readonly id: number;
  readonly label: string;
  readonly state: 'started' | 'updated' | 'ended' | 'failed' | 'cancelled' | 'skipped' | 'warned';
  readonly completed?: number;
  readonly total?: number;
}
```

A progress event is the typed value a region's report builds, so a program that runs a Command reads its progress without reading a frame. An [invocation by name](invocation.md#invocation-by-name) delivers each event to its observer, and the [MCP](../plugins/mcp.md) plugin sends each one to a client as `notifications/progress`.

- **From reports.** A region's first report builds a `started` event, and each later report an `updated` event. When a region that reported closes, core builds its end event: `ended` after `end()` and after `'completion'`, `failed` after `end('failed')` and after `'failure'`, `skipped` after `end('skipped')`, `warned` after `end('warned')`, and `cancelled` after `'cancellation'`. So a reader tells a skipped and a warned end from a success, and a [progress line](../libs/prompts.md#progress) the author cleared reads `ended`, because `clear()` ends its region with `end()`. A region that never reported builds none, so a question builds no event. [ADR-0170](../decisions/0170-a-progress-line-may-end-skipped-or-warned-or-be-cleared-and-a-regions-end-event-reads-skipped-and-warned.md) records the skipped and warned states.
- **The fields.** `id` numbers the run's reporting regions from 1, in the order each first reported. `label`, `completed`, and `total` hold the latest value any report of the region gave, so an update that carries `completed` alone keeps the label. An end event built by `end(state, label)` carries that label instead, and its counts as reported. `label` reads `''` until a report gives one, and an absent `completed` or `total` was never reported. `label` is the plain text of the reported label: core removes its style markup, as the view context's `plain` does, so an observer and an MCP client never read a style delimiter. Each event is frozen.
- **Delivery.** Core delivers each event synchronously, inside the `report` call or the close that built it, in the order they were built. Under `run()` nothing observes them.
- **Not logging.** A progress event reaches no [`onLog`](lifecycle-hooks.md#observing-log-events) hook, and no log event is a progress event, under [ADR-0069](../decisions/0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md).
- **Names.** `ProgressEvent` is exported from `@loomcli/core`.

## At the process's end

```ts
import { Application } from '@loomcli/core';

// loadSchema calls process.exit(1) when the schema file is missing.
export const ship = (loadSchema: (file: string) => void) => new Application('ship').action(({ out }) => {
  void out.info('Reading schema.sql');
  loadSchema('schema.sql');
});
```

```text
$ ship; echo "status $?"
ℹ Reading schema.sql
status 1
```

A write through `out` is queued: the call returns before its bytes reach the stream, and core writes it once every write queued before it has been written, on a later turn of the microtask queue at the earliest. A run that ends normally waits for every write it queued. When the process ends first, core writes each live run's queued writes synchronously at that end, in the order they were queued, so the `out.info` line above prints although `loadSchema` ends the process inside the action. [ADR-0157](../decisions/0157-core-writes-every-queued-write-at-the-processs-exit-and-a-shutdowns-end.md) records the decision.

- **What is queued.** A write is queued from its call until core hands its bytes to the stream. Apart from a log event's writes below, that covers every write core makes to the run's stdout or stderr: the semantic methods, `out.render`, `out.draw`, `out.results` and each row a row view has rendered, each frame a [live region](#live-region) draws, the failure report and its hints, a failure encoder's text, the console text the [patch-console plugin](../plugins/patch-console.md) routes through `out`, and the text an open [streamed message](#a-streamed-message) has received and core has not yet written, which takes the place its last write took and is written as the iterable's end would write it, its unfinished row or last line and the one closing line break. Each write keeps the stream it was queued for. Nothing else is queued: a row its source has not yielded, a chunk a streamed message's iterable has not yielded, a line core holds and has not queued yet, such as the [incomplete-result](results.md#a-sequence-that-stops-early) line a stopped sequence owes and a failure report held until a [lend](#lending-the-terminal) settles, the text `out.text` returns, and a call the run's [verbosity](verbosity.md) hides.
- **A log event's writes.** A [log line](logging.md#at--v), and what an [`onLog`](lifecycle-hooks.md#observing-log-events) hook writes to its destination's `stderr` under `run()` when that `stderr` is the run's, a terminal or not, take their place in the run's stderr order, but core queues one only when something waits ahead of it: a write queued on the run's stderr, a write whose turn has begun with bytes left to hand to a stream, or a sequence or streamed line that holds stderr's order, or the same on stdout when stdout shares stderr's terminal. With nothing ahead, core hands its bytes to the stream in the call, as its turn would, so a record the [logging plugin](../plugins/logging.md) writes to the console survives a `process.abort()`, a `SIGKILL`, or a crash that follows the log call. A queued one is written at an end with the rest of the queue, and an abort, which emits no `exit` event, loses it with the writes ahead of it. Once an end has written a run's queue, a log line or a hook's write goes straight to the stream, after any write queued since, so what an `onShutdown` handler logs, and the `A shutdown handler failed.` event, reach stderr before the process exits or the signal is re-raised. On a terminal that write lands below the last frame, without redrawing the regions. [ADR-0190](../decisions/0190-a-log-events-writes-to-the-runs-stderr-keep-call-order-and-reach-the-stream-at-once-when-nothing-waits-ahead.md) records the decision.
- **At the process's exit event.** When the process emits its `exit` event while a run is live, at a `process.exit()` that an action, a middleware, a hook, or a dependency calls, at an uncaught exception, or at the process's normal end, core writes that run's queued writes. Core listens for the event while a `run()` is live, under [Listening](signals.md#listening). It writes them before it calls the [`onLiveRegions`](lifecycle-hooks.md#observing-live-regions) hooks with `'closed'` and before the [`onShutdown`](signals.md#onshutdown) handlers, so `out.error(message)` followed by `process.exit(1)` prints the message, with a frame drawn or without one.
- **At a shutdown's end.** When a [shutdown](signals.md#the-shutdown) ends, because every run has resolved, the budget has run out, or a second signal arrived, and at `SIGQUIT`'s immediate end, core writes each live run's queued writes in the same step and the same order, before the `'closed'` calls and the handlers, and before it re-raises the signal. The cancelled lines drawn at the abort and every write the unwind queued before the end are among them.
- **A run that ends normally.** Nothing changes. `run()` resolves once every write it queued has been written, so a run that resolved has nothing queued, and an end that comes after it, such as `process.exit(await app.run())`, writes nothing for it.
- **The order.** Core writes one run's queued writes in the order they were queued: on each stream in that stream's order, and across both streams in the one order they share while a region is drawn and stdout is a terminal too. A region's frames take their places in that order, so the last frame is written where its draw was queued among the messages. Each write is written as its turn would have written it: on a terminal stderr that holds regions, a message erases the stack, writes its text, and draws the stack again below it, a frame replaces its region's frame, and a write while the terminal is lent is written as it is. A write held behind a row sequence open on stdout follows the rows that sequence had queued. Two streams that do not share one order keep no order between them, as under [Output](#output). After the queued writes, on a terminal stderr, core ends every lend still open and shows the cursor, as it does at every end.
- **No hook while it writes.** The step calls no [`onLiveRegions`](lifecycle-hooks.md#observing-live-regions) hook between its writes. A frame among the queued writes that would open a span, such as a region's first frame queued just before the end, calls no `'drawn'` and opens none, and a span already open stays open until the step's last bytes, after which core calls `'closed'` once.
- **Once, and synchronously.** Core hands each write's bytes to its stream within the end's own step and awaits nothing. It writes one run's queued writes once: the exit event after a shutdown's end writes nothing more for that run. A write queued after that step, such as one an `onLiveRegions` hook issues at its `'closed'` call, is not written then, unless a later log line or `onLog` hook write writes it first, under A log event's writes, and takes its turn only if the process goes on, as it can when an embedding host keeps the process alive past a shutdown. A write the end wrote sends nothing when its turn comes, and its promise resolves then, so no byte is written twice.
- **Nothing queued.** A run with nothing queued at an end writes what it wrote at that end before this rule: on a terminal stderr, the end of an open lend and the show-cursor sequence under [Redrawing](#live-region), and nothing on any other stream.
- **What is not promised.** The write at an end is best effort. A write a stream refuses, because it has failed, has closed, or its terminal has hung up, is dropped, and the end goes on; a stream the run already recorded as failed receives nothing. Bytes core has handed to a stream are the runtime's to deliver, as an asynchronous pipe may still hold some when the process ends. On Node that holds for the process's own console as well: a `console.log` larger than a pipe's buffer, followed at once by `process.exit()`, is cut short on a stdout pipe whether the [patch-console plugin](../plugins/patch-console.md) routed it or not. On Bun it does not: with stdout a pipe, a write still queued at `process.exit()` that is larger than the pipe's buffer is cut short, where Bun's own console writes the pipe in full, so a long text the plugin routes there can print less than it prints without the plugin. Core orders its writes among writes through `out` alone, so a write that bypasses core, such as `process.stderr.write` or the runtime's own report of an uncaught exception, keeps no promised order against them. An `onLog` hook's write to any other `stderr`, a pipe or a log file included, goes straight to that stream as the hook makes it, as a write that bypasses core does, so an end writes nothing of it and it keeps no order against the queued writes. An end that is neither an `exit` event nor a shutdown's end writes nothing: `kill -9`, `process.abort()`, and a crash of the runtime. A [mock process](../libs/testing.md#mockprocess) never calls its `exit` listeners, so on a mock only a shutdown's end writes the queue. A run that [`invoke`](invocation.md#invocation-by-name) starts captures its output, so nothing an end writes for it reaches a stream, and no caller reads that output once the process has ended.

## When author code fails

A view that throws, a lane view, a view a semantic call passed, or a region's frame view included, makes the `out.render`, `out.draw`, `region.draw`, or semantic-method call reject with the view's error, and the `out.text` call throw it, under [A view's text without a write](#a-views-text-without-a-write). A rejection the action or a middleware lets propagate takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and a rejection the code caught is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A call no code awaited has no catcher, so core reports its rejection through the ordinary failure path after the chain has settled, as the output-view row of the [ordinary failure path](failures.md#the-ordinary-failure-path) states. A row view's pieces written before the fault stand, under [Results](results.md#row-views). An iterable a [streamed message](#a-streamed-message) reads that throws makes the call reject with what it threw, by the same path, and the text received before the throw stands, ended with the message's one line break.
