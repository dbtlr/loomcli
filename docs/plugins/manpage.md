---
description: "The man pages plugin: the page set, the page, roff text, and writing the pages."
---

# Man pages plugin

This page documents the man pages plugin, which writes one man page for each Command and installs, refreshes, and removes the set. An author installs it so an operator can read the application's documentation with `man`.

```ts
// @loomcli/plugins/manpage
import type { Host, Log, Plugin } from '@loomcli/core';

export interface RefreshContext {
  readonly path: string; // the binary that replaced this one
  readonly host: Host; // the run's host
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log
}
export declare function manpage(): Plugin;
export declare function refreshManpages(context: RefreshContext): Promise<void>;
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manpage, refreshManpages } from '@loomcli/plugins/manpage';
import { selfUpdate } from '@loomcli/plugins/self-update';

export const jsonkit = new Application('jsonkit', {
  plugins: [help(), manpage(), selfUpdate({ afterReplace: refreshManpages })],
});
```

```text
$ jsonkit manpage install
Installed 20 man pages in /home/me/.local/share/man/man1.
Read them with man jsonkit.
$ man -w jsonkit-get
/home/me/.local/share/man/man1/jsonkit-get.1
$ jsonkit manpage uninstall
Removed 20 man pages from /home/me/.local/share/man/man1.
$ jsonkit manpage generate --out build/man
Wrote 20 man pages to /home/me/src/jsonkit/build/man.
```

