---
description: "Local options: string, boolean, and counted options, short groups, repeated values, implied values, aliases, declared option groups, and passthrough."
---

# Local options

This page states how an author declares local options: string, Boolean, and counted options, short groups, repeated and implied values, aliases, option groups, and passthrough. An author uses it to shape the options a Command accepts.

```ts
import { Application } from '@loomcli/core';

const app = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { short: 't', type: 'boolean' })
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

Every option and argument config object also accepts `description`, the core fact every projection reads under the rule [Extensions](extensions.md) states, and `extensions`, the list of [extension values](extensions.md) plugins define for inputs: `ExtensionValue<'option'>` on `StringOption`, `BooleanOption`, `CountOption`, and `ContentOption`, and `ExtensionValue<'argument'>` on `ArgumentConfig`. Both keys are optional, both apply to every global option, whichever declarer declares it, and neither changes parsing or validation. An option config object, and no argument config, also accepts the two core facts `hidden` and `deprecated` that [Hidden and deprecated members](commands.md#hidden-and-deprecated-members) describes, the `control` fact [Control options](commands.md#control-options) describes, `env`, the [environment binding](input-sources.md) that names the variable which supplies the option, and `aliases`, the [option aliases](#option-aliases) that add unadvertised long spellings.

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

A short group is one option word that holds short aliases after a single hyphen, read under the POSIX `getopt` rule. Each character after the hyphen is one code point and must be a declared letter. A Boolean letter is set, and the walk continues to the next character; a `=` after it is the unexpected-value error that Boolean option reports. A counted letter adds one to its count and the walk continues the same way, so a repeated counted letter is no repeat and a `=` after it is the unexpected-value error. A value letter ends the group: the rest of the word is its value, with one leading `=` stripped, or the next word is its value when nothing remains. A letter whose string option declares an [implied value](#implied-values) is a value letter that never takes the next word: the rest of the word is its value, with one leading `=` stripped, and when nothing remains it supplies its implied value. The walk stops at the first letter that faults, because core cannot know whether that letter takes a value: the characters after it are not read and supply nothing, so `-xh` reports `Unknown option "-x"` rather than rendering help, and the misplaced `-Fhello` never reads `hello` as letters.

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

A string option declares `multiple: true` to collect every occurrence instead of rejecting the second one. Boolean options and counted options cannot declare `multiple`; a [counted option](#counted-options) already counts every occurrence.

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

`required: true` means at least one occurrence. A multiple option's action value is never `undefined`: no occurrence is an accurate empty list, and it calls no validator. `required: true` is the structural at-least-one check, and it is read before validation. A rule over the whole list, such as uniqueness, a maximum count, or a transform of the array into another shape, is the action's, because the values are uniform and the action receives them all. A default is a `string[]`, or an array of the validator's input type when the declaration validates, and each of its values passes through the validator like a supplied one.

Global options declare `multiple` under the same rules. Every occurrence before the passthrough delimiter is collected, whether routing or the routed Command's table reads it, so a repeated global is collected rather than rejected.

| Rejected declaration or input                              | Diagnostic                                                                                                | Rule |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---- |
| A required multiple option with no occurrence              | `Option "--field" is required. Supply at least one value.`                                                |      |

The diagnostic is a validation-phase issue with exit code 2 and ranks with the other required inputs. TypeScript rejects `multiple` on a Boolean or counted option, a default of the wrong shape, and a validator whose input type does not accept `string`, at the `option()` call.

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
- **Every occurrence counts.** Occurrences count across every spelling of the option, its short alias and its [aliases](#option-aliases) included, and across words, so `-vv --verbose` reads `3`. The once-per-invocation rule never applies to a counted option, and a repeated counted letter in a [short group](#short-groups) is no repeat. A global counted option counts every occurrence before the passthrough delimiter, whether routing or the routed Command's table reads it, so occurrences before and after the Command name add together.
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
- **Input sources.** An environment binding and the configuration source supply explicit values alone and never the implied value: a variable fills the string it holds, and an empty variable is unset, as for any string option.
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
- **One option.** An alias's spelling reads every value form the option's long spelling reads, `--minimum 5` and `--minimum=5` alike. It binds the option in every other respect: an option that is neither multiple nor counted can occur only once across every spelling, so `--min-bytes 1 --minimum 2` fails with `Option "--minimum" can be supplied only once`, a `multiple` option collects across them in supplied order, and a [counted option](#counted-options) counts across them. An [input source](input-sources.md) fills the option only when no spelling supplied it, so `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1 one.txt` applies 1.
- **Diagnostics.** A fault the parser finds names the spelling the operator typed, as it does for a short alias, so a missing value reads `Option "--minimum" requires a value. Supply a value after "--minimum".` Validation and every reported problem name the option by its own long spelling, as `Option "--min-bytes"`, because the problem belongs to the option.
- **Unadvertised.** An alias is a synonym the application accepts, never a second name it advertises. Help, the [manifest](../plugins/manifest.md), [completion](../plugins/completion.md), the [suggestions](../plugins/suggestions.md) plugin, and every other listing omit it. [`locate`](graph-inspection.md#locating-a-word) reads a typed alias as the parser does, and [`inspect()`](graph-inspection.md) publishes the declared names under `aliases` on the option's node. An alias carries no `deprecated` message of its own, because no listing shows it; an option that is itself retired declares `deprecated` on its own config.
- **Every option.** `aliases` applies to a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under the same rules, because they are one kind of option.

## Declaration and invocation errors

A declaration rejects duplicate option keys and spelling collisions, including generated negative forms, short aliases, and option aliases, and an invalid option name or alias. Each throws from the call that declares the option, or from the attach that first brings two colliding options into one Application, as [Declaration faults](declaration-faults.md) states. TypeScript rejects an invalid type, polarity, implied value, or short-only combination at the call. The call that declares an input, `argument()`, `option()`, `globalOption()`, an input a lifecycle hook declares, and `plugin()` for each option it declares, keeps its own copy of the config object's keys, so a key the author adds to or replaces on that object later changes nothing the declaration holds. A fault judged before the config is read, such as an invalid name on `argument()`, `option()`, `globalOption()`, or `new Command()`, prints the config or options elided.

Each option that is neither multiple nor counted can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, `--total --no-total`, and `--backup -b=numbered` for a string option with an implied value. A `multiple` option collects its repetitions instead, as [Repeated string values](#repeated-string-values) describes, and a counted option counts them, as [Counted options](#counted-options) describes. An unknown or misplaced option, a missing value, or a value after a Boolean or counted option also prevents dispatch. Diagnostics identify the affected option and give a correction. A declaration error that `run()` reports returns code 1; invocation errors return code 2. A declaration diagnostic names the declaration, as in `Option "field"`, because the author edits the declaration to fix it. An input diagnostic names the supplied spelling, as in `Option "--field"`, because the operator changes that token. An argument declares and reads under one name, so its diagnostics use it throughout. A broken validator is a fault in the declaration, so it names the declaration even when a supplied value reached it. Command names, child attachment, and collisions between a global and a local option have their own rules, described in [Commands and global options](commands.md).

### Input declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](declaration-faults.md) assigns it. Each rule's identity links to its headline and explanation in the [diagnostics reference](diagnostics.md). A fault about one key of an input's config marks that key in its finding, a fault about the input as a whole marks its name, and a fault between two inputs carries a finding for each. The finding for an option a plugin declares rebuilds its entry in the `options` record of its `plugin()` call, and its sentences name it `Plugin "@loomcli/log" option "level"`. The rules for an environment binding and a global option read in [Input source declaration errors](input-sources.md#input-source-declaration-errors) and [Command declaration errors](commands.md#command-declaration-errors).

- **Names.** An option name and an alias name are nonempty and have no leading hyphen, whitespace, or `=`: [`@loomcli/core/declared-name`](diagnostics.md#loomclicoredeclared-name).
- **Spellings.** Two options of one scope never share a spelling. A generated negative form counts, and its finding marks the `polarity` that generates it. An alias's spelling counts, its negative form included, and its finding marks that alias in `aliases`: [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
- **Keys.** Two options of one scope never share a key. The scope reads `the root Command`, `the global options`, or `plugin "@loomcli/log"`: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice).
- **An option a plugin declares.** Its key and spelling stay apart from every other global option and every local option. A key reports under [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice) and a spelling under [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken), the rules of a collision between the application's own options, and the sentence names the plugin. The rules of [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) give each pairing.
- **A default.** A default passes its validator: [`@loomcli/core/invalid-default`](diagnostics.md#loomclicoreinvalid-default). `run()` raises the fault before it reads a token.
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

`exclusive(...names)` permits at most one supplied member. `oneRequired(...names)` requires at least one.
`requiredTogether(...names)` requires all members or none. Combining exclusive and one-required groups over the same members expresses exactly one.
Each call returns a new declaration, preserves the receiver, and closes at `action()` without changing action option types.
Application exposes the same methods for root-local options. Lifecycle hooks use them on the erased attached Command after action registration.

Presence follows the input-source stage's supplied fact. Argv, environment, and configuration fills count, including configured false, zero, or empty lists.
Any accepted spelling counts, including negative Boolean forms and aliases. Validation messages and structured spelling lists use the option's reported spelling, or its declared name for a named call.
Defaults do not count. A supplied value rejected by its validator still counts, so value and group problems can report together.
Malformed environment values and named values that cannot lower supply nothing.
An invocation by name first follows ordinary lowering: Boolean values without matching spellings, zero counts, and empty lists are absent.
A configured member and a different typed member conflict in an exclusive group, and the diagnostic names the configured source.

Automatically attached stdin does not count as a supplied option. For example, piping input does not satisfy `oneRequired('file', 'url')` on a stdin-claiming `file` option.
An exclusive group limits supplied options, so stdin may still attach to an unsupplied content option beside a supplied sibling.

Unknown names, repeated names, fewer than two members, globals, and arguments are declaration faults at the group call under `@loomcli/core/option-group`.
An exclusive group cannot contain an individually required member, including conditional requiredness and content with a positive minimum.
A content stdin claim does not remove that conflict because named calls have no stdin.
An exclusive group and a required-together group cannot share two or more members, in either declaration order.
Other redundancy is allowed, and core performs no transitive constraint solving.

Each failed group adds one problem to an exit-2 `InputError`, after individual input problems and in group declaration order.
The problem carries `reason`, `inputs`, `spellings`, and `supplied`, with member order preserved and no artificial singular input.
A failure depending only on unanswered configuration requests is suppressed, because those members' presence is unknown.
Existing held-fault precedence and middleware takeover rules remain unchanged across `run()`, `invoke()`, and MCP.

Inspection publishes frozen `optionGroups: [{ kind, options }]` on every Command, including hidden members, or `[]`.
Help states each visible group in one plain sentence and the manifest publishes the same facts.
Both omit groups with hidden members. Help notes when a group contains a stdin claim that piping does not count.
Completion suppresses exclusive siblings after a member appears in the line, including aliases and negative spellings, without reading environment or configuration.

MCP omits groups containing hidden or control options, and writes a group that holds an excluded option over its other members. Its schemas use named supplied-value predicates for Boolean polarity, positive counts, and nonempty lists.
Exclusive constraints remain sound when external sources fill other options. Positive requirements are encoded only when every member has no environment binding or extensions.
An extension might bind a configuration source, so uncertain groups remain runtime rules.
[ADR-0085](../decisions/0085-a-command-declares-option-groups-over-supplied-local-options.md) records the contract.

## Passthrough

The first bare `--` ends core parsing. Every following token reaches the action in `passthrough: string[]`, with order, values, and token boundaries intact. The delimiter is excluded. Later `--` tokens are ordinary passthrough values.

Passthrough is always available and is empty when no tail exists. It does not satisfy required positional arguments. Core does not parse it as options or arguments, validate it, or transform it. Parsing leaves `host.argv` intact.
