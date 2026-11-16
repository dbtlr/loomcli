---
description: "Local options: string, boolean, and counted options, short groups, repeated values, option value arity, last-occurrence-wins options, implied values, aliases and visible aliases, declared option groups, sharing options across Commands with a settings constant or an option set, and passthrough."
---

# Local options

This page states how an author declares local options: string, Boolean, and counted options, short groups, repeated values, value arity, the last occurrence winning, implied values, aliases and visible aliases, option groups, sharing options across Commands, and passthrough. An author uses it to shape the options a Command accepts.

```ts
import { Application } from '@loomcli/core';

const app = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { short: 't', type: 'boolean' })
  .passthrough({ description: 'Words the report repeats unchanged.' })
  .action(({ args, options, passthrough, out }) => {
    const metric: string | undefined = options.metric;
    const total: boolean = options.total;
    const files: string[] = args.files;
    const tail: string[] = passthrough;
    return out.print(JSON.stringify({ metric, total, files, tail }));
  });
```

`option(name, config)` declares a local option on the unnamed root Command. The declared name is the key in `options`. Short aliases, option aliases, and negative spellings do not add handler keys. Options and arguments have separate objects, so they can use the same key without collision.

Declarations infer types through fluent calls and `ActionHandler<typeof app>`. The constructor accepts no caller-supplied input types. `StringOption`, `BooleanOption`, `CountOption`, `ContentOption`, and their union `OptionConfig` support extracted configuration with `satisfies`. An option is one of four kinds, chosen by `type`: a string option takes a value, a [content option](validation.md#content-inputs) takes a path and prepares a lazy handle, a Boolean option takes none and reads the value of its spelling, and a [counted option](#counted-options) takes none and reads how many times it was supplied.

Every option and argument config object also accepts `description`, the core fact every projection reads under the rule [Extensions](extensions.md) states, and `extensions`, the list of [extension values](extensions.md) plugins define for inputs: `ExtensionValue<'option'>` on `StringOption`, `BooleanOption`, `CountOption`, and `ContentOption`, and `ExtensionValue<'argument'>` on `ArgumentConfig`. Both keys are optional, both apply to every global option, whichever declarer declares it, and neither changes parsing or validation. An option config object, and no argument config, also accepts the two core facts `hidden` and `deprecated` that [Hidden and deprecated members](commands.md#hidden-and-deprecated-members) describes, the `control` fact [Control options](commands.md#control-options) describes, `env`, the [environment binding](input-sources.md) that names the variable which supplies the option, `aliases`, the [option aliases](#option-aliases) that add unadvertised long spellings, and `visibleAliases`, the [visible option aliases](#visible-option-aliases) that the listings show.

The long spelling uses the exact declared name. `dryRun` produces `--dryRun`; `dry-run` produces `--dry-run`. Names are case-sensitive. They cannot be empty, start with a hyphen, or contain whitespace or `=`. A `short` alias is one ASCII letter and is case-sensitive. A hyphenated name is not a JavaScript identifier, so its action value reads with bracket access: `options['dry-run']`, the way textstat reads `options['min-bytes']`. Core exports the name rule as `isDeclaredName(name)`, which the [lint plugin](../libs/eslint-plugin.md) calls to judge a literal option, argument, or alias name as core does.

`shortOnly: true` requires `short` and suppresses every long spelling. For example, `.option('metric', { short: 'm', shortOnly: true, type: 'string' })` accepts `-m words` and rejects `--metric`.

## String values and token consumption

| Form                                                                  | Result                        |
| --------------------------------------------------------------------- | ----------------------------- |
| `--metric words`, `--metric=words`, `-m words`, `-mwords`, `-m=words` | `options.metric` is `"words"` |
| `--metric=`, `--metric ""`, `-m ""`, `-m=`                            | An empty string               |
| No metric option                                                      | `undefined`                   |
| `--metric=-value`, `-m-value`, `-m=-value`                            | The literal string `"-value"` |
| `--metric -5`, `-m -`                                                 | `"-5"` and `"-"`              |
| `--metric --total`, `-m -v`, `-m --`, `--metric` at the end           | Missing-value error           |

A string option that declares an [implied value](#implied-values) reads a bare spelling as that value and never takes the next word, so the missing-value row never applies to it: `--backup --total` and `--backup` at the end each supply the implied value.

An option word is `--` followed by at least one character, or `-` followed by an ASCII letter. Every other word is a plain word, a value or an argument: `-`, `-5`, `-.5`, and `-1e3` need no `--` escape, because no declaration can claim a spelling that is not an ASCII letter. A separate word is the value of a string option that declares no implied value, unless it is an option word or the bare `--`. A long assignment and an attached short value can contain any string, hyphens and additional `=` characters included, so a value that starts with a hyphen and a letter is written attached. When the word after a value option is an option word or the bare `--`, the missing-value error names that form: `Option "--pattern" requires a value. Supply a value after "--pattern", or attach one that starts with a hyphen as "--pattern=<value>".` [ADR-0055](../decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) records the grammar.

The parser preserves empty values. After parsing, value inputs pass through their declared validators. A declared default fills only an optional value that no token and no [input source](input-sources.md) supplied. A validated optional value can declare `validateOmitted: true` instead, which sends its omission to its validator, as [Absence and defaults](validation.md#absence-and-defaults) describes.

## Short groups

A short group is one option word that holds short aliases after a single hyphen, read under the POSIX `getopt` rule. Each character after the hyphen is one code point and must be a declared letter. A Boolean letter is set, and the walk continues to the next character; a `=` after it is the unexpected-value error that Boolean option reports. A counted letter adds one to its count and the walk continues the same way, so a repeated counted letter is no repeat and a `=` after it is the unexpected-value error. A value letter ends the group: the rest of the word is its value, with one leading `=` stripped, or the next word is its value when nothing remains. A letter whose string option declares an [implied value](#implied-values) is a value letter that never takes the next word: the rest of the word is its value, with one leading `=` stripped, and when nothing remains it supplies its implied value. A letter whose option declares an [arity](#option-value-arity) is a value letter that takes its count of following words when nothing remains, and refuses anything attached. The walk stops at the first letter that faults, because core cannot know whether that letter takes a value: the characters after it are not read and supply nothing, so `-xh` reports `Unknown option "-x"` rather than rendering help, and the misplaced `-Fhello` never reads `hello` as letters.

| Form, with Boolean `t`, string `m`, counted `v`, and `b` implying `simple` | Result                                        |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `-tm words`, `-tmwords`, `-tm=words`                                       | `total` is `true` and `metric` is `"words"`   |
| `-mt`                                                                      | `metric` is `"t"`                             |
| `-m==x`                                                                    | `metric` is `"=x"`                            |
| `-tx` with no `x` declared                                                 | `Unknown option "-x"`                         |
| `-t5`                                                                      | `Unknown option "-5"`                         |
| `-t=false`                                                                 | `Boolean option "-t" does not accept a value` |
| `-tt`                                                                      | `Option "-t" can be supplied only once`       |
| `-vvv`                                                                     | `verbose` is `3`                              |
| `-tvv`                                                                     | `total` is `true` and `verbose` is `2`        |
| `-v3`                                                                      | `Unknown option "-3"`                         |
| `-v=3`                                                                     | `Counted option "-v" does not accept a value` |
| `-b`, `-tb`                                                                | `backup` is `"simple"`, and `-tb` sets `total` |
| `-bnumbered`, `-b=numbered`                                                | `backup` is `"numbered"`                      |
| `-bt`                                                                      | `backup` is `"t"`                             |
| `-b=`                                                                      | `backup` is `""`                              |
| `-b words`                                                                 | `backup` is `"simple"`, and `words` is the next word |

A value letter takes the rest of its word whatever it holds, so `-mt` gives `metric` the value `t` and `-bt` gives `backup` the value `t`, and the option's validator is where such a typo surfaces. The letters of one group may belong to any option the routed Command's table holds, global or local, so `textstat -ht` sets help's `help` and the root's `total`. A letter outside ASCII is named whole, so `-té` reports `Unknown option "-é"`.

## Repeated string values

A string option declares `multiple: true` to collect every occurrence instead of rejecting the second one, or [`lastWins: true`](#last-occurrence-wins) to keep the last one. Boolean options and counted options cannot declare `multiple`; a [counted option](#counted-options) already counts every occurrence.

```ts
const app = new Application('select')
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .action(({ options, out }) => {
    const fields: string[] = options.field;
    return out.print(fields.join('\n'));
  });
```

The collected value keeps supplied token order across every accepted spelling, so `--field a -F b --field=c` gives `['a', 'b', 'c']`. Each occurrence follows the ordinary value rules of its spelling. A multiple string alias is a value letter in a short group: it ends the group.

The declared validator checks one value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). Core runs it on each occurrence in supplied order and reports each issue at the value's position, counted from 0, so `z.string().nonempty('Supply a field name.')` rejects an empty value: `--field a -F ''` fails with `Option "--field" at 1: Supply a field name.`. The action receives the array of the validator's outputs.

| Declaration and input               | Action value or failure              |
| ----------------------------------- | ------------------------------------ |
| Omitted, no declared default        | `[]`; the validator is not called    |
| Omitted, declared default           | Each default value's validated output |
| One or more occurrences             | Each value's validated output, or input issues |
| `required: true` with no occurrence | Input error; no dispatch             |

`required: true` means at least one occurrence. A multiple option's action value is never `undefined`: no occurrence is an accurate empty list, and it calls no validator. `required: true` is the structural at-least-one check, and it is read before validation. `required: 'non-interactive'` applies the same check only when the run is not [interactive](interaction.md). A rule over the whole list, such as uniqueness, a maximum count, or a transform of the array into another shape, is the action's, because the values are uniform and the action receives them all. A default is a `string[]`, or an array of the validator's input type when the declaration validates, and each of its values passes through the validator like a supplied one.

Global options declare `multiple` under the same rules. Every occurrence before the first bare `--` is collected, whether routing or the routed Command's table reads it, so a repeated global is collected rather than rejected.

| Rejected declaration or input                              | Diagnostic                                                                                                | Rule |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---- |
| A required multiple option with no occurrence              | `Option "--field" is required. Supply at least one value.`                                                |      |

The diagnostic is a validation-phase issue with exit code 2 and ranks with the other required inputs. TypeScript rejects `multiple` on a Boolean or counted option, a default of the wrong shape, and a validator whose input type does not accept `string`, at the `option()` call.

## Option value arity

A string option declares `arity`, a whole number of 2 or more, to take that many separate words per occurrence. A local option and a global option declare it alike.

```ts
import { Application } from '@loomcli/core';
import { integer } from '@loomcli/validators';

const app = new Application('draw')
  .option('point', { arity: 2, multiple: true, short: 'p', type: 'string', validate: integer() })
  .option('resize', { arity: 2, type: 'string', validate: integer() })
  .action(({ options, out }) => {
    const points: [number, number][] = options.point;
    const size: [number, number] | undefined = options.resize;
    return out.print(JSON.stringify({ points, size }));
  });
```

Each occurrence takes exactly its count of words after its spelling, so `--resize 800 600` gives `[800, 600]`. The words are the separate words after the spelling: a long spelling, a short letter, or a letter that ends a short group with nothing attached, so `-vp 3 4` sets `v` and gives `p` `['3', '4']`. `-5` and `-` are plain words, so an occurrence takes them. [ADR-0161](../decisions/0161-a-string-option-may-declare-an-arity-and-each-occurrence-takes-that-many-separate-words.md) records the decision.

| Declaration and input                   | Action value or failure                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `arity: 2`, `--point 3 4`               | `['3', '4']`, or the tuple of the validator's outputs          |
| `arity: 2, multiple: true`, two occurrences | A list of tuples, one per occurrence, in supplied order    |
| A scalar arity option omitted           | `undefined`, unless it is required or declares a default      |
| A multiple arity option omitted         | `[]`; the validator is not called                             |
| `--point=3 4`, `-p3 4`, `-p=3 4`        | Unexpected-value error                                         |
| `--point 3` at the end, `--point 3 -- x` | Missing-value error that names the count                     |
| `--rename a --old`                      | Missing-value error that names `--old`                         |

The action reads a tuple of the validator's outputs, one per word, in supplied order. With a literal arity the type is a tuple of that length, so `{ arity: 2, validate: integer() }` reads `[number, number]`, and with an arity typed as `number` it is an array of the output. With `multiple: true` each occurrence adds one tuple, so the value is a list of tuples. A default is a tuple, or a list of tuples on a multiple option, in the validator's input type, and its words pass the same validator. `required: true` means at least one occurrence, and `required: 'non-interactive'` applies the same check only when input is not [interactive](interaction.md). The fix clause names the count: `Option "--point" is required. Supply 2 values.`, and on a multiple option `Supply at least one set of 2 values.` Shaping the tuple into another value, such as `{ x, y }`, is the action's, as a rule over a multiple option's whole list is.

The declared validator checks one word under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). Core runs it on each word of each occurrence, in supplied order, and reports each issue at the word's position, counted from 0: `Option "--resize" at 1: Use an integer.` On a multiple option the position names the occurrence, then the word: `Option "--point" at 2.1: Use an integer.` On a [last-wins option](#last-occurrence-wins) only the last occurrence's words reach the validator, because a replaced occurrence supplies nothing. The [supplied record](validation.md#validation-context) holds the raw words in the same shape, a tuple of strings or a list of them.

An attached value is never one of the words. A long spelling with `=` and a short letter with the rest of its word each carry a value, which an arity option refuses, so `--point=3 4` is the unexpected-value error with exit code 2: `Option "--point" takes its values as separate words. Supply each one after "--point" as its own word.`

An option word or a bare `--` ends an occurrence, as does the end of the line. When either comes before the count is met, the occurrence is the missing-value error with exit code 2. At the end of the line or a bare `--` it reads `Option "--point" requires 2 values and received 1. Supply 2 values after "--point".` At an option word it names that word's spelling, the part of a long word before its first `=` or the first letter of a short group, so an attached value such as the secret in `--token=s3cret` never prints and `-old` prints as `-o`: `Option "--rename" requires 2 values, and "--old" reads as an option. Supply 2 values after "--rename"; a value that reads as an option cannot be one of them.` The words the occurrence took supply nothing, and the word that ended it is read as it would have been. An option word or a bare `--` can never be one of an arity option's values on a command line; such a value reaches the option through its [environment variable](input-sources.md#environment-bindings), the configuration source, or an [invocation by name](invocation.md#invocation-by-name).

A scalar arity option supplied twice is the repeated-option error, as any scalar option is, unless it declares [`lastWins: true`](#last-occurrence-wins), and the repeated occurrence still takes the words its count names, up to a word that refuses a value, so the words after it read as they would have. An occurrence never takes the first bare `--` or a word after it.

The types reject `arity` beside `implied` and `validateOmitted`, on a Boolean, counted, content, or background option, beside `env` on a multiple option, and beside `envAllowEmpty`. A scalar arity option binds `env` beside `envDelimiter`, whose items fill the words, as [Environment bindings](input-sources.md#environment-bindings) states. No question kind answers a tuple, so a question cannot link an arity option, as [Interaction](interaction.md) states. An arity that is not a whole number of 2 or more is a declaration error, [`@loomcli/core/option-arity`](diagnostics.md#loomclicoreoption-arity).

## Last occurrence wins

A scalar string option declares `lastWins: true` to let a later occurrence on the command line replace an earlier one instead of failing as a repeat. A wrapper script or a shell alias can then put a default first, and the operator's later value replaces it. A local option and a global option declare it alike, and so do an option a plugin declares and an option a lifecycle hook declares. [ADR-0162](../decisions/0162-a-scalar-string-option-may-declare-that-its-last-occurrence-wins.md) records the decision.

```ts
import { Application } from '@loomcli/core';

// With alias draft='mailer --editor vim', "draft --editor nano" runs with nano.
const app = new Application('mailer')
  .option('editor', { env: 'MAILER_EDITOR', lastWins: true, short: 'e', type: 'string' })
  .action(({ options, out }) => {
    const editor: string | undefined = options.editor;
    return out.print(editor ?? 'no editor');
  });
```

| Declaration and input, with `lastWins: true`                     | Action value or failure                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `--editor vim --editor nano`, `--editor=vim -e nano`, `-evim -enano` | `"nano"`                                                 |
| `MAILER_EDITOR=emacs mailer --editor vim --editor nano`          | `"nano"`                                                     |
| `--backup=numbered --backup`, with `backup` implying `simple`    | `"simple"`                                                   |
| `--resize 800 600 --resize 1024 768`, with `arity: 2`            | `['1024', '768']`                                            |
| `--editor --to x --editor nano`, with a declared `--to`          | Missing-value error for the first `--editor`                 |
| `--resize 800 --resize 1024 768`, with `arity: 2`                | Missing-value error that names the count                     |

- **Which options.** A scalar string option takes the setting, with or without an [implied value](#implied-values), and so does a scalar [arity option](#option-value-arity) and the [background-marked](background.md) option. TypeScript rejects `lastWins` beside `multiple: true`, because a multiple option collects every occurrence, and on a Boolean, counted, or content option, so a repeated Boolean option still fails as a repeat. `lastWins: false` and an omitted key keep the once-only rule. No setting turns the policy on for a whole Application or Command.
- **Occurrences.** An occurrence counts across every accepted spelling of the option, its long spelling, its short alias, a letter of a [short group](#short-groups), and each [alias](#option-aliases), as the once-only rule counts them, among the words before the first bare `--`, in word order. The last occurrence that supplies a value supplies the option. A bare spelling that supplies an implied value is an occurrence like any other, so `--backup=numbered --backup` reads `simple`. On an arity option, the last occurrence's whole tuple replaces the earlier one.
- **The replaced value.** Only the last occurrence's value reaches the option's validator. A replaced value is dropped unread: it is never validated, so one the validator would reject fails nothing, and the [supplied record](validation.md#validation-context) holds the last value alone. Nothing names a replaced value at any verbosity. An implied value belongs to the declaration, so it validates before any token is parsed, whether or not an occurrence uses it, as [Implied values](#implied-values) states.
- **Each occurrence is still read.** Each occurrence takes its words under the rules above, and every fault an occurrence finds other than the repeat is still raised, wherever it sits: a missing value, too few words for an arity option, and a value attached to an arity option. A faulted occurrence supplies nothing and replaces nothing.
- **Sources.** The setting decides among command-line occurrences alone. The [precedence](input-sources.md#precedence) of argv, the environment, the configuration source, and the default is unchanged, so the winning occurrence beats a bound variable, a configuration value, and a default, as any command-line value does. An [invocation by name](invocation.md#invocation-by-name) and an MCP tool call supply one value per option, so the setting changes neither.
- **The value and its class.** The setting changes neither the type the action reads nor the option's value class, so a parent's own option rebinds as [Global consumption and routing](commands.md#global-consumption-and-routing) states. The declaration an occurrence binds to decides whether a later occurrence replaces it or repeats it. A global last-wins option takes its last occurrence before the first bare `--`, whichever layer read each occurrence.
- **Projections.** [`inspect()`](graph-inspection.md) publishes `lastWins` on a string option's node, and the [manifest](../plugins/manifest.md) copies it. [Completion](../plugins/completion.md) offers a last-wins option again after the earlier words supplied it. Help, the man page, and the MCP tool schema print nothing new for it.

## Boolean polarity

Boolean options accept `polarity: 'positive' | 'both' | 'negative'`. The default polarity is `positive`.

| Polarity for `total`, with alias `t` | Long forms                                         | Short alias        | Absent value |
| ------------------------------------ | -------------------------------------------------- | ------------------ | ------------ |
| `positive`                           | `--total` gives `true`                             | `-t` gives `true`  | `false`      |
| `both`                               | `--total` gives `true`; `--no-total` gives `false` | `-t` gives `true`  | `false`      |
| `negative`                           | `--no-total` gives `false`                         | `-t` gives `false` | `true`       |

`shortOnly` removes long forms for positive or negative polarity. It cannot combine with `both`, because one short alias cannot express both polarities. String options and counted options cannot declare polarity.

Boolean options consume no value token. Assignments such as `--total=false` and `-t=false` fail. A following bare `false` remains a positional input.

## Counted options

```ts
const app = new Application('fetchit')
  .option('verbose', { short: 'v', type: 'count' })
  .action(({ options, out }) => {
    const verbose: number = options.verbose;
    return out.print(String(Math.min(verbose, 3)));
  });
```

`type: 'count'` declares a counted option. Each occurrence adds one, and the action reads the total as a `number`, so `fetchit -vvv`, `fetchit -v -v -v`, and `fetchit --verbose -vv` each read `3`, and `fetchit` alone reads `0`. [ADR-0057](../decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) records the decision.

- **No value.** A counted option takes no value, as a Boolean option takes none. `--verbose=3` and `-v=3` fail with the unexpected-value error `Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.`, which names the spelling typed. A following plain word such as `3` stays a positional input, and `-v3` reports `Unknown option "-3"`, as `-t5` does for a Boolean letter.
- **Every occurrence counts.** Occurrences count across every spelling of the option, its short alias and its [aliases](#option-aliases) included, and across words, so `-vv --verbose` reads `3`. The once-per-invocation rule never applies to a counted option, and a repeated counted letter in a [short group](#short-groups) is no repeat. A global counted option counts every occurrence before the first bare `--`, whether routing or the routed Command's table reads it, so occurrences before and after the Command name add together.
- **Absence.** No occurrence means the option was not supplied, and the action reads `0` unless an [input source](input-sources.md) fills it. A count needs no declared absence and has no upper limit, so a counted option declares no `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`. TypeScript rejects each at the `option()` call, and core adds no rule for a value that bypasses the types. An action that wants a cap clamps the count itself, as `Math.min` does above.
- **Input sources.** An [environment binding](input-sources.md) fills a count from a variable that holds one or more ASCII decimal digits, such as `0`, `3`, or `12`, and the configuration source fills it with a whole number of 0 or more. A source fills the count only when no occurrence supplied it, so with `env: 'VERBOSE'` on the declaration, `VERBOSE=2 fetchit -v` reads `1` and `VERBOSE=2 fetchit` reads `2`.
- **Every option.** `type: 'count'` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules, because they are one kind of option.

## Implied values

```ts
import { oneOf } from '@loomcli/validators';

const app = new Application('copyit')
  .argument('files', { required: true, variadic: true })
  .option('backup', { implied: 'simple', short: 'b', type: 'string', validate: oneOf(['none', 'simple', 'numbered']) })
  .action(({ options, out }) => {
    const backup: 'none' | 'simple' | 'numbered' | undefined = options.backup;
    return out.print(backup ?? 'no backup');
  });
```

`implied` on a string option declares the value a bare spelling supplies, so the value after the spelling becomes optional, as in GNU `cp --backup[=CONTROL]` and `ls --color[=WHEN]` under `getopt`'s optional-argument rule. [ADR-0057](../decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md) records the decision.

| Form, with `backup` implying `simple` and short alias `b` | Result                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `--backup`, `-b`                                          | `"simple"`                                                      |
| `--backup=numbered`, `-bnumbered`, `-b=numbered`          | `"numbered"`                                                    |
| `--backup numbered`, `-b numbered`                        | `"simple"`, and `numbered` is the next word, an argument or a Command name |
| `--backup=`, `-b=`                                        | An empty string                                                 |
| `-tb`, with Boolean `t`                                   | `total` is `true` and `backup` is `"simple"`                    |
| `-bt`                                                     | `"t"`                                                           |
| No backup option                                          | `undefined`                                                     |

- **Attached values only.** A bare spelling never takes the next word, so an explicit value is attached: after `=` on a long spelling, and after the letter, with one leading `=` stripped, on a short alias. The missing-value error therefore never applies to the option, at the end of the words or before an option word. In a [short group](#short-groups) its letter takes the rest of the word as its value, as any value letter does, and supplies the implied value only when nothing remains.
- **Judged as a default is.** The implied value is the string an operator would otherwise type, so it is in the validator's input type as a string, and TypeScript checks `implied` against the validator's input type, as it checks a default. Every `run()` passes it through the option's validator before it reads a token, as it passes a declared default, in the `default` phase of the [validation context](validation.md#validation-context), awaits an asynchronous answer, and reuses the output for that invocation, so a bare spelling supplies the validated output and the action's type is the type it would be without `implied`. A validator that rejects it is the declaration error `@loomcli/core/invalid-implied`, with exit code 1, whether or not the invocation holds a bare spelling, because the author declared the value. `inspect()` does not pass it through the validator, as it does not pass a default.
- **With other keys.** A default fills an omitted option, and the implied value fills a bare spelling, so with `default: 'none'` an omitted `--backup` reads `none` and a bare one reads `simple`. A bare spelling supplies the option, so it satisfies `required`, and `validateOmitted` still receives omission alone. A [multiple option](#repeated-string-values) collects each bare occurrence as the implied value in its place, so `--backup -b=numbered -b` collects `['simple', 'numbered', 'simple']`. An [alias](#option-aliases) spelling reads the same forms as the long spelling.
- **Input sources.** An environment binding and the configuration source supply explicit values alone and never the implied value: a variable fills the string it holds, and an empty variable is unset, as for any string option, unless the binding declares `envAllowEmpty: true`, under which a defined empty variable fills the empty string and still never the implied value.
- **Declarations.** `implied` belongs to a string option. `implied` on a Boolean or counted option and an `implied` value that is not a string are rejected by TypeScript at the call, and a value that bypasses the types gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Every option.** `implied` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules.

## Option aliases

```ts
const app = new Application('textstat')
  .option('min-bytes', { aliases: ['minimum'], default: '0', type: 'string' })
  .action(({ options, out }) => out.print(options['min-bytes']));
```

`aliases` lists other names of one option, for a common mistype, an inference, or a name the option used to have. Each alias adds its long spelling to the table the option's other spellings sit in, and that spelling binds the declared option, so `textstat --minimum 5` and `textstat --min-bytes 5` both set `options['min-bytes']`. [ADR-0056](../decisions/0056-an-option-alias-is-an-unadvertised-long-spelling-of-one-option.md) records the decision.

- **Names.** An alias follows the rule the declared name follows: nonempty, case-sensitive, with no leading hyphen, whitespace, or `=`. An empty list declares no alias. An alias that repeats the option's own name or another of its aliases adds nothing, and neither does an alias whose spelling the option already accepts, such as `no-color` on a `both` option `color`, so the option answers to each spelling once. An alias spelling that another option of the table already holds is a declaration error, under the rules [Input declaration errors](#input-declaration-errors) lists.
- **Spellings.** An alias takes every long form the option's polarity generates. A string option, a counted option, and a positive Boolean option gain `--<alias>`, a `both` Boolean option gains `--<alias>` and `--no-<alias>`, and a `negative` Boolean option gains `--no-<alias>`, so a renamed Boolean option keeps its negative form. `shortOnly` removes every long spelling, so it cannot combine with `aliases`, an empty list included: TypeScript rejects the pair.
- **One option.** An alias's spelling reads every value form the option's long spelling reads, `--minimum 5` and `--minimum=5` alike. It binds the option in every other respect: an option that is neither multiple, counted, nor last-wins can occur only once across every spelling, so `--min-bytes 1 --minimum 2` fails with `Option "--minimum" can be supplied only once`, a `multiple` option collects across them in supplied order, a [counted option](#counted-options) counts across them, and a [last-wins option](#last-occurrence-wins) takes the last of them. An [input source](input-sources.md) fills the option only when no spelling supplied it, so `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1 one.txt` applies 1.
- **Diagnostics.** A fault the parser finds names the spelling the operator typed, as it does for a short alias, so a missing value reads `Option "--minimum" requires a value. Supply a value after "--minimum".` Validation and every reported problem name the option by its own long spelling, as `Option "--min-bytes"`, because the problem belongs to the option.
- **Unadvertised.** An alias `aliases` declares is a synonym the application accepts, never a second name it advertises. Help, the [manifest](../plugins/manifest.md), [completion](../plugins/completion.md), the [suggestions](../plugins/suggestions.md) plugin, and every other listing omit it. [`locate`](graph-inspection.md#locating-a-word) reads a typed alias as the parser does, and [`inspect()`](graph-inspection.md) publishes the declared names under `aliases` on the option's node. An alias carries no `deprecated` message of its own; an option that is itself retired declares `deprecated` on its own config.
- **Every option.** `aliases` applies to a local option, a global option, an option a plugin declares, an option a lifecycle hook declares, and an entry of an [option set](#sharing-options), under the same rules, because they are one kind of option.

### Visible option aliases

```ts
const app = new Application('textstat')
  .option('min-bytes', {
    default: '0',
    description: 'Skip files below this size.',
    type: 'string',
    visibleAliases: ['minimum'],
  })
  .action(({ options, out }) => out.print(options['min-bytes']));
```

`visibleAliases` lists aliases that the listings show beside the option, for a short form or a second name the author wants operators to learn. A visible alias is an alias in every other respect, under every rule of [Option aliases](#option-aliases): the name rule, the long forms its option's polarity generates, the negative form included where the option has one, the binding to the one option, the diagnostics, and the declaration faults, whose findings mark it in `visibleAliases`. `shortOnly` cannot combine with `visibleAliases`, an empty list included: TypeScript rejects the pair. It applies to every option `aliases` applies to. [ADR-0168](../decisions/0168-a-command-or-an-option-may-declare-a-visible-alias-that-every-listing-shows-beside-its-canonical-name.md) records the decision.

- **Repeats.** A visible alias that repeats the option's own name or a spelling the option already accepts adds nothing, as an alias does. A name both lists hold is one alias, and it is visible, so a spelling fault marks it in `visibleAliases`.
- **What shows it.** [Help](../plugins/help-page.md#the-help-page) prints the fact `(alias: --minimum)` on the option's row, naming each alias's positive long spelling, so a `both` option's alias reads `--colour` and not `--[no-]colour`, while a `negative` Boolean option, whose only long spellings are negative, names `--no-<alias>`; the [man page](../plugins/manpage.md) follows help; [completion](../plugins/completion.md) offers a visible alias's spellings where none of the option's own spellings matches what was typed; and the [manifest](../plugins/manifest.md) lists the names in the `aliases` field of the option's entry. Usage lines and every reported problem keep the option's own spelling, an [MCP](../plugins/mcp.md) tool's input schema adds no property for it, and [suggestions](../plugins/suggestions.md) never match an alias.
- **Inspection.** The option's node holds every alias under `aliases`, the config's `aliases` and then its `visibleAliases`, each in its list's order, without a repeat, and the visible ones under `visibleAliases`, in that order.
- **No message.** An alias of either kind carries no migration message. A renamed option keeps its old name in `aliases`, and an option that is itself retired declares `deprecated`.

## Declaration and invocation errors

A declaration rejects duplicate option keys and spelling collisions, including generated negative forms, short aliases, and option aliases, and an invalid option name or alias. Each throws from the call that declares the option, or from the attach that first brings two colliding options into one Application, as [Declaration faults](declaration-faults.md) states. TypeScript rejects an invalid type, polarity, implied value, or short-only combination at the call. The call that declares an input, `argument()`, `option()`, `globalOption()`, an input a lifecycle hook declares, `plugin()` for each option it declares, and `optionSet()` for its record and each entry, keeps its own copy of the config object's keys, so a key the author adds to or replaces on that object later changes nothing the declaration holds. A fault judged before the config is read, such as an invalid name on `argument()`, `option()`, `globalOption()`, or `new Command()`, prints the config or options elided.

Each option that is neither multiple, counted, nor last-wins can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, `--total --no-total`, and `--backup -b=numbered` for a string option with an implied value. A `multiple` option collects its repetitions instead, as [Repeated string values](#repeated-string-values) describes, a counted option counts them, as [Counted options](#counted-options) describes, and a string option that declares `lastWins: true` takes its last occurrence, as [Last occurrence wins](#last-occurrence-wins) describes. An unknown or misplaced option, a missing value, a value after a Boolean or counted option, or a value attached to an [arity option](#option-value-arity) also prevents dispatch. Diagnostics identify the affected option and give a correction. A declaration error that `run()` reports returns code 1; invocation errors return code 2. A declaration diagnostic names the declaration, as in `Option "field"`, because the author edits the declaration to fix it. An input diagnostic names the supplied spelling, as in `Option "--field"`, because the operator changes that token. An argument declares and reads under one name, so its diagnostics use it throughout. A broken validator is a fault in the declaration, so it names the declaration even when a supplied value reached it. Command names, child attachment, and collisions between a global and a local option have their own rules, described in [Commands and global options](commands.md).

### Input declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](declaration-faults.md) assigns it. Each rule's identity links to its headline and explanation in the [diagnostics reference](diagnostics.md). A fault about one key of an input's config marks that key in its finding, a fault about the input as a whole marks its name, and a fault between two inputs carries a finding for each. The finding for an option a plugin declares rebuilds its entry in the `options` record of its `plugin()` call, and its sentences name it `Plugin "@loomcli/log" option "level"`. The rules for an environment binding and a global option read in [Input source declaration errors](input-sources.md#input-source-declaration-errors) and [Command declaration errors](commands.md#command-declaration-errors).

- **Names.** An option name and an alias name, a visible alias's included, are nonempty and have no leading hyphen, whitespace, or `=`: [`@loomcli/core/declared-name`](diagnostics.md#loomclicoredeclared-name).
- **Spellings.** Two options of one scope never share a spelling. A generated negative form counts, and its finding marks the `polarity` that generates it. An alias's spelling counts, its negative form included, and its finding marks that alias at its first place in `aliases`, or in `visibleAliases` for a [visible alias](#visible-option-aliases), a name both lists hold included: [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
- **Keys.** Two options of one scope never share a key. The scope reads `the root Command`, `the global options`, or `plugin "@loomcli/log"`: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice).
- **An option a plugin declares.** Its key and spelling stay apart from every other global option and every local option. A key reports under [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice) and a spelling under [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken), the rules of a collision between the application's own options, and the sentence names the plugin. The rules of [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) give each pairing.
- **A default.** A default passes its validator: [`@loomcli/core/invalid-default`](diagnostics.md#loomclicoreinvalid-default). `run()` raises the fault before it reads a token.
- **An arity.** A string option's `arity` is a whole number of 2 or more, so `{ arity: 1 }` throws `Option "point" declares arity 1.` with the correction `Declare a whole number of 2 or more, or remove arity.`, and its finding marks `arity`: [`@loomcli/core/option-arity`](diagnostics.md#loomclicoreoption-arity).
- **An implied value.** An implied value passes its validator: [`@loomcli/core/invalid-implied`](diagnostics.md#loomclicoreinvalid-implied). `run()` raises the fault before it reads a token, whether or not the invocation holds a bare spelling.
- **A converter.** In a [development build](release-facts.md#development-builds), a validator's JSON Schema converter returns a plain object: [`@loomcli/core/schema-converter-failed`](diagnostics.md#loomclicoreschema-converter-failed). A converter that throws, or that answers with anything but a plain object, is the fault.

## Declared option groups

A Command or the unnamed root declares relationships over its already-declared local options:

```ts
const exportCommand = new Command('export', { description: 'Export a document.' })
  .option('json', { description: 'JSON output.', type: 'boolean' })
  .option('yaml', { description: 'YAML output.', type: 'boolean' })
  .exclusive('json', 'yaml')
  .oneRequired('json', 'yaml')
  .action(({ options, out }) => out.print(options.json ? 'json' : 'yaml'));
```

`exclusive(...names)` permits at most one member that claims the group: a supplied member claims it unless it is a Boolean at its absent value. `oneRequired(...names)` requires at least one.
`requiredTogether(...names)` requires all members or none. Combining exclusive and one-required groups over the same members expresses exactly one.
`requires(option, ...needed)` is a one-way requirement: supplying `option` requires each of `needed`, while any of them alone is accepted, as [A one-way requirement](#a-one-way-requirement) states.
Each call returns a new declaration, preserves the receiver, and closes at `action()` without changing action option types.
Application exposes the same methods for root-local options. Lifecycle hooks use them on the erased attached Command after action registration.

Presence follows the input-source stage's supplied fact. Argv, environment, and configuration fills count, including configured false, zero, or empty lists.
Any accepted spelling counts, including negative Boolean forms and aliases, except that a Boolean at its absent value claims no exclusive group, as below. Validation messages and structured spelling lists use the option's reported spelling, or its declared name for a named call.
Defaults do not count. A supplied value rejected by its validator still counts, so value and group problems can report together.
Malformed environment values and named values that cannot lower supply nothing.
An invocation by name first follows ordinary lowering: Boolean values without matching spellings, zero counts, and empty lists are absent.
A member claims its exclusive group when a tier supplies it, unless it is a Boolean whose value equals its [absent value](#boolean-polarity). Such a Boolean, such as `--no-yaml`, `EXPORT_YAML=0`, or a configured `yaml = false` on a `positive` or `both` option, neither wins the group nor conflicts, so `--json --no-yaml` runs. It stays supplied: it reaches the action with its value and stays in the `supplied` record. A `negative` Boolean is absent as `true`, so a typed `--no-cache` claims its group and conflicts with a sibling typed beside it, while `CACHE=1` claims nothing. A counted or string member claims the group whatever its value, a zero or an empty list included.
In an exclusive group, the highest input tier that claims a member wins: the members that tier claimed stay supplied, and each member a lower tier claimed is withdrawn. The tiers rank as [Input sources](input-sources.md#precedence) ranks them for one option, argv, then the environment, then the configuration source, and the named values of an [invocation by name](invocation.md#invocation-by-name) are argv.
So `json = true` in a configuration file with a typed `--yaml` runs with `yaml`, the same file with a typed `--no-yaml` runs with `json`, and an environment member wins over a configured one.
Core withdraws a losing member right after the input-source stage and before validation, so its value is never validated. It then reads as unfilled by every tier: its declared default applies, or it is omitted, it is absent from the `supplied` record, and it activates nothing.
A member bound to a variable outside its grammar fails the run as ever, unless argv claims a member of the group, which makes the variable a lower tier the run never reads, and then the failure is not reported.
A conflict is reported only between members one tier claimed, such as `--json --yaml` or two configured keys, and the diagnostic names each member's source. The problem's `supplied` list names the members that claimed the group.
A member in two exclusive groups withdraws when either holds a member a higher tier claimed, judged on the fills the stage left, so declaration order does not matter.
The member that won an exclusive group replaced the withdrawn one in every other group. `oneRequired` counts a withdrawn member as supplied, so a group that holds one is satisfied. A `requiredTogether` group that holds a withdrawn member is not checked: with `exclusive('token', 'user')` and `requiredTogether('user', 'password')`, a configured `user` beside a typed `--token` runs whether the file holds `password` or not, and a configured `password` still reaches the action. A [requirement](#a-one-way-requirement) that holds a withdrawn member, as its option or as an option it needs, is not checked either. A rejected variable that a typed sibling sets aside filled nothing, so it settles no other group.

Automatically attached stdin does not count as a supplied option. For example, piping input does not satisfy `oneRequired('file', 'url')` on a stdin-claiming `file` option.
An exclusive group limits supplied options, so stdin may still attach to an unsupplied content option beside a supplied sibling.

Unknown names, repeated names, fewer than two members, globals, and arguments are declaration faults at the group call under `@loomcli/core/option-group`.
An exclusive group cannot contain an individually required member, including conditional requiredness and content with a positive minimum.
A content stdin claim does not remove that conflict because named calls have no stdin.
An exclusive group and a required-together group cannot share two or more members, in either declaration order, and neither can an exclusive group and a requirement.
A requirement cannot name its option among the options it needs.
Other redundancy is allowed, and core performs no transitive constraint solving.

Each failed group adds one problem to an exit-2 `InputError`, after individual input problems and in group declaration order.
The problem carries `reason`, `inputs`, `spellings`, and `supplied`, with member order preserved and no artificial singular input.
A failure depending only on unanswered configuration requests is suppressed, because those members' presence is unknown.
Existing held-fault precedence and middleware takeover rules remain unchanged across `run()`, `invoke()`, and MCP.

Inspection publishes frozen `optionGroups` on every Command, including hidden members, or `[]`: `{ kind, options }` for an exclusive, one-required, or required-together group, and `{ kind: 'requires', option, requires }` for a requirement.
Help and the man page state each visible group in one plain sentence and the manifest publishes the same facts.
All three omit groups with hidden members. Help and the man page note when a group contains a stdin claim that piping does not count.
Completion suppresses exclusive siblings after a member that claims the group appears in the line, an alias included, without reading environment or configuration. A spelling that gives a Boolean its absent value, such as `--no-json` on a `both` option, suppresses no sibling. A requirement changes no completion.

MCP omits groups containing hidden or control options, and writes a group that holds an excluded option over its other members. Its schemas use named supplied-value predicates for Boolean polarity, positive counts, and nonempty lists. An exclusive constraint reads a Boolean member as claiming only when it differs from its absent value, `true` for a `positive` or `both` option and `false` for a `negative` one, so a call with `json: true` and `yaml: false` passes.
Exclusive constraints remain sound when external sources fill other options. Positive requirements, a requirement included, are encoded only when every member has no environment binding or extensions.
An extension might bind a configuration source, so uncertain groups remain runtime rules.
[ADR-0085](../decisions/0085-a-command-declares-option-groups-over-supplied-local-options.md) records the contract, and [ADR-0123](../decisions/0123-in-an-exclusive-option-group-the-highest-input-tier-that-supplies-a-member-wins.md) decides an exclusive group by the highest tier that supplies a member. An [option set](#sharing-options) carries groups over its own members, which `options(set)` declares on the Command.

### A one-way requirement

`requires(option, ...needed)` declares that supplying `option` requires each option `needed` names, while each of them alone, or all of them without `option`, is accepted:

```ts
const login = new Command('login', { description: 'Sign in to the server.' })
  .option('user', { description: 'The account name.', type: 'string' })
  .option('password', { description: 'The account password.', env: 'LOGIN_PASSWORD', type: 'string' })
  .option('host', { description: 'The server.', type: 'string' })
  .requires('password', 'user', 'host')
  .action(({ options, out }) => out.print(options.user ?? 'anonymous'));
```

`login --user ada` runs, and so does `login --user ada --password secret --host example.org`. `login --password secret` fails with exit 2. The first name is the option that has the requirement, and each further name is an option it needs, at least one. Each is typed as a declared local option, as the other group calls type theirs. [ADR-0167](../decisions/0167-a-command-declares-that-one-option-requires-others-and-the-others-alone-are-accepted.md) records the decision.

- **A requirement only.** No option fills, sets, or defaults another. An option that should take a value when another is supplied stays the action's logic.
- **The trigger.** The requirement applies when its option is supplied, by a token, the environment, or the configuration source, and not by a default. A Boolean whose value equals its [absent value](#boolean-polarity) triggers nothing, as it claims no exclusive group, so `--no-pretty` runs without what `pretty` requires. A counted or string option triggers it whatever its value.
- **The needed options.** A needed option satisfies the requirement when a token, the environment, or the configuration source supplies it, a filled `false`, zero, or empty list included, and a default does not. No tier ranks the two sides: a configured `user` satisfies a typed `--password`.
- **Beside an exclusive group.** A requirement withdraws nothing. A requirement that holds a member an exclusive group withdrew, as its option or as a needed option, is not checked, because the sibling that won replaced it, as for a `requiredTogether` group. With `exclusive('token', 'user')` and `requires('password', 'user')`, a configured `user` beside a typed `--token` and a typed `--password` runs.
- **The failure.** A broken requirement is one problem whose `reason` is `'requires'`. `inputs` and `spellings` list the option, then each needed option, and `supplied` lists the members that were supplied. Its sentence names the option and only the needed options it still lacks, then both ways out, and the option carries its source label when the environment or the configuration source supplied it:

  ```text
  login: Option "--password" requires options "--user" and "--host". Supply them as well, or remove "--password".
  login: Option "--password" (from LOGIN_PASSWORD) requires option "--host". Supply it as well, or remove "--password".
  ```

  The second line is a run with `LOGIN_PASSWORD` set and `--user` typed. Three or more lacking options read `"--user", "--host", and "--port"`.
- **Declaration faults.** The call raises the group rules above under [`@loomcli/core/option-group`](diagnostics.md#loomclicoreoption-group): an undeclared local option, a global option and an argument included, a repeated name, and an option that requires itself, `Command "login" requires names option "password" as its own requirement.`, corrected by `Name only other local options after the first.` The call judges its names in order, each name in full before the next: a later name that repeats the first is the option requiring itself, so `.requires('password', 'user', 'password')` reads that sentence rather than the repeat's, another repeated name is the repeat, and then a name the Command does not declare is undeclared. A requirement and an exclusive group that share two or more members are `Command "login" exclusive and requires groups share at least two options.`, because the option could never be supplied with everything it needs. Two requirements that need each other, a requirement of a required option, and a requirement repeated are allowed.
- **Projections.** Help and the man page print `Use --password only with --user and --host.`, and the manifest publishes the entry inspection publishes, each omitting a requirement with a hidden member. Under the conditions above, which `login`'s `LOGIN_PASSWORD` binding fails, so its requirement stays a rule the run checks, an MCP tool's schema writes JSON Schema's `dependentRequired`, such as `{ password: ['user', 'host'] }`, or the same rule with named-value predicates where presence alone does not state it, as for a Boolean option or a counted or multiple member. Completion offers every option a requirement holds.

## Sharing options

Local options never inherit along a path, so each Command that reads an option declares it. Two forms keep the declarations the same on every Command that shares them: a settings constant for one option, and an option set for several options and the groups over them. [ADR-0166](../decisions/0166-an-option-set-declares-shared-options-once-and-each-command-that-shares-them-applies-it.md) records the decision.

### One option: a settings constant

An option's settings are a plain object, so one option that several Commands declare is one constant, typed with `satisfies` and one of the config types `StringOption`, `BooleanOption`, `CountOption`, or `ContentOption`. Each Command passes it to `option()` under the name it reads.

```ts
// src/document-input.ts
import type { ContentOption } from '@loomcli/core';

export const documentInput = {
  description: 'The document to read. Omit it to read piped text.',
  required: true,
  short: 'f',
  stdin: true,
  type: 'content',
} satisfies ContentOption;

// src/commands/get.ts
export const get = new Command('get', { description: 'Read one value at a path.' })
  .option('file', documentInput)
  .argument('path', { description: 'Dot path to read.', required: true })
  .action(getValue);
```

The jsonkit example's document Commands each declare `--file` this way.

### Several options: an option set

```ts
// src/output-options.ts
import { optionSet } from '@loomcli/core';

export const output = optionSet({
  json: { description: 'Print JSON.', type: 'boolean' },
  yaml: { description: 'Print YAML.', type: 'boolean' },
}).exclusive('json', 'yaml');

// src/commands/list.ts
export const list = new Command('list', { description: 'List the entries.' })
  .options(output)
  .action(({ options, out }) => out.print(options.yaml ? 'yaml' : 'json'));

// src/commands/show.ts
export const show = new Command('show', { description: 'Show one entry.' })
  .argument('id', { description: 'The entry to show.', required: true })
  .options(output)
  .option('wide', { description: 'Print every column.', type: 'boolean' })
  .exclusive('json', 'wide')
  .action(showEntry);
```

`optionSet(configs)` takes a record of option name to option settings, the configuration `option()` takes, and returns an `OptionSet`. `options(set)` on a Command, or on the Application for the root, declares each of the set's options as a local option, then each of its groups. The action reads each option under `options` with the type one `option()` call gives it, so `options.json` above is a `boolean` in both actions.

- **One by one, in order.** `options(set)` returns the declaration that one `option()` call per option, in the set's order, and then one group call per group, in the order the set holds them, would return, at the position of the call among the Command's other calls. The set's order is its record's key order as `Object.keys` reads it, so a linter rule that sorts object keys, such as ESLint's `sort-keys`, also sorts the order help lists the options in. A later group call on the Command may name a set's option beside one of its own, as `show` does above.
- **Each entry is checked as `option()` checks it.** The types apply to each entry the constraints `option()` applies to one option, so a default outside its validator's input type, or a `multiple` option whose validator does not accept one string, fails to compile at `optionSet()`. The call raises the declaration faults the set's own entries prove, under [Declaration faults](declaration-faults.md#at-the-call): an invalid name or alias, two entries that share a spelling or a variable, an empty `envDelimiter`, an invalid `arity`, two content entries that claim stdin, and an extension value `option()` would refuse, two entries' values whose descriptors share an identity included. Each reads as the fault `option()` raises, and its finding rebuilds the entry alone in the set's record, `optionSet({ json: { … } })`. A default and an implied value pass their validators when `run()` starts, as they do for any option.
- **Groups.** A set's `exclusive(...names)`, `oneRequired(...names)`, `requiredTogether(...names)`, and `requires(option, ...needed)` name the set's own members, so a group that names an option outside the set, or fewer than two, fails to compile. Each returns a new set that holds the group after the receiver's, and applies the group rules of [Declared option groups](#declared-option-groups) that no type expresses over the set's members at the call, a repeated member, an option that requires itself, and the conflicts between groups, with sentences that open `An option set`, such as `An option set exclusive group contains required option "json".`
- **A value.** A set never changes. A group call returns a new set and leaves its receiver as it was, and one set applies to any number of Commands, in one Application or in several. A set holds options only, never an argument, stdin, or the passthrough mode, and an empty set declares nothing.
- **What applying refuses.** A name the Command already declares as a local option, or one its global options hold, is a compile error at `options()`, which names it: `'This option name is already declared on this Command'` or `'This option name is already declared as a global option'`. At the call, `options()` raises every fault `option()` would raise for one of the set's options against the Command: a spelling or a variable the Command's own options hold, a second stdin claim, an extension descriptor that shares an identity with one the Command names, and on the root a key, spelling, or variable a global option holds. Attach and build judge a set's options as any local options. Every finding about a set's option, at `options()` or later, such as a default its validator rejects when `run()` starts, rebuilds the call that declared it, `.options(optionSet({ json: { … } }))`, with that entry alone and the part at fault marked. A set that another installed copy of `@loomcli/core` built is the [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value) fault.
- **Nothing inherits.** A parent that applies a set declares its options on the parent alone, and its children gain nothing. Each Command that shares the options applies the set itself. A set applied to a [group](commands.md#nested-commands-and-groups) gives the group its own options, which reach no action. When a parent and a child each apply one set, an operator may type such an option before the child's name, and it binds to the child's option, as [Global consumption and routing](commands.md#global-consumption-and-routing) states for any option both declare.
- **Where.** `options()` exists on a Command and on the Application root, wherever `option()` does, and `action()` closes it. There is no set form for global options. The attached Command a [lifecycle hook](lifecycle-hooks.md) receives has no `options()`.
- **Projections.** [`inspect()`](graph-inspection.md), the [manifest](../plugins/manifest.md), help, the man page, completion, and MCP show nothing about a set. A Command built with a set is the same in every projection as one that declared the same options and groups one by one, in the same order.

A settings constant stays the form for one option. A set is for several options a group of Commands shares, and for the groups over them, which a constant cannot carry. The jsonkit example's Commands that print a JSON value each apply its `jsonLayout` set, `--compact` and `--indent` with an exclusive group over them, and keep `--file` a settings constant.

## Passthrough

The first bare `--` ends routing and option parsing on every Command. The delimiter itself is no word of the Command, and no word after it is read as an option, a global option's included. What the words after it become depends on whether the routed Command declares the passthrough mode. [ADR-0159](../decisions/0159-passthrough-is-a-mode-a-command-declares-and-required-arguments-may-follow-a-variadic.md) records the decision.

```ts
import { Command } from '@loomcli/core';

// rm -- -draft.txt removes the file named -draft.txt.
export const rm = new Command('rm')
  .argument('file', { required: true })
  .action(({ args, out }) => out.print(`Removed ${args.file}.`));

// exec node -- --version prints node --version.
export const exec = new Command('exec')
  .argument('program', { required: true })
  .passthrough({ description: 'The arguments the program receives.' })
  .action(({ args, passthrough, out }) => out.print([args.program, ...passthrough].join(' ')));
```

- **Without the mode.** A Command that does not declare passthrough reads every word after the first bare `--` as a plain word. Each one fills the routed Command's next unfilled argument, after the plain words before the `--`, under the fill rule of [Application declarations](application.md), and a later `--` is an ordinary word. A word with no argument left to fill is the unexpected-argument error, with exit 2, and on a Command with children that declares no argument, every such word is. On a Command that declares arguments and holds children, the words fill its arguments, so `textstat -- completion` counts a file named `completion`. So `rm -- -draft.txt` fills `file` with `-draft.txt`. The action context has no `passthrough` member, so an action that reads one fails to compile.
- **Declaring the mode.** `.passthrough(config?)` turns the mode on. `config` takes one optional key, `description`, the core fact help and the [manifest](../plugins/manifest.md) print for the words. A Command declares the mode at most once, and the types close the call at `action()`, as they close `argument()`. Only a Command with an action declares it: on a group it is [`@loomcli/core/command-without-action`](diagnostics.md#loomclicorecommand-without-action), at attach and, for the root, at build. Nothing inherits the mode, so each Command that forwards words declares its own.
- **With the mode.** Every word after the first bare `--` reaches the action in `passthrough: string[]`, with its order, values, and word boundaries intact. A later `--` is an ordinary passthrough word. No such word fills an argument, so a required argument the words before the `--` leave out is still missing. Core never parses, validates, or transforms a passthrough word, and `passthrough` is `[]` when no word follows the `--`.
- **Readers.** The [validation context](validation.md#validation-context) and the middleware [`request`](middleware.md) carry `passthrough` on every Command, `[]` on one without the mode. Parsing leaves `host.argv` intact.
