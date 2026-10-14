---
type: adr
title: ADR-0079 - The manpage plugin writes a roff page per Command and installs the set in the home folder
description: The manpage plugin contributes manpage generate, install, update, and uninstall. It writes one section-1 roff page for the root and each Command that is neither hidden nor under a hidden Command, named like git's pages, from the graph and the help and configuration values each Command carries, with no date and no host fact, so a graph gives the same bytes everywhere. Details render from help's Markdown parser in roff's own way, filled by man. generate writes the set to a folder for a packager and records nothing; install writes it to ~/.local/share/man/man1, which man finds when ~/.local/bin is on PATH, through the installation record under ADR-0071 as written, and advises on MANPATH when man will not find it. refreshManpages refreshes after a self-update.
status: accepted
created: 2026-10-13
modified: 2026-10-14
---

# ADR-0079 - The manpage plugin writes a roff page per Command and installs the set in the home folder

## Context

An operator on Linux or macOS reaches for `man <tool>` first, and no Loom application has a page. [ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md) keeps environment and configuration bindings off help because they belong to documentation such as a man page, so today an operator learns them nowhere but `inspect()` and the manifest.

Every fact a page needs is already on the graph. Core owns names, descriptions, inputs, defaults, environment bindings, and hidden and deprecated facts. Help's `details`, `examples`, placeholders, accepted values, and ordered sections are extension values that `@loomcli/plugins/help/extension` reads whether or not help is installed, and the configuration plugin's `configInput` holds each option's key. [ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md) made `details` Markdown and gave the pack a parser whose model holds no projection.

Neither man-db, the `man` of most Linux distributions, nor macOS's `man` reads `XDG_DATA_HOME`, and neither searches a user folder by default. Both derive their search from `PATH`: for each `<dir>/bin` they search `<dir>/share/man` and `<dir>/man`. A `MANPATH` replaces that search unless it holds an empty entry. The [installer script](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) puts the binary in `~/.local/bin` by default.

[ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) records every file an installer writes by its digest, and [ADR-0076](0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) and [ADR-0078](0078-the-completion-plugin-installs-a-script-and-one-startup-line-per-shell.md) settled the shape of an installing plugin: `install`, `update`, and `uninstall`, and an `afterReplace` function that runs the new binary's `update`. A completion script asks the binary at every Tab, but a page is fixed text, so a page that is not refreshed describes the old version.

## Decision

