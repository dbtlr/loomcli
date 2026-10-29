---
description: "The help page: its blocks and layout, the Markdown subset details renders, and how the page wraps to the destination's columns."
---

# The help page

This page documents the page `--help` prints: its default layout, its Markdown details, and how it wraps to the destination's columns.

The page rules below define the default content and layout. [Ordered help sections](help.md#ordered-help-sections) replace the Command and option blocks when section fields are declared. The [help and version restyle](help.md#help-and-version-restyle) adds semantic styles without changing that structure. Output is UTF-8, and no meaning depends on styling. The page reads the routed `CommandNode`, `graph.globals`, `graph.name`, and `graph.description`, plus the help extension values those nodes carry. It reads no host facts. On a terminal it lays the page out against its view context's `columns`, under [Help wraps to the destination's columns](#help-wraps-to-the-destinations-columns). Each rule applies to both [variants](help.md#help-variants) unless it names one: Details and EXAMPLES print on the extended page alone, and the hints differ.

The page is a sequence of blocks separated by one blank line, and no block holds a blank line of its own except Details, which keeps one blank line wherever the author separated two Markdown blocks, and the empty lines inside its code. A block that has nothing to show is omitted. Outer section titles are uppercase at the left margin. The default layout indents every other line two spaces, except hints. [Ordered help sections](help.md#ordered-help-sections) add inner headings indented two spaces and inner rows indented four spaces. A line at the left margin is the masthead, an outer section title, or a hint and nothing else. `<name>` below is the application name, and `<path>` is the name followed by the routed path, space-separated: `jsonkit`, `jsonkit get`, or `store cache clear`. A member is visible when it is not hidden.

1. **Masthead.** `<path> · <description>`, with a space, U+00B7, and a space as the separator, or `<path>` alone when the node has no description. When the routed Command is deprecated, a second line `  Deprecated: <message>` follows in the same block. A description and a migration message each print as one line, wherever the page shows them: each line break the author wrote, CRLF or a single terminator, reads as one space.
2. **Details.** Extended alone. The routed node's `details`, rendered under [Markdown details](#markdown-details), each line indented two spaces. Help reads the same line terminators the schema recognizes, CRLF and each single terminator, as line breaks and joins with LF, so an authored CR or NEL never reaches the page.
3. **USAGE.** One line per form, each beginning with `<path>`, except that the action form of a node whose [`.stdin()`](../core/validation.md#content-inputs) declaration is required begins with `<producer> | `, as `<producer> | <path> [options]`. The action form is `<path> <arguments> <required options> [options]`: each declared argument in declaration order as `<name>` when required and `[name]` when optional, and as `[name]` when it is a content input that accepts stdin, because piped stdin can satisfy it, with `...` inside the brackets for a variadic, so `<path>`, `[path]`, `<files...>`, and `[files...]`; then each visible option that declares `required: true`, in declaration order, which is always the node's own because a global option declares no presence rule, except a [content input](../core/validation.md#content-inputs) that accepts stdin, which piped stdin can satisfy, so its row's `required` fact alone says a source is needed, as `--long <placeholder>`, or `-s <placeholder>` for a `shortOnly` option, or `--long[=<placeholder>]` and `-s[<placeholder>]` for an option with an [implied value](../core/options.md#implied-values), with `...` appended for a multiple option; then `[options]`, which is always present because the help option is one. A node with an action prints the action form. A node with a visible child prints the children form, `<path> <command> [options]`, after the action form when both apply. A group whose children are all hidden prints the children form alone, because it has no other form.
4. **COMMANDS.** For a node with a visible child, one row per visible child in authoring order. The left cell is the child's name, followed by ` <command>` when the child is a group and by ` [command]` when it has an action and children. The right cell follows the right-cell rule below, with `deprecated` as its one possible fact.
5. **ARGUMENTS.** For a node with arguments, one row per argument in declaration order. The left cell is the name, and the right cell follows the right-cell rule, with a [content input](../core/validation.md#content-inputs)'s source facts and `default` as its possible facts.
6. **INPUT.** For a node that declares [`.stdin()`](../core/validation.md#content-inputs), the standalone stdin declaration, and not for an argument or option that accepts stdin. The block holds, each on its own line indented two spaces: the declaration's `description` on one line, when it has one; the sentence `Required. Reads piped or redirected stdin. Terminal input is not accepted.`, or `Optional. Reads piped or redirected stdin. Terminal input is not accepted.` when the declaration is not required; and the line `Example: <producer> | <path>`, which shows the way to supply the stream.
7. **OPTIONS.** The routed node's visible local options in declaration order, one row each; on the root page of an Application with no children, the visible globals follow them in `graph.globals` order, in this one section. The left cell is the spellings, then ` <placeholder>` for a string option: `-f, --file <path>` with both spellings, `    --explain` with a long spelling alone, indented four spaces so the long spellings align, and `-m <metric>` for a `shortOnly` string option. A string option with an [implied value](../core/options.md#implied-values) shows its placeholder in brackets after `=`, `-b, --backup[=<control>]`, and after the letter alone, `-b[<control>]`, for a `shortOnly` one, because only an attached value replaces the implied value, and its right cell carries the fact `implied: <value>`, so the row reads `-b, --backup[=<control>]  How to back up each file.  (implied: simple)`. A [counted option](../core/options.md#counted-options) has no placeholder, and its spellings end with `...`, `-v, --verbose...`, or `-v...` for a `shortOnly` one, because each occurrence adds one; it never carries `repeatable`, `required`, or `default`, since the `...` already says it repeats and a count has no presence rule or default. The option that carries the [quiet mark](../core/verbosity.md) shows no `...`, `-q, --quiet`, because a further occurrence adds nothing. A Boolean option's long spelling follows its polarity: `--total` for `positive`, `--no-total` for `negative`, and `--[no-]total` for `both`. The right cell follows the right-cell rule. A Boolean option with `negative` polarity carries the fact `default: true`, because its absent value is `true` and both of its spellings set it to `false`; the other polarities carry no default fact, because their absent value is `false`.
8. **GLOBAL OPTIONS.** On every page except the root page of an Application with no children, the visible globals in `graph.globals` order, one row each under the OPTIONS rule, so the reader sees which options belong to this Command and which reach every Command.
9. **Option-group sentences.** After the option sections, one sentence per option group in declaration order, each indented two spaces, none under a title of its own. A group names each member by its [reported spelling](../core/failures.md), joined `a and b` for two and `a, b, and c` for more. An `exclusive` group reads `Use at most one of <members>.`, a `oneRequired` group `Supply at least one of <members>.`, and a `requiredTogether` group `Use <members> together.`. A group with a content input that accepts stdin adds ` (piped stdin does not count)` before the period. A group with a hidden member prints no sentence, because the sentence would reveal that member.
10. **EXAMPLES.** Extended alone. For a node that carries `examples`, one entry each: `$ <name> <command>`, then the note on the next line indented two more spaces.
11. **Hints.** One block of up to two lines, each at the left margin. When the page printed any child Command row, the first line is `Run <path> <command> --help for command details.` on the extended page and `Run <path> <command> -h for command details.` on the compact page. On the compact page alone, when the extended page of the same node would print Details or EXAMPLES, the last line is `Run <path> --help for details and examples.`

The right-cell rule: the description when the member has one, on one line, then, for an option or an argument that has them, its [accepted values](help.md#accepted-values) as one sentence, then, when any fact applies, one parenthesis holding the facts that apply, comma-separated, in this order: for a [content input](../core/validation.md#content-inputs), its source routing, `file or piped stdin; - selects stdin` for one source that accepts stdin, `files and piped stdin; - places stdin` for a multiple option or a variadic argument that accepts it, and `file path` for one that does not, then `min: <n> sources` and `max: <n> sources` when declared, with `source` for a count of 1; `required`, or `required when not interactive` for an option that declares `required: 'non-interactive'`, `repeatable` for a multiple option, `default: <value>`, `implied: <value>` for an option with an [implied value](../core/options.md#implied-values), and `deprecated: <message>`. One space separates the description from the accepted-values sentence, and help prints both as written, adding no punctuation between them; two spaces separate the text before the parenthesis from it; a member with neither description nor accepted values has the parenthesis as its whole right cell, with no leading spaces; and a member with none of the three has no right cell. The parenthesis begins at the first `  (` that is followed by `file path`, `file or piped stdin`, `files and piped stdin`, `min: `, `max: `, `required`, `repeatable`, `default: `, `implied: `, or `deprecated: `, and it ends at the closing `)` that ends the row's unwrapped text, and `deprecated` is always the last fact, so a reader splits the earlier facts on the comma and reads the text between `deprecated: ` and that closing parenthesis as the message. The page is a rendering for a reader; a consumer that needs a fact exactly, whatever a description, an accepted-values sentence, or a default holds, reads it from `inspect()`, which is the machine surface, and that includes a deprecated message, which may itself hold a comma or a parenthesis. An implied value prints, and is escaped, exactly as a default that is a string does. A default value prints as it is when it is a string, as its elements separated by a space when it is an array of strings, as `JSON.stringify` renders it for any other value JSON can represent, and as `String(value)` renders it otherwise, or as Object's own spelling, such as `[object Array]`, where `String` throws; an explicit `undefined` default prints no default fact, and a line terminator inside a rendered default prints as its JSON escape, so a rendered default adds no line break of its own.

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
      --no-config        Read no configuration file.
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
      --no-config        Read no configuration file.
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
- **A file.** An author who keeps details in a file imports it as text, `import details from './get.md' with { type: 'text' }`. Bun reads the file in a source run and in a test, and a [`loom build`](../toolchain/build.md#loom-build) bundle or binary inlines its text for every target, so the built application reads no file at run time. A build that does not inline it, such as `tsc` output run under Node, cannot load the import. `loom build` gains no embedding seam, as [ADR-0076](../decisions/0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) decided for skills. TypeScript types the import through the author's own module declaration, `declare module '*.md' { const text: string; export default text; }`.
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

The details block keeps its place after the masthead on the extended page alone. Every line of it that is not blank is indented two spaces, and a blank line is empty.

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

Under the [help and version restyle](help.md#help-and-version-restyle), each block has a style, and inline constructs add to it.

- **Blocks.** The text of a paragraph, table rows, a list item, a quote, and a thematic break is `primary`, and table rows read inline constructs per line as a paragraph does. The text of a heading is `dim`, and its underline is `dim`. Each line of code is one `highlight` value, its own leading whitespace included and its trailing whitespace dropped.
- **Inline.** Emphasis adds `italic` and strong emphasis adds `bold` to everything inside them. A code span is `highlight`, keeping the modifiers around it, so a code span in a heading is `highlight` inside the `dim` text. A link's text keeps the style around it. The destination with its parentheses is one `dim` value, keeping the modifiers around it, and the space before the opening parenthesis carries only the modifiers around it. An address an autolink or a link prints alone keeps the style around it.
- **Markers.** A list marker and a quote's `>` are `dim`. A list marker is one `dim` value with the spaces that right-align it.
- **Values.** Each run of text between inline constructs is one styled value, its spaces included. A line of text with no inline construct is therefore one `primary` value. Indentation and the space after a marker are unstyled.

The page escapes each authored fragment with `style.escape` before styling or measuring it, so style-wire markup inside Markdown prints literally, as it does in every help string. Help drops the emphasis and heading markers because styles carry stress and a level 1 heading's underline carries its level, and it keeps a code span's backticks and a link's destination because a literal token and an address are meaning, so the page reads the same with styling off.

- **The manifest.** Help supplies `details` to `manifestCommand` as written, so the manifest carries the Markdown source, which an agent reads as it is.
- **Replacement.** `HelpPage` is unchanged. A replacement of `helpPage` reads `details` through `readExtension` as the Markdown source and renders it as it chooses, and the pack exports no parser.

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
