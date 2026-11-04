---
description: The @loomcli/prompts reference. The five question kinds an action asks, text, secret, confirm, select, and multiselect, the choices a select or multiselect offers and how it searches them or reads them from a source, how a question links a local option or an argument, how the run's interaction decision resolves it, the keys and sequences the reader reads, how a paste reads, how a typed line is edited, what each kind draws and accepts and how its frame fits one row, and how a question leaves the terminal, and the progress lines an action shows around its work, their style plugin, their view, and their plain lines off a terminal.
---

# Prompts reference

`@loomcli/prompts` is a library an action imports to ask an operator a question at a terminal and to show [progress](#progress) around its work. Questions and progress lines need no plugin: an application installs nothing to use them, and the library registers no option. The one plugin it ships, `progressStyle()`, is optional and sets how progress lines look across the application. [ADR-0082](../decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) records the questions, [ADR-0136](../decisions/0136-a-multiple-string-option-or-a-string-argument-may-be-required-only-when-input-is-not-interactive-and-a-question-may-link-an-argument.md) a question's link to an argument, [ADR-0138](../decisions/0138-select-and-multiselect-questions-offer-choice-objects-may-search-them-or-read-them-from-a-source-and-draw-choice-rows.md) choice objects, multiselect, and search, and [ADR-0091](../decisions/0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) the regions both draw in and the progress lines. Core supplies what a question reads, the run's [interaction decision](../core/interaction.md), the [`supplied`](../core/interaction.md) record, [`out.region`](../core/output.md#live-region), and `cancel()`, and the library owns the key reader, the frames, and the progress timer.

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
// A linked select or multiselect answers its input's value; an unlinked one, its choices' values.
type ChoiceAnswer<Options, Key, Args, Argument, Output> = [Argument] extends [never]
  ? [Key] extends [never]
    ? Output
    : Options[Key & keyof Options]
  : Args[Argument & keyof Args];

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
  const Entry extends ChoiceEntry = ChoiceEntry,
  const Key extends LinkKey<Options> = never,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: ActionContext<Args, Options, unknown>,
  settings: SelectSettings<Key, Entry, Argument>,
): Promise<ChoiceAnswer<Options, Key, Args, Argument, ChoiceValue<Entry>>>;
function multiselect<
  Options,
  const Entry extends ChoiceEntry = ChoiceEntry,
  const Key extends LinkKey<Options> = never,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: ActionContext<Args, Options, unknown>,
  settings: MultiselectSettings<Key, Entry, Argument>,
): Promise<ChoiceAnswer<Options, Key, Args, Argument, ChoiceValue<Entry>[]>>;
```

The type tests prove the generic plumbing against the action context's real parameters; the results above are what it must produce. `Args` and `Argument` follow every type parameter a kind already had, so a call that passes type arguments explicitly keeps compiling. Select's second type parameter is the type of one entry of its list, a [choice or a separator](#choices), and `ChoiceValue` reads the answer's values from it. A string is its own entry and value, so `select<Options, 'sqlite' | 'postgres'>` keeps compiling and answers that union, and `select<Options, 'sqlite' | 'postgres', 'backend'>` keeps compiling and answers the option's value type, under [Resolving a question](#resolving-a-question).

| Setting          | Kinds                  | Meaning                                                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `message`        | All                    | The question's title, a marked string of one line.                                          |
| `option`         | All                    | The key of the local option the question links.                                             |
| `argument`       | All but confirm        | The name of the routed Command's argument the question links.                               |
| `skipIfSupplied` | All                    | `true` skips the question at a terminal when the linked input was supplied. Needs `option` or `argument`. |
| `default`        | All but secret         | The question's own default: a string for text, a Boolean for confirm, a choice's value for select, and a list of choice values for multiselect. |
| `validate`       | Text, secret           | A Standard Schema value that checks a typed answer and may transform it.                    |
| `choices`        | Select, multiselect    | A list of [choices](#choices) and separators, with at least one choice that is not disabled. |
| `search`         | Select, multiselect    | `true` filters `choices` as the operator types, under [Searching](#searching).              |
| `source`         | Select, multiselect    | A function that returns the choices for a search term, under [Searching](#searching). Never beside `choices`. |
| `min`            | Multiselect            | The fewest choices Enter submits, 0 when omitted.                                           |
| `max`            | Multiselect            | The most choices the operator can select, no limit when omitted.                            |

Question validation receives the captured Loom run context through the Standard Schema options channel, with `phase: 'question'`. A question linked to an option identifies its local option, a question linked to an argument identifies its argument with `kind: 'argument'`, and an unlinked question identifies its title with `kind: 'question'`. The host, route, passthrough tail, and supplied values come from the same run, with separate copies for each validator call. Shipped validators such as `path()` and `dateTime()` use the host's working directory and time zone. A skipped question never calls its question validator.

Secret declares no `default`, and its types reject one.

The types reject `choices` beside `source`, `search` beside `source`, which always searches, `min` and `max` on select, a `default` that is not one of the choices' values, a choice object without a `label` whose `value` is not a string, and, on a linked question, a choice or a `source` result whose `value` is not a string.

The return type is the question's own output: the validator's output for text and secret, or `string` without one, `boolean` for confirm, the union of the choices' values for an unlinked select, and an array of that union for an unlinked multiselect. A linked text, secret, or confirm question can also return the linked input's validated value, so `Answer` adds the option's or the argument's action value, `undefined` included, because a validator may return `undefined` for a supplied value. The union collapses when the two agree, as `port()` on both the option and the question does. A linked select or multiselect returns the linked input's validated value whether it asks or not, under [Resolving a question](#resolving-a-question), so `ChoiceAnswer` is the option's or the argument's action value alone: `string | undefined` for an option with no validator, the validator's output type for one with a validator, and an array of it for a multiple option or a variadic argument.

## Choices

```ts
interface ChoiceDetails {
  readonly description?: string;
  readonly disabled?: boolean | string; // a string is the reason
}
// The string values among Value, and every string when Value is unknown.
type StringValue<Value> = unknown extends Value ? string : Extract<Value, string>;
type ChoiceObject<Value = unknown> =
  | (ChoiceDetails & { readonly value: StringValue<Value>; readonly label?: string })
  | (ChoiceDetails & { readonly value: Value; readonly label: string });
interface Separator {
  readonly separator: string;
}
type Choice<Value = unknown> = StringValue<Value> | ChoiceObject<Value>;
type ChoiceEntry<Value = unknown> = Choice<Value> | Separator;
type ChoiceValue<Entry> = Entry extends Separator
  ? never
  : Entry extends string
    ? Entry
    : Entry extends { readonly value: infer Value }
      ? Value
      : never;
type ChoiceSource<Value = unknown> = (
  term: string,
  options: { readonly signal: AbortSignal },
) => readonly ChoiceEntry<Value>[] | PromiseLike<readonly ChoiceEntry<Value>[]>;

// Not exported: the list a question reads, and the string values a linked question takes.
type ChoiceList<Entry> =
  | { readonly choices: readonly Entry[]; readonly search?: boolean; readonly source?: never }
  | {
      readonly source: (
        term: string,
        options: { readonly signal: AbortSignal },
      ) => readonly Entry[] | PromiseLike<readonly Entry[]>;
      readonly choices?: never;
      readonly search?: never;
    };
type LinkedChoices<Key, Argument> = [Key | Argument] extends [never]
  ? unknown
  : { readonly choices?: readonly ChoiceEntry<string>[]; readonly source?: ChoiceSource<string> };

type SelectSettings<Key = never, Entry extends ChoiceEntry = ChoiceEntry, Argument = never> =
  Link<Key, Argument> &
    ChoiceList<Entry> &
    LinkedChoices<Key, Argument> & {
      readonly message: string;
      readonly default?: NoInfer<ChoiceValue<Entry>>;
    };
type MultiselectSettings<Key = never, Entry extends ChoiceEntry = ChoiceEntry, Argument = never> =
  Link<Key, Argument> &
    ChoiceList<Entry> &
    LinkedChoices<Key, Argument> & {
      readonly message: string;
      readonly default?: readonly NoInfer<ChoiceValue<Entry>>[];
      readonly min?: number;
      readonly max?: number;
    };
