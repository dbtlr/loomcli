---
description: "The help plugin: the --help option, the helpPage view and its variants, help extensions, ordered sections, accepted values, the restyle, and paging a long page."
---

# Help plugin

`help(settings?)` takes one optional setting, `paging`, under [Help paging](#help-paging), and declares one Boolean option, `help`, with the short spelling `h`, the description `Show this help.`, and `control: true` under [Control options](../core/commands.md#control-options), a middleware activated by it, the three extensions below, the `onCommandAttach` hook of [Help in the manifest](#help-in-the-manifest), and the `onFailure` hook of [Help's failure hint](suggestions.md#helps-failure-hint). The middleware renders the [help page](help-page.md#the-help-page) of the routed Command through the plugin's declared view, `helpPage`, a `DeclaredView<HelpPage>` where `HelpPage` is `{ readonly graph: CommandGraph; readonly command: CommandNode; readonly variant: HelpVariant }`. It derives the [variant](#help-variants) from `spellings.help`, calls `out.render({ command, graph, variant }, helpPage)`, or hands a long page to the operator's pager under [Help paging](#help-paging), and returns without calling `next()`, so the exit code is 0, or the cancellation code when the run is cancelled while the pager is open. The default function derives the page content from `graph`, `command`, and `variant` alone and ends the page with exactly one newline. The installed view escapes raw fragments before styling, as specified by the [help restyle](#help-and-version-restyle). Stdout holds the resolved page and one line terminator, unless the page goes to the pager. An application overrides `helpPage` to change the page while `help()` stays installed, the data it receives is the graph, the routed node, and the variant, and a replacement owns its own escaping, layout, and newline. The pack exports no structured page model or builder. `jsonkit --help` renders the root, `jsonkit get --help` renders `get`, and `jsonkit cache --help` renders the `cache` group, because the group's missing-subcommand fault is held before the chain and raised at the dispatch boundary, which the takeover never reaches. An unknown command still fails in routing, so `jsonkit nope --help` reports the unknown command. A fault core held from local parsing or validation is never raised under the takeover, so `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too. Like every global option, `--help` is read at any placement before `--`, in a short group with the routed Command's local options included, and every fault but an unknown command is held, so `textstat -ht` renders the root's page and `jsonkit -F name select --help` renders it although `-F` is misplaced. There is no `jsonkit help get` form: a `help` command would share the namespace with the application's own commands, and it would be a second way to say one thing.

The page is derived from the graph and the variant by the [page rules](help-page.md#the-help-page) and nothing else, so a test compares the bytes of `jsonkit --help` with a page written by hand.

## Help extensions

Three descriptors are exported from `@loomcli/plugins/help/extension`, and all are help's own facts; every other fact the page prints is a core fact, except an option's configuration key, which help reads from the [configuration plugin](config.md)'s `configInput`. Each field is optional, and the descriptor's schema carries every rule below, so the call that receives a value that breaks one rejects it the way it rejects any extension value its schema rejects. The declared view is exported from `@loomcli/plugins/help/views`, a second declarations module, because it imports the page module: the page code loads with the plugin's entry module, the descriptor module stays declarations alone, and the middleware module holds nothing but the call. A graph fact that carries a marker character prints literally. The restyle escapes raw fragments before it adds style markers, and a replacement owns that escaping obligation.

```ts
// @loomcli/plugins/help/views
import type { CommandGraph, CommandNode, DeclaredView } from '@loomcli/core';

export type HelpVariant = 'compact' | 'extended';

export interface HelpPage {
	readonly graph: CommandGraph;
	readonly command: CommandNode;
	readonly variant: HelpVariant;
}

export declare const helpPage: DeclaredView<HelpPage>;
```

```ts
import { Application, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpPage } from '@loomcli/plugins/help/views';

const app = new Application('example', {
	plugins: [help()],
	views: [override(helpPage, {
		render: ({ graph, command }, { style }) =>
			`${style.primary(style.escape([graph.name, ...command.path].join(' ')))}\n`,
	})],
});
```

```ts
// src/lines.ts, the pack's line, prose, and Markdown rules, which belong to no subpath
import { check, pipe, string } from 'valibot';

const terminator = /[\n\v\f\r\u0085\u2028\u2029]/u;
export const line = pipe(
  string(),
  check(
    (value) => /\S/u.test(value) && !terminator.test(value),
    'Supply one line that holds a character other than whitespace.',
  ),
);
export const prose = pipe(
  string(),
  check(
    (value) => value.split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/u).every((each) => /\S/u.test(each)),
    'Supply prose whose every line holds a character other than whitespace.',
  ),
);
export const markdown = pipe(
  string(),
  check(
    (value) => /\S/u.test(value),
    'Supply Markdown that holds a character other than whitespace.',
  ),
);
```

```ts
// src/help/extension.ts, the declarations module of the @loomcli/plugins/help subpath
import { extension } from '@loomcli/core';
import { array, literal, object, optional, pipe, regex, strictTuple, string, union } from 'valibot';

import { packageName } from '../constants.js';
import { line, markdown } from '../lines.js';

const example = object({ command: line, note: optional(line) });
const sectionPath = union([strictTuple([line]), strictTuple([line, line])]);
const sectionPaths = array(sectionPath);
const word = pipe(string(), regex(/^[^\s\u0085]+$/u, 'Supply one word with no whitespace.'));

export const helpCommand = extension(`${packageName}/help/command`, {
  schema: object({
    commandSections: optional(sectionPaths),
    details: optional(markdown),
    examples: optional(array(example)),
    optionSections: optional(sectionPaths),
    section: optional(sectionPath),
  }),
  target: 'command',
});
export const helpInput = extension(`${packageName}/help/input`, {
  schema: object({
    accepts: optional(line),
    hideBindings: optional(literal(true)),
    placeholder: optional(word),
    section: optional(sectionPath),
  }),
  target: 'option',
});
export const helpArgument = extension(`${packageName}/help/argument`, {
  schema: object({ accepts: optional(line) }),
  target: 'argument',
});
```

`helpCommand` targets Commands, so a Command or the Application carries it. `details` is [Markdown](help-page.md#markdown-details) the extended page renders after the masthead, a string that holds a character other than whitespace, with blank lines allowed, written inline or brought in with a text import. `examples` lists invocations the page prints under EXAMPLES: `command` holds the tokens after the application name as one line, and `note` is one line printed under it. `helpInput` targets options, so a local option and a global option carry it, whoever declares it. `placeholder` is the word the page shows for a string option's value, `<path>` for a `--file` declared with `placeholder: 'path'`; it holds no whitespace, and without it the page shows the option's declared name. A `placeholder` on a Boolean or counted option is accepted and never shown, because neither takes a value. `accepts` is one line the page prints as the input's [accepted values](#accepted-values), in place of any list help would derive from the schema; an `accepts` on a Boolean or counted option is accepted and never shown, for the same reason. `hideBindings`, which holds `true` alone, keeps the option's [bindings](#help-variants) off both pages. `helpArgument` targets arguments and carries `accepts` alone: an argument's placeholder is its declared name, which the author already chose, and its description is a core fact. The value a projection reads back through `readExtension` is the schema's output, deeply read-only, with an omitted field absent and an explicit `undefined` dropped, as every stored extension value drops it.

`section` places a Command or an option in an authored [help section](#ordered-help-sections). `commandSections` and `optionSections` order the sections on that Command's own help page. The fields are optional and belong to help, including on a global option a plugin declares. Arguments keep their existing block and gain no section field.

```ts
import { Application, Command } from '@loomcli/core';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

export const configured = new Application('fetchit').globalOption('verbose', {
  description: 'Show more detail. Repeat it for more.',
  short: 'v',
  type: 'count',
});

const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [
    helpCommand({
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: [{ command: 'get user.name -f doc.json', note: 'A nested key.' }],
    }),
  ],
})
  .argument('path', { description: 'Dot path to read.', required: true })
  .option('file', {
    description: 'The document to read. Omit it to read piped text.',
    extensions: [helpInput({ placeholder: 'path' })],
    required: true,
    short: 'f',
    stdin: true,
    type: 'content',
  });
```

```ts
import { Command } from '@loomcli/core';
import { helpArgument, helpInput } from '@loomcli/plugins/help/extension';
import { z } from 'zod';

const pick = new Command('pick', { description: 'Print one item of a list.' })
  .argument('index', {
    description: 'The item to print.',
    extensions: [helpArgument({ accepts: 'A whole number from 0 up to the last index.' })],
    validate: z.string().regex(/^[0-9]+$/u),
  })
  .option('order', {
    description: 'The order to count in.',
    extensions: [helpInput({ accepts: 'asc to count from the first item, desc from the last.' })],
    type: 'string',
    validate: z.enum(['asc', 'desc']),
  });
```

A projection that wants help's prose imports the descriptor module and reads the values with `readExtension`, as [Extensions](../core/extensions.md) describes, and never imports the help middleware.

## Help in the manifest

```ts
// src/help/attach.ts, the hook of the @loomcli/plugins/help subpath
import { readExtension } from '@loomcli/core';
import type { CommandAttachHook } from '@loomcli/core';

import { manifestCommand } from '../manifest/extension.js';
import { helpCommand } from './extension.js';

export const attachHelp: CommandAttachHook = (command) => {
  const value = readExtension(command, helpCommand);
  if (value === undefined || (value.details === undefined && value.examples === undefined)) {
    return command;
  }
  return command.extend(
    manifestCommand({
      ...(value.details === undefined ? {} : { details: value.details }),
      ...(value.examples === undefined ? {} : { examples: [...value.examples] }),
    }),
  );
};
```

Help decides that its prose belongs in the [manifest](manifest.md), and it supplies that prose through the manifest's [collecting extension](../core/extensions.md#collecting-extensions), so the manifest carries no code for help.

- **What it supplies.** On each Command, the hook reads `helpCommand` as it stands at help's turn, so a later plugin's hook that replaces that value does not change what help supplied. When the value holds `details` or `examples`, it extends the Command with one `manifestCommand` value that holds the same `details` and the same `examples`, each field present only where help's value holds it. `manifestCommand` applies the same line and Markdown rules as the shipped `helpCommand`, so every value help supplies validates. A Command with no help value, or with one that holds neither field, gets nothing. Neither `helpInput` nor `helpArgument` is supplied: a placeholder and an `accepts` line are for a human reader, and the input's own [schema](../core/validation.md#input-schema) states what it accepts.
- **When the manifest is absent.** The manifest plugin need not be installed. The value is then inert, and `inspect()` still reports it under `@loomcli/plugins/manifest/command`.
- **Order.** Help's value joins the author's own `manifestCommand` values after them, and it joins values from other plugins' hooks in installation order.
- **Cost.** The hook is one call per Command on every build. Help's entry module imports `@loomcli/plugins/manifest/extension`, a declarations module, and nothing else of the manifest's.

## Ordered help sections

```ts
// The shared schema in the help declarations module.
const sectionPath = union([strictTuple([line]), strictTuple([line, line])]);
```

```ts
import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

const next = new Command('next', {
	description: 'Find ready tasks.',
	extensions: [helpCommand({ section: ['Work commands', 'Read'] })],
}).action(() => {});
const done = new Command('done', {
	description: 'Complete a task.',
	extensions: [helpCommand({ section: ['Work commands', 'Lifecycle'] })],
}).action(() => {});
const doctor = new Command('doctor', {
	description: 'Check the application.',
}).action(() => {});

const app = new Application('work', {
	extensions: [helpCommand({
		commandSections: [
			['Work commands', 'Read'],
			['Work commands', 'Lifecycle'],
			['COMMANDS'],
		],
		optionSections: [['Output'], ['GLOBAL OPTIONS']],
	})],
	plugins: [help()],
})
	.globalOption('quiet', {
		description: 'Suppress progress messages.',
		extensions: [helpInput({ section: ['Output'] })],
		short: 'q',
		type: 'boolean',
	})
	.command(done)
	.command(next)
	.command(doctor);
```

- **Membership.** A child's `helpCommand.section` places its row on the parent's help page. An option's `helpInput.section` places its row on every page that shows it. A path has exactly one or two heading strings. Each string follows the existing `line` schema. Headings match by their uppercase form, which is also the form printed. They are not trimmed, and stored extension values retain their authored strings. TypeScript rejects an empty path, a path with three entries, and a non-string heading. Extension validation rejects those shapes and any heading the `line` schema rejects. A Command's membership does not enclose its own help page. The root's membership has no effect because the root has no parent.
- **Defaults.** A Command without membership uses `['COMMANDS']`. A local option without membership uses `['OPTIONS']`. A global option without membership uses `['GLOBAL OPTIONS']`, except on a childless root, where it uses `['OPTIONS']`. An authored path replaces the default for that member. Default paths participate in ordering and matching like authored paths, so an option explicitly assigned `['OPTIONS']` joins that default section. Arguments remain in ARGUMENTS.
- **Ownership.** The routed Command's `helpCommand.commandSections` orders its visible children's sections. Its `optionSections` orders the sections of its visible local and global options together. Both lists are optional and may be empty. Neither list is inherited, and the Application's value orders the root page alone. Commands remain before ARGUMENTS, and option sections remain after ARGUMENTS. A Command and an option with the same path belong to separate sections in those separate parts of the page.
- **Ordering.** Ordering applies at each heading level. Listed headings appear first, in their first listed order, and unlisted headings follow by their first visible member's appearance. Each listed path orders its outer heading and, when it has two entries, its inner heading. A one-entry path participates when its outer heading has visible direct members or visible subsections. A two-entry path participates only when that inner section has visible members. Otherwise the entire entry is ignored, even if another subsection makes the outer heading visible. Repeating a path adds no second section or second priority. Outer sections stay together even when their paths are interleaved in the order list. For example, `['Work', 'Read']`, `['Machinery']`, `['Work', 'Lifecycle']` renders Work with Read and Lifecycle, then Machinery. Direct members of an outer section precede its subsections.
- **Member order.** Visible children enter in authoring order. Visible options enter with the local options in declaration order, followed by globals in `graph.globals` order. Members keep that order within each section. Local and global options with the same authored path share one section, with local members first. Membership never changes the graph's lists or the order another projection reads.
- **Layout.** Outer headings are uppercase at the left margin. Direct members are indented two spaces. An inner heading is uppercase and indented two spaces, followed by members indented four spaces. Every outer section is one block, without an internal blank line. One blank line separates it from the next block. The existing row cells, accepted values, facts, and semantic styles apply. Column widths are measured independently for direct members and for each inner section, using `context.width` and `pad`. Hidden members are filtered before ordering and measurement. A heading with no visible members beneath it prints nothing, and a parent with visible subsections prints its heading even when it has no direct members.
- **Variants and projections.** Both variants use the same sections and order. Compact help still omits details and examples alone. Both variants retain their child hint whenever any visible child row prints, including when every child uses an authored section. Heading text is uppercased, then escaped before styling. The default section style is `dim` at both levels. `readExtension` publishes the section fields through the ordinary extension values. Help supplies only details and examples to `manifestCommand`, and completion keeps its descriptions and ordering. No section field is added to core or the manifest.

The command part of `work --help` in the example is:

```text
WORK COMMANDS
  READ
    next  Find ready tasks.
  LIFECYCLE
    done  Complete a task.

COMMANDS
  doctor  Check the application.
```

With no section membership or order fields, existing help pages keep their bytes. [ADR-0058](../decisions/0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md) records the decision.

## Help variants

```ts
// @loomcli/plugins/help/views
export type HelpVariant = 'compact' | 'extended';
```

`-h` asks for compact help, which orients a reader who needs the syntax, and `--help` asks for extended help, which teaches. [ADR-0040](../decisions/0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) records the decision.

- **Selection.** The middleware reads `spellings.help` from its [context](../core/middleware.md). `-h` selects `compact`. Every other case selects `extended`: `--help`, and a help option with no spelling, which only an input source could supply. Help's option binds no variable and carries no configuration binding, so the first-party plugin never meets that case, and the rule keeps the extended page as the answer to a request that names no variant. `jsonkit -h --help` repeats the help option, and the repeated-option fault is held while the earlier `-h` stands, as it does for any repeated global under [Global consumption and routing](../core/commands.md#global-consumption-and-routing), so it prints the compact page. A letter in a short group is spelled `-h`, so `jsonkit -Vh` prints the compact page when help is installed ahead of version. Core supplies no variant fact and knows nothing of help.
- **Compact.** The [page rules](help-page.md#the-help-page) with Details and EXAMPLES omitted, the child hint spelled `-h`, and the pointer `Run <path> --help for details and examples.` when the extended page of the node would print one of the omitted blocks. The masthead keeps its deprecation line, and every row keeps its accepted values and facts, so the compact page loses no rule about what an input accepts.
- **Extended.** Every block of the [page rules](help-page.md#the-help-page).
- **Bindings.** Both pages print an option's bindings in its row's fact parenthesis under the [right-cell rule](help-page.md#the-help-page): `env: <names>` for its [environment binding](../core/input-sources.md), the variables in declaration order separated by a space, and `config: <path>` for the dotted path of its [`configInput`](config.md#linking-an-option) value, so textstat's `--min-bytes` reads `(default: 0, env: TEXTSTAT_MIN_BYTES, config: minBytes)` on `-h` and `--help` alike. Help prints names alone, never a variable's value or a configuration value and no sentence about what a value does, so a Boolean option of every polarity prints its bindings alike. Help reads `configInput` through its descriptor, as the [man page](manpage.md) does, whether or not the configuration plugin is installed; a configuration source another plugin declares binds through its own extension, which help does not read. An option whose `helpInput` holds `hideBindings: true` prints neither fact on either page, while the man page, the manifest, and `inspect()` still publish its bindings. [ADR-0124](../decisions/0124-help-prints-each-options-bound-variables-and-configuration-key-on-both-pages.md) records the decision.
- **Replacement.** `HelpPage` carries `variant`, and `helpPage` stays one declared view. A replacement receives the variant and decides what each one prints, and one that ignores it prints one page for both. A replacement never reads `spellings`.
- **The manifest.** Help's values in the manifest are unchanged: it supplies `details` and `examples` whatever the variant, because the variant is a choice of page, not a fact of the Command.

## Accepted values

```text
OPTIONS
  -m, --metric <metric>        What each row counts. One of: bytes, words, lines.  (default: bytes)
  -f, --format <format>        Select the output format, table by default. One of: table, json, jsonl.
```

An option or an argument row states the values the input accepts, so a reader chooses a valid value before the first run rather than learning it from a validation error. The sentence sits in the right cell after the description and before the facts, under the [right-cell rule](help-page.md#the-help-page).

- **Authored.** An `accepts` value on the input's help extension, `helpInput` for an option and `helpArgument` for an argument, is the sentence, printed as written. It always wins, whatever the input's schema holds, so an author states a pattern, a range, or a long set in their own words. An `accepts` on a Boolean or counted option is never shown.
- **Derived.** Without `accepts`, help derives the sentence from the input's [input schema](../core/validation.md#input-schema) when that schema is a closed set of strings: an `enum` whose members are all strings, a single string `const`, or an `anyOf` whose members are each such an `enum` or `const`, flattened in order, and a multiple option or a variadic argument reads the same shapes, because its input schema describes one value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). Help reads `enum`, `const`, and `anyOf` at the schema's top level, and derives nothing when more than one of the three sits at the same level. Every other keyword beside them must leave each listed value accepted, so help derives only when each one is `type: 'string'` or an annotation, `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, or `deprecated`, and the same holds inside each `anyOf` member. Any other keyword, such as `pattern`, `minLength`, `format`, or `not`, may narrow the set, so it derives nothing, and the author states the set with `accepts`. The sentence is `One of: ` followed by the values in the schema's order, separated by a comma and a space, and a closing period: `One of: bytes, words, lines.`
- **Bounds.** A value that repeats prints once, at its first place, and counts once. Help lists no set of more than eight distinct values, and its row prints as it would without accepted values: eight bounds help's listing, not the derivation, so [completion](completion.md) still offers every value of a larger set. An empty set derives nothing, and neither does any other shape, a `null` schema, or a set holding a member that is not a string; the row then prints as it would without accepted values. A member that is not a string derives nothing because the list prints tokens exactly, and help does not decide how a token spells a number, a Boolean, or `null`.
- **Quoting.** A value that is empty or holds whitespace, a comma, a double quote, or a control character prints as its JSON string, `One of: "a b", c.`, so the list splits unambiguously. A line terminator inside it prints as its JSON escape, as a rendered default's does, so the list adds no line break of its own, and DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX` escapes, so no control character reaches the terminal. Every value is escaped before styling, as every graph string on the page is.
- **Not the manifest's.** `accepts` is help's own fact for a human reader. Help does not supply it to the [manifest](manifest.md), where an agent reads the exact `schema`.

The [formatter](format.md)'s `--format` carries the enum of its view names, so its row derives them, and the formatter's description names only the default. A Command with more than eight view names prints none of them in help; `inspect()` and the manifest still carry the enum.

## Help and version restyle

```ts
// The inputs of the default help and version views.
import type { DeclaredView } from '@loomcli/core';
import type { HelpPage } from '@loomcli/plugins/help/views';
import type { VersionLine } from '@loomcli/plugins/version/views';

// Exported from @loomcli/plugins/help/views and @loomcli/plugins/version/views.
declare const helpPage: DeclaredView<HelpPage>;
declare const versionLine: DeclaredView<VersionLine>;
```

```text
OPTIONS
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.
```

- **Content.** The page keeps its masthead, details, usage forms, section order, filtering, row facts, examples, hint, indentation, blank lines, and final newline. The application path remains first in the masthead. Neither default view adds a framework logo or branding glyph. Available view names print as the `--format` row's [accepted values](#accepted-values), with no separate section.
- **Escaping.** Graph strings, help extension strings, and rendered default values are literal data. The view escapes each raw fragment with `style.escape` before styling or measuring it. It never escapes the completed marked page or recovers semantic fields by parsing a rendered row. Authored markup in a description or example remains literal. Existing default serialization and line-terminator escaping remain unchanged. Embedded ANSI remains subject to core's separate rendering policy.
- **Measurement.** The two-column rule uses destination-aware `context.width` and core's deferred `pad`. This replaces JavaScript string-length padding. It preserves ASCII spacing while aligning wide and combining characters under core's existing rules. Styling never changes which members or sections appear. The version view neither wraps nor reads the width, and the help view wraps on a terminal under [Help wraps to the destination's columns](help-page.md#help-wraps-to-the-destinations-columns).
- **Policy.** Views return semantic marked strings. The installed theme and core's destination policy determine colors and modifiers. A missing theme leaves semantic colors unmapped, while explicit bold and italic still follow modifier policy. Under automatic policy, an ordinary pipe has no style escapes. At a capable terminal, `NO_COLOR` disables color but does not disable bold or italic. Explicit policy and `FORCE_COLOR` retain their existing precedence. The plain examples disable both colors and modifiers.
- **Replacement.** `helpPage` keeps `{ graph, command }`, which [help variants](#help-variants) extend with `variant`. `versionLine` takes `VersionLine`, `{ graph, postfix }`, since the [version postfix](version.md). Each override replaces the whole view through the existing registry. A replacement derives its own content and owns its layout, literal-data escaping, styles, and final newline. No public section model or builder is introduced.

The default help view applies this mapping. A style named below is a member of the run-specific `style` object.

| Page part | Style |
| --- | --- |
| Masthead application path | `highlight.bold` |
| Masthead middle dot | `dim` |
| Masthead description, and details text under [Markdown styles](help-page.md#markdown-styles) | `primary` |
| Section titles | `dim` |
| Application paths, child command names, and option spellings outside authored examples | `highlight` |
| Placeholders, including their brackets, the `[=` and `]` around an implied value's placeholder, and variadic suffix, the `...` after a counted option's spellings, and argument labels in ARGUMENTS | `dim.italic` |
| Argument forms in USAGE, `[options]`, and the `<command>` or `[command]` markers in USAGE and COMMANDS | `dim.italic` |
| Option spelling separator `,` | `dim` |
| Descriptions in right cells | `primary` |
| Accepted-values sentences in right cells | `primary` |
| Fact parentheses, fact separators, `required`, `repeatable`, `default: <value>`, `implied: <value>`, `env: <names>`, and `config: <path>` | `dim` |
| `deprecated: <message>` inside a fact list | `warning` |
| The entire `Deprecated: <message>` line below a masthead, excluding indentation | `warning` |
| Example `$` prompt | `dim` |
| Application name added before an authored example | `highlight` |
| Authored example command text | `primary` |
| Example note | `dim` |
| Hint words `Run`, `for command details.`, and `for details and examples.` | `dim` |
| Hint application path, `--help`, and `-h` | `highlight` |
| Hint `<command>` | `dim.italic` |

Indentation, padding, spaces between styled parts, and newlines are unstyled. Spaces inside a styled text value retain that value's style. A placeholder's internal `...`, and the `...` after a required multiple option's placeholder, share its dim italic style, and so does the `...` after a counted option's spellings. The `--[no-]name` spelling is one highlighted option spelling, not a placeholder. Deprecated rows keep their name and description styles. Only the deprecation fact uses warning, with surrounding parentheses and separators still dim. The text stays explicit when color is off, and no warning glyph is added.

Examples remain opaque authored text. The view styles only the prompt and application name it adds, the whole authored command string, and the optional note. It does not parse shell syntax or highlight individual flags inside that string.

The formatter hook sets its description to `Select the output format, <default> by default.`, where `<default>` is the result's declared default name at that hook. The view names are not in the description: the option's input schema is the enum of the names, in record order after `json` and `jsonl` are appended where absent, and the page prints them as the row's [accepted values](#accepted-values). A plugin whose hook changes the default installs before `format()` for the description to reflect that choice. Later hooks do not retroactively update the description. The description is ordinary literal graph text, so the whole sentence uses the description's `primary` style. It is not the right-cell `default:` fact, and the option still declares no parser default. An omitted `--format` preserves an earlier middleware's selection. Help does not infer formatter ownership from an option name or inspect the result to synthesize this sentence. A Command without the formatter has no synthetic format row or view list.

## Help paging

```ts
// @loomcli/plugins/help
export interface HelpSettings {
	readonly paging?: boolean; // new: page a long help page through the operator's pager
}

export declare function help(settings?: HelpSettings): Plugin<HelpOptions>; // new: takes settings
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

// On a 24-row terminal, jsonkit --help opens its 40-line page in less, and q returns to the prompt with exit 0.
// PAGER=cat jsonkit --help, jsonkit --help | grep file, and jsonkit -h on a 60-row terminal print as before.
const jsonkit = new Application('jsonkit', { plugins: [help({ paging: true })] });
```

A help page longer than the screen scrolls its masthead and usage out of sight. With paging on, help hands such a page to the operator's pager, as git and man do, and prints every other page as before. Paging is off by default. [ADR-0115](../decisions/0115-help-pages-a-long-page-through-the-operators-pager-on-opt-in.md) records the decision.

- **The setting.** `help({ paging: true })` turns paging on. With no settings, or `paging: false`, every page prints through `out.render`, byte for byte as before. The types reject a `paging` that is not a Boolean, and help adds no rule for one, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **When a page goes to the pager.** With paging on, help pages the page when each of these holds, and otherwise prints it through `out.render` as before: `host.terminal.stdout.isTTY` is true; `TERM` in `host.env` holds a value other than `dumb`, and an empty `TERM` reads as unset; the run is not under CI; `PAGER` does not turn paging off, below; `host.terminal.stdout.rows` is a number; and the page has at least that many lines. Help judges stdout and the environment and never reads the [interaction decision](../core/interaction.md), so `jsonkit --help < /dev/null` on a terminal still pages, while a pipe, a redirect, an [invocation by name](../core/invocation.md), and so every [MCP](mcp.md) tool call never do.
- **Not under CI.** A run is under CI when `CI` in `host.env` is set, nonempty, and not `false`, as [ADR-0114](../decisions/0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md) reads it. A pager waits for keys that a CI runner's pseudo-terminal never sends, so under CI every page prints through `out.render`. `CI=false` lets help page again.
- **Counting the page.** Help takes the page from [`out.text`](../core/output.md#a-views-text-without-a-write), so it is the bytes `out.render` would write: laid out at stdout's `columns` under [Help wraps to the destination's columns](help-page.md#help-wraps-to-the-destinations-columns), styled under stdout's policy, and drawn by an application's override of `helpPage` when one applies. Its line count is the number of line feeds it holds. A literal wider than the screen counts as one line, and `F` in `LESS`, below, quits at once on a page that turns out to fit.
- **The pager.** `PAGER` in `host.env` names the pager, and `less` stands in when `PAGER` is unset. A `PAGER` that is empty or holds only whitespace, or that holds `cat` with surrounding whitespace alone, turns paging off for the run, the standard switch git and man honor. Help declares no option and binds no variable for it, and no other option, an application's quiet option included, changes it.
- **Through the shell.** Help runs the `PAGER` text through the shell, as git and man-db do, so a quoted path, arguments, and a pipeline work: it starts `/bin/sh` through [`host.spawn`](../core/host.md#child-programs) with the arguments `-c` and `exec ` followed by the `PAGER` text, so the shell replaces itself with the pager's program, which is then the child help ends. A `PAGER` that opens with a variable assignment, such as `LESS=-R less`, makes `exec` report the assignment as a program it cannot find, and the page prints unpaged under the could-not-start rule below; `env LESS=-R less` pages. `host.spawn` itself runs no shell, and the pager is the one child the pack starts through one, because `PAGER` is the operator's own command line from the operator's own environment. The shell finds the program on `PATH` in the pager's environment, which is `host.env` with `LESS` set to `FRX` when `host.env` holds no `LESS`, so less passes color through, quits on a page that fits one screen, and leaves the page on the screen when it quits. An operator's `LESS`, an empty one included, stands. The pager's working directory is `host.cwd`.
- **The streams.** Help hands the page to `host.spawn` as the child's `input`, which is written to the pager's standard input and then closed. The pager's standard output and standard error are `inherit`, the run's own, so it draws on the terminal itself. Help waits for the pager to exit and adds no time limit, because how long the operator reads is the operator's.
- **Ctrl-C ends the application.** While the pager is open, `SIGINT` cancels the run as it does anywhere else, and the pager ends with the run, so no pager is left running on the terminal. Help does not hold `SIGINT` while the pager runs, as git does, and adds no listener of its own. less catches `SIGINT` and stays open, so the run ends it: help passes the run's `signal` to `host.spawn`, so the run's abort, by a [shutdown](../core/signals.md#the-shutdown) or any other cause, sends `SIGTERM` to the pager, on which less restores the terminal and quits, and the run resolves its cancellation code, 130 for `SIGINT`. While the pager is open, help also holds an [`onShutdown`](../core/signals.md#onshutdown) handler that sends the pager `SIGTERM`, never `SIGKILL`, which would leave the terminal without echo, so a run the shutdown cuts off before the pager exits still leaves none behind, and it removes the handler once the pager exits. Cleanup is guaranteed for a `PAGER` that names one command. A `PAGER` that is a pipeline, such as `tr a-z A-Z | less`, has a limit: `exec` replaces the shell with no single program, so `SIGTERM` ends the shell alone, and a member of the pipeline, less included, can outlive the run, however the run is cancelled.
- **The exit.** Help ignores every exit code of the pager but the two that mean it could not start, below, and the run exits 0, as every help takeover does, unless the run is cancelled while the pager is open. An operator who quits before the pager has read the whole page closes its input early. That input is the child's, not the run's stdout, so the closed pipe is neither an error nor the [closed reader](../core/signals.md#the-run-signal) that ends a run with 141.
- **A pager that cannot start.** When `host.spawn` reports the shell `unstarted`, or the shell exits 127 or 126 because it could not run the command, help prints the page through `out.render` as if paging were off, and the run exits 0. A line the shell wrote about the command, such as `sh: 1: most: not found`, stays on stderr ahead of the page.
- **Only the help page.** Paging covers the help page, compact and extended, and nothing else: the version line, a failure, a result, and every other plugin's output print as before. A paged page holds the bytes help prints unpaged, and only where they go changes.
- **Testing.** The pager starts through `host.spawn`, so a test of a paged page under [`mockProcess`](../libs/testing.md#mockprocess), with a terminal stdout that reports `rows` and a `TERM`, scripts `/bin/sh` in `programs`, and the script receives `-c`, `exec ` followed by the `PAGER` text, and the page as its input. A test that leaves `/bin/sh` unscripted meets the mock's sentence for a program it has no script for.
- **Names.** `help`, `HelpOptions`, and `HelpSettings`, the type of its settings, are exported from `@loomcli/plugins/help`.

## When author code fails

An application's override of `helpPage` is author code. A replacement that throws or rejects makes the `out.render` call in help's middleware reject, or, with paging on, the `out.text` call throw, and the run takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path). An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Help adds no outcome of its own for a broken view.
