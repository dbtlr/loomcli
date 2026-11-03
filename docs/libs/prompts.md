---
description: The @loomcli/prompts reference. The four question kinds an action asks, text, secret, confirm, and select, how a question links a local option or an argument, how the run's interaction decision resolves it, the keys the reader reads and how a typed line is edited, what each kind draws and accepts, and how a question leaves the terminal, and the progress lines an action shows around its work, their style plugin, their view, and their plain lines off a terminal.
---

# Prompts reference

`@loomcli/prompts` is a library an action imports to ask an operator a question at a terminal and to show [progress](#progress) around its work. Questions and progress lines need no plugin: an application installs nothing to use them, and the library registers no option. The one plugin it ships, `progressStyle()`, is optional and sets how progress lines look across the application. [ADR-0082](../decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) records the questions, [ADR-0136](../decisions/0136-a-multiple-string-option-or-a-string-argument-may-be-required-only-when-input-is-not-interactive-and-a-question-may-link-an-argument.md) a question's link to an argument, and [ADR-0091](../decisions/0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) the regions both draw in and the progress lines. Core supplies what a question reads, the run's [interaction decision](../core/interaction.md), the [`supplied`](../core/interaction.md) record, [`out.region`](../core/output.md#live-region), and `cancel()`, and the library owns the key reader, the frames, and the progress timer.

```ts
import { Application, Command } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { confirm, secret, select, text } from '@loomcli/prompts';
import { oneOf, port } from '@loomcli/validators';

const setup = new Command('setup')
  .option('backend', { type: 'string', validate: oneOf(['sqlite', 'postgres']), required: 'non-interactive' })
  .option('database-url', { type: 'string' })
  .option('port', { type: 'string', validate: port(), required: 'non-interactive' })
  .action(async (context) => {
    await context.out.info('Mimir keeps its work state in a database.');
    const backend = await select(context, {
      message: 'Storage backend',
      choices: ['sqlite', 'postgres'],
      option: 'backend',
      skipIfSupplied: true,
    });
    const url = backend === 'postgres'
      ? await secret(context, { message: 'Postgres connection URL', option: 'database-url', skipIfSupplied: true })
      : undefined;
    const listen = await text(context, { message: 'Service port', option: 'port', default: '4317', validate: port() });
    const install = await confirm(context, { message: 'Install the background service?', default: true });
    // ...
  });

export const app = new Application('mimir', { plugins: [interaction()] }).command(setup);
```

At a terminal this run reads, once every question is answered:

```text
$ mimir setup
ℹ Mimir keeps its work state in a database.
? Storage backend · postgres
? Postgres connection URL
? Service port · 8080
? Install the background service? · yes
✔ Mimir is set up.
```

With `--no-input`, `--backend` and `--port` are required before the action runs, `--database-url` is required when the action reaches its question, and the unlinked confirm fails with `InteractionUnavailableError`.

## Calling a question

Each kind is a function of the action context and one settings object, and returns a promise of the answer.

```ts
type LinkKey<Inputs> = keyof Inputs & string;
type Answer<Inputs, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Inputs[Key & keyof Inputs];

function text<
  Options,
  const Key extends LinkKey<Options> = never,
  Output = string,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: ActionContext<Args, Options, unknown>,
  settings: TextSettings<Key, Output, Argument>, // validate?: StandardSchemaV1<string, Output>
): Promise<Answer<Args, Argument, Answer<Options, Key, Output>>>;
function secret<
  Options,
  const Key extends LinkKey<Options> = never,
  Output = string,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: ActionContext<Args, Options, unknown>,
  settings: SecretSettings<Key, Output, Argument>,
): Promise<Answer<Args, Argument, Answer<Options, Key, Output>>>;
function confirm<Options, const Key extends LinkKey<Options> = never>(
  context: ActionContext<unknown, Options, unknown>,
  settings: ConfirmSettings<Key>,
): Promise<Answer<Options, Key, boolean>>;
function select<
  Options,
  const Choice extends string,
  const Key extends LinkKey<Options> = never,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: ActionContext<Args, Options, unknown>,
  settings: SelectSettings<Key, Choice, Argument>, // choices: readonly Choice[]; default?: NoInfer<Choice>
): Promise<Answer<Args, Argument, Answer<Options, Key, Choice>>>;
```

The type tests prove the generic plumbing against the action context's real parameters; the results above are what it must produce. `Args` and `Argument` follow every type parameter a kind already had, so a call that passes type arguments explicitly keeps compiling.

| Setting          | Kinds                  | Meaning                                                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `message`        | All                    | The question's title, a marked string of one line.                                          |
| `option`         | All                    | The key of the local option the question links.                                             |
| `argument`       | Text, secret, select   | The name of the routed Command's argument the question links.                               |
| `skipIfSupplied` | All                    | `true` skips the question at a terminal when the linked input was supplied. Needs `option` or `argument`. |
| `default`        | Text, confirm, select  | The question's own default: a string for text, a Boolean for confirm, a choice for select.  |
| `validate`       | Text, secret           | A Standard Schema value that checks a typed answer and may transform it.                    |
| `choices`        | Select                 | A nonempty list of strings.                                                                 |

Question validation receives the captured Loom run context through the Standard Schema options channel, with `phase: 'question'`. A question linked to an option identifies its local option, a question linked to an argument identifies its argument with `kind: 'argument'`, and an unlinked question identifies its title with `kind: 'question'`. The host, route, passthrough tail, and supplied values come from the same run, with separate copies for each validator call. Shipped validators such as `path()` and `dateTime()` use the host's working directory and time zone. A skipped question never calls its question validator.

Secret declares no `default`, and its types reject one.

The return type is the question's own output: the validator's output for text and secret, or `string` without one, `boolean` for confirm, and the choice union for select. A linked question can also return the linked input's validated value, so `Answer` adds the option's or the argument's action value, `undefined` included, because a validator may return `undefined` for a supplied value. The union collapses when the two agree, as `port()` on both the option and the question does.

## Linking an input

A question links at most one input of the routed Command: `option` names a local option, and `argument` names an argument. The types admit the keys of the action's `options` for `option` and of its `args` for `argument`, and they reject `option` and `argument` together, `argument` on confirm, and `skipIfSupplied` without either. A linked argument works as a linked option does throughout [Resolving a question](#resolving-a-question): its raw supplied value prefills the question, and its validated value answers a skipped one.

```ts
const clone = new Command('clone')
  .argument('url', { required: 'non-interactive', validate: url() })
  .action(async (context) => {
    const source = await text(context, { message: 'Repository URL', argument: 'url', skipIfSupplied: true });
    // ...
  });
```

`app clone https://example.com/repo.git` skips the question, `app clone` at a terminal asks it, and `app clone --no-input` fails before the action with `Argument "url" requires a value when input is not interactive. Supply a value for "url".`

At the call, the library checks the declaration through `context.command` and throws a `DeclarationError` under the rule [`@loomcli/prompts/link`](../core/diagnostics.md#loomclipromptslink) for each of these, which a run reports with exit 1:

- **A declared input.** The linked key is a local option the routed Command declares, or the linked name is an argument it declares: `The question "Repository URL" links argument "url", which Command "clone" does not declare.`, corrected by `Link an argument of the routed Command.` An undeclared option keeps its sentence, `... links option "port", which Command "setup" does not declare.`, corrected by `Link a local option of the routed Command.`
- **A local option.** The linked option is not a global option.
- **One string value.** A text, secret, or select question links a string option or a string argument that takes one value, never a multiple, content, or counted option and never a variadic or content argument. The sentence names the input, `The question "Tags" links option "tag", which is not a string option that takes one value.` or `The question "Files" links argument "files", which is not a string argument that takes one value.`, and both read the correction `Link a string option or argument that takes one value.`
- **A Boolean.** A confirm question links a Boolean option and no other.
- **Choices.** A select question has at least one choice, which a computed `choices` list may lack before the question resolves.

The rule's explanation reads `A question asks in one line of prose and links at most one local option or argument of the routed Command, of the kind the question accepts, and a select question offers at least one choice.` The types reject the other malformed settings, such as `skipIfSupplied` without a link, `option` beside `argument`, a `default` that is not one of `choices`, a `default` on secret, and a `validate` that is not a Standard Schema value, so they get no rule. The root Command reads as `the root Command`.

## Resolving a question

A question first reads the run's interaction decision, `context.interactive`, and the linked input's raw value: `context.supplied.options[option]` for an option and `context.supplied.args[argument]` for an argument, each `undefined` when the input was omitted or left to its declared default.

| Linked input             | Interaction on, `skipIfSupplied` | Interaction on, without it | Interaction off             |
| ------------------------ | -------------------------------- | -------------------------- | --------------------------- |
| Supplied                 | Skipped                          | Asked, prefilled           | Skipped                     |
| Not supplied             | Asked                            | Asked                      | Missing-input error, exit 2 |
| No link                  | Asked                            | Asked                      | `InteractionUnavailableError`, exit 1 |

- **Skipped.** The question draws nothing and returns the linked input's validated value, `context.options[option]` or `context.args[argument]`. The question's own validator does not run.
- **Asked.** The prefill is the first that applies: the raw supplied value, the question's `default`, the linked input's declared default, or none. A Boolean option's implicit absent value is never a default. A select whose prefill matches no choice starts on the first choice. Secret takes no prefill: asked, it starts empty even when its input was supplied, and only `skipIfSupplied` or interaction off answers it from the input. An accepted prefill is a submitted answer and passes through `validate` as a typed one does.
- **Missing input.** The question throws core's ordinary `InputError` for its input, which [`missingInputError`](../core/interaction.md) builds: `missingInputError(context, option)` for an option, `Option "--database-url" is required when input is not interactive. Supply a value.`, named by declared name under an invocation by name, and `missingInputError(context, { argument })` for an argument, `Argument "url" requires a value when input is not interactive. Supply a value for "url".` For argv, a confirm's Boolean option reads `Supply "--install" or "--no-install".` in place of `Supply a value.`, naming the spellings its polarity accepts. Under an invocation by name, the fix remains `Supply a value.` A default never answers here. An input that declares `required: 'non-interactive'` never reaches this row, because core reports it before the action.
- **Interaction unavailable.** `InteractionUnavailableError` extends `FatalError` with the failure code `interaction-unavailable` and exit 1. Its sentence names the question and the routed Command: `The question "Install the background service?" needs an interactive terminal, and this run is not interactive. Run "mimir setup" at a terminal.`

## Reading keys

Each kind reads keys from stdin in raw mode, through one reader that every question of the run shares. The reader turns the bytes a terminal sends into keys, in the encodings xterm-compatible terminals send, so the keys an operator presses in a shell work in a question. In the table, CSI is `\u001b[` and SS3 is `\u001bO`.

| Key                         | Bytes the reader reads as the key                                               |
| --------------------------- | ------------------------------------------------------------------------------- |
| Enter                       | `\r`, `\n`, or `\r\n`, which reads as one Enter                                 |
| Backspace                   | `\u007f`, and `\b`, which is also Ctrl-H                                        |
| Delete                      | CSI `3~`                                                                        |
| Tab                         | `\t`, which is also Ctrl-I                                                      |
| Escape                      | A lone ESC, `\u001b`, under the rule below, and CSI `27u`                       |
| Up, Down, Right, Left       | CSI or SS3 followed by `A`, `B`, `C`, or `D`                                    |
| Home                        | CSI `H`, SS3 `H`, CSI `1~`, and CSI `7~`                                        |
| End                         | CSI `F`, SS3 `F`, CSI `4~`, and CSI `8~`                                        |
| Ctrl-Right, Ctrl-Left       | CSI `1;5C` and CSI `1;5D`                                                       |
| Alt-Right, Alt-Left         | CSI `1;3C` and CSI `1;3D`                                                       |
| Alt-Backspace               | ESC followed by `\u007f` or `\b`                                                |
| Ctrl and a letter           | The letter's code with its upper three bits cleared, `\u0001` for Ctrl-A through `\u001a` for Ctrl-Z, except the bytes a row above names |
| Alt and a character         | ESC followed by a printable character other than `[` and `O`, as a terminal that sends Meta as ESC writes it |
| A printable character       | Each code point from U+0020, Space, upward, other than U+007F                   |

- **Interrupt keys first.** Core reads Ctrl-C, Ctrl-\\, and Ctrl-Z out of each read before the reader sees it, under [Leaving a question](#leaving-a-question), so no kind reads them as keys.
- **Unlisted sequences.** A complete CSI sequence or SS3 sequence the table does not list, such as Shift-Left, CSI `1;2D`, or F5, is read whole and ignored, so its bytes never reach a typed line. An arrow with a modifier parameter other than 3 and 5 is such a sequence.
- **A lone Escape.** An ESC that ends a read, alone or as the start of a sequence the read does not finish, is held. A read that arrives within 50 milliseconds continues it, so a sequence a slow link splits across two reads still reads as one key. When 50 milliseconds pass with no read, a held lone ESC is the Escape key, and a held unfinished sequence is dropped. Inside one read, ESC followed by another byte is never a lone Escape: it starts a sequence, an Alt combination, or Alt-Backspace, except that ESC followed by a control byte other than `\u007f` and `\b`, ESC included, is the Escape key and the byte after it reads on its own. The window is the reader's own timing for telling one key from another, not a limit on the operator: its timer runs only while bytes are held, is unref'd, and is cleared when the reader releases stdin.
- **Escape cancels nothing.** Escape never cancels a question and never ends the run, so an operator who presses it out of habit from an editor loses no answer. Ctrl-C is the one key that cancels. No kind gives Escape a meaning, so every kind ignores it.
- **A key a kind does not list is ignored.** Enter submits, and the submitted answer, typed or an accepted prefill, passes through `validate` when the question has one. A rejected answer keeps what was typed and shows the first issue's message on the line below until the next Enter, which either accepts an answer or replaces the issue. Keys that arrive after an Enter, typed ahead or pasted, stay queued for the run's next question, and keys still queued when the action ends are discarded.

## Editing a typed line

Text, secret, and confirm hold a typed line: the text typed so far and a cursor. The cursor is a grapheme index, from 0, before the first grapheme, to the line's grapheme count, after the last. A grapheme is an extended grapheme cluster, as `Intl.Segmenter` segments text with `granularity: 'grapheme'`, so an emoji or a letter with a combining accent moves and deletes as one.

| Keys                                   | Effect on the typed line                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| A printable character                  | Inserts the character at the cursor                                          |
| Left, Ctrl-B                           | Moves the cursor one grapheme left                                           |
| Right, Ctrl-F                          | Moves the cursor one grapheme right                                          |
| Alt-B, Ctrl-Left, Alt-Left             | Moves the cursor to the start of the word before it                          |
| Alt-F, Ctrl-Right, Alt-Right           | Moves the cursor to the end of the word after it                             |
| Home, Ctrl-A                           | Moves the cursor to the start of the line                                    |
| End, Ctrl-E                            | Moves the cursor to the end of the line                                      |
| Backspace                              | Deletes the grapheme before the cursor                                       |
| Delete                                 | Deletes the grapheme at the cursor                                           |
| Ctrl-D                                 | On an empty line, ends input; otherwise, as Delete                           |
| Ctrl-W, Alt-Backspace                  | Deletes from the start of the word before the cursor to the cursor           |
| Ctrl-U                                 | Deletes from the start of the line to the cursor                             |
| Ctrl-K                                 | Deletes from the cursor to the end of the line                               |
| Tab                                    | In text, copies the hint into an empty line; otherwise, nothing              |
| Enter                                  | Submits the line                                                             |

- **Bounds.** A move or a deletion with nothing in its direction does nothing: Left and Backspace at 0, and Right, Delete, and Ctrl-K at the end. Right on an empty text line that shows a hint copies the hint, as Tab does.
- **Words.** A word grapheme is one whose first code point is a letter or a number, Unicode general category `L` or `N`. Every other grapheme, whitespace, punctuation, and symbols, separates words. The start of the word before the cursor is found by moving left over separators and then over word graphemes, and stops at 0. The end of the word after the cursor is found by moving right over separators and then over word graphemes, and stops at the end. One definition serves every word key, so Ctrl-W stops at punctuation as Alt-Backspace does: with the cursor at the end of `postgres://db.local:5432/app`, Ctrl-W leaves `postgres://db.local:5432/`, and a second Ctrl-W leaves `postgres://db.local:`.
- **Where the cursor lands.** Every edit replaces one range of the line, the cursor's position for an insertion, with new text, which is empty for a deletion. Afterward the cursor sits at the first grapheme boundary of the new line at or after the end of the new text, so a combining mark typed after a letter joins it, and the cursor stays after the combined grapheme.
- **Pasted text.** A paste reads as the keys its bytes hold, in order, as typed text does. Its printable characters insert at the cursor, one after another, a line break in it is Enter, which submits, and the rest of the paste stays queued for the next question. A tab in it is the Tab key.
- **Nothing else.** The line keeps no history, so Up and Down do nothing in it, and it has no kill ring, so Ctrl-Y yanks nothing. Ctrl-T, Ctrl-L, undo, and a vi mode are not keys of a typed line.

## The kinds

- **Text.** Edits a typed line. The prefill is its hint: with an empty line, the hint draws dimmed and Enter accepts it. The first character typed replaces the hint, and a line emptied again shows it again. Tab, or Right on the empty line, copies the hint into the line with the cursor at its end, so the operator edits the default rather than retyping it, and Enter then submits the line as edited. A question with a hint cannot submit the empty string, so an author who needs blank as an answer omits the default. Without a prefill, Enter on an empty line submits the empty string, and the validator decides whether it is valid.
- **Secret.** Edits a typed line with every key text has but Tab, and with nothing echoed: the frame does not change while the operator types or moves the cursor, and no frame shows a hint, a mask, the length, or the cursor's place. The typed value reaches no view. The editing keys still work on the hidden line, so an operator who knows a typo can Ctrl-U and type again, as at a shell's password prompt.
- **Confirm.** Edits a typed line. Enter accepts `y`, `yes`, `n`, and `no` in any case. Enter on an empty line accepts the prefill when there is one, and otherwise shows the issue `Type y or n.`, as any other text does. The hint reads `[Y/n]` for a yes prefill, `[y/N]` for a no prefill, and `[y/n]` with none. The hint is a legend for the keys, not text the line can hold, so Tab and Right on an empty line do nothing.
- **Select.** ↑ and ↓ move the highlight and stop at the first and last choice. Enter selects the highlighted choice. At most seven choices show at once, fewer when stderr has fewer rows, and the window scrolls with the highlight. A dim `↑ 3 more` or `↓ 5 more` line marks hidden choices in that direction. The last line is the key help `↑↓ move · Enter select`. When even one choice with the ordinary frame cannot fit, the frame clips the title and selected label at grapheme boundaries, combines hidden-count markers with the footer, and abbreviates narrow key help to `↑↓ Enter`. The clipping uses the view context’s `columns`, which is stderr’s width by the rule in [Width, padding, and multiline lanes](../core/styles.md#width-padding-and-multiline-lanes), because a question draws on stderr: the real width, narrowed by a smaller valid `COLUMNS`, or `COLUMNS` alone on a terminal that reports no width. Each frame reads `columns` and `rows` when it draws, so the select window’s visible count follows a resize at the next frame, and a question does not redraw by itself on a resize. The default view clips at 80 columns when `columns` is `undefined`. That 80-column fallback applies to clipping alone: the select window’s height estimate assumes no wrapping when `columns` is `undefined`. The returned value is always the complete choice.

## Frames and views

A question draws in an input region, which it opens with `out.region({ input: true })` on stderr, and never writes to stdout. Each frame renders through a declared view the library exports from `@loomcli/prompts/views`, so an application restyles one with [`override`](../core/views.md) as it restyles a lane.

| View            | Data                                                                                      | Default rendering                                      |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `questionFrame` | `kind`, `message`, and `issue`; for text, secret, and confirm the `typed` text, the `cursor`, and the `hint`; for select the visible `choices`, the `highlighted` index, and the hidden counts above and below, and stderr’s `rows` | The active question, below                             |
| `answeredLine`  | `message` and `answer`, a display string, absent for secret                               | `? Service port · 8080`                               |
| `cancelledLine` | `message`                                                                                 | `? Service port · cancelled`                          |

`cursor` is the typed line's cursor, a grapheme index into `typed` from 0 to its grapheme count, the unit the editing keys move by. A view draws graphemes, so a grapheme index names a place it can draw, where a code unit or code point offset could fall inside an emoji or an accented letter. A secret's `typed` field is always the empty string and its `cursor` always 0, because a cursor that moved would show the secret's length. The default views use core's style tokens and glyphs:

| Frame                    | Rendering                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Text, asking             | `?` in `info` and bold, the message bold, a dim `›`, then the field: the typed text with the cursor block, or the hint, dim, with the cursor block over its first grapheme |
| Secret, asking           | `?`, the message, a dim `›`, and the cursor block over one space, which never moves                          |
| Confirm, asking          | `?`, the message, the dim hint `[Y/n]`, and the field: the typed text with the cursor block                  |
| Select, asking           | `?` and the message on the first line, the highlighted choice as `❯ postgres` in `highlight`, the others indented two columns, the marker lines and key help dim |
| An issue                 | On the line below, indented two columns, `✘` and the message in `error`                                       |
| Answered                 | A dim `?`, the message, a dim `·`, and the answer in `highlight`; a secret ends at the message                 |
| Cancelled                | A dim `?`, the message, and a dim `· cancelled`                                                               |

- **The cursor block.** The default view draws the cursor in `inverse` over the grapheme at the cursor, and over one space after the last grapheme when the cursor is at the end, so the block shows where the next character lands.
- **One row.** A text, secret, or confirm frame keeps its asking line on one row of the view context's `columns`, or 80 columns when `columns` is `undefined`, so a long answer never wraps the frame. The prefix is `? `, the message, and the separator, ` › ` for text and secret and the hint with a space on each side for confirm. The field takes the columns the prefix leaves. When that is fewer than 16, the message clips at grapheme boundaries, as the select title clips, until the field has 16 columns, or every column after `? ` and the separator on a narrower screen.
- **A field too narrow for the line.** When the typed text and the cursor's cell fit the field, the view draws them whole. Otherwise it draws a window of the line that holds the cursor's cell. Each side of the window that leaves out a grapheme draws the glyph `ellipsis`, dim, in its place, and a side that leaves out nothing draws none. The view takes graphemes leftward from the cursor while they fit, keeping one ellipsis's width on the right when any grapheme follows the cursor's, and then fills what remains rightward. So typing at the end scrolls the text left with the cursor at the field's right edge, and Home shows the line from its start.
- **A long hint.** A hint wider than the field draws from its start and ends in the dim `ellipsis` glyph at the field's edge.
- **Widths.** The view measures with the view context's `width`, so a wide grapheme takes its two columns, and it never splits a grapheme. Each frame reads `columns` when it draws, so the window follows a resize at the next frame.

`?`, `›`, and `·` are plain text, and `✘`, `❯`, and `…` are the [glyphs](../core/styles.md#glyphs) `cross`, `pointer`, and `ellipsis`, so a terminal that takes compat forms reads `×` and `>` for the first two. A question hides the terminal cursor while it asks and draws its own, so the view decides where the cursor sits. The library writes the sequences that hide and show the cursor through `out.draw` with a bare view of its own, which nothing overrides. Core erases and redraws the region, so an overridden view that takes more or fewer rows redraws in place, and a lane message written while the question asks lands above the frame without breaking it. An active frame has no trailing newline, so its hidden terminal cursor stays on the last drawn row. The answered or cancelled line is the region's last frame: it replaces the frame, the cursor shows again, and the line stays in the scrollback when the region closes.

## Leaving a question

A question asks only when interaction is on, and it enters raw mode through `host.stdin.setRawMode`, which a terminal stream has. An embedding host that reports a terminal on stdin supplies a stream with that method, and a question that finds none throws a `TypeError`, which a run reports as a defect with exit 1. Before it enters raw mode, it adds a synchronous listener to `context.signal` that leaves raw mode, so the terminal is cooked again at the moment of the abort. While it is open, it also registers a run-scoped [`onShutdown`](../core/signals.md#onshutdown) handler that leaves raw mode and shows the cursor, so a signal that ends the process leaves the terminal cooked even when the shutdown's budget runs out, and it registers run-scoped [suspend and resume](../core/signals.md#suspend-and-resume) handlers: a suspend leaves raw mode before the process stops, while core erases the question's frame and shows the cursor, and the resume enters raw mode again and hides the cursor again, while core redraws the frame, under [Raw-mode readers](../core/signals.md#raw-mode-readers). A question enters raw mode before its first frame, so a key typed while that frame is written, Ctrl-C included, reaches it as a key, and raw mode holds while any question of the run is open, so a question waiting its turn never leaves a key to a cooked terminal. Every path out of the run's last open question leaves raw mode, pauses `host.stdin` and removes the listeners the questions added, so stdin never holds the process open after the run. Every path out of a question draws the last line, answered or cancelled, with the sequence that shows the cursor, after every frame the question queued.

- **Ctrl-C** raises `SIGINT` on the run's signal source through `host.raise`, which starts the [shutdown](../core/signals.md#the-shutdown): core aborts the run signal, the question draws its cancelled line and throws `context.signal.reason`, and core reads the throw as a silent cancellation. The run resolves 130 and the process then ends by the signal. Every key still unread when Ctrl-C or Ctrl-\\ raises its signal, such as an Enter typed in the same read, is dropped, as a cooked terminal flushes its input on an interrupt, so no key answers the question before the signal arrives.
- **Ctrl-\\** raises `SIGQUIT`, which skips the shutdown's budget.
- **Ctrl-Z** raises `SIGTSTP`, which [suspends](../core/signals.md#suspend-and-resume) the process: the question's frame is erased and the terminal restored, and on `fg` the frame is drawn again and the question goes on reading keys. Several Ctrl-Z keys in one read suspend once, and every key still unread when Ctrl-Z raises its signal is dropped, as it is for Ctrl-C. The suspend cancels nothing.
- **A stdin that is not its signal source's own terminal**, such as one an embedding host gives `processHandle`, raises none of these signals, because `host.raise` answers `false`, under [Raw-mode readers](../core/signals.md#raw-mode-readers): Ctrl-C and Ctrl-\\ call `context.cancel()`, so the question draws its cancelled line and the run resolves 130 while the process goes on, and Ctrl-Z does nothing.
- **End of input** while a question is active, stdin closing, or Ctrl-D on an empty typed line or at a select, calls `context.cancel()`, and the question then draws its cancelled line and throws `context.signal.reason`, and the run resolves 130. It neither accepts a default nor submits an empty answer.
- **A run signal that aborts** while a question waits, from a caller or a process signal, ends the question the same way, with the code the first cause fixed. Core closes the question's region for the cancellation, and the question draws its cancelled line in the region's abort.
- **Core closing the question's region** for a failure, such as work the action runs beside the question with `Promise.all` that rejects, or for the return of what asked it, ends the question too. The question draws its cancelled line in the region's abort, stops reading keys, and rejects with the region signal's reason.
- **A signal already aborted** at the call ends the question before it draws anything.

A question waits as long as the operator takes, and the library adds no timeout. Two questions asked at once take turns, because core opens one input region at a time: the second draws and reads keys once the first is answered or cancelled. While a question asks, every progress line's frame holds still, and each catches up once when the question closes.

## Progress

```ts
import type { ActionContext, Out, Plugin } from '@loomcli/core';

interface Spinner {
  readonly frames: readonly string[]; // drawn in turn, one each interval
  readonly interval: number; // milliseconds between frames
}
interface ProgressSettings {
  readonly label: string;
  readonly total?: number; // a bar with counts; without it, a spinner
  readonly spinner?: Spinner; // this line's own spinner, over the application's style
}
interface ProgressUpdate {
  readonly completed?: number;
  readonly total?: number;
  readonly label?: string;
}
interface TrackMessages<Value> {
  readonly done?: string | ((value: Value) => string);
  readonly failed?: string | ((error: unknown) => string);
}
interface Progress {
  update(update: ProgressUpdate): void;
  end(message?: string): Promise<void>;
  fail(message?: string): Promise<void>;
  track<Value>(work: PromiseLike<Value>, messages?: TrackMessages<Value>): Promise<Value>;
}
type ProgressContext = Pick<ActionContext<unknown>, 'graph'> & {
  readonly out: Pick<Out, 'region' | 'info' | 'success' | 'error'>;
};
interface ProgressStyleSettings {
  readonly spinner?: Spinner;
  readonly bar?: { readonly complete: string; readonly incomplete: string };
}

declare function progress(context: ProgressContext, settings: ProgressSettings): Progress;
declare function progressStyle(settings?: ProgressStyleSettings): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { progress } from '@loomcli/prompts';

import { buildIndex, fetchRecord } from './records.js';

export const app = new Application('fetchit')
  .argument('urls', { required: true, variadic: true })
  .action(async (context) => {
    const { urls } = context.args;
    const fetching = progress(context, { label: 'Fetching records', total: urls.length });
    for (const [index, url] of urls.entries()) {
      await fetchRecord(url);
      fetching.update({ completed: index + 1 });
    }
    await fetching.end(`Fetched ${String(urls.length)} records`);
    await progress(context, { label: 'Building the index' }).track(buildIndex(), {
      done: (count) => `Indexed ${String(count)} records`,
    });
  });
```

At a terminal, the first line reads, partway through:

```text
◓ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · 2.4s
```

and the run leaves:

```text
✔ Fetched 10 records · 4.1s
✔ Indexed 812 records · 1.9s
```

With stderr piped, or on a terminal whose `TERM` is `dumb`, the same run writes:

```text
ℹ Fetching records
✔ Fetched 10 records
ℹ Building the index
✔ Indexed 812 records
```

A progress line shows an operator that work is under way: a spinner while the work has no known size, and a bar with counts once it has a total. `progress(context, settings)` draws one in a [live region](../core/output.md#live-region), animates it on its own timer, and reports it as [progress events](../core/output.md#progress-events), so an invocation by name and an MCP client read the same progress a terminal shows.

- **A line in a region.** `progress()` opens one region through `context.out.region()`, reports `{ label, total, completed: 0 }` with a total and `{ label }` without one, draws its first frame, and returns the line's handle at once. Several lines stack in the order they started, and a question asked meanwhile draws below them. An action, a middleware, and a configuration source each call it with their own context.
- **Updates.** `update({ completed?, total?, label? })` changes what the line shows, reports the change, and draws the next frame, and an omitted field keeps its value. A `total` turns a spinner into a bar. It returns nothing, because the frame queues in call order. After the line has closed it checks its settings, as every call does, and then does nothing.
- **The frame timer.** While the line is live, the library redraws it every spinner `interval` from its own `setInterval`, advancing the spinner frame and the elapsed time. The timer is unref'd, so it never keeps a process alive, and the library clears it when the region's signal aborts, whatever closed the region. It cancels and limits nothing. A line that is not live runs no timer.
- **Ending.** `end(message?)` draws the line's success line, with the message or else the label, and closes its region with `end('ended', message)`. `fail(message?)` draws its failure line and closes the region with `end('failed', message)`, so its last progress event reads `failed`. Either way the end event's label is the message, so an `onProgress` observer and an MCP client read the same end text the terminal shows, and a line ended with no message keeps its last label. Each resolves once its line is written. After the line has ended, failed, or been cancelled, `end` and `fail` do nothing and resolve.
- **Tracking work.** `track(work, { done?, failed? })` awaits `work`. When it resolves, the line ends with `done`, and `track` returns the value. When it rejects, the line fails with `failed`, and `track` rejects with the same rejection, unchanged. `done` is a string or a function of the resolved value, and `failed` a string or a function of the rejection, so either message can say what happened, and each defaults to the label. When the line has already closed, `track` only returns the value or rethrows.
- **Cancellation.** The handle has no cancel method. When the run is cancelled, core closes the line's region for the cancellation, and the line draws its cancelled line in the region's abort. A line started after the run is cancelled finds its region already closed, so it draws and writes nothing and starts no timer.
- **A failing run.** When the run fails with a line still open, core closes the line's region for the failure before it renders the failure report, and the line draws its failure line with its label in the abort, so the report follows every line. A line the action leaves open draws its success line with its label when the action returns. A line a middleware or a configuration source leaves open stays open through the action, so a middleware can show a line around the whole run, and draws its success line with its label once the middleware chain has unwound.
- **Off a terminal.** When the region is not live, because stderr is not a terminal, the terminal does not [redraw](../core/output.md#live-region) in place (`TERM=dumb`, or `CI` set and not `false`), the run is an [invocation by name](../core/invocation.md#invocation-by-name), or the run's [verbosity](../core/verbosity.md) is -1, the line draws nothing. `progress()` writes its label once through `context.out.info`. `end` and a resolved `track` write the end message through `context.out.success`, and `fail`, a rejected `track`, and a failing run write it through `context.out.error`. An update and a cancellation write nothing, and no line carries the elapsed time. So under `-q` the start and success lines hide with their lanes and a failure line prints, and under an invocation by name the lines land in `messages`. The library reads the region's `live` and never the verbosity.
- **Reports.** The line reports at its start, at each update, and when it closes, so an [`onProgress`](../core/invocation.md#invocation-by-name) observer and an [MCP](../plugins/mcp.md) client read `started`, `updated`, and `ended`, `failed`, or `cancelled`, whether or not the line draws.
- **The values.** `label`, an update's `label`, and the end messages are marked strings, as a lane message is, so an author escapes raw data with `style.escape` first. `total` and `completed` are counts of 0 or more, which the library draws as given, and `completed` may pass `total`.
- **No limit.** A line shows until its work ends. The library adds no timeout and no stall check.

### Progress style

```ts
import { Application } from '@loomcli/core';
import { progressStyle } from '@loomcli/prompts';
import spinners from 'cli-spinners';

export const app = new Application('fetchit', {
  plugins: [progressStyle({ spinner: spinners.dots, bar: { complete: '█', incomplete: '░' } })],
});
```

`progressStyle(settings?)` sets how every progress line of the application looks. It is an ordinary [plugin](../core/plugin-contract.md) whose identity is `@loomcli/prompts`, and an application that leaves it out draws the defaults.

- **One value.** The plugin declares no option, middleware, Command, view, or slot. It lists one Command-target [extension](../core/extensions.md), `@loomcli/prompts/progress-style`, whose value its `onCommandAttach` hook adds to the root Command alone, and `progress()` reads it from `context.graph.root` with `readExtension`. The package does not export the descriptor.
- **The spinner shape.** A spinner is `{ frames, interval }`, the shape every entry of [cli-spinners](https://github.com/sindresorhus/cli-spinners) has, so any entry drops in. One call's `spinner` setting wins over the style for its line.
- **Defaults.** Without the plugin, and for each setting it omits, a line draws cli-spinners' `circleHalves` frames, `◐ ◓ ◑ ◒`, every 80 milliseconds, and a bar of `▰` complete cells and `▱` incomplete cells.
- **No checks.** `progressStyle()` and `progress()` judge no setting, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the types bound each one, and the counts, labels, frames, cells, and interval are the author's values, drawn as given.

### Progress view

```ts
interface ProgressLine {
  readonly state: 'running' | 'ended' | 'failed' | 'cancelled';
  readonly label: string; // the end message once the line has ended or failed
  readonly completed: number | undefined;
  readonly total: number | undefined;
  readonly frame: string; // the spinner's current frame
  readonly bar: { readonly complete: string; readonly incomplete: string };
  readonly elapsed: number; // milliseconds since progress() opened the line
}
```

`progressLine` is the declared view `@loomcli/prompts/progress`, exported from `@loomcli/prompts/views`, so an application restyles every progress line with [`override`](../core/views.md), as it restyles a question frame. The default view renders one line with no trailing newline, through core's style tokens and glyphs:

| Line                                   | Rendering                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Running, no total                      | The frame in `highlight`, the label, then a dim `·` and the elapsed time, dim: `◐ Building the index · 0.8s`                    |
| Running, with a total                  | The frame, the label, a bar of 10 cells, complete cells in `highlight` and incomplete cells dim, the counts, the dim `·`, and the elapsed time: `◓ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · 2.4s` |
| Running, `completed` without a total   | The frame, the label, the count, the dim `·`, and the elapsed time: `◑ Reading rows 1204 · 3.0s`                                |
| Ended                                  | The glyph `success` in `success`, the message, the dim `·`, and the elapsed time: `✔ Fetched 10 records · 4.1s`               |
| Failed                                 | Core's glyph `error` in `error`, the message, the dim `·`, and the elapsed time: `✘ Fetching records · 2.6s`, and `× Fetching records · 2.6s` where the terminal takes compat forms |
| Cancelled                              | The glyph `squareCenter`, the label, and `(cancelled)`, all dim: `■ Fetching records (cancelled)`                              |

- **The bar.** The complete cells number 10 × `completed` ÷ `total`, rounded down and held between 0 and 10, and a total of 0 fills the bar. The counts read `completed/total` when both are whole numbers, and otherwise the percent, 100 × `completed` ÷ `total` rounded down and followed by `%`, which a total of 0 reads as `100%`. An absent `completed` reads 0.
- **Elapsed time.** Under a minute it reads seconds with one decimal, `2.4s`; under an hour, minutes and two-digit seconds, `1m 05s`; and from an hour, hours and two-digit minutes, `1h 02m`. Each rounds down.
- **Plain text.** The spinner frames and the bar cells are plain text, not glyphs, so a terminal that takes compat forms draws them as the style gives them. The view neither wraps nor clips a long label: the terminal wraps it, and core counts the rows it takes.

## When author code fails

A question's `validate`, the `done` and `failed` message functions of `track`, the work `track` awaits, and an overridden prompts view are author code. Author code that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Two outcomes are the library's own. Work that rejects under `track` fails its line and rejects `track` with the same rejection, unchanged. A question or progress line still open when the run fails draws its cancelled or failure line before core renders the failure report, as [Leaving a question](#leaving-a-question) and the failing-run rule of [Progress](#progress) state.

## Package

- The root export holds `text`, `secret`, `confirm`, `select`, `InteractionUnavailableError`, `progress`, `progressStyle`, and the settings types, `ProgressSettings`, `ProgressUpdate`, `TrackMessages`, `Progress`, `ProgressContext`, `Spinner`, and `ProgressStyleSettings` included. `@loomcli/prompts/views` exports `questionFrame`, `answeredLine`, `cancelledLine`, and `progressLine` and their data types. Its one plugin is `progressStyle()`, whose identity is `@loomcli/prompts`.
- `@loomcli/core` is a peer dependency. The package reads the action context, `DeclarationError`, `FatalError`, `missingInputError`, `extension`, `plugin`, `readExtension`, the Standard Schema types, `glyph`, and `view` from core, and adds no runtime dependency of its own. Its style schema is a hand-written Standard Schema value.

## Not shipped

- A Command that declares it needs a terminal.
- Multiple-choice selection, a question that narrows its choices as the operator types, and an editor question.
- A number question and a date question. A text question composes them: `integer()`, `number()`, `date()`, or `dateTime()` from [`@loomcli/validators`](validators.md) as its `validate` checks the typed answer and returns the value.
- A path question. Completing a path is a source of choices for a question that searches them, not a kind of its own.
- Multiline text. It overlaps an editor question, which edits several lines in the operator's own editor.
- A form that asks several questions on one screen. An action asks its questions in order, and a follow-up that depends on an earlier answer stays the application's, under [ADR-0082](../decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md).
- A sort question that reorders a list. It needs a mode in which the arrow keys carry a held choice, which no other kind has.
- A typed line's history, kill ring, and vi mode.
- A default, a prefill, or "Enter keeps the current value" for secret.
- Redrawing when the terminal is resized while a question asks. The next frame after a resize erases the whole region, because core recounts its last frame at the current width.
- A progress line drawn as a multi-step tree, a progress line with a rate or an estimated time left, and a progress line on stdout.