```

`Link` is the existing union that admits `option`, `argument`, or neither, with `skipIfSupplied` beside a link. `ChoiceList` admits `choices` or `source`, never both, so `choices` is optional on `SelectSettings` and `MultiselectSettings`, and code that reads `settings.choices` from either type checks that it is present, a breaking change for `SelectSettings` that ADR-0138 records. A choice object has a `label` that is optional exactly when its `value` is a string: `ChoiceObject<string>` admits `{ value: 'a' }`, and `ChoiceObject<number>` requires `label`. `Choice` is a string or a choice object, and a separator is not a choice, so the list's entry type, which admits both, is `ChoiceEntry`.

```ts
const engine = await select(context, {
  message: 'Storage backend',
  choices: [
    'sqlite',
    { value: 'postgres', label: 'PostgreSQL', description: 'A server you run or rent.' },
    { separator: 'Hosted' },
    { value: 'neon', label: 'Neon', disabled: 'needs an account' },
  ],
}); // 'sqlite' | 'postgres' | 'neon'
const features = await multiselect(context, {
  message: 'Features',
  choices: [{ value: Feature.Backups, label: 'Backups' }, { value: Feature.Telemetry, label: 'Telemetry' }],
  min: 1,
}); // Feature[]
```

Select and multiselect offer the same choices, so one list serves either kind.

- **A string.** A string choice is shorthand for a choice whose value and label are that string.
- **A choice object.** `value` is what the question returns, `label` is what the frame and the answered line draw, `description` draws under the list while the choice is highlighted, and `disabled` draws the choice dimmed, with its reason, where navigation never stops. A choice is disabled when `disabled` is `true` or a string, and a nonempty string is its reason. The types require `label` unless `value` is a string, and a string `value` without a `label` is its own label.
- **A separator.** `{ separator: 'Hosted' }` draws a dimmed row of its text between choices. It is never highlighted, selected, or returned, and an empty string draws an empty row. The entry is a plain object rather than a class instance, so a `source` returns it as data and a list needs no import.
- **Any value.** An unlinked question's `value` may be any type, and the answer is the chosen choice's `value` itself. A linked question's values are strings, because a supplied value is a string: with `option` or `argument`, the types reject a choice whose `value` is not a string.
- **Matching a value.** An unlinked question's `default` matches the choice whose `value` is `Object.is` the default, or, for multiselect, each element of the default. A linked question's prefill, the raw supplied value, its `default`, or its input's declared default, matches the choice whose `value` is the same string. A value that matches no choice matches nothing, and two choices with one value match the first. A prefill list that names one value twice, such as `--feature a --feature a`, matches its choice once, and the choice counts once toward `max`.
- **Plain text.** A label, a description, a reason, and a separator's text are plain text, because a `source` often builds them from data. They are not marked strings, so they carry no styles, and an override of `questionFrame` styles them. The default views draw each as [`escapeControlCharacters`](../core/styles.md#strings-and-composition) writes it, in the frame and in the answered line, as they draw a typed line, so a control character or a bidirectional control in a label shows as its escape, such as `\u001b`, and never styles, moves, or reorders the frame. Fitting measures that escaped form. A static search matches the raw label, before escaping.
- **The answer's types.** Select infers its entry type from `choices` or from the `source` result under `const` inference, and `ChoiceValue` reads the values from it: a string adds its literal, a choice object adds its `value`'s type, and a separator adds nothing. So the first call above answers `'sqlite' | 'postgres' | 'neon'`, and the choices `[{ value: 1, label: 'One' }, { value: { id: 2 }, label: 'Two' }]` answer `1 | { readonly id: 2 }`. A `source` answers the values its result declares, so one typed `ChoiceSource<Repository>` answers `Repository`. A linked question answers its input's value type instead, under [Resolving a question](#resolving-a-question).

## Linking an input

A question links at most one input of the routed Command: `option` names a local option, and `argument` names an argument. The types admit the keys of the action's `options` for `option` and of its `args` for `argument`, and they reject `option` and `argument` together, `argument` on confirm, and `skipIfSupplied` without either. A linked argument works as a linked option does throughout [Resolving a question](#resolving-a-question): its raw supplied value prefills the question, and its validated value answers a skipped one. A multiselect links a list, a multiple string option or a variadic string argument, whose raw tokens preselect the choices they match and whose validated list answers a skipped question. A linked select or multiselect that asks passes each chosen value through its input's own validator, so its answer is that input's validated value either way.

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
- **A list of string values.** A multiselect question links a multiple string option or a variadic string argument, never an option or argument that takes one value and never a content or counted option or a content argument. The sentence names the input, `The question "Features" links option "feature", which is not a multiple string option.` or `The question "Files" links argument "file", which is not a variadic string argument.`, and both read the correction `Link a multiple string option or a variadic string argument.`
- **A Boolean.** A confirm question links a Boolean option and no other.
- **Choices.** A select or multiselect question with `choices` can be answered, which a computed list may fail before the question resolves. It offers at least one choice that is not disabled: `The select question "Storage backend" has no choice that is not disabled.`, or `The multiselect question "Features" has no choice that is not disabled.`, each corrected by `Supply at least one choice that is not disabled.` A multiselect's `min` is at most its `max`: `The multiselect question "Features" has min 3 above max 2.`, corrected by `Set min at or below max.` And it offers at least `min` choices that are not disabled: `The multiselect question "Features" has min 3 and 2 choices that are not disabled.`, corrected by `Supply at least min choices that are not disabled.` A question with `source` is checked for its `min` and `max` alone, because its choices arrive as the operator types.

The rule's explanation reads `A question asks in one line of prose and links at most one local option or argument of the routed Command, of the kind the question accepts, and a select or multiselect question offers enough choices that are not disabled to be answered.` The types reject the other malformed settings, such as `skipIfSupplied` without a link, `option` beside `argument`, a `default` that is not one of the choices' values, a `default` on secret, a choice whose `value` is not a string on a linked question, `choices` beside `source`, and a `validate` that is not a Standard Schema value, so they get no rule. The root Command reads as `the root Command`.

## Resolving a question

A question first reads the run's interaction decision, `context.interactive`, and the linked input's raw value: `context.supplied.options[option]` for an option and `context.supplied.args[argument]` for an argument, each `undefined` when the input was omitted or left to its declared default, and `[]` for a multiple option or a variadic argument. A multiselect's linked input is supplied when its raw list is not empty, and an empty raw list is neither a supplied value nor a prefill.

| Linked input             | Interaction on, `skipIfSupplied` | Interaction on, without it | Interaction off             |
| ------------------------ | -------------------------------- | -------------------------- | --------------------------- |
| Supplied                 | Skipped                          | Asked, prefilled           | Skipped                     |
| Not supplied             | Asked                            | Asked                      | Missing-input error, exit 2 |
| No link                  | Asked                            | Asked                      | `InteractionUnavailableError`, exit 1 |

- **Skipped.** The question draws nothing and returns the linked input's validated value, `context.options[option]` or `context.args[argument]`. The question's own validator does not run.
- **Asked.** The prefill is the first that applies: the raw supplied value, the question's `default`, the linked input's declared default, or none. An empty raw list, which an omitted multiple option or variadic argument reads, does not apply, so the order moves on to the question's `default` and then the declared default, and either preselects at a multiselect whose input was omitted. A Boolean option's implicit absent value is never a default. A select highlights the choice its prefill matches, under [Matching a value](#choices), and the first choice that is not disabled when the prefill matches none or matches a disabled one. A multiselect's prefill is a list, and it starts with each choice the list matches selected, once each, in the list's order, except a disabled choice and any match past `max`. Under a `source`, the prefill matches the result of the first call, under [Searching](#searching). Secret takes no prefill: asked, it starts empty even when its input was supplied, and only `skipIfSupplied` or interaction off answers it from the input. An accepted prefill is a submitted answer and passes through `validate` as a typed one does, or through the linked input's validator at a select or multiselect.
- **A supplied value that selects nothing.** A raw supplied value that a select does not highlight or a multiselect does not select, because it matches no choice, after a `source`'s lookup under [Searching](#searching), matches a disabled choice, or falls past `max`, is named in the issue the first frame after the prefill resolves draws. A value that matches no choice or a disabled one reads `Cannot select "mysql". Choose from the list.`, or `Cannot select "foo", "neon". Choose from the list.` for several. A value that matches a choice the multiselect could select, but falls past `max`, is in the list, so its sentence names the limit and the way past it instead: `Cannot select "neon": at most 3 can be selected. Deselect a choice to select it.`, or `Cannot select "neon", "redis": at most 3 can be selected. Deselect a choice to select one.` for several, with `max` in place of 3. When both apply, the issue holds both sentences, the list's first. Each such value appears once, in supplied order, quoted and drawn as `escapeControlCharacters` writes it. So an operator who supplied a value and was asked anyway sees what the question could not take before an Enter answers without it. A `default` that selects nothing is the author's, and draws no issue.
- **The linked input's validator.** Select and multiselect take no `validate` of their own, and no validator sees a multiselect's whole list. An unlinked one returns the chosen values themselves. A linked one that asks calls core's `validateLinkedValue(context, { message, option }, value)`, or `{ message, argument }` for an argument, once for each chosen value, as its raw string, under [Validation](../core/validation.md#validation-context). So the linked input's own validator checks one value per call, as [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md) validates a collected input, with the options `questionValidationOptions` builds for the same link: `phase: 'question'` and the input's identity, as every linked question's validator reads. Their `supplied` is a copy of the run's supplied inputs, so for the linked input it holds the raw value the operator supplied, or `undefined` or `[]` when it was omitted, never the selection: a validator there cannot read the other chosen values, as an invocation's validator reads the whole raw list. An input that declares no validator passes each value unchanged, and the result types each output as one element of the input's value, `LinkedValue`, so the answer needs no type assertion. A context core did not build, such as an `actionContext` whose `graph` is not one `inspect()` returned, throws rather than pass a value unvalidated, under the same section. A multiselect validates its values in selection order and stops at the first rejection. A rejection keeps asking, with the term, the highlight, and the selection kept, and draws the first issue's message, after the rejected choice's label and `: ` at a multiselect: `Telemetry: Not available on this plan.` The answer is the validators' outputs, in selection order at a multiselect.
- **Skipped, for a list.** A skipped select or multiselect returns the linked input's validated value, which for a multiple option or a variadic argument is the list each value of which passed the same validator, so asked or skipped, a linked question's answer is its input's value, the type `ChoiceAnswer` names. A multiselect's `min` and `max` bound what the operator selects at a terminal, never a skipped question's list.
- **Missing input.** The question throws core's ordinary `InputError` for its input, which [`missingInputError`](../core/interaction.md) builds: `missingInputError(context, option)` for an option, `Option "--database-url" is required when input is not interactive. Supply a value.`, named by declared name under an invocation by name, and `missingInputError(context, { argument })` for an argument, `Argument "url" requires a value when input is not interactive. Supply a value for "url".` A multiselect's multiple option reads `Supply at least one value.`, and its variadic argument `requires at least one value`, as core's own sentences for them do. For argv, a confirm's Boolean option reads `Supply "--install" or "--no-install".` in place of `Supply a value.`, naming the spellings its polarity accepts. Under an invocation by name, the fix remains `Supply a value.` A default never answers here. An input that declares `required: 'non-interactive'` never reaches this row, because core reports it before the action.
- **Interaction unavailable.** `InteractionUnavailableError` extends `FatalError` with the failure code `interaction-unavailable` and exit 1. Its sentence names the question and the routed Command: `The question "Install the background service?" needs an interactive terminal, and this run is not interactive. Run "mimir setup" at a terminal.`

A [`source`](#searching) is never called when the question does not ask, so a skipped question, a missing input, and an unavailable interaction call no author code. An invocation by name, and so every MCP tool call, is not interactive, so a select or multiselect resolves there by the last column, as every kind does.

## Reading keys

Each kind reads keys from stdin in raw mode, through one reader that every question of the run shares. The reader turns the bytes a terminal sends into keys, in the encodings xterm-compatible terminals, rxvt, and the Linux console send, so the keys an operator presses in a shell work in a question. A read is one chunk of bytes the reader receives from stdin. In the table, CSI is `\u001b[` and SS3 is `\u001bO`.

| Key                         | Bytes the reader reads as the key                                               |
| --------------------------- | ------------------------------------------------------------------------------- |
| Enter                       | `\r`, `\n`, or `\r\n`, which reads as one Enter                                 |
| Backspace                   | `\u007f`, and `\b`, which is also Ctrl-H                                        |
| Delete                      | CSI `3~`                                                                        |
| Tab                         | `\t`, which is also Ctrl-I                                                      |
| Escape                      | A lone ESC, `\u001b`, under [A lone Escape](#a-lone-escape), which is what terminals send; also CSI `27u`, the form the kitty keyboard protocol sends once an application enables it, which Loom never does |
| Up, Down, Right, Left       | CSI or SS3 followed by `A`, `B`, `C`, or `D`                                    |
| Home                        | CSI `H`, SS3 `H`, CSI `1~`, and CSI `7~`                                        |
| End                         | CSI `F`, SS3 `F`, CSI `4~`, and CSI `8~`                                        |
| Ctrl-Right, Ctrl-Left       | CSI `1;5C` and CSI `1;5D`, and SS3 `c` and SS3 `d`, as rxvt sends them          |
| Alt-Right, Alt-Left         | CSI `1;3C` and CSI `1;3D`, and Right or Left with an [Alt prefix](#sequences), `\u001b\u001b[C` and `\u001b\u001b[D`, as rxvt sends them |
| Alt-Backspace               | ESC followed by `\u007f` or `\b`                                                |
| A paste                     | CSI `200~`, the pasted text, and CSI `201~`, under [Pasting](#pasting)          |
| Ctrl and a letter           | The letter's code with its upper three bits cleared, `\u0001` for Ctrl-A through `\u001a` for Ctrl-Z, except the bytes a row above names |
| Alt and a character         | ESC followed by a printable character other than `[`, `O`, `]`, `P`, `_`, and `^`, as a terminal that sends Meta as ESC writes it |
| A printable character       | Each code point from U+0020, Space, upward, other than U+007F and the C1 controls U+0080 through U+009F |

- **Interrupt keys first.** Core reads Ctrl-C, Ctrl-\\, and Ctrl-Z out of each read before the reader sees it, under [Leaving a question](#leaving-a-question), so no kind reads them as keys.
- **A key a kind does not list is ignored.** Enter submits, and the submitted answer, typed or an accepted prefill, passes through `validate` when the question has one. A rejected answer keeps what was typed and shows the first issue's message on the line below until the next Enter, which either accepts an answer or replaces the issue. Keys that arrive after an Enter, typed ahead or pasted without bracketed paste, stay queued for the run's next question, except after a secret, under [Pasting](#pasting), and keys still queued when the action ends are discarded.
- **Escape cancels nothing.** Escape never cancels a question and never ends the run, so an operator who presses it out of habit from an editor loses no answer. Ctrl-C is the one key that cancels. Escape's one meaning is to clear the search term of a select or multiselect that [searches](#searching), and every other kind and state ignores it.

### Sequences

An ESC starts what the byte after it says:

| Byte after the ESC                       | What the ESC starts                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `[`                                      | A CSI sequence                                                                     |
| `O`                                      | An SS3 sequence                                                                    |
| `]`, `P`, `_`, or `^`                    | An OSC, DCS, APC, or PM string                                                     |
| ESC that starts a CSI or SS3 sequence    | An Alt prefix: the sequence is its key with Alt                                    |
| Any other ESC                            | Nothing: the first ESC is the Escape key, and the second starts what its own next byte says |
| `\u007f` or `\b`                         | Alt-Backspace                                                                      |
| Another printable character              | Alt and that character                                                             |
| Any other control byte                   | Nothing: the ESC is the Escape key, and the byte reads on its own                  |
| None, because the ESC ends the read      | What the next read says, under [A lone Escape](#a-lone-escape)                     |

- **The CSI grammar.** A CSI sequence is CSI, then any run of parameter bytes, 0x30 through 0x3F (`0` through `9`, `:`, `;`, `<`, `=`, `>`, and `?`), and intermediate bytes, 0x20 through 0x2F (Space and `!` through `/`), in any order, then one final byte, 0x40 through 0x7E (`@` through `~`). The sequence is every byte from the ESC through the final byte.
- **The SS3 grammar.** An SS3 sequence is SS3, then any run of parameter and intermediate bytes in any order, then one final byte, in the byte ranges and with the unlisted-sequence rule a CSI sequence uses, so a modified function key an older xterm sends, such as SS3 `2P` for Shift-F1, reads as one key.
- **The Linux console's function keys.** CSI followed directly by `[` and then one byte from 0x40 through 0x7E is one key, as the Linux console sends F1 through F5, CSI `[A` through CSI `[E`. No kind reads it, so it is ignored.
- **Strings.** An OSC, DCS, APC, or PM string is its introducer, then any bytes, up to BEL, `\u0007`, or ST, `\u001b\\`, whichever comes first, for every kind of string. The reader reads it whole and ignores it, so a reply that arrives after core's [background query](../core/background.md) stopped reading, such as an OSC 11 color report later than the query's deadline, never types into a question.
- **Unlisted sequences.** A complete CSI or SS3 sequence the key table does not list, such as Shift-Left, CSI `1;2D`, or F5, CSI `15~`, is read whole and ignored, so its bytes never reach a typed line. An arrow with a modifier parameter other than 3 and 5 is such a sequence, and so is a sequence whose parameter bytes follow its intermediate bytes.
- **An Alt prefix.** An ESC directly before the ESC of a CSI or SS3 sequence makes the sequence its key with Alt, as rxvt and a terminal that sends Meta as ESC write Alt with a cursor key. Right or Left with an Alt prefix is Alt-Right or Alt-Left. Every other key with an Alt prefix, such as Alt-Up or Alt-Delete, is read whole and ignored.
- **A sequence spans reads.** Once a CSI sequence, an SS3 sequence, or a string has started, the reader keeps its place in it across reads, with no timer, until the sequence ends, as the reader already keeps an unfinished CSI sequence. So a sequence a slow link splits across reads reads as one key, and the trailing bytes of a sequence never become text.
- **A malformed sequence.** A byte that cannot belong to the sequence ends it. In a CSI or SS3 sequence that is any byte outside 0x20 through 0x7E: a control byte, ESC included, DEL, or a code point from U+0080 upward. In a string it is a C0 control byte other than BEL and ESC, DEL, or an ESC not followed by `\`. The reader drops the sequence read so far and then reads that byte normally, as if it were the first byte of a read: ESC starts a new sequence, Enter submits, Backspace deletes, and a code point from U+0080 upward is text. A terminal never sends such a byte inside a sequence, so it is the operator's own key, and it keeps its meaning. The bound is the operator's next key of that kind: a sequence left unfinished by a lost byte swallows the bytes after it until the next control key, which acts, or, in a CSI or SS3 sequence, until the next letter, whose byte is a final byte and ends the sequence with it.

### A lone Escape

The reader's 50-millisecond window decides one thing alone: whether an ESC that ends a read is the Escape key.

- **Held.** An ESC that ends a read is held, together with the ESC before it when the two could form an Alt prefix. A read that arrives within 50 milliseconds continues it under [Sequences](#sequences), so `\u001b` and then `[A` in the next read is Up. When 50 milliseconds pass with no read, each held ESC is the Escape key.
- **Only there.** An ESC with a byte after it in the same read never waits, and a sequence that has started never waits either: it spans reads under [Sequences](#sequences).
- **At a release.** A held ESC belongs to the run's keys, not to a question, so it outlives the release of stdin when a question closes, as typeahead does. The reader keeps the time it held the ESC: when the next read arrives, for the same question or a later one, an ESC held 50 milliseconds or longer is the Escape key, and one held for less continues under [Sequences](#sequences). So `x\r\u001b` that answers one question, followed 200 milliseconds later by `b\r` at the next, answers `b`, while a sequence a slow link splits across the release still reads as one key.
- **Not a limit.** The window is the reader's own timing for telling one key from another, not a limit on the operator: its timer runs only while an ESC is held, is unref'd, and is cleared when the reader releases stdin.

## Pasting

- **Bracketed paste.** While the reader holds stdin in raw mode, it puts the terminal in bracketed paste mode, so a terminal that supports the mode wraps each paste in CSI `200~` and CSI `201~` and the reader tells pasted text from typed keys. The library writes CSI `?2004h` with the sequence that hides the cursor when the reader enters raw mode, and CSI `?2004l` on every path that leaves raw mode, under [Leaving a question](#leaving-a-question), so the terminal never keeps the mode after a question.
- **One key.** The bytes between the two markers are one paste key, which spans reads as a sequence does. Inside it the reader looks for CSI `201~` alone: an ESC that does not start it is dropped, and the bytes after that ESC are pasted text.
- **What a paste inserts.** Text, secret, and confirm insert a paste at the cursor as one edit, after three changes to its text, and so does a select or multiselect that searches, into its search term. It ends at its first line break, `\r`, `\n`, or `\r\n`, and that line break and everything after it are discarded, never queued for a later question, so a paste never submits and a trailing line break adds nothing. Each tab becomes one space, because the field has no tab stops and the Tab key would copy the question hint. Every other control character, C0, DEL, and C1, is dropped. A select or multiselect that does not search ignores a paste.
- **Without bracketed paste.** A terminal that ignores the mode sends a paste as plain bytes, and the reader reads them as typed keys: printable characters insert, a line break is Enter, which submits, a tab is the Tab key, and the keys after that Enter stay queued for the run's next question.
- **After a secret.** When a secret's answer is accepted, every key still queued from the read that held its Enter is discarded, a sequence or a paste that read started included. One still open when the answer is accepted keeps its place, under [A sequence spans reads](#sequences), and yields no key when it ends in a later read, so its trailing bytes never become text and the rest of a multi-line paste never lands in a question that echoes it. The reader cannot tell a typed key from a pasted one there, so the discard reaches keys typed ahead in that read too. A rejected secret discards nothing, so its next answer may follow in the same read. Text, confirm, select, and multiselect keep the keys queued after their Enter, because what the operator pasted or typed into them is already on the screen, and an operator may type or paste the next answer ahead.

## Editing a typed line

Text, secret, and confirm hold a typed line: the text typed so far and a cursor. A select or multiselect that searches holds its search term as a typed line, with the exceptions [Searching](#searching) lists. The cursor is a grapheme index, from 0, before the first grapheme, to the line's grapheme count, after the last. A grapheme is an extended grapheme cluster, as `Intl.Segmenter` segments text with `granularity: 'grapheme'`, so an emoji or a letter with a combining accent moves and deletes as one.

| Keys                                   | Effect on the typed line                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| A printable character                  | Inserts the character at the cursor                                          |
| A paste                                | Inserts the paste's first line at the cursor, under [Pasting](#pasting)      |
| Left, Ctrl-B                           | Moves the cursor one grapheme left                                           |
| Right, Ctrl-F                          | Moves the cursor one grapheme right; on an empty text line, copies the question hint |
| Alt-B, Ctrl-Left, Alt-Left             | Moves the cursor to the start of the letter-or-number word before it         |
| Alt-F, Ctrl-Right, Alt-Right           | Moves the cursor to the end of the letter-or-number word after it            |
| Home, Ctrl-A                           | Moves the cursor to the start of the line                                    |
| End, Ctrl-E                            | Moves the cursor to the end of the line                                      |
| Backspace                              | Deletes the grapheme before the cursor                                       |
| Delete                                 | Deletes the grapheme at the cursor                                           |
| Ctrl-D                                 | On an empty line, ends input; otherwise, as Delete                           |
| Ctrl-W                                 | Deletes from the start of the whitespace word before the cursor to the cursor |
| Alt-Backspace                          | Deletes from the start of the letter-or-number word before the cursor to the cursor |
| Ctrl-U                                 | Deletes from the start of the line to the cursor                             |
| Ctrl-K                                 | Deletes from the cursor to the end of the line                               |
| Tab                                    | In text, copies the question hint into an empty line; otherwise, nothing     |
| Enter                                  | Submits the line                                                             |

- **Bounds.** A move or a deletion with nothing in its direction does nothing: Left and Backspace at 0, and Right, Delete, and Ctrl-K at the end. Right on an empty text line that shows a question hint copies the hint, as Tab does, and so does Ctrl-F, because it is the same key, as fish accepts an autosuggestion with Right and Ctrl-F alike.
- **Whitespace words.** Ctrl-W reads words as readline's `unix-word-rubout` does: a whitespace grapheme is one whose first code point has the Unicode `White_Space` property, and a whitespace word is a run of graphemes that are not whitespace. The start of the whitespace word before the cursor is found by moving left over whitespace graphemes and then over the others, and stops at 0.
- **Letter-or-number words.** Alt-Backspace, Alt-B, Alt-F, Ctrl-Left, Ctrl-Right, Alt-Left, and Alt-Right read words as readline's `backward-kill-word`, `backward-word`, and `forward-word` do: a word grapheme is one whose first code point is a letter or a number, Unicode general category `L` or `N`, and every other grapheme, whitespace, punctuation, and symbols, separates words. The start of the word before the cursor is found by moving left over separators and then over word graphemes, and stops at 0. The end of the word after the cursor is found by moving right over separators and then over word graphemes, and stops at the end.
- **The two side by side.** With the cursor at the end of `connect postgres://db.local:5432/app`, Ctrl-W leaves `connect `, Alt-Backspace leaves `connect postgres://db.local:5432/`, and a second Alt-Backspace leaves `connect postgres://db.local:`.
- **Where the cursor lands.** Every edit replaces one range of the line, the cursor's position for an insertion, with new text, which is empty for a deletion. Afterward the cursor sits at the first grapheme boundary of the new line at or after the end of the new text, so a combining mark typed after a letter joins it, and the cursor stays after the combined grapheme.
- **What a line holds.** A line holds the printable characters the key table reads and the text a paste inserts, so no C0 control, DEL, or C1 control ever enters it or the answer: no key types one, and a C1 code point only arrives from a terminal sending 8-bit controls, which Loom never enables. The bidirectional controls and marks, U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, and U+061C, and the separators U+2028 and U+2029 are text: they enter the line and the answer as typed or pasted, because a right-to-left input method types the marks, the answer is the text the operator gave, and the question's validator may reject them. The default view draws a grapheme that holds one of them as [`escapeControlCharacters`](../core/styles.md#strings-and-composition) writes it, such as `\u200f`, so none reorders or breaks the frame, and the frame's fitting measures that drawn form.
- **Nothing else.** The line keeps no history, so Up and Down do nothing in it, beyond moving a search's highlight, and it has no kill ring, so Ctrl-Y yanks nothing. Ctrl-T, Ctrl-L, undo, and a vi mode are not keys of a typed line.

## The kinds

- **Text.** Edits a typed line. The prefill is its question hint: with an empty line, the question hint draws dimmed and Enter accepts it. The first character typed replaces the question hint, and a line emptied again shows it again. Tab, or Right or Ctrl-F on the empty line, copies the question hint into the line with the cursor at its end, so the operator edits the default rather than retyping it, and Enter then submits the line as edited. A question with a question hint cannot submit the empty string, so an author who needs blank as an answer omits the default. Without a prefill, Enter on an empty line submits the empty string, and the validator decides whether it is valid.
- **Secret.** Edits a typed line with every key text has but Tab, and with nothing echoed: the frame does not change while the operator types or moves the cursor, and no frame shows a question hint, a mask, the length, or the cursor's place. The typed value reaches no view. The editing keys still work on the hidden line, so an operator who knows a typo can Ctrl-U and type again, as at a shell's password prompt.
- **Confirm.** Edits a typed line. Enter accepts `y`, `yes`, `n`, and `no` in any case. Enter on an empty line accepts the prefill when there is one, and otherwise shows the issue `Type y or n.`, as any other text does. Its legend reads `[Y/n]` for a yes prefill, `[y/N]` for a no prefill, and `[y/n]` with none, and the view receives it as `hint`. The legend names the keys and is not text the line can hold, so Tab, Right, and Ctrl-F on an empty line do nothing.
- **Select.** Moves a highlight through its choices, under [Moving through choices](#moving-through-choices), and Enter selects the highlighted choice and returns its value. At most seven rows, choices and separators, show at once, fewer when stderr has fewer rows, and the window scrolls with the highlight. A dim `↑ 3 more` or `↓ 5 more` line marks the rows hidden in that direction. The highlighted choice's description draws under the list, and the last line is the key help `↑↓ move · Enter select`. When even one choice with the ordinary frame cannot fit, the frame turns compact, under [Fitting a list](#fitting-a-list). The clipping uses the view context’s `columns`, which is stderr’s width by the rule in [Width, padding, and multiline lanes](../core/styles.md#width-padding-and-multiline-lanes), because a question draws on stderr: the real width, narrowed by a smaller valid `COLUMNS`, or `COLUMNS` alone on a terminal that reports no width. Each frame reads `columns` and `rows` when it draws, so the select window’s visible count follows a resize at the next frame, and a question does not redraw by itself on a resize. The default view clips at 80 columns when `columns` is `undefined`. That 80-column fallback applies to clipping alone: the select window’s height estimate assumes no wrapping when `columns` is `undefined`. The returned value is always the choice's `value`, never a clipped label.
- **Multiselect.** Moves a highlight as select does and keeps a selection, the choices the operator has selected, in the order they were toggled on, whether they come from `choices` or a `source`. Without a search, Space toggles the highlighted choice in and out of the selection, and Tab toggles it too, so Tab is the one toggle key that works at every multiselect and an operator who learned it in a search keeps it. With a search, `search: true` or a `source`, Tab toggles and Space types into the term, under [Searching](#searching), as fzf's multi-select toggles with Tab. Enter submits the selection, the empty list included when `min` is 0, and returns the selected choices' values in the selection's order, through the linked input's validator when it links one. With fewer than `min` selected, Enter keeps asking and draws the issue `Choose at least 1.`, with `min` in place of 1. With `max` selected, a choice outside the selection cannot be toggled in: it draws dimmed, navigation still reaches it, and a toggle on it does nothing until a toggle out of the selection makes room, while the key help's count reads `3/3 selected`. Its window, markers, description, compact frame, and issues follow select's rules, and its key help reads `↑↓ move · Space toggle · Enter submit`, then the count, `· 2 selected`, or `· 2/3 selected` with a `max`. The answered line joins the selected labels with `, `, and an empty selection answers the empty string, which the default view draws as a dim `none` rather than in `highlight`, so it never reads as a choice labelled `none`.
- **A list's issue.** A select's or multiselect's issue, from `min`, an empty search, the linked input's validator, or a supplied value that selects nothing, draws on the line below the key help and stays until the next Enter, as every kind's issue does, or until the next key that changes the term or the selection, whichever comes first. A navigation key keeps it. So `No choice can be selected. Change the search.` clears as the operator changes the search.

### Moving through choices

| Keys               | Effect                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Up, Ctrl-P         | Moves the highlight to the previous choice that is not disabled                          |
| Down, Ctrl-N       | Moves the highlight to the next choice that is not disabled                              |
| Home, End, Ctrl-A, Ctrl-E | Move the highlight to the first or last choice that is not disabled, when the question does not search |
| Enter              | Selects the highlighted choice, or submits a multiselect's selection                     |
| Space              | Toggles a multiselect's highlighted choice when it does not search                       |
| Tab                | Toggles a multiselect's highlighted choice, with or without a search                     |

- **Stops, no wrap.** The highlight stops at the first and last choice that is not disabled: Up at the first and Down at the last do nothing, so a list never wraps. Ctrl-P and Ctrl-N are readline's and fzf's previous and next keys, which no typed line uses.
- **One key, Home or Ctrl-A.** The reader reads Ctrl-A as Home and Ctrl-E as End, under [Reading keys](#reading-keys), so in a list that does not search they jump as Home and End do, and in a search all four move the term's cursor, under [Editing a typed line](#editing-a-typed-line).
- **Skips.** Navigation passes over separators and disabled choices, which are never highlighted, and the window scrolls far enough to show the choice it lands on.
- **The window.** The window is the run of rows, choices and separators, that the frame shows. When the highlight is on the first choice that is not disabled, the window starts at the list's first row, and when it is on the last, the window ends at the list's last row, each as far as the window's size allows while it holds the highlight, so a separator heading before the first choice or a disabled choice after the last stays in view. Otherwise a move keeps the window where it is while the highlight stays inside it, and shifts it the fewest rows that bring the highlight in. When the question opens, the window starts at the list's first row and then shifts the fewest rows that bring the highlight in, and when the list changes under [Searching](#searching), or nothing is highlighted, it starts at the list's first row.
- **Nothing to highlight.** When the list shows no choice that is not disabled, which only a search reaches, because a list of `choices` offers one under [Linking an input](#linking-an-input), nothing is highlighted. Enter at a select then keeps asking and draws the issue `No choice can be selected. Change the search.`, and Enter at a multiselect submits its selection, which the search term never changes.
- **No paging and no select-all.** PageUp and PageDown read as unlisted sequences, because the window holds at most seven rows and a search narrows a long list. A multiselect has no key that selects every choice or inverts the selection: Ctrl-A is Home, a printable letter would type into the term, and selecting every choice is undefined under `max` and disabled choices. An author who wants an "all" answer offers a choice for it or a `default`.

## Searching

```ts
const country = await select(context, { message: 'Country', choices: countries, search: true });
const repositories = await multiselect(context, {
  message: 'Repositories',
  source: async (term, { signal }) => {
    const response = await fetch(`${api}/repositories?q=${encodeURIComponent(term)}`, { signal });
    const found: { name: string; summary: string }[] = await response.json();
    return found.map(({ name, summary }) => ({ value: name, label: name, description: summary }));
  },
});
```

A select or multiselect searches when it has `search: true` or a `source`. It holds a search term, which the operator types on the question's first line, and its list shows the choices for that term. The answer is always a choice: a typed term is never an answer, and no key submits it.

- **The term.** The term starts empty and is a [typed line](#editing-a-typed-line) with every editing key, a paste included, except these. Up, Down, Ctrl-P, and Ctrl-N move the highlight, and Enter selects or submits, under [Moving through choices](#moving-through-choices). Tab toggles a multiselect's highlighted choice and does nothing at a select, because a search has no question hint, Space types a space into the term, as any printable character does, and Right and Ctrl-F only move the cursor. Escape clears the term, and does nothing when it is already empty. Ctrl-D on an empty term ends input, under [Leaving a question](#leaving-a-question), and otherwise deletes, as on any typed line.
- **Where the term draws.** The first line is the question's asking line, `?`, the message, a dim `›`, and the term with the cursor block, fitted as a text frame's line is, under [Fitting one row](#fitting-one-row). The key help reads `↑↓ move · type to search · Enter select` at a select, and `↑↓ move · Tab toggle · Enter submit` and the count at a multiselect.
- **Static search.** With `search: true`, the list shows each choice whose label contains the term, compared after `String.prototype.toLowerCase` lowers both, in the authored order, disabled choices included. Separators drop out while the term is not empty. An empty term shows the whole list. Matching on the description, fuzzy matching, and ranking are a `source`'s to do.
- **A source.** `source(term, { signal })` returns the choices for the term, as an array or a promise of one. The question calls it with `''` when it opens, before its first frame, and again with each change to the term, and a key that leaves the term as it was, such as a cursor move, calls nothing. The list shows the result as it is returned, separators included, so the source does the matching and the order.
- **One call at a time.** A new call aborts the previous call's `signal`, and so does the end of the question, answered, cancelled, or failed. A call whose `signal` has aborted is stale: its result, or its rejection, is discarded, so a `fetch` that rejects with an `AbortError` after the operator typed on ends nothing. Loom adds no debounce timer, under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write): a source that should wait for the operator to pause waits on its own `signal`.
- **Loading.** While the latest call has not settled, the frame's `loading` is true and the list keeps the rows the last settled call returned. Before any call has settled the list has no rows, and the frame draws its loading state alone, with no `No matches` row, because nothing has been searched yet. A call that returns an array settles at once and draws no loading frame. The question draws a frame when the latest call settles.
- **Keys wait for the list.** While the latest call has not settled, a key that acts on the list, a navigation key, a toggle, or Enter, waits until it settles, and each key after it waits in turn, so every key acts on the list for the term typed before it. A test or an operator that types `uni`, Down, and Enter in one read selects the second choice the source returns for `uni`. Ctrl-C, Ctrl-\\, and Ctrl-Z never wait, because core reads them first, so a source that never settles leaves the operator Ctrl-C.
- **When the list changes.** Under `search: true`, the list changes at each key that changes the term. Under a `source`, it changes when a call settles without going stale, which a key that changes the term starts. A key that leaves the term as it was, such as a cursor move, changes nothing. When the list changes, the highlight moves to its first choice that is not disabled, or to nothing when it shows none, as fzf's does on a new query, so the best match a source returns first is the one Enter takes, and the window starts at the list's first row. The one exception is the list of a source's first call, under the next rule, where a prefill that matches decides the highlight instead.
- **The first call.** Under a `source`, the first call is the first call that settles without going stale, which is the call with `''` unless the operator changed the term before it settled. The prefill decides the highlight and a multiselect's starting selection once, under [Resolving a question](#resolving-a-question), matched against the first call's result, and where it matches it wins over the first choice that [When the list changes](#searching) would highlight. A prefill that matches nothing leaves that first choice highlighted. A `default` that result does not contain selects nothing.
- **A supplied value the first call lacks.** A source's first result is often a page, so a value the operator supplied may be valid and still be missing from it. For each distinct raw supplied value the first call's result does not contain, in supplied order, the question calls the source once with that value as the term, and the choice in that lookup's result whose `value` is the same string, if any, joins the prefill as if the first call had returned it: a multiselect selects it, in its place in the supplied order, and a select opens with that value as its term, the lookup's result as its list, and that choice highlighted, as if the operator had typed the value. A value still unmatched is named in the issue of [A supplied value that selects nothing](#resolving-a-question). The lookups run one at a time, each with its own `signal`, which the question's end aborts, and each is a call of the source, so one that throws or rejects ends the question under [When the source fails](#searching). A lookup is an ordinary call with a term, so a source needs no code of its own to serve one.
- **Keys wait for the prefill.** When the linked input was supplied, every key waits from the question's opening until the prefill resolves, after the first call and its lookups, except Ctrl-C, Ctrl-\\, and Ctrl-Z, which core reads first. So the first call is the call with `''`, the operator's first key acts on the opened question, and a lookup never races a term the operator typed. Without a supplied value, a key that changes the term acts at once, under [Keys wait for the list](#searching).
- **The selection survives the term.** A multiselect's selection holds the chosen choices themselves, so a choice the term hides, or that a later call no longer returns, stays selected and is submitted. A row shows as selected when its `value` is `Object.is` the value of a selected choice, so a source that returns object values returns the same objects for the same choice.
- **When the source fails.** The source is author code. When the latest call throws or rejects, the question ends: it draws its cancelled line and rejects with the same error, unchanged, which takes the [ordinary failure path](#when-author-code-fails). Loom adds no retry, no timeout, and no guard on what a source returns.

## Frames and views

A question draws in an input region, which it opens with `out.region({ input: true })` on stderr, and never writes to stdout. Each frame renders through a declared view the library exports from `@loomcli/prompts/views`, so an application restyles one with [`override`](../core/views.md) as it restyles a lane.

| View            | Data                                                                                      | Default rendering                                      |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `questionFrame` | `kind`, `message`, and `issue`; for text, secret, and confirm the `typed` text, the optional `cursor`, and the `hint`, which is the question hint for text and the legend for confirm; for select and multiselect the [list frame](#list-frames) below | The active question, below                             |
| `answeredLine`  | `message` and `answer`, a display string, absent for secret; for select the choice's label, and for multiselect the labels joined with `, `, or the empty string for an empty selection | `? Service port · 8080`                               |
| `cancelledLine` | `message`                                                                                 | `? Service port · cancelled`                          |

`cursor` is the typed line's cursor, a grapheme index into `typed` from 0 to its grapheme count, the unit the editing keys move by. A view draws graphemes, so a grapheme index names a place it can draw, where a code unit or code point offset could fall inside an emoji or an accented letter. A secret's `typed` field is always the empty string and its `cursor` always 0, because a cursor that moved would show the secret's length. A question always supplies `cursor`, and the frame data declares it optional, so data an application builds by hand for `out.draw(data, questionFrame)` draws without one: an absent `cursor` is the end of `typed`, and the default view draws the cursor block over one space after the last grapheme. The default views use core's style tokens and glyphs:

| Frame                    | Rendering                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Text, asking             | `?` in `info` and bold, the message bold, a dim `›`, then the field: the typed text with the cursor block, or the question hint, dim, with the cursor block over its first grapheme |
| Secret, asking           | `?`, the message, a dim `›`, and the cursor block over one space, which never moves                          |
| Confirm, asking          | `?`, the message, the dim legend `[Y/n]`, and the field: the typed text with the cursor block                |
| Select, asking           | `?` and the message on the first line, the highlighted choice as `❯ PostgreSQL` in `highlight`, the others indented two columns, the marker lines and key help dim |
| Multiselect, asking      | As select, with each choice's mark after the pointer or the indent: `❯ ◉ Backups` and `  ◯ Telemetry`, the `circleFilled` glyph in `highlight` for a selected choice and the `circle` glyph dim for the others, as Inquirer's checkbox draws them |
| Searching, asking        | The first line as a text frame's, `? Country › uni` with the cursor block; while `loading`, the key help reads `Searching…`, dim, in its place, with the `ellipsis` glyph; with no row to show and not `loading`, one dim `  No matches` row in place of the list, and with none while `loading`, no row at all |
| A disabled choice        | Dim, indented two columns, the label and its reason in parentheses, `  Neon (needs an account)`, or `(disabled)` with no reason; at a multiselect with its mark |
| A choice `max` keeps out | At a multiselect whose `max` is set and whose `count` has reached it, a row that is neither `disabled` nor `selected`: its mark and label dim, with no parentheses; highlighted, the pointer in `highlight` before the dim mark and label, `❯ ◯ Telemetry`, so the operator sees where the highlight is and that a toggle does nothing |
| A separator              | Dim, indented two columns, its text; an empty separator is an empty row                                         |
| A description            | Below the list and its `↓` marker, indented two columns, dim, on one row, clipped to the columns the indent leaves |
| An issue                 | On the line below the field, or below a list's key help, indented two columns, `✘` and the message in `error` |
| Answered                 | A dim `?`, the message, a dim `·`, and the answer in `highlight`; an empty answer as a dim `none`; a secret ends at the message |
| Cancelled                | A dim `?`, the message, and a dim `· cancelled`                                                               |

- **The cursor block.** The default view draws the cursor in `inverse` over the grapheme at the cursor, and over one space after the last grapheme when the cursor is at the end, so the block shows where the next character lands. That grapheme or space is the cursor's cell.
- **Widths.** The view measures with the view context's `width`, so a wide grapheme takes its two columns, and it never splits a grapheme. A grapheme drawn in its escaped form, under [Editing a typed line](#editing-a-typed-line), takes the escape's columns. A grapheme that measures 0 columns, such as U+200B, draws as itself followed by one space and counts one column, so every cell the cursor can rest on shows. Each frame reads `columns` when it draws, so the fitting below follows a resize at the next frame.

### List frames

```ts
interface TypedFrame {
  readonly kind: 'text' | 'secret' | 'confirm';
  readonly message: string;
  readonly issue: string | undefined;
  readonly typed: string;
  readonly cursor?: number | undefined; // absent, the end of typed
  readonly hint: string | undefined;
}
interface ChoiceRow {
  readonly kind: 'choice';
  readonly label: string;
  readonly description: string | undefined;
  readonly disabled: boolean; // the choice's own disabled state; false for a choice max keeps out
  readonly reason: string | undefined; // a disabled choice's reason, when it has one
  readonly selected: boolean; // in a multiselect's selection; false at a select
}
interface SeparatorRow {
  readonly kind: 'separator';
  readonly label: string;
}
interface ListFrame {
  readonly message: string;
  readonly issue: string | undefined;
  readonly choices: readonly (ChoiceRow | SeparatorRow)[]; // the visible rows
  readonly highlighted: number | undefined; // an index into choices; undefined when no row is highlighted
  readonly above: number; // rows hidden above the window
  readonly below: number; // rows hidden below the window
  readonly rows: number | undefined; // stderr's rows
  readonly term?: string | undefined; // the search term; absent when the question does not search
  readonly cursor?: number | undefined; // the term's cursor; absent, the end of term
  readonly loading?: boolean | undefined; // a source call has not settled; absent, false
}
type QuestionFrame =
  | TypedFrame
  | (ListFrame & { readonly kind: 'select' })
  | (ListFrame & {
      readonly kind: 'multiselect';
      readonly count: number; // choices in the selection, shown or not
      readonly min: number;
      readonly max: number | undefined;
    });
```

Select and multiselect draw one list frame, so a view override that restyles a choice row restyles it in both. A question always supplies every member, and the frame data declares `term`, `cursor`, and `loading` optional, so data an application builds by hand draws a list that does not search without them. `choices` holds the rows the window shows, and `above` and `below` count the rows it hides, separators included. `selected` is set on every row whose choice is in the selection, so a row the term hid and a later term shows again draws selected. `count` counts the whole selection, so the frame states it while the term hides selected choices. A choice `max` keeps out is not `disabled`, because navigation reaches it and a toggle out of the selection frees it, so a view tells it from a disabled choice by `count` reaching `max` on a row that is not `selected`. `TypedFrame` is the member text, secret, and confirm already draw, which `@loomcli/prompts/views` now exports by name beside the list frame's types.

### Fitting one row

A text, secret, or confirm frame keeps its asking line on one row of the view context's `columns`, or 80 columns when `columns` is `undefined`, so a long answer never wraps the frame. These rules give every positive width, down to [1 column](../core/styles.md#width-padding-and-multiline-lanes), exactly one rendering. The issue line below the frame is not fitted: the terminal wraps it, and core counts the rows it takes.

- **The parts.** The asking line is the mark `?` and one space, the message, the separator, and the field. The separator is ` › ` for text and secret, 3 columns, and the legend with one space on each side for confirm, ` [Y/n] `, 7 columns. The field takes every column the other parts leave.
- **What gives way.** While the field would have fewer than 16 columns, the parts give way in this order, and each step applies only when the one before it still leaves too few:
  1. The message clips, until the field has 16 columns. A clipped message is its leading graphemes, the `ellipsis` glyph, and its trailing graphemes, as the select title clips: the leading graphemes take at most half, rounded down, and the trailing graphemes at most what the leading ones leave, where the budget is the columns the message may take less the ellipsis's width. At its narrowest it is the ellipsis alone.
  2. The message drops, with the space after `?`, so the line is `?`, the separator, and the field. This holds while the field keeps at least 4 columns, the narrowest field in which the window below draws a wide cursor grapheme between two ellipses.
  3. The separator drops, the legend with it, so the line is `? ` and the field.
  4. At 2 columns, the space drops, so the line is `?` and a field of 1 column.
  5. At 1 column, `?` drops, so the line is a field of 1 column.

  With a message of `m` columns, the default separators give these lines:

  | Columns, text or secret | Columns, confirm | Asking line                                      |
  | ----------------------- | ---------------- | ------------------------------------------------ |
  | `m` + 21 and more       | `m` + 25 and more | The whole line; the field has 16 columns or more |
  | 22 to `m` + 20          | 26 to `m` + 24   | The message clipped to the columns less 21, or less 25 for confirm; a field of 16 |
  | 8 to 21                 | 12 to 25         | `? › ` or `? [Y/n] ` and the field              |
  | 3 to 7                  | 3 to 11          | `? ` and the field                               |
  | 2                       | 2                | `?` and a field of 1                             |
  | 1                       | 1                | A field of 1                                     |
- **A line that fits.** When the field holds the line's cells, its graphemes and, with the cursor at the end, the cursor's cell, the view draws them whole from the field's first column and nothing after them.
- **A line longer than the field.** Otherwise the field draws a window of the line around the cursor, decided from these numbers alone, so the same line, cursor, and width always draw the same bytes. `F` is the field's columns, `E` the `ellipsis` glyph's width, 1 in both its forms, `L` the columns of the line's cells, `x` the line column at which the cursor's cell starts, and `w` its width. A window that centred the cursor's cell would start at line column `s = x − ⌊(F − w) ÷ 2⌋`. A range `a` up to `b` holds the columns from `a` through `b − 1`.
  - **The head.** When `s` ≤ 0, the field draws line columns 0 up to `F − E`, then the ellipsis.
  - **The tail.** Otherwise, when `s + F` ≥ `L`, the field draws the ellipsis, then line columns `L − (F − E)` up to `L`.
  - **The middle.** Otherwise the field draws the ellipsis, line columns `s + E` up to `s + F − E`, and the ellipsis, so the cursor's cell starts at field column `⌊(F − w) ÷ 2⌋`.

  A grapheme draws when all its columns fall inside the window, and each window column no whole grapheme covers draws as one space, so a wide grapheme an edge cuts leaves a space in its place. The ellipses are dim. So typing at the end draws the tail with the cursor at the field's right edge, Home draws the head, and a cursor inside a long line stays centred with text on both sides. The rule needs `F` ≥ `w + 2E`.
- **An example.** In a field of 12 columns, the line `postgres://db.local:5432/app` has 28 graphemes of one column:

  | Cursor             | `s` | Window                       | Field                                  |
  | ------------------ | --- | ---------------------------- | -------------------------------------- |
  | 0, Home            | −5  | The head, 0 up to 11         | `postgres://…`, the block over `p`     |
  | 14, on the `l` of `local` | 9 | The middle, 10 up to 20      | `…/db.local:…`, the block over `l` at field column 5 |
  | 28, End            | 23  | The tail, 18 up to 29        | `…l:5432/app` and the block over a space |

  In a field of 9 columns, `日本語のテキスト` has 8 graphemes of two columns. With the cursor at 3, on `の`, `x` is 6 and `w` is 2, so `s` is 3, and `s + F`, 12, is less than `L`, 16: the middle draws line columns 4 up to 11. `語`, `の`, and `テ` fit, `キ` at columns 10 and 11 does not, and column 10 draws a space, so the field is `…語のテ …`, 9 columns, with the block over `の` at field column 3.
- **A field narrower than the window.** When the line does not fit and `F` < `w + 2E`, the field draws the cursor's cell alone, with no ellipsis. When the cursor's grapheme is wider than `F`, the block draws the `ellipsis` glyph in its place, so the block always shows.
- **A long question hint.** A question hint wider than the field draws the longest run of its leading graphemes that fits in `F − E` columns, the first under the cursor block, then one space for each column that run leaves, then the ellipsis, dim. When its first grapheme does not fit in `F − E` columns, the hint drops, and the field draws the cursor block over one space.
- **Secret.** A secret's field is the cursor block over one space at every width, so it always fits.

`?`, `›`, and `·` are plain text, and `✘`, `❯`, `◉`, `◯`, and `…` are the [glyphs](../core/styles.md#glyphs) `cross`, `pointer`, `circleFilled`, `circle`, and `ellipsis`, so a terminal that takes compat forms reads `×`, `>`, `(*)`, and `( )` for the first four, and `…` in both forms, so `Searching…` and the clipped text's ellipsis read the same on every terminal. Fitting measures each glyph in the form it draws. A question hides the terminal cursor while it asks and draws its own, so the view decides where the cursor sits. The library writes the sequences that hide and show the cursor, and those that turn bracketed paste on and off, through `out.draw` with a bare view of its own, which nothing overrides. The exceptions are the run-scoped shutdown and suspend handlers under [Leaving a question](#leaving-a-question), which write straight to stderr: each runs inside its signal's handler, before the process ends or stops, where a queued draw would land too late. Core erases and redraws the region, so an overridden view that takes more or fewer rows redraws in place, and a lane message written while the question asks lands above the frame without breaking it. An active frame has no trailing newline, so its hidden terminal cursor stays on the last drawn row. The answered or cancelled line is the region's last frame: it replaces the frame, the cursor shows again, and the line stays in the scrollback when the region closes.

### Fitting a list

A select or multiselect frame fits `rows` first and `columns` second, so its redraw never scrolls the terminal.

- **The ordinary frame.** The title line, the `↑` marker, the rows in the window, the `↓` marker, the highlighted choice's description, the key help, and the issue line when the frame has an issue, each on its own line. A row's label and the issue are not clipped: the terminal wraps them, and the height estimate counts each line's wrapped rows, the issue line's included, at `columns` less 1, because a wide grapheme can leave a cell unused at a wrap, and counts one row a line when `columns` is `undefined`. While the estimate exceeds `rows` and the window holds more than one row, the window gives up one row from the side farther from the highlight, from the bottom when both sides are equally far, and from the bottom when nothing is highlighted.
- **The first line.** A list that does not search draws `?` and the message, unclipped in the ordinary frame. A list that searches draws the asking line of [Fitting one row](#fitting-one-row), with the term as its line and ` › ` as its separator, so it is one row at every width.
- **The description.** One row, indented two columns: a description wider than the columns the indent leaves, `columns` less 2, clips as a clipped message does to those columns, its leading graphemes, the `ellipsis` glyph, and its trailing graphemes. When `columns` is 2 or fewer, no column is left after the indent, and the description does not draw.
- **The compact frame.** When even one row with the ordinary frame cannot fit, the frame draws the title line, the highlighted row, the markers, the key help, and the issue line when there is an issue, and drops the description. The title line is the message clipped at grapheme boundaries in a list that does not search, and the asking line of [Fitting one row](#fitting-one-row), the term included, in a list that searches. The highlighted row is clipped with its pointer and, at a multiselect, its mark. With nothing highlighted, it is `No matches` when the list has no rows, nothing when the list has no rows while `loading`, and `No choice can be selected` when the list has rows of which none can be highlighted. The issue line clips to one row. When `rows` holds the title line, the highlighted row, and the issue line but not the key help as well, the key help drops, so the issue stays in view. The markers join the key help, `↑↓ move · Enter select · ↓ 5 more`, while the frame would exceed `rows`, and they join `Searching…` in the same way while `loading`. When `columns` is narrower than the whole key help, it abbreviates to `↑↓ Enter` at a select, `↑↓ Space Enter` at a multiselect, and `↑↓ Tab Enter` at a multiselect that searches, and a multiselect keeps its count after it, `↑↓ Space Enter · 2/3 selected`, before the line clips.
- **Two rows and one.** With 2 `rows`, the highlighted row and the title share the first row, and the key help is the second. With 1, the three share one row, each clipped. A list that searches keeps its asking line whole on the first row instead: with 2 `rows` the highlighted row and the key help share the second, and with 1 the asking line draws alone, so the term the operator types shows. In each of these frames an issue takes the key help's place while it shows, and in a list that searches with 1 `rows` it takes the asking line's place, so the issue is never lost. A key that changes the term clears the issue, under [A list's issue](#the-kinds), so the term shows again as the operator types.

## Leaving a question

A question asks only when interaction is on, and it enters raw mode through `host.stdin.setRawMode`, which a terminal stream has. An embedding host that reports a terminal on stdin supplies a stream with that method, and a question that finds none throws a `TypeError`, which a run reports as a defect with exit 1. Before it enters raw mode, it adds a synchronous listener to `context.signal` that leaves raw mode, so the terminal is cooked again at the moment of the abort. While it is open, it also registers a run-scoped [`onShutdown`](../core/signals.md#onshutdown) handler that leaves raw mode, turns bracketed paste off, and shows the cursor, so a signal that ends the process leaves the terminal cooked even when the shutdown's budget runs out, and it registers run-scoped [suspend and resume](../core/signals.md#suspend-and-resume) handlers: a suspend leaves raw mode and turns bracketed paste off before the process stops, while core erases the question's frame and shows the cursor, and the resume enters raw mode again, turns bracketed paste on again, and hides the cursor again, while core redraws the frame, under [Raw-mode readers](../core/signals.md#raw-mode-readers). A question enters raw mode before its first frame, so a key typed while that frame is written, Ctrl-C included, reaches it as a key, and raw mode holds while any question of the run is open, so a question waiting its turn never leaves a key to a cooked terminal. Every path out of the run's last open question leaves raw mode, turns bracketed paste off, pauses `host.stdin` and removes the listeners the questions added, so stdin never holds the process open after the run. Every path out of a question draws the last line, answered or cancelled, with the sequence that shows the cursor, after every frame the question queued, and the run's last open question writes CSI `?2004l` with it.

- **Ctrl-C** raises `SIGINT` on the run's signal source through `host.raise`, which starts the [shutdown](../core/signals.md#the-shutdown): core aborts the run signal, the question draws its cancelled line and throws `context.signal.reason`, and core reads the throw as a silent cancellation. The run resolves 130 and the process then ends by the signal. Every key still unread when Ctrl-C or Ctrl-\\ raises its signal, such as an Enter typed in the same read, is dropped, as a cooked terminal flushes its input on an interrupt, so no key answers the question before the signal arrives.
- **Ctrl-\\** raises `SIGQUIT`, which skips the shutdown's budget.
- **Ctrl-Z** raises `SIGTSTP`, which [suspends](../core/signals.md#suspend-and-resume) the process: the question's frame is erased and the terminal restored, and on `fg` the frame is drawn again and the question goes on reading keys. Several Ctrl-Z keys in one read suspend once, and every key still unread when Ctrl-Z raises its signal is dropped, as it is for Ctrl-C. The suspend cancels nothing.
- **A stdin that is not its signal source's own terminal**, such as one an embedding host gives `processHandle`, raises none of these signals, because `host.raise` answers `false`, under [Raw-mode readers](../core/signals.md#raw-mode-readers): Ctrl-C and Ctrl-\\ call `context.cancel()`, so the question draws its cancelled line and the run resolves 130 while the process goes on, and Ctrl-Z does nothing.
- **End of input** while a question is active, stdin closing, or Ctrl-D on an empty typed line, an empty search term included, or at a select or multiselect that does not search, calls `context.cancel()`, and the question then draws its cancelled line and throws `context.signal.reason`, and the run resolves 130. It neither accepts a default nor submits an empty answer.
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

A question's `validate`, the linked input's validator a select or multiselect runs, a select's or multiselect's `source`, its lookups included, the `done` and `failed` message functions of `track`, the work `track` awaits, and an overridden prompts view are author code. Author code that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Three outcomes are the library's own. A source whose latest call throws or rejects ends its question with its cancelled line and rejects the question with the same error, unchanged, and a stale call's rejection is discarded, under [Searching](#searching). Work that rejects under `track` fails its line and rejects `track` with the same rejection, unchanged. A question or progress line still open when the run fails draws its cancelled or failure line before core renders the failure report, as [Leaving a question](#leaving-a-question) and the failing-run rule of [Progress](#progress) state.

## Package

- The root export holds `text`, `secret`, `confirm`, `select`, `multiselect`, `InteractionUnavailableError`, `progress`, `progressStyle`, and the settings and choice types, `MultiselectSettings`, `Choice`, `ChoiceEntry`, `ChoiceObject`, `Separator`, `ChoiceSource`, `ChoiceValue`, `ChoiceAnswer`, `ProgressSettings`, `ProgressUpdate`, `TrackMessages`, `Progress`, `ProgressContext`, `Spinner`, and `ProgressStyleSettings` included. `@loomcli/prompts/views` exports `questionFrame`, `answeredLine`, `cancelledLine`, and `progressLine` and their data types, `TypedFrame`, `ListFrame`, `ChoiceRow`, and `SeparatorRow` included. Its one plugin is `progressStyle()`, whose identity is `@loomcli/prompts`.
- `@loomcli/core` is a peer dependency. The package reads the action context, `DeclarationError`, `FatalError`, `missingInputError`, `questionValidationOptions`, `validateLinkedValue`, `escapeControlCharacters`, `extension`, `plugin`, `readExtension`, the Standard Schema types, `glyph`, and `view` from core, and adds no runtime dependency of its own. Its style schema is a hand-written Standard Schema value.

## Not shipped

- A Command that declares it needs a terminal.
- An autocomplete kind. A select or multiselect with `search` or a `source` is the question that narrows its choices as the operator types, and its answer is always a choice.
- A free-text answer from a search, a term that becomes an answer when no choice matches it. A text question takes free text.
- Fuzzy matching, ranking, and matching on a description for `search: true`. A `source` matches as its author chooses.
- A debounce, a timeout, or a retry for a `source`.
- Wrapping navigation, paging keys, and keys that select every choice or invert the selection, under [Moving through choices](#moving-through-choices).
- A validator for a whole multiselect answer, and a `validate` on select.
- An editor question.
- A number question and a date question. A text question composes them: `integer()`, `number()`, `date()`, or `dateTime()` from [`@loomcli/validators`](validators.md) as its `validate` checks the typed answer and returns the value.
- A path question. Completing a path is a `source` that lists the entries the term names, which an author writes, not a kind of its own.
- Multiline text. It overlaps an editor question, which edits several lines in the operator's own editor.
- A form that asks several questions on one screen. An action asks its questions in order, and a follow-up that depends on an earlier answer stays the application's, under [ADR-0082](../decisions/0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md).
- A sort question that reorders a list. It needs a mode in which the arrow keys carry a held choice, which no other kind has.
- A typed line's history, kill ring, and vi mode.
- A default, a prefill, or "Enter keeps the current value" for secret.
- Redrawing when the terminal is resized while a question asks. The next frame after a resize erases the whole region, because core recounts its last frame at the current width.
- A progress line drawn as a multi-step tree, a progress line with a rate or an estimated time left, and a progress line on stdout.