`manpage()` is the manpage plugin. It writes one [man page](../glossary.md#product-surface) for each Command an operator can find, in the roff that `man` reads, from the graph and the help facts each Command carries, and installs, refreshes, and removes the set in the operator's home folder. Its identity is `@loomcli/plugins/manpage`, and it declares no settings, no options, no middleware, and no extension; it contributes one [plugin Command](../core/plugin-contract.md#plugin-commands) group and one `onGraphBuilt` hook. [ADR-0079](../decisions/0079-the-manpage-plugin-writes-a-roff-page-per-command-and-installs-the-set-in-the-home-folder.md) records the decision.

- **The Commands.** `manpage` is a group, `Write or install the man pages.`, with these children:
  - `generate`, `Write the man pages to a folder.`, with one required string option, `--out`, `The folder to write the man pages in. It is created when missing.`, whose help placeholder is `folder`.
  - `install`, `Install the man pages in your home folder.`, with no argument or option.
  - `update`, `Bring installed man pages up to date with this version.`, with no argument or option.
  - `uninstall`, `Remove the installed man pages.`, with no argument or option.

  No child declares a result, so `--format` never applies, and every child writes through `out`.
- **What it reads.** A page reads the `CommandNode` it describes, its parent and visible children, `graph.name`, `graph.version`, `graph.globals` on the root page, and the extension values those nodes carry under `helpCommand`, `helpInput`, and `helpArgument` from `@loomcli/plugins/help/extension` and `configInput` from `@loomcli/plugins/config/extension`, through `readExtension`, as a projection reads any plugin's facts. Neither plugin need be installed: a value is read wherever a node carries it, and a page without help's values is shorter, with no details and no EXAMPLES. A page reads no host fact, so the same graph gives the same bytes on every host, from every build, and through `generate` and `install` alike.
- **Which applications.** A root that declares arguments cannot hold children, so textstat cannot install the plugin, as [Plugin Commands](../core/plugin-contract.md#plugin-commands) states, and an application installs it once, because a second `manpage` collides there.

## The page set

- **One page per findable Command.** The set holds one page for the root and one for every Command that is not hidden and has no hidden ancestor, plugin Commands and groups included, so `jsonkit-manpage-install` has a page and the completion plugin's hidden `__complete` has none. A deprecated Command has a page. An alias has no page and appears on none.
- **Names.** A page's name is the application name, then each name on the Command's path, joined with `-`: `jsonkit` for the root, `jsonkit-get`, and `jsonkit-completion-install`. Its file is the name and `.1`, because every page is in section 1.
- **Names that collide.** Two findable Commands can give one page name, as `foo-bar` beside `foo bar` does, and one page would replace the other. The plugin's `onGraphBuilt` hook judges the page names on every build and throws a `DeclarationError`, which reports as itself under [Judging the built graph](../core/lifecycle-hooks.md#judging-the-built-graph): [`@loomcli/plugins/manpage/page-name-taken`](../core/diagnostics.md#loomclipluginsmanpagepage-name-taken). A hidden Command gives no page, so it collides with nothing.

## The page

A page is roff for the `man` macro package, read by man-db's `groff` and by `mandoc`, the `man` of macOS and the BSDs. It is ASCII, each line ends with a line feed, the last line included, and no line ends in whitespace. It holds no blank line, an empty line of code being written `\&`, no comment, and no date. With jsonkit's `get` details in `get.md` under [Markdown details](help-page.md#markdown-details), `jsonkit-get.1` holds this text:

```roff
.TH "JSONKIT\-GET" "1" "" "jsonkit 0.12.0" ""
.SH "NAME"
jsonkit\-get \- Read one value at a path.
.SH "SYNOPSIS"
.nf
\fBjsonkit get\fR <path> [options]
.fi
.SH "DESCRIPTION"
A path is a dot\-separated walk from the root of the document.
.IP \(bu 2
A \fBkey\fR reads an object\(aqs member, such as \fBuser.name\fR.
.IP \(bu 2
A \fBwhole number\fR reads an array\(aqs item, such as \fBitems.0\fR.
.PP
The document is \fIJSON\fR; see the format <https://www.json.org/json\-en.html>.
.SH "ARGUMENTS"
.TP
\fIpath\fR
Dot path to read.
.SH "EXAMPLES"
.nf
\fB$ jsonkit get name \-f doc.json\fR
.fi
.PP
.nf
\fB$ jsonkit get nested.deep.value \-f doc.json\fR
.fi
.SH "SEE ALSO"
\fBjsonkit\fR(1)
```

A page holds these sections, in this order, each omitted when it has nothing to show. `<path>` is the application name followed by the Command's path, space-separated, as on the [help page](help-page.md#the-help-page).

1. **Title.** `.TH "<NAME>" "1" "" "<name> <version>" ""`: the page name with its ASCII letters in uppercase, the section, an empty date, the application name and `graph.version`, and an empty manual name. The version tells a reader which build wrote the page, and no clock reaches a page.
2. **NAME.** `<page> \- <description>`, or the page name alone when the Command has no description.
3. **SYNOPSIS.** Each usage form help's USAGE block prints for the Command, in its order, one line each in no-fill text, with `<path>` in bold and the rest as help prints it.
4. **DESCRIPTION.** For a deprecated Command, a paragraph `Deprecated: <message>`. Then the Command's `details`, rendered under Markdown below. A Command with neither has no DESCRIPTION.
5. **COMMANDS.** For a Command with a visible child, one entry per visible child, in help's sections and order. An entry's tag is the child's name in bold, followed by help's ` <command>` or ` [command]` suffix, and its text is help's right cell for the row, with `deprecated` as its one possible fact.
6. **ARGUMENTS.** One entry per argument in declaration order. The tag is the name in italic, and the text is help's right cell for the row.
7. **OPTIONS** and **GLOBAL OPTIONS.** The Command's visible local options, in help's sections and order. On the root page, the visible globals take their places in help's option sections, under GLOBAL OPTIONS unless an authored section holds them. The root always has a visible child, the `manpage` group, so help's folding of the globals into OPTIONS on a childless root never applies. On every other page the globals appear nowhere, and SEE ALSO names the root page, which lists them. An entry's tag is help's left cell as help prints it, without its leading indentation, so it reads `-f, --file <path>`, `--[no-]total`, `-v, --verbose...`, or `-b, --backup[=<control>]`. Each spelling, the bracketed `[no-]` included, is bold, each placeholder between `<` and `>` is italic, and the separators, the brackets, the `=`, and the `...` are regular, so `\fB\-f\fR, \fB\-\-file\fR <\fIpath\fR>` and `\fB\-b\fR, \fB\-\-backup\fR[=<\fIcontrol\fR>]`. Its text is help's right cell for the row, the description, the [accepted values](help.md#accepted-values) sentence under help's bound, and the parenthesis of facts. Then, on a line of its own, `Environment: <VARIABLE>` when the option has an [environment binding](../core/input-sources.md), naming every variable of a list in declaration order, separated by commas, and on another, `Configuration: <path>` when it carries `configInput`, each value in bold.
8. **EXAMPLES.** For each of the Command's `examples`, a paragraph holding `$ <name> <command>` in bold as one no-fill line, then its note, when it has one, as `.RS 4`, the note's text, and `.RE`, with no `.PP`, so the note sits under its command.
9. **ENVIRONMENT.** One entry per variable of each option the page lists that has an environment binding, in the order the page lists them and, within a list, in declaration order. The tag is the variable in bold, and the text is `Supplies <spelling>.`, with the long spelling of the option's tag in bold, as the tag prints it and without `...`: `--file`, `--no-total` for a negative Boolean, `--[no-]total` for one of both polarities, `--verbose` for a counted option, or the short spelling, `-m`, for a `shortOnly` option.
10. **SEE ALSO.** The root page, the parent's page when the parent is not the root, then each visible child's page in the COMMANDS order, as `\fB<page>\fR(1)` separated by `, `. The root page names its children alone.

- **Sections help orders.** When a Command's members carry [ordered help sections](help.md#ordered-help-sections), the page follows help's grouping and order: an outer heading is a `.SH` and an inner heading an `.SS`, each as help prints it, in uppercase, and the default headings are COMMANDS, OPTIONS, and GLOBAL OPTIONS, as on help. A global member of an authored section appears on the root page alone.
- **One line.** A description, a deprecated message, and a stdin input's description print on one line wherever the page shows them: each line break the author wrote, CRLF or a single terminator, reads as one space, as on the help page.
- **Entries.** Each entry is `.TP`, its tag on the next line, and its text on the line after, a filled paragraph; an extra line, such as `Environment:`, follows a `.br`. An entry whose text is empty, as for a member with no description, no accepted values, and no fact, writes its `.TP` and tag alone, and one with an extra line and no text writes the extra line without the `.br`.
- **Paragraph breaks.** A `.PP` separates a paragraph, a code block, a quote, a thematic break, an example, or an item's later blocks from the block before it; a list item and a heading at the top level of `details` write none, because `.IP` and `.SS` space themselves, while a heading inside a list item or a quote, which prints as a paragraph in bold, takes its `.PP` as any paragraph does. The first block after a `.SH` or `.SS`, or inside an `.RS`, writes none, so no paragraph request follows a heading or opens an indented block. A block that opens an `.RS`, code, a quote, or an item's later blocks, writes its `.PP` before the `.RS` when a block precedes it, so it keeps its space from the text above. An example's note writes none, under EXAMPLES.

## Roff text

Every string a page prints, an authored fact or a graph fact, passes through one writer:

- **Escapes.** Each `\` is written `\e` and each `-` is written `\-`, so a spelling copied from the page is the one the operator types and no hyphen becomes a typographic one. Each `'` is written `\(aq`, each `` ` `` `\(ga`, each `^` `\(ha`, and each `~` `\(ti`, which groff would otherwise print as typographic quotes and accents where its man.local does not map them back, and each `"` is written `\(dq`, so a quote is never read as roff's argument quoting. A text line that would start with `.` starts with `\&`, so no authored text reads as a request.
- **Request arguments.** Each argument of `.TH`, and the text of each `.SH` and `.SS`, is written as one argument in double quotes, so a heading of several words, or one holding a quote, is read whole.
- **Characters.** A tab in no-fill text, a code line or an example, is kept, and `man` moves it to the next tab stop; a tab anywhere else is written as a space. Every other control character, U+0000 through U+001F or U+007F through U+009F, and each line separator, U+2028 or U+2029, is written as [`escapeControlCharacters`](../core/styles.md#strings-and-composition) writes it, its `\uXXXX` escape, whose backslash is then written `\e`, so it shows rather than vanishes. Every other character above U+007F, a bidirectional control or mark included, as help prints it, is written `\[uXXXX]`, its code point in four or more uppercase hexadecimal digits, so a page is ASCII and reads the same whether or not the `man` program runs `preconv`.
- **Fonts.** A run of text in a font writes `\fB`, `\fI`, or `\f(BI` before it and `\fR` after it, so every line ends in the regular font, and a request line such as `.SS` or `.TP` holds no font escape.

## Markdown in roff

`details` is parsed with the parser help uses, under the block and inline rules of [Markdown details](help-page.md#markdown-details), and rendered in roff's own way: `man` fills a paragraph and wraps it to the reader's width, so the author's line breaks inside a paragraph are not kept, while code keeps every line. Spacing between blocks is the macro package's.

- **A paragraph** is its lines, each written as a source line, which `man` joins, after a `.PP` under Paragraph breaks.
- **A heading** at the top level of `details` is `.SS` and its text, its inline constructs printed as plain text. A heading inside a list item or a quote is a paragraph in bold.
- **Code** is `.RS 4`, `.nf`, its lines, `.fi`, and `.RE`, after a `.PP` under Paragraph breaks, dropping the blank lines at its start and end. Each line loses the whitespace at its end, as on help, and a line left empty is written `\&`, so the page holds no blank line and the code keeps its empty lines. Code with no other line prints nothing.
- **A thematic break** is a paragraph that holds it as written.
- **A list item** is `.IP` with its marker and the marker's width and one: `.IP \(bu 2` for every bullet, and for an ordered item its number, counting up by one from the first item's number with leading zeros dropped, and the author's delimiter, so `007.` gives `.IP 7. 3`. When the item's first block is a paragraph, or a heading, which prints as a paragraph in bold, its lines follow the `.IP`, and the item's other blocks follow in `.PP`, `.RS <width>`, and `.RE`; otherwise every block of the item is in `.RS <width>` and `.RE` right after the `.IP`. A nested list is therefore indented by its parent's marker.
- **A quote** is its blocks in `.RS 4` and `.RE`, after a `.PP` under Paragraph breaks.
- **Inline.** Emphasis is italic, strong emphasis is bold, and a code span is bold without its backticks, the man convention for a literal; the fonts combine, so a code span inside emphasis is bold italic. A link prints its text, a space, and its destination in angle brackets, `the format <https://www.json.org/json-en.html>`, or, when the text prints exactly as the destination, the text alone in its own fonts, and when it prints nothing but whitespace, the destination alone, so no text line starts with a space. An image prints as a link with the same text, and an autolink prints its address. A backslash escape prints its character, and everything else prints as written, as on help.

## Writing the pages

- **`generate`.** `--out` is resolved against `host.cwd`. The plugin creates the folder and each missing parent with mode `755`, whatever the umask, then writes each page to a staging file it creates exclusively in the folder, named `.<file>.<random>.loom-staging`, with mode `644`, whatever the umask, and renames it into place, which replaces a file or a symbolic link of that name. It touches nothing else in the folder and records nothing, so `generate` runs on every platform, `win32` included, and from every build. It prints `Wrote <count> man pages to <folder>.` through `out.success`. A `--out` that names anything but a folder fails with a `FatalError` and exit 1 before anything is written: `/home/me/src/jsonkit/build/man is not a folder. Name a folder, or a path where jsonkit can create one.` A file system call that fails throws the runtime's error, which fails the run through the ordinary failure path, and the staging file is removed.
- **The folder.** `install` writes the set to `<home>/.local/share/man/man1`, where `<home>` is `HOME` from `host.env`. Neither man-db nor macOS's `man` reads `XDG_DATA_HOME`, and both search `<dir>/share/man` for each `<dir>/bin` on `PATH`, so a page there is found whenever `<home>/.local/bin`, the [installer script](../toolchain/install.md)'s default folder, is on `PATH`.
- **The record.** The set is recorded through the [installed-files module](../core/installation-record.md#installed-files) in the plugin's file `manpage.json`, every page a file with its digest, under the module's rules as written: there is no `--force`, and each folder the module creates is created with mode `755` and each page written with mode `644`, whatever the umask.
- **Checks first.** Each of `install`, `update`, and `uninstall` checks, in this order, and fails at the first that fails:
  1. The platform. No platform refuses: on `win32` each child resolves its folder from `HOME` as on other platforms, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md).
  2. `install`: `<home>`, which fails as [Skills](skills.md#global-installs) states when `HOME` is not an absolute path.
  3. The record's directory, `applicationDirectory('installation', name, host)`, which answering `{ variable }` fails as Skills states.
  4. The plugin's file, read through the module. One that is damaged or holds an unknown `format` fails with a `FatalError` and exit 1: `<record> cannot be read, so jsonkit will not change the man pages it lists. Remove it and the pages it lists, then run jsonkit manpage install again.`, with `uninstall` in place of `install` for that child.
  5. `install` and `update`: every page of the set, under Files the record does not list.
- **Files the record does not list.** A file, folder, or symbolic link at a page's path that `manpage.json` does not record, such as a page an earlier `generate` wrote there or a link a dotfile manager keeps, and a recorded page of the set, one this run would write, whose digest changed since it was written, each refuse `install` and `update`, which write nothing. A recorded page the set no longer holds never refuses; it is kept as `install` states. The child prints one line for each through `out.warn`, `<file> was not installed by jsonkit manpage install.` or `<file> changed since jsonkit manpage install wrote it.`, where `<file>` is the page's path, then fails with a `FatalError` and exit 1: `jsonkit manpage install changed nothing, because files it did not install are in the way.`, corrected by `Remove them, then run jsonkit manpage install again.` `update` uses `jsonkit manpage update` in the failure sentence and `jsonkit manpage install` in the correction.
- **`install`.** The module installs every page of the set. The set is unchanged when `manpage.json` is committed, records exactly the set's paths, and every page is a regular file at its path whose digest is the recorded one and the one it would hold; then nothing is written, and it prints `The <count> man pages in <folder> are unchanged.` through `out.info`. Otherwise it prints `Installed <count> man pages in <folder>.` through `out.success`, counting the whole set. A recorded page the set no longer holds, as when a Command was removed or hidden, or every recorded page after `HOME` changed while the record's directory stayed, as it does on Linux under an absolute `XDG_STATE_HOME`, so that the set moves to the new folder, is removed when its digest is unchanged and prints `Removed <file>.`, and is kept when it changed and prints `<file> changed since jsonkit manpage install wrote it, so it was left in place.` through `out.warn`. Then it prints `Read them with man jsonkit.` through `out.info`, or the advice below.
- **Advice when `man` will not find them.** After `install`, the plugin reads `MANPATH` and `PATH` from `host.env`. An entry of `PATH` maps to the folder when, with a trailing `/` removed, it is `<home>/.local/bin`. `man` finds `<home>/.local/share/man` when one of these holds:
  - `MANPATH` is unset or empty, and an entry of `PATH` maps to the folder;
  - `MANPATH` lists `<home>/.local/share/man`;
  - `MANPATH` holds an empty entry, at its start, at its end, or between two colons, which both `man` programs read as their default search, and an entry of `PATH` maps to the folder.

  When none holds, the plugin prints `man will not find these pages until MANPATH lists <home>/.local/share/man. Add this line to your shell's startup file:` through `out.warn`, then `export MANPATH="<home>/.local/share/man:${MANPATH-}"` through `out.print`, with each `"`, `\`, `$`, and `` ` `` in the folder escaped with a `\`. When the last segment of `SHELL` is `fish`, the line is `set -gx MANPATH '<home>/.local/share/man' "$MANPATH"` instead, with the folder in Fish's single quotes as [Completion](completion.md) writes them: Fish joins a quoted path variable with colons, and reads an unset one as one empty element, which gives the trailing colon. When `MANPATH` was unset, the line leaves a trailing colon, so the default search still follows, and `${MANPATH-}` reads an unset variable as empty under `set -u`. The plugin never edits a startup file.
- **A new home on macOS.** On `darwin` the record's directory is under `HOME`, so after `HOME` changes the plugin reads the new home's record, and the pages under the old home stay where they are, recorded in the old home's record.
- **`update`.** It acts only on what `manpage.json` records, read as recovery would resolve it. It installs the set into the folder that holds the recorded pages and derives no page path from `HOME`, so a refresh run from another environment never moves a page. A record whose pages sit in more than one folder, which only an install interrupted while it moved the set leaves, fails `update` with a `FatalError` and exit 1 before anything is written: `<record> lists man pages in more than one folder, so jsonkit manpage update cannot tell where they belong. Run jsonkit manpage install to put them in one folder.` Otherwise it prints `Updated <count> man pages in <folder>.` in place of the installed line, or the unchanged line, with removed and kept pages as `install` prints them. It prints no advice. With no page recorded, it prints `jsonkit has no man pages installed, so there is nothing to update. Run jsonkit manpage install to install them.` through `out.success` and exits 0.
- **`uninstall`.** The module removes each recorded page whose digest is unchanged, keeps each changed one, removes each directory it created that is then empty, and deletes the plugin's file. It prints `Removed <count> man pages from <folder>.` through `out.success` for each folder it removed pages from, in the order the record lists them, counting that folder's pages, and each kept page prints the left-in-place line through `out.warn`. A recorded page already gone is not counted and prints nothing. When it removed and kept no page, as with no page recorded or every recorded page already gone, it prints `jsonkit has no man pages installed, so there is nothing to remove.` through `out.success` and exits 0.
- **Any build.** Every child acts from a `source`, `development`, or `distributed` build alike, because a page describes the graph, not the binary's path.
- **No index.** The plugin never runs `mandb` or `makewhatis`. `man <page>` finds an installed page without an index; `apropos` and `whatis` find it after the system's next index run.

## Refreshing man pages after a self-update

`refreshManpages` is an `afterReplace` function for the [self-update plugin](self-update.md), which passes it a context that holds every member `RefreshContext` names. A page is fixed text, so after a replace the installed pages describe the old version until they are rewritten, and the replaced process holds the old version's graph. `refreshManpages` therefore runs the new binary, and `update` decides what to refresh. It runs `path` with the words `manpage update` exactly as [`refreshSkills`](skills.md#refreshing-after-a-self-update) runs `skills update`, under the same rules for the child, its output, and the run signal. A child that fails, or that cannot start, adds the `warn` log event `Man pages were not refreshed after the update.`, with the same fields, and resolves; one that cannot start writes `The man pages were not refreshed because /home/me/.local/bin/jsonkit could not start. Run jsonkit manpage update.` to `host.stderr`. An application that also refreshes skills or completion calls each from its own `afterReplace`, as [Completion](completion.md#refreshing-completion-after-a-self-update) shows. A binary that a package manager, npm, or the installer script replaced runs no `afterReplace`, and its installed pages stay those of the earlier version until the operator runs `manpage update`.

- **Output.** A count of 1 reads `1 man page`, and every other count `man pages`. The `Wrote`, `Installed`, `Updated`, `Removed <count>`, and nothing-to lines go through `out.success`; the unchanged, `Removed <file>`, and `Read them` lines through `out.info`; the refused-file, left-in-place, and advice lines through `out.warn`; and the `export` line through `out.print`, the only thing a child writes to stdout. The examples above omit the glyph each lane view adds. Every path a sentence repeats passes through `escapeControlCharacters`. Every refusal and check failure above is a `FatalError` that exits 1, and a missing `--out` is core's usage error, with exit 2.
- **Names.** `manpage`, `refreshManpages`, and `RefreshContext` are exported from `@loomcli/plugins/manpage`. `RefreshContext` is the same declaration `@loomcli/plugins/skills` exports.
