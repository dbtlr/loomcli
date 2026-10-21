---
description: "The help plugin: the help page, help extensions, ordered sections, variants, accepted values, markdown details, and wrapping."
---

# Help plugin

`help()` declares one Boolean option, `help`, with the short spelling `h`, the description `Show this help.`, and `control: true` under [Control options](../core/commands.md#control-options), a middleware activated by it, the three extensions below, the `onCommandAttach` hook of [Help in the manifest](#help-in-the-manifest), and the `onFailure` hook of [Help's failure hint](suggestions.md#helps-failure-hint). The middleware renders the [help page](#the-help-page) of the routed Command through the plugin's declared view, `helpPage`, a `DeclaredView<HelpPage>` where `HelpPage` is `{ readonly graph: CommandGraph; readonly command: CommandNode; readonly variant: HelpVariant }`. It derives the [variant](#help-variants) from `spellings.help`, calls `out.render({ command, graph, variant }, helpPage)`, and returns without calling `next()`, so the exit code is 0. The default function derives the page content from `graph`, `command`, and `variant` alone and ends the page with exactly one newline. The installed view escapes raw fragments before styling, as specified by the [help restyle](#help-and-version-restyle). Stdout holds the resolved page and one line terminator. An application overrides `helpPage` to change the page while `help()` stays installed, which is the acceptance target of the registry increment; the data it receives is the graph, the routed node, and the variant, and a replacement owns its own escaping, layout, and newline. The restyle retains `{ graph, command }`, help variants add `variant`, and neither adds a public structured page model or builder. `jsonkit --help` renders the root, `jsonkit get --help` renders `get`, and `jsonkit cache --help` renders the `cache` group, because the group's missing-subcommand fault is held before the chain and raised at the dispatch boundary, which the takeover never reaches. An unknown command still fails in routing, so `jsonkit nope --help` reports the unknown command. A fault core held from local parsing or validation is never raised under the takeover, so `jsonkit get --help` renders while `get` is missing its required `path`, and `jsonkit select --bogus --help` renders too. Like every global option, `--help` is read at any placement before `--`, in a short group with the routed Command's local options included, and every fault but an unknown command is held, so `textstat -ht` renders the root's page and `jsonkit -F name select --help` renders it although `-F` is misplaced. There is no `jsonkit help get` form: a `help` command would share the namespace with the application's own commands, and it would be a second way to say one thing.

The page is derived from the graph and the variant by the rules below and nothing else, so a test compares the bytes of `jsonkit --help` with a page written by hand.

## Help extensions

Three descriptors are exported from `@loomcli/plugins/help/extension`, and all are help's own facts; every other fact the page prints is a core fact. Each field is optional, and the descriptor's schema carries every rule below, so the call that receives a value that breaks one rejects it the way it rejects any extension value its schema rejects. The declared view is exported from `@loomcli/plugins/help/views`, a second declarations module, because it imports the page module: the page code loads with the plugin's entry module, the descriptor module stays declarations alone, and the middleware module holds nothing but the call. A graph fact that carries a marker character prints literally. The restyle escapes raw fragments before it adds style markers, and a replacement owns that escaping obligation.

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
import { array, object, optional, pipe, regex, strictTuple, string, union } from 'valibot';

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

`helpCommand` targets Commands, so a Command or the Application carries it. `details` is [Markdown](#markdown-details) the extended page renders after the masthead, a string that holds a character other than whitespace, with blank lines allowed, written inline or brought in with a text import. `examples` lists invocations the page prints under EXAMPLES: `command` holds the tokens after the application name as one line, and `note` is one line printed under it. `helpInput` targets options, so a local option and a global option carry it, whoever declares it. `placeholder` is the word the page shows for a string option's value, `<path>` for a `--file` declared with `placeholder: 'path'`; it holds no whitespace, and without it the page shows the option's declared name. A `placeholder` on a Boolean or counted option is accepted and never shown, because neither takes a value. `accepts` is one line the page prints as the input's [accepted values](#accepted-values), in place of any list help would derive from the schema; an `accepts` on a Boolean or counted option is accepted and never shown, for the same reason. `helpArgument` targets arguments and carries `accepts` alone: an argument's placeholder is its declared name, which the author already chose, and its description is a core fact. The value a projection reads back through `readExtension` is the schema's output, deeply read-only, with an omitted field absent and an explicit `undefined` dropped, as every stored extension value drops it.

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

## The help page

The page rules below define the default content and layout. [Ordered help sections](#ordered-help-sections) replace the Command and option blocks when section fields are declared. The [help and version restyle](#help-and-version-restyle) adds semantic styles without changing that structure. Output is UTF-8, and no meaning depends on styling. The page reads the routed `CommandNode`, `graph.globals`, `graph.name`, and `graph.description`, plus the help extension values those nodes carry. It reads no host facts. On a terminal it lays the page out against its view context's `columns`, under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns). Each rule applies to both [variants](#help-variants) unless it names one: Details and EXAMPLES print on the extended page alone, and the hints differ.

The page is a sequence of blocks separated by one blank line, and no block holds a blank line of its own except Details, which keeps one blank line wherever the author separated two Markdown blocks, and the empty lines inside its code. A block that has nothing to show is omitted. Outer section titles are uppercase at the left margin. The default layout indents every other line two spaces, except hints. [Ordered help sections](#ordered-help-sections) add inner headings indented two spaces and inner rows indented four spaces. A line at the left margin is the masthead, an outer section title, or a hint and nothing else. `<name>` below is the application name, and `<path>` is the name followed by the routed path, space-separated: `jsonkit`, `jsonkit get`, or `store cache clear`. A member is visible when it is not hidden.

1. **Masthead.** `<path> · <description>`, with a space, U+00B7, and a space as the separator, or `<path>` alone when the node has no description. When the routed Command is deprecated, a second line `  Deprecated: <message>` follows in the same block. A description and a migration message each print as one line, wherever the page shows them: each line break the author wrote, CRLF or a single terminator, reads as one space.
2. **Details.** Extended alone. The routed node's `details`, rendered under [Markdown details](#markdown-details), each line indented two spaces. Help reads the same line terminators the schema recognizes, CRLF and each single terminator, as line breaks and joins with LF, so an authored CR or NEL never reaches the page.
3. **USAGE.** One line per form, each beginning with `<path>`. The action form is `<path> <arguments> <required options> [options]`: each declared argument in declaration order as `<name>` when required and `[name]` when optional, with `...` inside the brackets for a variadic, so `<path>`, `[path]`, `<files...>`, and `[files...]`; then each visible option that declares `required: true`, in declaration order, which is always the node's own because a global option declares no presence rule, except a [content input](../core/validation.md#content-inputs) that accepts stdin, which piped stdin can satisfy, so its row's `required` fact alone says a source is needed, as `--long <placeholder>`, or `-s <placeholder>` for a `shortOnly` option, or `--long[=<placeholder>]` and `-s[<placeholder>]` for an option with an [implied value](../core/options.md#implied-values), with `...` appended for a multiple option; then `[options]`, which is always present because the help option is one. A node with an action prints the action form. A node with a visible child prints the children form, `<path> <command> [options]`, after the action form when both apply. A group whose children are all hidden prints the children form alone, because it has no other form.
4. **COMMANDS.** For a node with a visible child, one row per visible child in authoring order. The left cell is the child's name, followed by ` <command>` when the child is a group and by ` [command]` when it has an action and children. The right cell follows the right-cell rule below, with `deprecated` as its one possible fact.
5. **ARGUMENTS.** For a node with arguments, one row per argument in declaration order. The left cell is the name, and the right cell follows the right-cell rule, with a [content input](../core/validation.md#content-inputs)'s source facts and `default` as its possible facts.
6. **OPTIONS.** The routed node's visible local options in declaration order, one row each; on the root page of an Application with no children, the visible globals follow them in `graph.globals` order, in this one section. The left cell is the spellings, then ` <placeholder>` for a string option: `-f, --file <path>` with both spellings, `    --explain` with a long spelling alone, indented four spaces so the long spellings align, and `-m <metric>` for a `shortOnly` string option. A string option with an [implied value](../core/options.md#implied-values) shows its placeholder in brackets after `=`, `-b, --backup[=<control>]`, and after the letter alone, `-b[<control>]`, for a `shortOnly` one, because only an attached value replaces the implied value, and its right cell carries the fact `implied: <value>`, so the row reads `-b, --backup[=<control>]  How to back up each file.  (implied: simple)`. A [counted option](../core/options.md#counted-options) has no placeholder, and its spellings end with `...`, `-v, --verbose...`, or `-v...` for a `shortOnly` one, because each occurrence adds one; it never carries `repeatable`, `required`, or `default`, since the `...` already says it repeats and a count has no presence rule or default. The option that carries the [quiet mark](../core/verbosity.md) shows no `...`, `-q, --quiet`, because a further occurrence adds nothing. A Boolean option's long spelling follows its polarity: `--total` for `positive`, `--no-total` for `negative`, and `--[no-]total` for `both`. The right cell follows the right-cell rule. A Boolean option with `negative` polarity carries the fact `default: true`, because its absent value is `true` and both of its spellings set it to `false`; the other polarities carry no default fact, because their absent value is `false`.
7. **GLOBAL OPTIONS.** On every page except the root page of an Application with no children, the visible globals in `graph.globals` order, one row each under the OPTIONS rule, so the reader sees which options belong to this Command and which reach every Command.
8. **EXAMPLES.** Extended alone. For a node that carries `examples`, one entry each: `$ <name> <command>`, then the note on the next line indented two more spaces.
9. **Hints.** One block of up to two lines, each at the left margin. When the page printed any child Command row, the first line is `Run <path> <command> --help for command details.` on the extended page and `Run <path> <command> -h for command details.` on the compact page. On the compact page alone, when the extended page of the same node would print Details or EXAMPLES, the last line is `Run <path> --help for details and examples.`

The right-cell rule: the description when the member has one, on one line, then, for an option or an argument that has them, its [accepted values](#accepted-values) as one sentence, then, when any fact applies, one parenthesis holding the facts that apply, comma-separated, in this order: for a [content input](../core/validation.md#content-inputs), its source routing, `file or piped stdin; - selects stdin` for one source that accepts stdin, `files and piped stdin; - places stdin` for a multiple option or a variadic argument that accepts it, and `file path` for one that does not, then `min: <n> sources` and `max: <n> sources` when declared, with `source` for a count of 1; `required`, or `required when not interactive` for an option that declares `required: 'non-interactive'`, `repeatable` for a multiple option, `default: <value>`, `implied: <value>` for an option with an [implied value](../core/options.md#implied-values), and `deprecated: <message>`. One space separates the description from the accepted-values sentence, and help prints both as written, adding no punctuation between them; two spaces separate the text before the parenthesis from it; a member with neither description nor accepted values has the parenthesis as its whole right cell, with no leading spaces; and a member with none of the three has no right cell. The parenthesis begins at the first `  (` that is followed by `file path`, `file or piped stdin`, `files and piped stdin`, `min: `, `max: `, `required`, `repeatable`, `default: `, `implied: `, or `deprecated: `, and it ends at the closing `)` that ends the row's unwrapped text, and `deprecated` is always the last fact, so a reader splits the earlier facts on the comma and reads the text between `deprecated: ` and that closing parenthesis as the message. The page is a rendering for a reader; a consumer that needs a fact exactly, whatever a description, an accepted-values sentence, or a default holds, reads it from `inspect()`, which is the machine surface, and that includes a deprecated message, which may itself hold a comma or a parenthesis. An implied value prints, and is escaped, exactly as a default that is a string does. A default value prints as it is when it is a string, as its elements separated by a space when it is an array of strings, as `JSON.stringify` renders it for any other value JSON can represent, and as `String(value)` renders it otherwise, or as Object's own spelling, such as `[object Array]`, where `String` throws; an explicit `undefined` default prints no default fact, and a line terminator inside a rendered default prints as its JSON escape, so a rendered default adds no line break of its own.

Within a section the rows are two columns: the left cell is padded to the longest left cell in that section plus two spaces, and a row with no right cell has no trailing padding. The view measures terminal columns with `context.width` and pads to the widest cell with core's `pad` from [Width, padding, and multiline lanes](../core/styles.md#width-padding-and-multiline-lanes). Markup contributes no width, and Unicode follows core's existing measurement rules. Off a terminal nothing wraps, so a long row is one line however long it is. On a terminal a right cell wraps under its column, and a row set that cannot fit stacks, under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns).

The root of jsonkit has an action and ten children: the `doctor` Command the private `@loom/doctor` plugin attaches, the `completion` group the [completion](completion.md) plugin attaches, the `mcp` Command the [MCP](mcp.md) plugin attaches, and the `manpage` group the [manpage](manpage.md) plugin attaches, ahead of jsonkit's own in installation order, then six of its own, of which `fetch` is deprecated and `debug` and `paths` are hidden. It declares two local options: `--file`, the [content input](../core/validation.md#content-inputs) every jsonkit Command that reads the document declares, and `--format`, which the [formatter](format.md) declared on it because it declares a result, so the restyled `jsonkit --help` has this text with color and modifiers disabled:

```text
jsonkit · Read and reshape one JSON document.

  With no subcommand, jsonkit summarizes the document and its top-level keys.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

DOCUMENT COMMANDS
  READ
    get    Read one value at a path.
    keys   List the keys at a path.
    fetch  Read one value at a path.  (deprecated: Use get instead.)
  RESHAPE
    select  Keep the named fields of the document.

COMMANDS
  doctor                Check the host this application runs on.
  completion <command>  Print or install a shell completion script.
  mcp                   Serve this application's tools to an MCP client over stdin and stdout.
  manpage <command>     Write or install the man pages.

OPTIONS
  -f, --file <path>      The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.

GLOBAL OPTIONS
  -h, --help        Show this help.
  -V, --version     Print the version.
  -M, --manifest    Print this command's manifest as JSON.
  -e, --explain     Explain the selected command and exit.
      --[no-]color  Turn color on or off, overriding NO_COLOR.
  -v, --verbose...  Show more detail. Repeat it for more.
  -q, --quiet       Hide info and success messages.

EXAMPLES
  $ jsonkit -f doc.json
  $ jsonkit get user.name -f doc.json

Run jsonkit <command> --help for command details.
```

`select` is a leaf with the `--file` content input, one required multiple option, and no `details` or `examples`, so the restyled `jsonkit select --help` has this text with color and modifiers disabled:

```text
jsonkit select · Keep the named fields of the document.

USAGE
  jsonkit select --field <field>... [options]

OPTIONS
  -f, --file <path>    The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)
  -F, --field <field>  A field to keep. Repeat it for several.  (required, repeatable)

GLOBAL OPTIONS
  -h, --help        Show this help.
  -V, --version     Print the version.
  -M, --manifest    Print this command's manifest as JSON.
  -e, --explain     Explain the selected command and exit.
      --[no-]color  Turn color on or off, overriding NO_COLOR.
  -v, --verbose...  Show more detail. Repeat it for more.
  -q, --quiet       Hide info and success messages.
```

textstat is one root Command with a variadic argument, four local options, of which `--timing` is hidden and `--min-bytes` carries the [alias](../core/options.md#option-aliases) `--minimum` that no page lists, a fifth local option `--format` that the [formatter](format.md) declared on it because it declares a result, and no children, so its page folds the globals into OPTIONS. The restyled `textstat --help` has this text with color and modifiers disabled:

```text
textstat · Count bytes, words, or lines across text sources.

  Textstat counts files and piped text in order. Use - to place stdin among the files.

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files and piped text to count. Use - to place stdin.  (files and piped stdin; - places stdin)

COUNTING
  MEASURE
    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)
  FILTER
    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
  SUMMARY
    -t, --total  Add a total row.

OPTIONS
  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.
  -h, --help             Show this help.
  -V, --version          Print the version.
  -M, --manifest         Print this command's manifest as JSON.
  -c, --config <config>  Read configuration from this file alone.
  -e, --explain          Explain the selected command and exit.

EXAMPLES
  $ textstat one.txt two.txt
  $ textstat --metric words --total *.md
```

`textstat -h` prints the compact page, without the details and EXAMPLES blocks, and it points to the extended page because those blocks hold something:

```text
textstat · Count bytes, words, or lines across text sources.

USAGE
  textstat [files...] [options]

ARGUMENTS
  files  The files and piped text to count. Use - to place stdin.  (files and piped stdin; - places stdin)

COUNTING
  MEASURE
    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)
  FILTER
    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)
  SUMMARY
    -t, --total  Add a total row.

OPTIONS
  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.
  -h, --help             Show this help.
  -V, --version          Print the version.
  -M, --manifest         Print this command's manifest as JSON.
  -c, --config <config>  Read configuration from this file alone.
  -e, --explain          Explain the selected command and exit.

Run textstat --help for details and examples.
```

`jsonkit -h` prints both hints, the child hint first:

```text
jsonkit · Read and reshape one JSON document.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

DOCUMENT COMMANDS
  READ
    get    Read one value at a path.
    keys   List the keys at a path.
    fetch  Read one value at a path.  (deprecated: Use get instead.)
  RESHAPE
    select  Keep the named fields of the document.

COMMANDS
  doctor                Check the host this application runs on.
  completion <command>  Print or install a shell completion script.
  mcp                   Serve this application's tools to an MCP client over stdin and stdout.
  manpage <command>     Write or install the man pages.

OPTIONS
  -f, --file <path>      The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)
  -o, --format <format>  Select the output format, records by default. One of: records, json, jsonl.

GLOBAL OPTIONS
  -h, --help        Show this help.
  -V, --version     Print the version.
  -M, --manifest    Print this command's manifest as JSON.
  -e, --explain     Explain the selected command and exit.
      --[no-]color  Turn color on or off, overriding NO_COLOR.
  -v, --verbose...  Show more detail. Repeat it for more.
  -q, --quiet       Hide info and success messages.

Run jsonkit <command> -h for command details.
Run jsonkit --help for details and examples.
```

`jsonkit select -h` prints the `jsonkit select --help` page above unchanged, because `select` carries no details or examples, so the compact page has nothing to point to.

The deprecated child `fetch` carries its message as the last fact of its row, and its own page opens with `jsonkit fetch · Read one value at a path.` followed by `  Deprecated: Use get instead.`. The hidden child `debug` appears on no page above, and `jsonkit debug --help` prints its own page like any other. A group child `cache` with the description `Manage the cache.` would add the row `cache <command>  Manage the cache.`.

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
- **Defaults.** A Command without membership uses `['COMMANDS']`. A local option without membership uses `['OPTIONS']`. A global option without membership uses `['GLOBAL OPTIONS']`, except on a childless root, where it uses `['OPTIONS']` as today. An authored path replaces the default for that member. Default paths participate in ordering and matching like authored paths, so an option explicitly assigned `['OPTIONS']` joins that default section. Arguments remain in ARGUMENTS.
- **Ownership.** The routed Command's `helpCommand.commandSections` orders its visible children's sections. Its `optionSections` orders the sections of its visible local and global options together. Both lists are optional and may be empty. Neither list is inherited, and the Application's value orders the root page alone. Commands remain before ARGUMENTS, and option sections remain after ARGUMENTS. A Command and an option with the same path belong to separate sections in those separate parts of the page.
- **Ordering.** Ordering applies at each heading level. Listed headings appear first, in their first listed order, and unlisted headings follow by their first visible member's appearance. Each listed path orders its outer heading and, when it has two entries, its inner heading. A one-entry path participates when its outer heading has visible direct members or visible subsections. A two-entry path participates only when that inner section has visible members. Otherwise the entire entry is ignored, even if another subsection makes the outer heading visible. Repeating a path adds no second section or second priority. Outer sections stay together even when their paths are interleaved in the order list. For example, `['Work', 'Read']`, `['Machinery']`, `['Work', 'Lifecycle']` renders Work with Read and Lifecycle, then Machinery. Direct members of an outer section precede its subsections.
- **Member order.** Visible children enter in authoring order. Visible options enter with the local options in declaration order, followed by globals in `graph.globals` order. Members keep that order within each section. Local and global options with the same authored path share one section, with local members first. Membership never changes the graph's lists or the order another projection reads.
- **Layout.** Outer headings are uppercase at the left margin. Direct members are indented two spaces. An inner heading is uppercase and indented two spaces, followed by members indented four spaces. Every outer section is one block, without an internal blank line. One blank line separates it from the next block. The existing row cells, accepted values, facts, and semantic styles apply. Column widths are measured independently for direct members and for each inner section, using `context.width` and `pad` as today. Hidden members are filtered before ordering and measurement. A heading with no visible members beneath it prints nothing, and a parent with visible subsections prints its heading even when it has no direct members.
- **Variants and projections.** Both variants use the same sections and order. Compact help still omits details and examples alone. Both variants retain their child hint whenever any visible child row prints, including when every child uses an authored section. Heading text is uppercased, then escaped before styling. The default section style is `dim` at both levels. The three descriptor identities, `HelpPage`, and the whole-page override remain unchanged. `readExtension` publishes the new fields through the ordinary extension values. Help still supplies only details and examples to `manifestCommand`, and completion keeps its existing descriptions and ordering. No section field is added to core or the manifest.

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

## Ordered help sections acceptance

Public API fixtures prove the following rules under Node and Bun, including rendered output and packed-package checks.

- **Paths and storage.** One-level and two-level membership compile and reach the frozen extension values, whether help is installed or not. An empty path, a three-entry path, and a non-string heading fail TypeScript checks and ordinary extension validation. A blank or multiline heading fails the `line` rule. The same checks apply to entries in either order list. Membership paths whose headings have the same uppercase form combine, order entries match that same form, and title-case references such as `Global options` match default headings. Stored strings retain their authored spelling.
- **Commands.** A page with direct and nested sections, unsectioned children, interleaved order entries, duplicate entries, unlisted sections, and an entry for an absent section pins the heading and member order. A two-entry order path for an absent or entirely hidden subsection does not position its visible outer heading. A parent-only order entry positions that outer heading when another subsection is visible. A child page uses its own ordering, while that child's membership affects only its row on the parent page. Plugin-attached Commands use the same membership rules.
- **Options.** `optionSections` orders local and global sections together, including GLOBAL OPTIONS before OPTIONS when explicitly listed that way. Direct and nested option sections cover partial, interleaved, repeated, parent-only, and absent order entries. A child's page uses its own order for global and local members even when the root declares an option order. Every option section remains after ARGUMENTS. A named section combines a local option and a global option, with local members first. A childless root folds unsectioned globals into OPTIONS, while a page with children retains the two default sections. A root with hidden children alone retains GLOBAL OPTIONS as today. An authored default path joins the default section. Global options declared by a plugin follow the same rules.
- **Filtering and layout.** Hidden members create no headings and affect no widths. An outer heading containing only visible subsections remains. Golden bytes pin two-space inner headings, four-space inner rows, two-space direct rows, blank lines, and the final newline. Wide and combining characters align using the existing width rules. Marker characters in headings print literally under both plain and styled output.
- **Variants and other projections.** Compact and extended pages have the same section layout, with their existing differences in details, examples, and hints. Both variants retain the child hint when every visible child uses an authored section and no COMMANDS heading prints. A whole-page replacement can read section fields through `readExtension`. The manifest receives details and examples alone, and its graph order and completion output are unchanged.
- **Compatibility and delivery.** Unsectioned fixture pages remain byte-for-byte unchanged. Both examples opt into authored sections through the public descriptors, and packed-package checks exercise grouped help under Node and Bun. An ordinary change fragment describes the new fields and layout. No version field changes in the implementation PR.

## Help variants

```ts
// @loomcli/plugins/help/views
export type HelpVariant = 'compact' | 'extended';
```

`-h` asks for compact help, which orients a reader who needs the syntax, and `--help` asks for extended help, which teaches. [ADR-0040](../decisions/0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) records the decision.

- **Selection.** The middleware reads `spellings.help` from its [context](../core/middleware.md). `-h` selects `compact`. Every other case selects `extended`: `--help`, and a help option with no spelling, which only an input source could supply. Help's option binds no variable and carries no configuration binding, so the first-party plugin never meets that case, and the rule keeps the extended page as the answer to a request that names no variant. `jsonkit -h --help` repeats the help option, and the repeated-option fault is held while the earlier `-h` stands, as it does for any repeated global under [Global consumption and routing](../core/commands.md#global-consumption-and-routing), so it prints the compact page. A letter in a short group is spelled `-h`, so `jsonkit -Vh` prints the compact page when help is installed ahead of version. Core supplies no variant fact and knows nothing of help.
- **Compact.** The page rules above with Details and EXAMPLES omitted, the child hint spelled `-h`, and the pointer `Run <path> --help for details and examples.` when the extended page of the node would print one of the omitted blocks. The masthead keeps its deprecation line, and every row keeps its accepted values and facts, so the compact page loses no rule about what an input accepts.
- **Extended.** Every block of the page rules, which is the page `--help` printed before variants. Help prints no environment or configuration binding on either page: help teaches command-line syntax, and a variable or a configuration file belongs to the documentation.
- **Replacement.** `HelpPage` carries `variant`, and `helpPage` stays one declared view. A replacement receives the variant and decides what each one prints, and one that ignores it prints one page for both, as every replacement did before. A replacement never reads `spellings`.
- **The manifest.** Help's values in the manifest are unchanged: it supplies `details` and `examples` whatever the variant, because the variant is a choice of page, not a fact of the Command.

Compared with the page rules before this section, the changed rules are: `-h` prints the compact page; `--help` prints the page it printed before; the hint becomes a block that may hold the pointer; and `HelpPage` gains `variant`. The help option's row and description are unchanged.

## Help variants acceptance

Help variants are proven when public APIs alone produce these results under Node and Bun:

- **Example pages.** `textstat --help`, `textstat -h`, `jsonkit -h`, and `jsonkit select -h` print the pages above, byte for byte, with color and modifiers disabled, and `jsonkit --help` and `jsonkit select --help` print their pages unchanged. The example applications' help goldens are re-pinned to these pages.
- **Selection.** `-h` prints the compact page, `-Vh` the compact page, and `-h --help` the compact page, because the earlier `-h` stands when the repeated option is held.
- **Spellings.** A fixture plugin's middleware reads `--flag`, `-f`, and `--no-flag` for its typed options, `--name` for `--name=value`, the grouped letter as `-f`, and the last spelling of a multiple string option given as `-n a --name b`. An option filled from the environment or the configuration source, a defaulted option, and an option not supplied have no entry, another plugin's options and the application's options never appear, and the record is frozen.
- **Hints.** A compact leaf page whose only extended block is Details prints the pointer, a compact leaf with neither Details nor EXAMPLES prints none, and a compact group page prints the child hint with `-h` ahead of the pointer.
- **Replacement.** An `override(helpPage, …)` receives `variant` as `compact` under `-h` and `extended` under `--help`.
- **Styles.** A themed compact page styles both hint lines under the [restyle](#help-and-version-restyle) mapping.

## Accepted values

```text
OPTIONS
  -m, --metric <metric>        What each row counts. One of: bytes, words, lines.  (default: bytes)
  -f, --format <format>        Select the output format, table by default. One of: table, json, jsonl.
```

An option or an argument row states the values the input accepts, so a reader chooses a valid value before the first run rather than learning it from a validation error. The sentence sits in the right cell after the description and before the facts, under the right-cell rule.

- **Authored.** An `accepts` value on the input's help extension, `helpInput` for an option and `helpArgument` for an argument, is the sentence, printed as written. It always wins, whatever the input's schema holds, so an author states a pattern, a range, or a long set in their own words. An `accepts` on a Boolean or counted option is never shown.
- **Derived.** Without `accepts`, help derives the sentence from the input's [input schema](../core/validation.md#input-schema) when that schema is a closed set of strings: an `enum` whose members are all strings, a single string `const`, or an `anyOf` whose members are each such an `enum` or `const`, flattened in order, and a multiple option or a variadic argument reads the same shapes, because its input schema describes one value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). Help reads `enum`, `const`, and `anyOf` at the schema's top level, and derives nothing when more than one of the three sits at the same level. Every other keyword beside them must leave each listed value accepted, so help derives only when each one is `type: 'string'` or an annotation, `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples`, `readOnly`, `writeOnly`, or `deprecated`, and the same holds inside each `anyOf` member. Any other keyword, such as `pattern`, `minLength`, `format`, or `not`, may narrow the set, so it derives nothing, and the author states the set with `accepts`. The sentence is `One of: ` followed by the values in the schema's order, separated by a comma and a space, and a closing period: `One of: bytes, words, lines.`
- **Bounds.** A value that repeats prints once, at its first place, and counts once. Help lists no set of more than eight distinct values, and its row prints as it would without accepted values: eight bounds help's listing, not the derivation, so [completion](completion.md) still offers every value of a larger set. An empty set derives nothing, and neither does any other shape, a `null` schema, or a set holding a member that is not a string; the row then prints as it would without accepted values. A member that is not a string derives nothing because the list prints tokens exactly, and help does not decide how a token spells a number, a Boolean, or `null`.
- **Quoting.** A value that is empty or holds whitespace, a comma, a double quote, or a control character prints as its JSON string, `One of: "a b", c.`, so the list splits unambiguously. A line terminator inside it prints as its JSON escape, as a rendered default's does, so the list adds no line break of its own, and DEL and the C1 controls, which JSON leaves raw, print as their lowercase `\uXXXX` escapes, so no control character reaches the terminal. Every value is escaped before styling, as every graph string on the page is.
- **Not the manifest's.** `accepts` is help's own fact for a human reader. Help does not supply it to the [manifest](manifest.md), where an agent reads the exact `schema`.

The [formatter](format.md)'s `--format` carries the enum of its view names, so its row derives them, and the formatter's description names only the default. A Command with more than eight view names prints none of them in help; `inspect()` and the manifest still carry the enum.

Compared with the page rules before this section, the changed rules are: the right cell gains the accepted-values sentence between the description and the facts, and a member with neither description nor sentence has the parenthesis alone; `helpInput` gains `accepts`; arguments gain `helpArgument`, where no help extension targeted them before; and the formatter's description drops the view names and states the default as `Select the output format, <default> by default.`

## Accepted values acceptance

Accepted values are proven when public APIs alone produce these results under Node and Bun:

- **Example pages.** `textstat --help` prints the `--metric` and `--format` rows shown above, and `jsonkit --help` prints `--format` with `One of: records, json, jsonl.`. The quoted pages in this document and the example applications' help and manifest goldens are re-pinned for the formatter's new description.
- **Derived shapes.** Fixture applications prove each shape the Derived rule names, a string `enum`, a single string `const`, and an `anyOf` of them, at every level it can appear: at the top level and as an `anyOf` member, on a single option, a multiple option, and a variadic argument. At each level, one case holds `type: 'string'` beside the shape and one holds an annotation such as `default`, and both still derive, and one holds a narrowing keyword, such as `pattern` or `minLength`, and derives nothing. Beside those, fixtures cover an `anyOf` mixing an `enum` member and a `const` member, flattened in order, with a value repeating across members printing once; a schema holding only a narrowing keyword such as `pattern`, with no closed set, deriving nothing; an `enum` beside a `const` or an `anyOf` at the same level deriving nothing; a repeated value printing once, an empty set and a nullable enum deriving nothing, eight values printing, nine deriving and help listing none, a set holding a number deriving nothing, and an argument row deriving from its schema.
- **Authored.** An `accepts` wins over a derived list, prints for an input with a `null` or pattern schema, prints on an argument row through `helpArgument`, and is never shown on a Boolean option.
- **Text.** A value that is empty or holds a space, a comma, a double quote, a line terminator, or a control character prints as its JSON string, a marker character in a value prints literally, and a row with no description starts its right cell with the sentence.

## Help and version restyle

```ts
// The restyle left both view inputs unchanged; help variants add variant to HelpPage, and the
// version postfix gives the version line VersionLine.
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

- **Scope.** It changes the default help and version views and the formatter's option description. The restyle itself adds no export, extension field, theme requirement, glyph, or rendering policy; the `accepts` field and `helpArgument` arrive with [accepted values](#accepted-values). The existing help and version takeover, output destination, invocation rules, and view override identities stay unchanged.
- **Content.** The page keeps its masthead, details, usage forms, section order, filtering, row facts, examples, hint, indentation, blank lines, and final newline. The application path remains first in the masthead. Neither default view adds a framework logo or branding glyph. Available view names print as the `--format` row's [accepted values](#accepted-values), with no separate section.
- **Escaping.** Graph strings, help extension strings, and rendered default values are literal data. The view escapes each raw fragment with `style.escape` before styling or measuring it. It never escapes the completed marked page or recovers semantic fields by parsing a rendered row. Authored markup in a description or example remains literal. Existing default serialization and line-terminator escaping remain unchanged. Embedded ANSI remains subject to core's separate rendering policy.
- **Measurement.** The two-column rule uses destination-aware `context.width` and core's deferred `pad`. This replaces JavaScript string-length padding. It preserves ASCII spacing while aligning wide and combining characters under core's existing rules. Styling never changes which members or sections appear. The version view neither wraps nor reads the width, and the help view wraps on a terminal under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns).
- **Policy.** Views return semantic marked strings. The installed theme and core's destination policy determine colors and modifiers. A missing theme leaves semantic colors unmapped, while explicit bold and italic still follow modifier policy. Under automatic policy, an ordinary pipe has no style escapes. At a capable terminal, `NO_COLOR` disables color but does not disable bold or italic. Explicit policy and `FORCE_COLOR` retain their existing precedence. The plain examples disable both colors and modifiers.
- **Replacement.** `helpPage` keeps `{ graph, command }`, which [help variants](#help-variants) extend with `variant`. `versionLine` takes `VersionLine`, `{ graph, postfix }`, since the [version postfix](version.md). Each override replaces the whole view through the existing registry. A replacement derives its own content and owns its layout, literal-data escaping, styles, and final newline. No public section model or builder is introduced.

The default help view applies this mapping. A style named below is a member of the run-specific `style` object.

| Page part | Style |
| --- | --- |
| Masthead application path | `highlight.bold` |
| Masthead middle dot | `dim` |
| Masthead description, and details text under [Markdown styles](#markdown-styles) | `primary` |
| Section titles | `dim` |
| Application paths, child command names, and option spellings outside authored examples | `highlight` |
| Placeholders, including their brackets, the `[=` and `]` around an implied value's placeholder, and variadic suffix, the `...` after a counted option's spellings, and argument labels in ARGUMENTS | `dim.italic` |
| Argument forms in USAGE, `[options]`, and the `<command>` or `[command]` markers in USAGE and COMMANDS | `dim.italic` |
| Option spelling separator `,` | `dim` |
| Descriptions in right cells | `primary` |
| Accepted-values sentences in right cells | `primary` |
| Fact parentheses, fact separators, `required`, `repeatable`, `default: <value>`, and `implied: <value>` | `dim` |
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

Compared with the previously accepted help page rules, the changed rules are: semantic styling replaces unconditional plain output, column width follows core's measurement, and the formatter description adds its declared default. The version line gains the styling in [Version](version.md) without changing its text. All other content and invocation rules remain in force.

## Help and version restyle acceptance

The implementation re-pins hand-written help pages and version lines against built processes under Node and Bun, including packed-consumer coverage. Plain and themed expectations are authored independently of the rendering helpers.

- Root, leaf, group, and hybrid pages retain their content rules. Cover hidden-member filtering, a directly requested hidden Command, a group with only hidden children, omitted empty sections, and root-only folding of globals.
- Compare complete plain text for jsonkit root, jsonkit select, and textstat against the examples above. Check one final newline, no trailing row padding, required and variadic forms, Boolean polarity, short-only options, and existing default serialization.
- Pin exact themed bytes for the style mapping, including placeholders beside highlighted spellings, the accepted-values sentence, dim fact punctuation around warning deprecation, literal example flags, notes, the hint lines, and the version line. Cover deprecation on both a row and a routed Command's masthead.
- Cover the named theme at truecolor, 256 colors, and 16 colors, a custom token mapping, an absent theme, an ordinary pipe, and a capable terminal with `NO_COLOR`. Check modifier policy independently, including fully disabled styles. Neither view chooses a fallback color or adds a glyph.
- Use wide and combining characters in names and placeholders, plus literal style-marker data in graph facts, defaults, and help extensions. Check alignment through core's measurement, literal marker output, and no interpretation of authored example syntax.
- Check formatter view order, custom and replaced view names, an unadvertised `ndjson` alias, and a declared default other than a pack view. An earlier hook changing the default updates the description. A later hook changing it leaves the description at its formatter-hook value. With the formatter absent, help invents no selector or view list. Inspect the formatter description and the absence of a parser default, and prove omission preserves an earlier middleware's selected view.
- Check version strings with a lowercase `v`, an uppercase `V`, an omitted version, and explicit `0.0.0`. Root and routed invocations print the same application version text, and raw marker-bearing strings stay literal.
- Keep the existing help and version override, takeover, fault precedence, stdout, and exit-code coverage. A replacement sees the same graph data, owns its newline, and can render its own styles without installing a replacement plugin.

## Markdown details

```markdown
A path is a dot-separated walk from the root of the document.

- A **key** reads an object's member, such as `user.name`.
- A **whole number** reads an array's item, such as `items.0`.

The document is *JSON*; see [the format](https://www.json.org/json-en.html).
```

```ts
// examples/jsonkit/src/commands/get.ts, the help value; get.md holds the text above
import details from './get.md' with { type: 'text' };

helpCommand({
  details,
  examples: [{ command: 'get name -f doc.json' }, { command: 'get nested.deep.value -f doc.json' }],
  section: ['Document commands', 'Read'],
});
```

A Command's `details` is Markdown, so an author writes paragraphs, lists, code, and links as they would in a README, inline or in a file of its own. [ADR-0077](../decisions/0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md) records the decision. The extended page renders a stated subset of Markdown with a parser the pack carries, which loads with the page view and needs no dependency. Text outside the subset, other than a thematic break, reads under the paragraph and inline rules. With jsonkit's `get` details in `get.md` above, `jsonkit get --help` has this text with color and modifiers disabled:

```text
jsonkit get · Read one value at a path.

  A path is a dot-separated walk from the root of the document.

  ● A key reads an object's member, such as `user.name`.
  ● A whole number reads an array's item, such as `items.0`.

  The document is JSON; see the format (https://www.json.org/json-en.html).

USAGE
  jsonkit get <path> [options]

ARGUMENTS
  path  Dot path to read.

OPTIONS
  -f, --file <path>  The document to read. Omit it to read piped text.  (file or piped stdin; - selects stdin, required)

GLOBAL OPTIONS
  -h, --help        Show this help.
  -V, --version     Print the version.
  -M, --manifest    Print this command's manifest as JSON.
  -e, --explain     Explain the selected command and exit.
      --[no-]color  Turn color on or off, overriding NO_COLOR.
  -v, --verbose...  Show more detail. Repeat it for more.
  -q, --quiet       Hide info and success messages.

EXAMPLES
  $ jsonkit get name -f doc.json
  $ jsonkit get nested.deep.value -f doc.json
```

- **The value.** `details` on `helpCommand` and on `manifestCommand` is a string that holds a character other than whitespace, judged at the authoring call. Blank lines, whitespace at either end, and a final line terminator are allowed, so a file's text passes as it is. Help reads strings and no files, and no flag marks a value as Markdown or as plain lines: every `details` is Markdown. Details whose lines hold no Markdown syntax and no whitespace at either end prints as it did when details was lines.
- **A file.** An author who keeps details in a file imports it as text, `import details from './get.md' with { type: 'text' }`. Bun reads the file in a source run and in a test, and a [`loom build`](../toolchain/build.md#loom-build-1) bundle or binary inlines its text for every target, so the built application reads no file at run time. A build that does not inline it, such as `tsc` output run under Node, cannot load the import. `loom build` gains no embedding seam, as [ADR-0076](../decisions/0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) decided for skills. TypeScript types the import through the author's own module declaration, `declare module '*.md' { const text: string; export default text; }`.
- **Lines.** Help reads every line terminator the pack recognizes, CRLF and each single terminator, as a line break before it parses, so an authored CR or NEL never reaches the page. A final line terminator ends the last line and starts no empty one. A line that holds only whitespace is blank. Whitespace, a letter, and a digit below are Unicode's, as JavaScript's `\s`, `\p{L}`, and `\p{N}` read them.
- **Tabs.** Before reading blocks, help expands each tab in the whitespace that starts a line, and in the whitespace after a list marker or a quote's `>` at the start of a line, to spaces up to the next column that is a multiple of four. Any other tab is text. Off a terminal it prints as written, and on a terminal it expands before help measures or wraps, under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns).

### Markdown blocks

Help reads the text as a sequence of blocks. Each rule below reads a line after the indentation its container takes, and a marker may follow up to three spaces of indentation.

- **Fenced code.** A run of three or more backticks, or of three or more tildes, opens a code block, and the rest of the opening line is ignored. A backtick run whose line holds another backtick after it opens nothing. The block closes at a line that holds a run of the same character at least as long and nothing else but whitespace, or at the end of its container. The lines between are the code, each with up to the opening run's indentation removed, and no other rule reads them.
- **Indented code.** A line indented four or more spaces that does not continue a paragraph or follow table rows opens a code block. Directly after table rows such a line reads as paragraph text, as it did when the rows were paragraph text it continued. The block holds each following line that is indented four or more spaces or is blank, up to its last indented line. Each of its lines loses four spaces, and no other rule reads them.
- **Heading.** One to six `#` characters followed by a space, a tab, or the end of the line. Its text is the rest of the line, without surrounding whitespace and without a closing run of `#` that follows a space. A run of seven or more is paragraph text. A heading with no text is no block and prints nothing.
- **Quote.** A line that starts with `>`, with one space after it removed. Consecutive such lines form one quote, and the text after the markers is read as blocks, so a quote holds lists, code, and paragraphs. A line without `>` ends the quote.
- **Thematic break.** Three or more `-`, three or more `*`, or three or more `_`, one character alone, with any spaces or tabs between them and nothing else on the line. It is not in the subset, so it is a block of its own that prints as written without its indentation, and no list item reads it, so `* * *` is a break and not three items.
- **List item.** A bullet marker, `-`, `+`, or `*`, or an ordered marker, one to nine ASCII digits followed by `.` or `)`, then a space or the end of the line. The item's content starts after the spaces that follow the marker, or one column after the marker when five or more follow. When the marker's line holds nothing else, the content's column is the marker's width and one, and the item's first line is the next line that belongs to it. A later line belongs to the item when it is indented at least to the content's column, when it continues the item's open paragraph, or when it is blank and a later line belongs to the item. The item's lines, with that indentation removed, are read as blocks, so a list nests inside an item. Consecutive items with the same bullet character, or with the same ordered delimiter, form one list, whether or not blank lines separate them, and a different bullet character or delimiter starts another list.
- **Table rows.** A line whose text starts with `|`. Consecutive such lines form one block, which interrupts a paragraph as a list item does, and each of its lines keeps no leading or trailing whitespace, as a paragraph's lines keep none. A row still continues a list item's open paragraph lazily, as paragraph text does, and the item reads it as a row. The block is not parsed into cells.
- **Paragraph.** Any other line that is not blank. A paragraph continues on each following line until a blank line or a line that starts fenced code, a heading, a quote, a thematic break, a table row, or a list item. Each of its lines keeps no leading or trailing whitespace.

A table is not parsed into cells: the table rows rule above holds a pipe table's lines, and a table written without a leading `|` reads as paragraph text. A setext heading underline, a link reference definition, and an HTML block are not in the subset. Each reads as paragraph text, so its lines lose the whitespace at their ends and the inline rules read them.

### Markdown inline text

Help reads inline constructs in each line of a paragraph and of a heading, wherever the block sits, from left to right. No construct spans a line break, so a marker that would close on a later line prints as written. A code span, an autolink, and a backslash escape are read where each starts, the first to start winning. Links are read next, then emphasis, so a code span's characters start nothing, and an emphasis pair never crosses a link's brackets.

- **Backslash escape.** A backslash before an ASCII punctuation character prints that character, which then starts or closes nothing, so `` \` `` opens no code span. Any other backslash prints as written. No escape applies inside a code span or a destination.
- **Code span.** A run of backticks opens a code span that closes at the next run of exactly as many backticks. The span prints as written, its backticks included, and no other rule reads inside it, so `` `C:\` `` is a code span. A run with no closing run prints as written.
- **Emphasis and strong emphasis.** A run of one `*` or `_` marks emphasis, and a run of two marks strong emphasis. A run closes the nearest open run of the same character and length when the character before it is not whitespace, and a run that closes nothing opens when the character after it is not whitespace, so `**pre**fix` closes at its second run. An `_` run opens only when no letter or digit precedes it and closes only when no letter or digit follows it, so `snake_case_name` prints as written. Closing a pair drops the open runs between its markers, which print as written. The text between is read for inline constructs, so emphasis nests. The markers do not print. A run of three or more, and a run that neither opens nor closes a pair, prints as written.
- **Link.** `[text](destination)`. The text ends at the `]` that balances the opening `[`, where a bracket inside a code span, or one a backslash escape prints, does not count, so the `]` of `[C:\\](url)` closes the text. The destination is not empty, holds no whitespace, and ends at the `)` that balances the opening `(`. The text is read for inline constructs except links, and an image inside it is read as an image. A link prints its text, a space, and its destination in parentheses: `the format (https://www.json.org/json-en.html)`. When the text prints exactly as the destination, the link prints the destination once, without parentheses. `![text](destination)` is an image and prints as a link with the same text. A bracket that starts no link prints as written.
- **Autolink.** `<`, an address that starts with `http://`, `https://`, or `mailto:` and holds no whitespace, `<`, or `>`, then `>`, prints the address alone. Any other angle-bracketed word, such as `<host:port>`, prints as written.

Everything else prints as written, such as an HTML tag, an entity like `&amp;`, and a table's pipes.

### Markdown layout

The details block keeps its place after the masthead on the extended page alone. Every line of it that is not blank is indented two spaces, as before, and a blank line is empty.

- **Blank lines are the author's.** One blank line separates two blocks, anywhere in the details, exactly where the author separated them with one or more blank lines, and nowhere else. A block that starts right after another, such as a list under the paragraph that introduces it or code inside a list item, prints right after it. The details block has no blank line at its start or end. Details that renders no line, such as an empty fence, is omitted, as a block with nothing to show is.
- **A paragraph** prints each of its lines as one page line off a terminal. On a terminal its lines join and wrap to the width, under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns).
- **Table rows** print each line as one page line, on a terminal and off one, and never reflow or wrap.
- **A heading** prints in the form of the [Heading view](pack-views.md#heading), its text `dim`. A level 1 heading, `#`, adds a `dim` underline of `glyph.line` as wide as its widest line, measured with `context.width`, on the line after the text at the text's indent. A heading at levels 2 to 6 prints as the Heading view's level 2, its text alone with no underline. The text is one line off a terminal. On a terminal it wraps under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns), and the underline matches the widest wrapped line.
- **Code** prints each of its lines indented two more spaces, without the fence lines. It drops the blank lines at its start and end, and code with no other line prints nothing.
- **A thematic break** prints as written, without its indentation.
- **A list item** prints in the form of the [List view](pack-views.md#list), its marker, one space, and its first line. Every later line of the item, its nested blocks included, is indented by the widest marker among the item's siblings and one space, and a nested list starts at its parent item's text column. Every bullet prints as `glyph.bullet`, whatever character the author used. An ordered item prints its number, counting up by one from the first item's number with leading zeros dropped, and a `.`, whatever delimiter the author wrote, so `007)` prints `7.`. The markers of one list right-align to the widest among them, so `9.` prints as ` 9.` above `10.`, and every item's text starts in one column.
- **A quote** prints `>` and a space before each line of its content, and `>` alone on a blank line inside it.
- **Whitespace at a line's end.** No page line ends in whitespace, so an empty line inside code prints empty.

### Markdown styles

Under the [help and version restyle](#help-and-version-restyle), each block has a style, and inline constructs add to it.

- **Blocks.** The text of a paragraph, table rows, a list item, a quote, and a thematic break is `primary`, as details was, and table rows read inline constructs per line as a paragraph does. The text of a heading is `dim`, and its underline is `dim`. Each line of code is one `highlight` value, its own leading whitespace included and its trailing whitespace dropped.
- **Inline.** Emphasis adds `italic` and strong emphasis adds `bold` to everything inside them. A code span is `highlight`, keeping the modifiers around it, so a code span in a heading is `highlight` inside the `dim` text. A link's text keeps the style around it. The destination with its parentheses is one `dim` value, keeping the modifiers around it, and the space before the opening parenthesis carries only the modifiers around it. An address an autolink or a link prints alone keeps the style around it.
- **Markers.** A list marker and a quote's `>` are `dim`. A list marker is one `dim` value with the spaces that right-align it.
- **Values.** Each run of text between inline constructs is one styled value, its spaces included. A line of text with no inline construct is therefore one `primary` value, as before. Indentation and the space after a marker are unstyled.

The page escapes each authored fragment with `style.escape` before styling or measuring it, so style-wire markup inside Markdown prints literally, as it does in every help string. Help drops the emphasis and heading markers because styles carry stress and a level 1 heading's underline carries its level, and it keeps a code span's backticks and a link's destination because a literal token and an address are meaning, so the page reads the same with styling off.

- **The manifest.** Help supplies `details` to `manifestCommand` as written, so the manifest carries the Markdown source, which an agent reads as it is.
- **Replacement.** `HelpPage` is unchanged. A replacement of `helpPage` reads `details` through `readExtension` as the Markdown source and renders it as it chooses, and the pack exports no parser.

Compared with the page rules before this section, the changed rules are: `details` on `helpCommand` and `manifestCommand` is Markdown and may hold blank lines; the Details block renders the subset above instead of printing each line as written, so it may hold blank lines of its own; a paragraph line loses the whitespace at both ends; a backslash before ASCII punctuation prints the punctuation alone; and text that uses Markdown syntax, such as a line that starts with `- ` or a word between asterisks, renders. Compact help, the pointer to `--help`, and every other block are unchanged.

## Markdown details acceptance

Markdown details are proven when public APIs alone produce these results under Node and Bun:

- **Example page.** jsonkit's `get` reads its help `details` from `src/commands/get.md` through a text import, and `jsonkit get --help` prints the page above, byte for byte, with color and modifiers disabled, from the `loom build --target node` bundle the example tests run. `jsonkit get -h` omits the block and prints the pointer. `jsonkit get --manifest` carries the file's text as written, final line terminator included. Every other example page and manifest is unchanged.
- **Packed consumer.** `check:packed` bundles a fixture entry whose details come from a text import of a `.md` file with the packed `loom build --target node`, as it bundles its release fixture, and the bundle's `--help` page prints the rendered block under Node and Bun. The `tsc`-compiled consumer keeps inline details.
- **Blocks.** Fixtures cover each block rule: fenced code with backticks and with tildes, an info string ignored, a backtick run with a later backtick on its line, a longer closing run, an unclosed fence running to the end of its container, and Markdown inside code printing as written; indented code after a blank line, and a line indented four spaces that continues a paragraph reading as paragraph text; headings at levels one and six, with the level 1 underline as wide as its widest wrapped line and none at level six, a closing `#` run removed, `# C#` keeping its `#`, seven `#` printing as text, and `#` alone printing nothing; a quote holding a list and code, and ending at a line without `>`; thematic breaks `---`, `* * *`, and `___`; bullet and ordered lists, nested two levels, with and without blank lines between items, an ordered list starting at `3` and at `007`, `)` delimiters printing `.`, an ordered list of ten items right-aligning ` 9.` under `10.`, an ordered list under a bullet, a change of bullet character starting a new list, a lazy continuation line, an item whose content starts after more than four spaces, an item whose marker line holds nothing else, and a list directly under a paragraph; and a paragraph interrupted by each block that can interrupt it.
- **Inline.** Fixtures cover each inline rule: emphasis and strong emphasis with both characters, nested, crossing, unmatched, closing inside a word as in `**pre**fix`, and spanning a line break; `snake_case_name`; a run of three; code spans with one and two backticks, holding emphasis markers, ending in a backslash, and unclosed; backslash escapes of a marker, a backtick, and a letter; a link, an image, a link inside emphasis, a link whose text holds brackets, a destination holding balanced parentheses, a link whose text equals its destination, a destination holding whitespace, and a bracket that starts no link; and autolinks with each of the three prefixes beside `<host:port>`, which prints as written.
- **Unsupported constructs.** A table, a setext underline, a reference definition, an HTML block, and an entity read under the paragraph and inline rules.
- **Lines.** CRLF, CR, NEL, and LINE SEPARATOR read as line breaks; a tab in leading indentation and a tab after a list marker expand to the next multiple of four columns; whitespace at both ends and a final terminator are accepted; details of whitespace alone is a declaration fault at the call on `helpCommand` and on `manifestCommand`; details that renders no line prints no block, and the compact page prints no pointer for it when the Command has no examples; and no page line ends in whitespace.
- **Compatibility.** jsonkit's root and textstat's root, whose details use no Markdown syntax, print their pages unchanged, and so does a multi-line details value with no Markdown syntax and no whitespace at either end of a line.
- **Styles and escaping.** Exact themed bytes pin each style above: a plain paragraph line as one `primary` value, a heading, nested emphasis, a code span inside a heading and inside strong emphasis, a link inside emphasis with its destination, a link and an autolink that print an address alone, and the list and quote markers. Style-wire marker characters inside a heading, a code span, a code line, and a link destination print literally. With modifiers disabled, emphasis and headings carry no escape.

## Help wraps to the destination's columns

```ts
// No export changes. The default helpPage view reads its context's columns and lays the page
// out with the context's wrap and expandTabs and core's pad, splitLines, and nowrap.
import type { DeclaredView, ViewContext } from '@loomcli/core';
import type { HelpPage } from '@loomcli/plugins/help/views';

declare const helpPage: DeclaredView<HelpPage>;
declare const context: ViewContext; // context.columns: number | undefined
```

On a 60-column terminal, `jsonkit --help` has this text with color and modifiers disabled:

```text
jsonkit · Read and reshape one JSON document.

  With no subcommand, jsonkit summarizes the document and
  its top-level keys.

USAGE
  jsonkit [options]
  jsonkit <command> [options]

DOCUMENT COMMANDS
  READ
    get    Read one value at a path.
    keys   List the keys at a path.
    fetch  Read one value at a path.  (deprecated: Use get
           instead.)
  RESHAPE
    select  Keep the named fields of the document.

COMMANDS
  doctor                Check the host this application runs
                        on.
  completion <command>  Print or install a shell completion
                        script.
  mcp                   Serve this application's tools to an
                        MCP client over stdin and stdout.
  manpage <command>     Write or install the man pages.

OPTIONS
  -f, --file <path>      The document to read. Omit it to
                         read piped text.  (file or piped
                         stdin; - selects stdin, required)
  -o, --format <format>  Select the output format, records
                         by default. One of: records, json,
                         jsonl.

GLOBAL OPTIONS
  -h, --help        Show this help.
  -V, --version     Print the version.
  -M, --manifest    Print this command's manifest as JSON.
  -e, --explain     Explain the selected command and exit.
      --[no-]color  Turn color on or off, overriding
                    NO_COLOR.
  -v, --verbose...  Show more detail. Repeat it for more.
  -q, --quiet       Hide info and success messages.

EXAMPLES
  $ jsonkit -f doc.json
  $ jsonkit get user.name -f doc.json

Run jsonkit <command> --help for command details.
```

At 30 columns the COMMANDS row set stacks, because its indent, its left column, and its floor, `application's`, need 2 + 22 + 13 = 37 columns:

```text
COMMANDS
  doctor
      Check the host this
      application runs on.
  completion <command>
      Print or install a shell
      completion script.
  mcp
      Serve this application's
      tools to an MCP client
      over stdin and stdout.
  manpage <command>
      Write or install the man
      pages.
```

[ADR-0087](../decisions/0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md) records the decision.

- **Where it applies.** The page lays out against its view context's [`columns`](../core/styles.md#width-padding-and-multiline-lanes), the effective width of stdout, where help prints. When `columns` is `undefined`, as on a pipe, a file, an invocation by name, and an MCP tool call, every page is byte for byte the page the rules above print, tabs included. `COLUMNS` narrows the page as it narrows every view. The compact and extended variants follow the same rules. Help wraps at `columns` itself, with no maximum line length of its own.
- **What wraps.** Prose wraps: the masthead description, the message of the `Deprecated:` line under a masthead, every right cell, which is its description, its accepted-values sentence, and its fact parenthesis, read as one text, every Details block except code and a thematic break, the INPUT block's description and its `Required.` or `Optional.` sentence, each option-group sentence, such as `Use at most one of --json and --yaml.`, each example note, and each hint.
- **What stays whole.** Literals never wrap: USAGE forms, outer section titles and inner headings, left cells, Details code, table rows, and thematic breaks, the INPUT block's `Example: <producer> | <path>` line, and example commands with their `$`. One wider than the space left for it overflows, and the terminal soft-wraps it. Inside prose, a Details code span and the command a hint names, such as `jsonkit <command> --help`, sit in [`nowrap`](../core/styles.md#width-padding-and-multiline-lanes), so each stays on one line. A link's destination holds no space, so it stays whole as any word does.
- **Breaking.** Every wrap is `context.wrap` at the width left for its text, under its rules: greedy, breaking at U+0020 spaces alone, keeping a word wider than the width whole. Before the view measures, wraps, or indents text, it expands tabs with `context.expandTabs`, so the page holds no tab: a right cell's assembled text once, and each authored line of a Details block from that line's start, before its lines join. The view splits wrapped text with `splitLines` and places each line after its unstyled indent, so a style that spans a break closes before the indent and opens again after it. Where the width left for a text is less than one column, the text prints unwrapped.
- **Hanging indents.** A continuation line starts where its text's first line starts. The masthead description continues under its first character, after `<path> · `, and the deprecation message under its first character, after `Deprecated: `. A right cell continues under the right cell's column, a list item under its text after the marker, as an authored continuation is indented, and a quote after the `> ` that starts each of its lines. An example note continues at the note's indent, an INPUT sentence and an option-group sentence at their two-space indent, and a hint at the left margin. When a hanging text's continuation indent and its floor, the widest unit `wrap` keeps whole in it, measured as a table column's floor is, together exceed `columns`, its continuation lines start at its block's base indent instead, and its first line keeps its place: the masthead description and the deprecation message continue at indent 2, and a list item at its list's own indent, where its marker starts. A right cell stacks instead, under the stacked rows rule below.
- **Two columns.** A row set is the rows that share a left column off a terminal: an outer heading's direct rows, or the rows under one inner heading. Its left column keeps its width, the set's longest left cell plus two spaces, and each right cell wraps at `columns` minus the set's indent and that width.
- **Stacked rows.** A row set's floor is the widest unit `wrap` keeps whole in any of its right cells, measured as a [table](pack-views.md#table) column's floor is. When the set's indent, its left column, and its floor together exceed `columns`, the set stacks. Each row prints its left cell on its own line at the set's indent and its right cell on the lines below, four columns past the furthest-in start of a left cell's text in the set, so a set that holds a long-only option, whose left cell carries four alignment spaces, indents every right cell eight columns past the set's indent, wrapped at what remains. A row with no right cell prints its left cell alone, and no blank line separates stacked rows. Every other row set on the page keeps two columns.
- **Details reflow.** A paragraph's lines join with one space, Markdown's soft line break, and the joined text wraps at the width left after the block's indent and its containers' markers and prefixes. A paragraph in a list item or a quote does the same, and a heading, which is one line, wraps as a paragraph does. Inline constructs are still read per authored line under [Markdown inline text](#markdown-inline-text), so joining changes no styling. Code never reflows or wraps, a thematic break prints as written, and the blank lines between blocks stay the author's. Off a terminal, each authored line stays one page line.
- **What does not change.** `HelpPage`, the view's identity, replacement, styles, escaping, and every content rule above stand, and no page line ends in whitespace. The pack exports no layout helper and no parser. The man page and the manifest are unchanged. The version line neither wraps nor reads the width.

Compared with the page rules before this section, the changed rules are: on a terminal, prose wraps at `columns` with hanging indents, a row set that cannot fit stacks, and Details paragraphs reflow at soft line breaks. Off a terminal, nothing changes.

## Help wrapping acceptance

Help wrapping is proven when public APIs alone produce these results under Node and Bun, through fixtures whose host reports a fixed stdout width and an `env` with no `COLUMNS`:

- **Example pages.** `jsonkit --help` at 60 columns prints the page above, and its COMMANDS row set at 30 columns prints the stacked block above, byte for byte with color and modifiers disabled. `jsonkit -h` and `textstat --help` each fit 40 and 60 columns. `jsonkit get --help` and `jsonkit select --help` fit 60. At 40, only `get`'s second example command and `select`'s USAGE form, which stay whole, run past it. Every example page and every help golden that runs off a terminal is unchanged.
- **Width.** A page at a width it already fits prints its rows as before. `COLUMNS=60` over a real width of 100 lays the page out at 60, `COLUMNS=150` over 100 lays it out at 100, and `COLUMNS=60` on a pipe changes nothing.
- **Right cells.** A description, an accepted-values sentence, and a fact parenthesis wrap as one text under the right column, in an outer heading's direct rows and under an inner heading, whose indent narrows its width. A row with no right cell carries no padding.
- **Stacking.** A row set stacks exactly when its indent, left column, and floor exceed `columns`, and the next row set keeps two columns. An outer heading's direct rows and the rows under its inner headings stack independently. A stacked right cell wraps at the indent four columns past the furthest-in start of a left cell's text in its set, and a right cell whose unit is wider than that space overflows on its own line. A stacked set that holds a long-only option starts every right cell eight columns past its indent, in an outer heading's direct rows and under an inner heading, so no description starts in a spelling's column, and a stacked set without one starts them four columns in.
- **Literals.** A USAGE form, a left cell, a code block line, and an example command wider than `columns` print whole. A Details code span holding spaces, and a hint's command, never break. A link destination wider than the width keeps its own line.
- **Details.** A paragraph authored across several lines joins and wraps at 40 columns and joins into one line at 200. A list item's continuation hangs after its marker, nested two levels, and a quote's continuation carries `> `. A heading wraps. Code keeps every line as written, and an emphasis pair on one authored line stays styled after the join. Off a terminal, each authored line stays one page line.
- **Table rows.** Consecutive Details lines that start with `|` print one page line each at 24 and at 200 columns, with no join and no wrap, even directly after a paragraph, whose lines still join, and off a terminal every Details value that held a pipe table prints as it did before the rule, a row that continues a list item lazily included.
- **Hanging indents.** At 40 columns a masthead description continues after `<path> · `, a deprecation message after `Deprecated: `, an example note at its indent, and a hint at the left margin, and the version line stays one line. When a masthead description's hang cannot fit, as for `jsonkit manpage generate --help` at 30 columns, its first line stays after the path and the rest continues at indent 2, and so does a deprecation message, while a list item whose hang cannot fit continues at its marker's column, nested too.
- **INPUT and option groups.** At 40 columns the INPUT block's description and its stdin sentence wrap at their two-space indent while its `Example:` line stays whole, an option-group sentence wider than the width wraps at the same indent, and off a terminal each prints as one line.
- **Narrow and tabs.** At a width that leaves less than one column for a text, that text prints unwrapped. A tab inside a description, a Details paragraph, and a code line expands on a terminal, and stays a tab off one.
- **Styles.** Exact themed bytes pin a wrapped right cell whose style spans the break, a wrapped fact parenthesis, a wrapped deprecation message, and a stacked row.