- **Four Commands and a refresh.** `manpage()` from `@loomcli/plugins/manpage` takes no settings and contributes one plugin Command group, `manpage`, with `generate --out <folder>`, `install`, `update`, and `uninstall`, and exports `refreshManpages`. `generate` serves a packager, such as a Homebrew formula or a Debian package, and an operator installs with `install`.
- **A page per findable Command.** The set holds a page for the root and for every Command that is not hidden and has no hidden ancestor, plugin Commands and groups included. A deprecated Command has a page; an alias has none. Pages are named as git's are, `jsonkit`, `jsonkit-get`, and `jsonkit-completion-install`, every page is in section 1, and no extension excludes a page or names its section. Two page names equal without ASCII case are a declaration fault the plugin's `onGraphBuilt` hook throws on every build, because a file system that ignores case would hold them as one file.
- **The page.** NAME, SYNOPSIS from help's usage forms, DESCRIPTION from `details`, COMMANDS, ARGUMENTS, OPTIONS in help's ordered sections, EXAMPLES, ENVIRONMENT, and SEE ALSO. Global options appear on the root page alone, as git's, gh's, and cargo's do, and every other page names the root page under SEE ALSO. An option's entry names its environment variable and its configuration key, and ENVIRONMENT lists the variables, so the bindings help leaves out have a home. There is no EXIT STATUS section, because an author's failure classes are not tied to Commands, and no FILES section, because the configuration file's location is a configuration plugin setting no projection reads.
- **The same bytes everywhere.** `.TH` holds the page name, section 1, an empty date, the application name and `graph.version`, and an empty manual name. A page reads no host fact and no clock, so a graph gives the same bytes on every host, through `generate` and `install` alike, and an unchanged page keeps its digest.
- **Markdown in roff's way.** `details` is parsed with the parser help uses and rendered with the man macros: a paragraph is filled and wrapped to the reader's width by `man`, code keeps its lines, a heading is an `.SS`, lists and quotes indent through `.IP` and `.RS`, emphasis is italic, strong emphasis and code spans are bold, and a link prints its destination in angle brackets. Help keeps the author's line breaks because its page wraps nothing; a man page follows the convention of its own medium. Every string passes one writer that escapes `\`, `-`, the quote characters, `^`, and `~`, quotes each request argument, protects a line that would start with `.`, keeps a tab only in no-fill text, shows a control character as its escape, and writes every other character above ASCII as a `\[u…]` escape, so no authored text reads as a request, a copied example is the text the operator types, and a page is ASCII whether or not `man` runs `preconv`.
- **`generate` writes a folder and records nothing.** It writes each page directly into the folder `--out` names, creating it when missing, replaces a file of the same name, touches nothing else, and runs on every platform.
- **`install` writes `~/.local/share/man/man1`.** The folder is fixed under `HOME`, because `man` ignores `XDG_DATA_HOME`, and `man` finds it whenever `~/.local/bin` is on `PATH`. After an install, the plugin reads `MANPATH` and `PATH`, and when `man` will not find the pages, prints a line that sets `MANPATH` for the operator to add, in Fish's syntax when the login shell is Fish. It never edits a startup file. On Windows, which has no `man`, `install` refuses and points at `generate`, and `update` and `uninstall` find nothing to do.
- **ADR-0071 as written.** The set is recorded in `manpage.json`, every page a file with its digest. A file the record does not list, or a recorded page of the set someone changed, refuses an install, and there is no `--force`. A page the set no longer holds is removed when unchanged and kept when changed. `update` acts on the recorded folder alone and derives no page path from `HOME`, and `uninstall` removes unchanged pages and the plugin's file. Any build installs, because a page describes the graph, not the binary's path.
- **`refreshManpages` refreshes after a self-update.** It runs the replaced binary's `manpage update` as a child, as `refreshSkills` and `refreshCompletion` do, and never fails the update.

The contract and its acceptance are in [Man pages](../core.md#man-pages).

## Considered options

- **The original specification's `--prefix` on install and uninstall.** Rejected. A record per prefix serves the packager, whom `generate` serves without writing an installation record on a build machine that the record would not describe.
- **`<data>/man` under `XDG_DATA_HOME`, as completion's data folder.** Rejected. `man` never reads it, so an operator who sets the variable would get pages no `man` finds.
- **A folder beside the running binary, `<bin>/../share/man`.** Rejected. Only a compiled binary in a `bin` folder has one, a Node or npm run does not, and the folder may belong to a package manager.
- **Adding a line to the operator's startup file that sets `MANPATH`.** Rejected. The installer script advises on `PATH` and edits no profile; `man` already finds the folder in the common case, and the advice covers the rest.
- **A page for a hidden Command.** Rejected. `apropos` and `man jsonkit-<Tab>` list installed pages, which is a listing a hidden Command stays off.
- **A `manpage` extension to exclude a Command or name its section.** Rejected. Hidden already excludes a Command, and every Command is a section-1 command.
- **Global options on every page, as help prints them.** Rejected. Man pages for tools with subcommands keep them on the root page, which keeps each page about its Command.
- **Keeping the author's line breaks with `.br`.** Rejected. `man` wraps to the reader's width, and forced breaks leave ragged text at every other width.
- **A date in `.TH`, from the clock or `SOURCE_DATE_EPOCH`.** Rejected. The clock changes the bytes of every page on every run, and `SOURCE_DATE_EPOCH` would make `generate` and `install` disagree for one binary; the version says which build wrote the page.
- **Requiring help to be installed, as the original specification did.** Rejected. The values are read wherever a Command carries them, and a page without them is shorter, never wrong.
- **Running `mandb` or `makewhatis` after an install.** Rejected. `man <page>` finds a page without an index, and the index is the system's.

## Consequences

`@loomcli/plugins/manpage` imports the declarations modules of help and the configuration plugin, which [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md) allows a projection that knows its suppliers. The pack's Markdown parser gains a second renderer and stays internal. The Windows refusal is unverified under [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md), because no CI runner has Windows. A page installed by an earlier version stays until `update` runs, unless self-update refreshes it.

## Status

Accepted in 0.12.0.

## Changelog

- 2026-10-13: Proposed with the man pages contract.
