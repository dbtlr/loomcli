---
description: The @loomcli/prompts reference. The four question kinds an action asks, text, secret, confirm, and select, how a question links a local option, how the run's interaction decision resolves it, what each kind draws and accepts, and how a question leaves the terminal.
---

# Prompts reference

`@loomcli/prompts` is a library an action imports to ask an operator a question at a terminal. It is not a plugin: an application installs nothing, and the library registers no option. [ADR-0082](decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) records the decision. Core supplies what a question reads, the run's [interaction decision](core.md#interaction), the [`supplied`](core.md#interaction) record, `out.draw`, and `cancel()`, and the library owns the key reader and the frames.

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
type LinkKey<Options> = keyof Options & string;
type Answer<Options, Key, Output> = [Key] extends [never]
  ? Output
  : Output | Options[Key & keyof Options];

function text<Options, const Key extends LinkKey<Options> = never, Output = string>(
  context: ActionContext<unknown, Options, unknown>,
  settings: TextSettings<Key, Output>, // validate?: StandardSchemaV1<string, Output>
): Promise<Answer<Options, Key, Output>>;
function secret<Options, const Key extends LinkKey<Options> = never, Output = string>(
  context: ActionContext<unknown, Options, unknown>,
  settings: SecretSettings<Key, Output>,
): Promise<Answer<Options, Key, Output>>;
function confirm<Options, const Key extends LinkKey<Options> = never>(
  context: ActionContext<unknown, Options, unknown>,
  settings: ConfirmSettings<Key>,
): Promise<Answer<Options, Key, boolean>>;
function select<Options, const Choice extends string, const Key extends LinkKey<Options> = never>(
  context: ActionContext<unknown, Options, unknown>,
  settings: SelectSettings<Key, Choice>, // choices: readonly Choice[]; default?: NoInfer<Choice>
): Promise<Answer<Options, Key, Choice>>;
```

The type tests prove the generic plumbing against the action context's real parameters; the results above are what it must produce.

| Setting          | Kinds                  | Meaning                                                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `message`        | All                    | The question's title, a marked string of one line.                                          |
| `option`         | All                    | The key of the local option the question links.                                             |
| `skipIfSupplied` | All                    | `true` skips the question at a terminal when the linked option was supplied. Needs `option`. |
| `default`        | Text, confirm, select  | The question's own default: a string for text, a Boolean for confirm, a choice for select.  |
| `validate`       | Text, secret           | A Standard Schema value that checks a typed answer and may transform it.                    |
| `choices`        | Select                 | A nonempty list of distinct strings.                                                        |

Question validation receives the captured Loom run context through the Standard Schema options channel, with `phase: 'question'`. A linked question identifies its local option; an unlinked question identifies its title with `kind: 'question'`. The host, route, passthrough tail, and supplied values come from the same run, with separate copies for each validator call. Shipped validators such as `path()` and `dateTime()` use the host's working directory and time zone. A skipped question never calls its question validator.

Secret declares no `default` in this release, and its types reject one.

The return type is the question's own output: the validator's output for text and secret, or `string` without one, `boolean` for confirm, and the choice union for select. A linked question can also return the option's validated value, so `Answer` adds the option's action value, `undefined` included, because a validator may return `undefined` for a supplied value. The union collapses when the two agree, as `port()` on both the option and the question does.

## Linking an option

`option` names a local option of the routed Command. Its type admits the keys of the action's `options`. At the call, the library checks the declaration through `context.command` and throws a `DeclarationError` under the rule `@loomcli/prompts/link` for each of these, which a run reports with exit 1:

| Link                                               | Sentence                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A key the routed Command does not declare          | `The question "Service port" links option "prot", which Command "setup" does not declare. Link a local option of the routed Command.` |
| A global option                                    | `The question "Service port" links global option "verbose". Link a local option of the routed Command.`      |
| A multiple, content, or counted option from text, secret, or select | `The question "Tags" links option "tag", which is not a string option that takes one value. Link a string option that takes one value.` |
| Any option but a Boolean from confirm              | `The question "Install?" links option "install", which is not a Boolean option. Link a Boolean option.`     |
| `skipIfSupplied` without `option`                  | `The question "Service port" sets skipIfSupplied without option. Link an option or remove skipIfSupplied.`   |

The same rule covers settings that are malformed: an empty `choices` list, a repeated choice, a `default` that is not one of `choices`, a `default` on secret, and a `validate` that is not a Standard Schema value. The root Command reads as `the root Command`.

## Resolving a question

A question first reads the run's interaction decision, `context.interactive`, and the linked option's raw value, `context.supplied.options[option]`, which is `undefined` when the option was omitted or left to its declared default.

| Linked option            | Interaction on, `skipIfSupplied` | Interaction on, without it | Interaction off             |
| ------------------------ | -------------------------------- | -------------------------- | --------------------------- |
| Supplied                 | Skipped                          | Asked, prefilled           | Skipped                     |
| Not supplied             | Asked                            | Asked                      | Missing-input error, exit 2 |
| No link                  | Asked                            | Asked                      | `InteractionUnavailableError`, exit 1 |

- **Skipped.** The question draws nothing and returns `context.options[option]`, the option's validated value. The question's own validator does not run.
- **Asked.** The prefill is the first that applies: the raw supplied value, the question's `default`, the linked option's declared default, or none. A Boolean option's implicit absent value is never a default. A select whose prefill matches no choice starts on the first choice. Secret takes no prefill in this release: asked, it starts empty even when its option was supplied, and only `skipIfSupplied` or interaction off answers it from the option. An accepted prefill is a submitted answer and passes through `validate` as a typed one does.
- **Missing input.** The question throws `missingInputError(context, option)`, core's ordinary `InputError` for that option: `Option "--database-url" is required when input is not interactive. Supply a value.`, named by declared name under an invocation by name. For argv, a confirm's Boolean option reads `Supply "--install" or "--no-install".` in place of `Supply a value.`, naming the spellings its polarity accepts. Under an invocation by name, the fix remains `Supply a value.` A default never answers here. An option that declares `required: 'non-interactive'` never reaches this row, because core reports it before the action.
- **Interaction unavailable.** `InteractionUnavailableError` extends `FatalError` with the failure code `interaction-unavailable` and exit 1. Its sentence names the question and the routed Command: `The question "Install the background service?" needs an interactive terminal, and this run is not interactive. Run "mimir setup" at a terminal.`

## The kinds

Each kind reads keys from stdin in raw mode. A key a kind does not list is ignored. Enter submits, and the submitted answer, typed or an accepted prefill, passes through `validate` when the question has one. A rejected answer keeps what was typed and shows the first issue's message on the line below until the next Enter, which either accepts an answer or replaces the issue. Ctrl-D with nothing typed is end of input, as it is in a cooked terminal. Keys that arrive after an Enter, typed ahead or pasted, stay queued for the run's next question, and keys still queued when the action ends are discarded.

- **Text.** A printable character appends, and Backspace removes the last character. With no typed text, the prefill shows as a dim hint, and Enter accepts it. Without a prefill, Enter submits the empty string, and the validator decides whether it is valid. A question with a prefill cannot submit the empty string, so an author who needs blank as an answer omits the default.
- **Secret.** Text's keys, with nothing echoed: the frame does not change while the operator types, and no frame shows a hint, a mask, or the length. The typed value reaches no view.
- **Confirm.** Text's keys over a typed answer. Enter accepts `y`, `yes`, `n`, and `no` in any case. Enter on empty input accepts the prefill when there is one, and otherwise shows the issue `Type y or n.`, as any other text does. The hint reads `[Y/n]` for a yes prefill, `[y/N]` for a no prefill, and `[y/n]` with none.
- **Select.** ↑ and ↓ move the highlight and stop at the first and last choice. Enter selects the highlighted choice. At most seven choices show at once, fewer when stderr has fewer rows, and the window scrolls with the highlight. A dim `↑ 3 more` or `↓ 5 more` line marks hidden choices in that direction. The last line is the key help `↑↓ move · Enter select`. When even one choice with the ordinary frame cannot fit, the frame clips the title and selected label at grapheme boundaries, combines hidden-count markers with the footer, and abbreviates narrow key help to `↑↓ Enter`. The returned value is always the complete choice.

## Frames and views

A question draws through `out.draw` on stderr and never writes to stdout. Each frame renders through a declared view the library exports from `@loomcli/prompts/views`, so an application restyles one with [`override`](core.md#views) as it restyles a lane.

| View            | Data                                                                                      | Default rendering                                      |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `questionFrame` | `kind`, `message`, and for text and confirm the `typed` text, `hint`, and `issue`; for select the visible `choices`, the `highlighted` index, and the hidden counts above and below, and stderr’s `columns` and `rows` | The active question, below                             |
| `answeredLine`  | `message` and `answer`, a display string, absent for secret                               | `? Service port · 8080`                               |
| `cancelledLine` | `message`                                                                                 | `? Service port · cancelled`                          |

A secret's `typed` field is always the empty string. The default views use core's style tokens and glyphs:

| Frame                    | Rendering                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Text, asking             | `?` in `info` and bold, the message bold, a dim `›`, then the typed text, or the hint dim, and a block cursor drawn in `inverse` |
| Secret, asking           | `?`, the message, a dim `›`, and the cursor                                                                    |
| Confirm, asking          | `?`, the message, the dim hint `[Y/n]`, the typed text, and the cursor                                        |
| Select, asking           | `?` and the message on the first line, the highlighted choice as `❯ postgres` in `highlight`, the others indented two columns, the marker lines and key help dim |
| An issue                 | On the line below, indented two columns, `✘` and the message in `error`                                       |
| Answered                 | A dim `?`, the message, a dim `·`, and the answer in `highlight`; a secret ends at the message                 |
| Cancelled                | A dim `?`, the message, and a dim `· cancelled`                                                               |

`?`, `›`, and `·` are plain text, and `✘` and `❯` are the [glyphs](core.md#glyphs) `cross` and `pointer`, so a terminal that takes compat forms reads `×` and `>`. A question hides the terminal cursor while it asks and draws its own, so the view decides where the cursor sits. The library writes its cursor movement, erasure, and the sequences that hide and show the cursor through `out.draw` with a bare view of its own, which nothing overrides. Before each redraw it returns the cursor to column 0, moves up the rows the previous frame's `out.draw` reported, and erases to the end of the screen, so an overridden view that takes more or fewer rows redraws in place. An active frame has no trailing newline, so its hidden terminal cursor stays on the last drawn row. The answered or cancelled line replaces the frame, shows the cursor again, and stays in the scrollback.

## Leaving a question

A question asks only when interaction is on, and it enters raw mode through `host.stdin.setRawMode`, which a terminal stream has. An embedding host that reports a terminal on stdin supplies a stream with that method, and a question that finds none fails as a defect, exit 1. Before it enters raw mode, it adds a synchronous listener to `context.signal` that leaves raw mode, so the terminal is cooked again at the moment of the abort. Every path out of a question leaves raw mode, pauses `host.stdin` and removes the listeners the question added, so stdin never holds the process open after the run, and draws the last line, answered or cancelled, with the sequence that shows the cursor, after every frame the question queued.

- **Ctrl-C** calls `context.cancel()`, then the question draws its cancelled line and throws `context.signal.reason`. Core reads the throw as a silent cancellation, and the run resolves 130.
- **End of input** while a question is active, stdin closing or Ctrl-D with nothing typed, takes the same path. It neither accepts a default nor submits an empty answer.
- **A run signal that aborts** while a question waits, from a caller or the signals owner, ends the question the same way, with the code the first cause fixed.
- **A signal already aborted** at the call ends the question before it draws anything.

A question waits as long as the operator takes. The library adds no timeout and no guard against two questions at once.

## Package

- The root export holds `text`, `secret`, `confirm`, `select`, `InteractionUnavailableError`, and the settings types. `@loomcli/prompts/views` exports `questionFrame`, `answeredLine`, and `cancelledLine` and their data types. The package has no plugin.
- `@loomcli/core` is a peer dependency. The package reads the action context, `DeclarationError`, `FatalError`, `missingInputError`, the Standard Schema types, `glyph`, and `view` from core, and adds no runtime dependency of its own.
- The package joins the synchronized release set the way `@loomcli/validators` did under [ADR-0037](decisions/0037-validators-ship-in-their-own-package-as-standard-schema-values.md): it lands with `private: true`, the maintainer publishes a `0.0.0` placeholder and binds the trusted publisher, an ordinary pull request removes `private`, and the next release cut publishes it. The root `build` script, `scripts/clean.mjs`, the packed-consumer check, and the runtime consumers list it.

## Acceptance

- **PTY.** Through the `zpty` driver, a fixture application asks each kind and the screen reads the frames above, with color and with `NO_COLOR`: the hint, typing over it, clearing back to it, Enter on the hint, Enter with no prefill submitting the empty string, a rejected answer whose issue stays until the next Enter, then an accepted one, the answered line left in scrollback, secret's frame unchanged after typing, confirm's three hints, `yes` and `NO` accepted and `x` answered with `Type y or n.`, and select's start on a matching prefill, its stop at both ends, a window of seven with both marker lines, and its key help.
- **Linking.** At a terminal, a supplied linked option prefills an asked question with the raw value from argv, the environment, and the configuration source alike, and a question with `skipIfSupplied` draws nothing and returns the validated value without calling the question's validator. Prefill precedence holds across all four rungs, an accepted prefill passes through the question's validator, an omitted Boolean does not prefill confirm, and a supplied secret asks empty without `skipIfSupplied`.
- **Interaction off.** Under `--no-input` with stdin and stderr terminals, with piped stdin, with stderr redirected, under `app.invoke`, under an action's `invoke`, and as an MCP tool call: a supplied linked option returns its validated value, an unsupplied one fails with the missing-input sentence and exit 2, by declared name under an invocation by name, and an unlinked question fails with `InteractionUnavailableError` and exit 1. A piped stdout with stdin and stderr terminals still asks, and stdout holds no question byte.
- **Leaving.** Ctrl-C at each kind exits 130 and leaves the terminal in cooked mode with the cursor shown, with and without an installed signals owner, and stdin closing and Ctrl-D on empty input at a question do the same. A caller's abort while a question waits resolves 130 and restores the terminal. After every path, the process exits once the run resolves, with nothing left reading stdin.
- **Typeahead.** `8080` Enter `yes` Enter written in one chunk answers a text question and the confirm after it, and a view override that draws more rows than the default redraws in place.
- **Faults.** Each row of [Linking an option](#linking-an-option) and each malformed setting throws its `DeclarationError` at the call, and a run reports it with exit 1.
- **Types.** `option` rejects a key the action's `options` lacks, secret rejects `default`, a select's `default` must be a choice, and the return types of each kind, linked and unlinked, match [Calling a question](#calling-a-question).
- **Views.** An application's override of each view changes its frame, and a secret's typed text never reaches a view.

## Not in this release

- A Command that declares it needs a terminal.
- Multiple-choice selection, autocompletion, an editor question, and cursor movement inside a typed answer.
- A default, a prefill, or "Enter keeps the current value" for secret.
- Redrawing when the terminal is resized while a question asks.
