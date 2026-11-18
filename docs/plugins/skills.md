---
description: "The skills plugin: installing an application's agent skills globally or into a project, with command references generated from the graph, and reporting whether each installed skill is current."
---

# Skills plugin

This page documents the skills plugin, which installs an application's agent skills globally or into a project, keeps them current, reports whether each is current, and removes them, and generates a reference for each Command a skill selects. An author installs it so coding agents can read the skills the application ships.

```ts
// @loomcli/plugins/skills
import type { CommandGraph, Host, Log, Plugin } from '@loomcli/core';

export interface SkillFile {
  readonly path: string; // relative to the skill's folder, such as references/workflow.md
  readonly content: string | Uint8Array; // the file's text or bytes
  readonly executable?: boolean; // written with mode 755 when true, else 644
}
export interface Skill {
  /** The skill's folder name, such as notes. */
  readonly name: string;
  /** Loads the skill's files, called when a skills Command installs or reports on the skill, or skillFolders reads it. */
  readonly files: () => Promise<readonly SkillFile[]> | readonly SkillFile[];
  /** The Commands whose command references the plugin generates, each by its path from the root; the path [] selects the whole application. */
  readonly commands?: readonly (readonly string[])[];
}
export interface FolderSkillCommands {
  /** The name of a skill the skills folder holds, which supplies its files. */
  readonly name: string;
  readonly files?: never;
  /** The Commands whose command references the plugin generates for that skill. */
  readonly commands: readonly (readonly string[])[];
}
export interface SkillsSettings {
  readonly folder?: URL | string; // a folder whose subfolders are skills, each named for its subfolder
  readonly skills?: readonly Skill[]; // skills whose files a loader returns
}
export interface FolderSkillsSettings {
  readonly folder: URL | string; // the skills folder, which an entry without files needs
  readonly skills?: readonly (Skill | FolderSkillCommands)[]; // listed skills, and the Commands folder skills select
}
export interface RefreshContext {
  readonly path: string; // the binary that replaced this one
  readonly host: Host; // the run's host
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log
  readonly name?: string; // the application's name, which finds the installation record; absent, the child always runs
}
export interface CommandReferenceSettings {
  readonly commands: readonly (readonly string[])[]; // the paths of the Commands to render, as a skill's commands
  readonly guidance: boolean; // whether each file carries its Command's skillCommand guidance
}
export interface CommandReferenceFile {
  readonly name: string; // the file's name, such as index.md or notes-note-list.md
  readonly content: string; // the file's text
}
export interface SkillFolder {
  readonly name: string; // the skill's name
  readonly files: readonly SkillFile[]; // every file an install writes in the skill's folder
}
export interface SkillFoldersOptions {
  readonly moduleDirectory?: string; // the application module's directory, which a relative folder setting resolves against
}
export type SkillState = 'missing' | 'unmanaged' | 'modified' | 'stale' | 'current';
export interface SkillStatus {
  readonly skill: string; // the skill's name
  readonly target: 'claude' | 'agents'; // the agent target
  readonly scope: 'global' | 'project'; // the home folder's skills, or a repository's
  readonly state: SkillState; // what status found, under Status
  readonly folder: string; // the skill's folder for the target and scope, an absolute path
  readonly files: readonly string[]; // the relative paths that differ, for a modified or stale skill; none otherwise
  readonly notes: readonly string[]; // what to do next; none for a current skill
}
export declare function skills(settings: SkillsSettings | FolderSkillsSettings): Plugin;
export declare function refreshSkills(context: RefreshContext): Promise<void>;
export declare function commandReferences(graph: CommandGraph, settings: CommandReferenceSettings): readonly CommandReferenceFile[];
export declare function skillFolders(graph: CommandGraph, options?: SkillFoldersOptions): Promise<readonly SkillFolder[] | undefined>;
```

```ts
// @loomcli/plugins/skills/extension, declarations alone
import type { Extension, StandardSchemaV1 } from '@loomcli/core';

export interface SkillCommandFacts {
  readonly guidance: string; // Markdown for an agent that uses the Command through a skill
}
export declare const skillCommand: Extension<'command', StandardSchemaV1<SkillCommandFacts, SkillCommandFacts>>;
```

```text
skills/
  notes/
    SKILL.md
    references/
      workflow.md
```

```ts
import { Application } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills, skills } from '@loomcli/plugins/skills';

import { note } from './note.js';

export const notes = new Application('notes', {
  description: 'Keep short notes in one file.',
  plugins: [
    help(),
    format(),
    skills({
      folder: new URL('../skills/', import.meta.url),
      skills: [{ name: 'notes', commands: [['note']] }],
    }),
    selfUpdate({ afterReplace: refreshSkills }),
  ],
  version: '1.4.0',
}).command(note);
```

```text
$ notes skills install
Installed notes for claude in /home/me/.claude/skills/notes.
Installed notes for agents in /home/me/.agents/skills/notes.
$ notes skills update
/home/me/.claude/skills/notes is unchanged.
/home/me/.agents/skills/notes is unchanged.
$ notes skills status
notes for claude: current
  folder  /home/me/.claude/skills/notes

notes for agents: current
  folder  /home/me/.agents/skills/notes
$ notes skills install --project --agent claude
Installed notes for claude in /home/me/src/acme/.claude/skills/notes.
$ notes skills uninstall
Removed /home/me/.claude/skills/notes.
Removed /home/me/.agents/skills/notes.
```

The folder's `notes/` subfolder is the skill `notes`. A source run and a test read the folder from disk, and `loom build` carries it into the bundle or the binary, under [The skills folder](#the-skills-folder). A skill whose files are generated or computed comes from a loader in `skills`, which the plugin calls only when a skills Command installs the skill or reports on it, or [`skillFolders`](#reading-skills-outside-an-install) reads it. The entry `{ name: 'notes', commands: [['note']] }` gives the folder's `notes` no files of its own; it selects the `note` Command and every Command under it, so each installed `notes` folder also holds `references/commands/`, a command reference for each of those Commands and an index, which the plugin generates from the graph under [Command references](#command-references).

`skills()` is the skills plugin. It installs the application's agent skills where coding agents read them, keeps them current with the binary, and removes them. Its identity is `@loomcli/plugins/skills`, and its contribution is one [plugin Command](../core/plugin-contract.md#plugin-commands) group, the `skillCommand` extension, and one `onGraphBuilt` hook that judges the Commands each skill selects and records which `skills()` call built the graph. [ADR-0076](../decisions/0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) records the decision, [ADR-0133](../decisions/0133-the-skills-plugin-reads-a-skills-folder-that-loom-build-carries-into-the-artifact.md) adds the skills folder, [ADR-0188](../decisions/0188-the-skills-plugin-generates-each-skills-command-references-from-the-graph-at-install.md) adds the generated command references, and [ADR-0189](../decisions/0189-skills-status-reports-each-skill-per-target-and-the-record-keeps-a-digest-of-each-installed-skill-file.md) adds `status` and a digest of each installed file.

- **Settings.** The settings type bounds `folder`, the list, and each entry's `files` and `commands`, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). `skills()` judges the settings at the call and throws a `DeclarationError` for the first fault, in this order, with the finding marked on the setting at fault:
  - **Some setting.** The settings hold a `folder` or a `skills` list, which may be empty: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).
  - **A file folder.** A `folder` URL uses the `file:` scheme, and a `folder` string is not empty: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).
  - **Skill name.** Each entry's `name` is a skill name: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).
  - **Unique names.** No two entries repeat one name: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).

  A skill name is one or more runs of lowercase ASCII letters and digits joined by single `-`, 64 characters at most, the Agent Skills grammar, so it is safe as one path segment. A name the diagnostic repeats passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). A `commands` path is judged when the graph builds, under [Command references](#command-references), because only the graph knows it. A `FolderSkillCommands` name is judged when the folder is read, under [The skills folder](#the-skills-folder), because only the folder knows it.
- **Entries.** A `Skill` is a listed skill, whose `files` loader supplies its files, and it may declare `commands`. A `FolderSkillCommands` entry, `{ name, commands }` with no `files`, names the skills folder's skill of its `name`, which supplies the files, and adds only the Commands it selects; it takes no place in the install order. `skills()` takes `SkillsSettings` or `FolderSkillsSettings`, and only the second, whose `folder` is required, lists a `FolderSkillCommands` entry, so the list takes one only in settings that name a `folder`: `skills({ skills: [{ name: 'notes', commands: [['note']] }] })` is a compile error, and a value that bypasses the types gets no rule, under ADR-0093.
- **Loading the files.** `install`, `update`, `status`, and [`skillFolders`](#reading-skills-outside-an-install) read the skills folder, under [The skills folder](#the-skills-folder), then call each listed skill's `files` once, in declaration order, after every check under Global installs or Project installs that comes before loading, and before they read the record or write anything, and await each; `uninstall` calls no loader, so a broken loader never blocks a removal. A loader that throws or rejects takes the ordinary failure path, as [When author code fails](#when-author-code-fails) states. The result is judged before anything is written, and the first fault throws a `DeclarationError`, which fails the run through the same path:
  - **Inside the folder.** A file's path is relative and stays inside the skill's folder, so it neither starts with `/` nor has a `..` segment: [`@loomcli/plugins/skills/files`](../core/diagnostics.md#loomclipluginsskillsfiles).
  - **A SKILL.md.** The list holds an entry whose path is `SKILL.md`: [`@loomcli/plugins/skills/files`](../core/diagnostics.md#loomclipluginsskillsfiles).

  A path the diagnostic repeats passes through `escapeControlCharacters`. The result's type bounds its shape, and the plugin judges no file's content. The folder's skills come first, in name order, then the listed skills, in declaration order; a `FolderSkillCommands` entry takes no place of its own. A listed skill that holds a folder skill's name is a fault: `The skills setting lists the skill notes, which the skills folder /work/notes/skills holds too.`, corrected by `Give the listed skill another name, remove it from the list or the folder, or leave out its files so the entry names the folder's skill.`, with the rule [`@loomcli/plugins/skills/files`](../core/diagnostics.md#loomclipluginsskillsfiles). Once every skill's files are judged, the plugin generates each selecting skill's command references, under [What an install writes](#what-an-install-writes).
- **The Commands.** `skills`, visible, with the description `Install this application's agent skills.`, and four children, each visible with no arguments:
  - `install`, `Install the skills for your coding agents.`, with the string option `--agent`, `The agents to install for: claude, or agents for Codex and others. Both when left out.`, validated to `claude` or `agents`; the Boolean option `--project`, `Install into the current repository instead of your home folder.`; the string option `--directory` with the short spelling `-C`, `Find the repository from this directory instead of the current one.`; and the Boolean option `--force`, `Replace skill files that something else wrote or that you changed.`
  - `update`, `Bring installed skills up to date with this version.`, with no options.
  - `uninstall`, `Remove the skills from your coding agents.`, with `--agent`, `The agents to remove the skills from: claude or agents. Both when left out.`, validated the same way.
  - `status`, `Report whether each skill is installed and up to date.`, with `--agent`, `The agents to report on: claude or agents. Both when left out.`, validated the same way; `--project`, `Report on the current repository's skills instead of your home folder's.`; and `--directory` with `-C`, described as on `install`. It declares the result under [Status](#status).

  An `--agent` value outside the set is core's usage error for that input, with exit 2. `--directory` without `--project` is an `InputError` the action throws, `Option "--directory" needs --project. Add --project, or leave out --directory.`, with exit 2, on `install` and `status` alike. `--force` with `--project` has no effect, because a project install always replaces. Only `status` declares a result. A root that declares arguments holds the plugin's Commands like any children, so such an application can install the plugin, and an application installs it once, because a second `skills` collides under [Plugin Commands](../core/plugin-contract.md#plugin-commands).
- **Agent targets.** `claude` and `agents`, in that order, which every child follows. A child with no `--agent` acts on both.

  | Target | Global folder | Project folder |
  | --- | --- | --- |
  | `claude` | `<claude>/skills/<name>/`, where `<claude>` is `CLAUDE_CONFIG_DIR` when it is an absolute path, else `<home>/.claude` | `<root>/.claude/skills/<name>/` |
  | `agents` | `<home>/.agents/skills/<name>/` | `<root>/.agents/skills/<name>/` |

  `<home>` is [`host.home`](../core/host.md#the-home-and-temporary-folders) on every platform, and `CLAUDE_CONFIG_DIR` is read from `host.env`.
- **File modes.** Each file is written with mode `755` when `executable` is true and `644` otherwise, whatever the umask, at both scopes. A generated file is never executable. Folders are created with the process's default mode.
- **Any build.** Every child acts from a `source`, `development`, or `distributed` build alike, because a skill does not depend on the binary's path, except that a source run cannot read a `folder` given as a relative path, and an artifact `loom build` made without reading the declaration, or that found no folder in it, cannot read a `folder`, under [The skills folder](#the-skills-folder).

## The skills folder

The `folder` setting names a folder whose subfolders are the application's skills. The author names it once, in the declaration, and every way the application runs installs the same files. A string that starts with `file:` reads as that URL, and any other string is a path. [ADR-0133](../decisions/0133-the-skills-plugin-reads-a-skills-folder-that-loom-build-carries-into-the-artifact.md) records the decision.

- **The folder's shape.** Each directory directly inside the folder is one skill, named for the directory, and so is a symbolic link there that names a directory, read through the link. An entry whose name starts with `.`, directly inside the folder or at any depth inside a skill, is skipped by its name before it is read or judged, whether it is a file, a folder, or a symbolic link, so a `.DS_Store` or an editor's lock link such as `.#SKILL.md` is never installed and never a fault. A file a skill needs under such a name, such as `.env`, comes through a loader instead. A skill's files are every other file below its directory, at its path relative to the skill's directory, using `/`, and a symbolic link to a file reads as that file. A file is executable when its mode has an execute bit. Directly inside the folder, a file, such as a `README.md`, or a symbolic link to one is ignored.
- **Reading and judging.** `install`, `update`, `status`, and `skillFolders` read the folder when they load files, so a run that does none of them reads nothing, and judge its skills as they judge a loader's, under Loading the files, before anything is written. A skill name is judged here, not at the call, because only the folder knows it. Each fault below throws a `DeclarationError` through the ordinary failure path with the rule [`@loomcli/plugins/skills/folder`](../core/diagnostics.md#loomclipluginsskillsfolder):
  - **A folder.** The folder exists and is a directory: `Plugin "@loomcli/plugins/skills" setting "folder" names /work/notes/skills, which is not a folder.`, corrected by `Create the folder, or name the folder that holds the skills.`
  - **Some skill.** The folder holds at least one skill when the `skills` list is empty or left out, so an update never removes every installed skill: `The skills folder /work/notes/skills holds no skill.`, corrected by `Add a folder for each skill, holding its SKILL.md, such as skills/notes/SKILL.md.`
  - **Skill names.** Each skill directory's name is a skill name: `The skills folder /work/notes/skills holds a folder that is not a skill name: My Notes.`, corrected by `Name each skill's folder with lowercase letters, digits, and single hyphens, such as notes.`
  - **Links.** A symbolic link directly inside the folder names something: `The skills folder /work/notes/skills holds shared, a link that names nothing.`, corrected by `Point the link at the skill's folder, or remove it.`
  - **Links to folders.** Nothing inside a skill is a symbolic link that names a folder: `The skill notes holds scripts/lib64, a link to a folder, which a skill cannot hold.`, corrected by `Replace the link with the folder's files, or remove it.`
  - **Files and folders.** Nothing inside a skill is a symbolic link that names nothing, or an entry that is neither a file nor a folder: `The skill notes holds references/old, which is not a file or a folder.`, corrected by `Replace it with the file it stands for, or remove it.`
  - **Entries without files.** Each `FolderSkillCommands` entry names a skill the folder holds, judged after a listed skill that holds a folder skill's name: `The skills setting lists the skill notes without files, and the skills folder /work/notes/skills holds no skill notes.`, corrected by `Add a folder named notes, holding its SKILL.md, to the skills folder, or give the entry its files.`
- **Where an unbuilt run reads.** A run with no carried folder, a source run, a test, or a build `loom build` did not make, reads the folder a URL or an absolute path names. A relative path resolves against the application module, which only `loom build` knows, so such a run fails with `Plugin "@loomcli/plugins/skills" setting "folder" is the relative path ../skills, which only loom build resolves.`, corrected by `Name the folder with new URL('../skills', import.meta.url), resolved against the module that calls skills().`, with the rule `@loomcli/plugins/skills/folder`. When the release facts say the run was built and the folder is missing, the failure says `The build carried no skills folder, and /work/notes/skills is not a folder.`, corrected by `Build with loom build at the version of @loomcli/plugins, which carries the folder skills() names.`
- **Matching versions.** A carried folder, or a copy's index, whose format this plugin does not know fails with `This @loomcli/plugins cannot read the skills folder the installed @loomcli/loom carried.`, corrected by `Install @loomcli/plugins and @loomcli/loom at one version, and build again.`, with the rule `@loomcli/plugins/skills/folder`.
- **What a `loom build` artifact reads.** [`loom build`](../toolchain/build.md#the-skills-folder) reads the folder from the declaration and carries it. A development build reads the source folder where it stands, and reads and judges it when it loads, as an unbuilt run does. A distributed bundle reads the copy in `loom-skills/` beside its chunks, and a distributed binary the copy embedded in it, each with the files, names, and modes the build judged, which the copy's index, `loom-skills/index.json`, names. Each is read through `node:fs`, under Node and Bun alike. When the build could not read the declaration, a run of the artifact whose setting names a folder fails with `loom build could not read the skills folder, because it could not load the application module.`, and when it read the module but found no folder there, because no `skills()` call named one or none ran while the module loaded, with `loom build found no skills folder in the application module.`; each is corrected by `Export the Application from the module paths.application names, src/application.ts by convention, call skills() as it loads, and build again.`, with the rule `@loomcli/plugins/skills/folder`. The build carries the author's files alone, `references/commands/` included when the folder holds one; nothing generated is carried.

## Command references

```text
/home/me/.claude/skills/notes/
  SKILL.md
  references/
    workflow.md
    commands/
      index.md
      notes-note.md
      notes-note-add.md
      notes-note-list.md
```

A skill that declares `commands` selects Commands, and the plugin generates a command reference, a Markdown file, for each Command it selects and an index of them, from the graph of the run that installs, so the references describe the binary that installed them and never drift from it. A command reference reads the same facts help and the man page read, through help's own cells, and adds the skill's guidance. [ADR-0188](../decisions/0188-the-skills-plugin-generates-each-skills-command-references-from-the-graph-at-install.md) records the decision.

- **Selecting.** `commands` is a list of paths. A path is the canonical names of the Commands on the way from the root down to one Command, never an alias, and it selects that Command and every Command under it: `['note']` selects `note` and its children, `['cache', 'clear']` selects one leaf, and the path `[]` selects the root and so the whole application, the plugin's own Commands included. Paths may overlap, and a Command two paths select is selected once. A skill that leaves out `commands`, or gives the empty list, selects nothing, generates nothing, owns no name, and installs exactly the files it supplies.
- **Which Commands get a file.** A selected Command gets a file when it is neither hidden nor under a hidden Command, the rule of the [man page set](manpage.md#the-page-set), so a path that leads to a hidden Command, or into one, gives no file and is not a fault. A non-empty `commands` whose every Command is hidden generates nothing, `index.md` included. A deprecated Command gets a file, marked under [The command reference file](#the-command-reference-file). The files follow graph order: the root first, then each Command's children depth first in authoring order, whatever order the paths list.
- **File names.** A Command's file is named as its [man page](manpage.md#the-page-set) is, the application name, then each name on its path, joined with `-`, with `.md` in place of `.1`: `notes.md` for the root, `notes-note.md`, and `notes-note-list.md`. The index is `index.md`. Each file sits directly in the skill's `references/commands/` folder.
- **Judged at build.** The plugin's `onGraphBuilt` hook judges each entry's `commands` on every build, entries in declaration order and each entry's paths in order, so `inspect()` throws and a run reports the first fault under [Judging the built graph](../core/lifecycle-hooks.md#judging-the-built-graph), whether or not a skills Command runs:
  - **A path names a Command.** Each name of a path is the name of a child of the Command the names before it lead to, starting at the root: [`@loomcli/plugins/skills/commands`](../core/diagnostics.md#loomclipluginsskillscommands). The sentence is `Skill "notes" selects the path ["note", "show"], which names no Command.`, corrected by `Name each Command on the path from the root down, such as ["note", "add"], or select [] for the whole application.` The path is shown as each name written as a JSON string literal, joined with `, `, in brackets, and passed through `escapeControlCharacters`.
  - **One file per name.** No two Commands that get a file in one skill give one file name, as `config-set` beside `config set` does, and the root of an application named `index` gives no file when the skill selects it, because `index.md` is the index: [`@loomcli/plugins/skills/reference-name-taken`](../core/diagnostics.md#loomclipluginsskillsreference-name-taken). The sentences are `Skill "notes" selects Commands "config set" and "config-set", which both give the file references/commands/notes-config-set.md.`, corrected by `Rename one of them, hide one, or select one of them alone.`, naming the earlier Command in graph order first, and `Skill "tools" selects the root of index, whose file references/commands/index.md is the name of the index.`, corrected by `Select the root's Commands by their own paths, such as ["get"], in place of [].`

  A path's faults come before its names', and a skill whose paths all name Commands is judged for names once, over every Command it selects. A Command path a sentence repeats is its names joined with a space.
- **The names belong to the plugin.** In a skill whose `commands` is not empty, the plugin owns three names directly under `references/commands/`: `index.md`, `<app>.md`, and every `<app>-*.md`, where `<app>` is the application name, whether or not a Command gives that name today, and whether or not any Command gets a file. An author's file at one of those names, from the folder or a loader, is left out of the install, and the run says so at `-vv`, under [At -v and in the log](#at--v-and-in-the-log), so a file an export wrote for a Command since removed never survives. Every other author file under `references/commands/`, such as `references/commands/overview.md`, a file in a folder below it, or a `.md` file that is none of the three names, installs unchanged, like any author file. The plugin writes the author's files as they are and changes none of them, `SKILL.md` included.

### The index

`index.md` lists every Command that gets a file, in graph order, then the visible global options. With the application at the top of this page and the [example](#an-example) below, it holds this text:

```markdown
---
application: "notes"
version: "1.4.0"
---

# notes commands

- [notes note](notes-note.md): Write and list notes.
- [notes note add](notes-note-add.md): Add a note.
- [notes note list](notes-note-list.md): List the notes, newest first. (alias: ls)

## Global options

- `--help`: Show this help.
```

- **Frontmatter.** A line `---`, then a line `application: ` and the graph's `name`, then a line `version: ` and the graph's `version`, each value as `JSON.stringify` writes it, so YAML reads `1.10` as a string, then a line `---`. The version is the Application's declared version, `0.0.0` when it declares none, as [Graph inspection](../core/graph-inspection.md) reports it, so it does not depend on the release version a build bakes.
- **Heading.** One blank line, then `# <name> commands`.
- **Entries.** One blank line, then one list item per file, on consecutive lines: `- [<path>](<file>)`, where `<path>` is the application name followed by the Command's path, space-separated, and `<file>` the file's name; then `: <description>` when the Command has a description; then, when a fact applies, one space and a parenthesis holding the facts that apply, separated by `, `, in this order: `alias: <name>` for one [visible alias](../core/commands.md#visible-aliases) or `aliases: <names>` for several, the names in the order `visibleAliases` holds them and joined with `, `, as help's Command rows show them, then `needs a terminal` for a Command that needs one, then `deprecated`. So an entry reads `- [notes fetch](notes-fetch.md): Read one note. (alias: get, deprecated)`, and a full-screen editor's reads `- [notes edit](notes-edit.md): Edit a note. (needs a terminal)`. The link target needs no escaping, because a Command name holds only `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`.
- **Global options.** When the graph has a visible global option, one blank line, then `## Global options`, one blank line, and one list item per visible global, in `graph.globals` order, on consecutive lines, each an option entry as [The command reference file](#the-command-reference-file) states. An application with no visible global has no such section. No command reference lists a global.

### The command reference file

A Command's file holds these blocks, in this order, each left out, heading and all, when it has nothing to show. `<path>` is the application name followed by the Command's path, space-separated: `notes` for the root and `notes note list`. A row, a left cell, and a right cell below are the [help page's](help-page.md#the-help-page), computed as help computes them from the graph and from the `helpInput`, `helpArgument`, and `configInput` values the nodes carry, whether or not help or the configuration plugin is installed, as the man page reads them.

1. **Heading.** `# <path>`.
2. **Aliases.** For a Command with a visible alias, the paragraph `Alias: <name>`, or `Aliases: <names>` for several, the names in the order `visibleAliases` holds them, joined with `, `, as help's masthead shows them.
3. **Needs a terminal.** For a Command that [needs a terminal](../core/commands.md#a-command-that-needs-a-terminal), the paragraph `Needs a terminal: stdin and stderr, outside CI.`, the line help's masthead shows.
4. **Deprecated.** For a deprecated Command, the paragraph `Deprecated: <message>`.
5. **Description.** The Command's description, as a paragraph. The root's is the Application's.
6. **Usage.** `## Usage`, then a fenced block whose first line is ` ```text ` and last line ` ``` `, holding each usage form help's USAGE block prints for the Command, in its order, one per line, without help's two-space indent: the action form, beginning `<producer> | ` for a required standalone stdin, then the children form.
7. **Arguments.** `## Arguments`, then one list item per row help's ARGUMENTS block prints for the Command, in its order, the passthrough row and the `--` row included: ``- `<left cell>`: <right cell>``, or ``- `<left cell>` `` for a row with no right cell. A required argument's mark is its `<name>` in the usage form, as on the help page.
8. **Input.** `## Input` for a Command that declares a standalone [`.stdin()`](../core/validation.md#content-inputs), then each line help's INPUT block prints, without help's two-space indent, as a paragraph of its own.
9. **Options.** `## Options`, then one list item per visible local option, in declaration order, an option a plugin's hook declared included, as an option entry below, then each option-group sentence help prints for the Command, in its order, as a paragraph of its own.
10. **Result.** `## Result` for a Command that declares a result, then the paragraph ``Kind: `<kind>`. Views: <views>.``, where `<kind>` is `value` or `rows`, and `<views>` is each view name in record order as a code span, the default followed by ` (default)`, joined with `, `.
11. **Guidance.** `## Guidance`, then the Command's [`skillCommand`](#skill-guidance) guidance as Markdown, for a Command that carries one. `commandReferences` with `guidance: false` leaves the block out.
12. **Details.** `## Details`, then the `details` of each [`manifestCommand`](manifest.md#manifest-extension) value that holds one, in collection order, each as Markdown. With help installed, help's own `details` arrive here through [Help in the manifest](help.md#help-in-the-manifest).
13. **Examples.** `## Examples`, then one list item per example the `manifestCommand` values hold, in collection order: ``- `<name> <command>`: <note>``, or ``- `<name> <command>` `` for an example with no note, where `<name>` is the application name.
14. **Failures.** `## Failures`, then one list item per failure the `manifestCommand` values declare, in collection order: ``- `<code>` (exit <exit code>): <meaning>``.

- **An option entry.** ``- `<label>`: <right cell>``, or ``- `<label>` `` when the right cell is empty. The label is help's left cell for the row without its leading indentation and without the short spelling and the `, ` after it, so `-f, --file <path>` reads `--file <path>`, `    --explain` reads `--explain`, `-v, --verbose...` reads `--verbose...`, and `-b, --backup[=<control>]` reads `--backup[=<control>]`. A `shortOnly` option has no long spelling, so its label keeps its short one, `-m <metric>`; it would otherwise have none. The right cell is help's right cell for the row with the alias fact left out, so a default, an environment variable, a configuration key, a required mark, the accepted values, and a deprecated option's message read as help states them, and no option alias appears in any file. The index's global options use the same entry.
- **Blocks and blank lines.** A file is a sequence of blocks: a heading, a paragraph, a list, and a fenced block. Exactly one blank line separates two blocks, so one blank line follows each heading before its first block, one separates the last list item of Options from its first option-group sentence, and one separates two option-group sentences or two INPUT paragraphs. The items of one list sit on consecutive lines, with no blank line between them, and each item is one line. No blank line opens a file or a fenced block, and none sits inside a fenced block. Inside a Guidance or Details block, the author's own blank lines are kept, and two `details` values are separated by exactly one blank line.
- **Text.** Every value a file shows as text, which is a heading's path, an alias line, a description, a deprecated message, a right cell, an INPUT line, an option-group sentence, an index entry's path, an example's note, and a failure's meaning, is one line: each line break the author wrote, CRLF or a single line terminator of the set [the help page's text rules](help.md#help-extensions) name, reads as one space, as on the help page. Its leading and trailing spaces and tabs are left out. It is escaped so that it renders as written wherever CommonMark is rendered and stays readable as raw text: a backslash goes before each `\`, `` ` ``, `*`, `[`, and `<`; before each `_` that does not have an ASCII letter or digit on both sides; and before each `&` that an ASCII letter or `#` follows. ASCII alone renders correctly, because under CommonMark's flanking rule an `_` between two ASCII letters or digits never opens or closes emphasis, and a backslash before any other `_` is always safe. When the text begins a paragraph, a leading `#`, `>`, `-`, or `+` takes a backslash too, and so does a leading run of three or more `~`, which would open a code fence, and the `.` or `)` after a leading run of digits. Nothing else is escaped, so `NOTES_TAG`, `a > b`, and `~/notes` read as written.
- **Code spans.** A label, a left cell, a result's kind and view names, a failure's code, and an example's `<name> <command>` are code spans, written as they are, with no escape: delimited by one backtick, or, when the content holds backticks, by one more than its longest run of them, with one space inside each delimiter when the content begins or ends with a backtick, as CommonMark reads a code span.
- **Usage lines.** Each usage form is written as help prints it, without its two-space indent and with no escape, inside the fenced block. A form begins with the application name or `<producer>`, so no form closes the fence.
- **Markdown.** The guidance and each `details` are Markdown the author wrote, written as they are, except for their line breaks and their blank lines at the start and the end. Each line break, CRLF or a single line terminator of the set [the help page's text rules](help.md#help-extensions) name, is written as LF. A line that is empty or holds only spaces and tabs is blank, and the blank lines before the first line that is not blank and after the last one are left out. Every line from that first line to that last one, a blank line between them included, is written as the author wrote it, with its indentation and its trailing spaces, so a blank line that holds spaces keeps them. So guidance that opens with an indented code block keeps its indent and reads as code under its heading. The plugin escapes nothing in them and changes no heading level, so an author who heads a part of the guidance writes `###`, which sits under the block's `##`.
- **Bytes.** A file is UTF-8 with no byte order mark, each line ends with LF, the file ends with exactly one LF after its last block, and no line the plugin composes ends with a space or a tab. A file depends on the graph alone, its name, version, nodes, and their extension values, and reads no clock, host, or environment, so the same graph gives the same bytes in every build, on every host, and through every caller.

### An example

The `note` Command of the application at the top of this page, with its `add` and `list` children:

```ts
import { Command, EX_TEMPFAIL, FatalError } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { skillCommand } from '@loomcli/plugins/skills/extension';
import { table } from '@loomcli/plugins/table';

import { addNote, listNotes } from './actions.js';
import type { Note } from './actions.js';

export class StoreLockedError extends FatalError {
  static override readonly code = 'store-locked';
  static override readonly exitCode = EX_TEMPFAIL;
}

const add = new Command('add', { description: 'Add a note.' })
  .stdin({ description: 'The note text.', required: true })
  .action(addNote);

const list = new Command('list', {
  description: 'List the notes, newest first.',
  extensions: [
    skillCommand({ guidance: 'Read each row with `--format json`, and pass its `id` to the Command that changes a note.' }),
    manifestCommand({
      details: 'Each row holds `id`, `tag`, and `text`.',
      examples: [{ command: 'note list --tag home --limit 5', note: 'The five newest notes tagged home.' }],
      failures: [{ failure: StoreLockedError, meaning: 'Another run holds the note file.' }],
    }),
  ],
})
  .visibleAlias('ls')
  .option('tag', { description: 'Show only notes with this tag.', env: 'NOTES_TAG', type: 'string' })
  .option('untagged', { description: 'Show only notes with no tag.', type: 'boolean' })
  .option('limit', { default: '20', description: 'Show at most this many notes.', type: 'string' })
  .exclusive('tag', 'untagged')
  .rows<Note>({ views: { table: table({ columns: [{ key: 'text', header: 'NOTE' }] }) } })
  .action(listNotes);

export const note = new Command('note', { description: 'Write and list notes.' }).command(add).command(list);
```

The [formatter](format.md) declares `--format` on `list` and adds the `json` and `jsonl` views, so `references/commands/notes-note-list.md` holds this text:

````markdown
# notes note list

Alias: ls

List the notes, newest first.

## Usage

```text
notes note list [options]
```

## Options

- `--tag <tag>`: Show only notes with this tag.  (env: NOTES_TAG)
- `--untagged`: Show only notes with no tag.
- `--limit <limit>`: Show at most this many notes.  (default: 20)
- `--format <format>`: Select the output format, table by default. One of: table, json, jsonl.
- `--fields <fields>`: Select top-level fields of json and jsonl output, as a comma list.  (repeatable)

Use at most one of --tag and --untagged.

## Result

Kind: `rows`. Views: `table` (default), `json`, `jsonl`.

## Guidance

Read each row with `--format json`, and pass its `id` to the Command that changes a note.

## Details

Each row holds `id`, `tag`, and `text`.

## Examples

- `notes note list --tag home --limit 5`: The five newest notes tagged home.

## Failures

- `store-locked` (exit 75): Another run holds the note file.
````

`references/commands/notes-note-add.md`, for a Command that reads its text from stdin, holds this text, with the `<` of help's INPUT example escaped:

````markdown
# notes note add

Add a note.

## Usage

```text
<producer> | notes note add [options]
```

## Input

The note text.

Required. Reads piped or redirected stdin. Terminal input is not accepted.

Example: \<producer> | notes note add
````

`notes-note.md`, a group's file, holds its heading, its description, and the usage form `notes note <command> [options]`: the formatter's `--format` on a group is hidden. The index above lists the three files and the one visible global, help's `--help`; no file lists it.

### What an install writes

- **One folder.** For a skill that selects Commands, `install`, `update`, and a project install write the author's files, every one but those at a name the plugin owns, and the generated files as the one skill folder every rule under [Global installs](#global-installs) and [Project installs](#project-installs) acts on. The generated files follow the author's in the skill's file list: `references/commands/index.md`, then each Command's file in graph order, each with mode 644.
- **When they are generated.** The plugin generates a skill's files once every skill's files are loaded and judged, under Loading the files, and before the record is read or anything is written, from the graph of the run, the one the action receives. A fault in the Commands a skill selects never reaches an install, because it fails the graph build first.
- **Unchanged and updated.** Unchanged, under Global installs, compares the whole folder, generated files included, so `update` after a binary whose graph changed writes the skill, and one whose graph did not leaves it unchanged. A [self-update's refresh](#refreshing-after-a-self-update) runs the new binary's `skills update`, which generates from the new graph.
- **Uninstall.** `uninstall` removes the folder whole, generated files included, as it removes any recorded folder, unless a command reference in it is modified, under [Global installs](#global-installs).
- **Nothing committed.** The plugin writes nothing generated to the skills folder, `loom build` carries none, and the plugin keeps none anywhere but the installed folder. An author who wants a copy in a repository writes one with [`loom skills export`](../toolchain/skills.md), which calls [`skillFolders`](#reading-skills-outside-an-install), and a test keeps that copy current with [`assertSkillsMatch`](../libs/testing.md#assertskillsmatch).

## Skill guidance

```ts
import { Command } from '@loomcli/core';
import { skillCommand } from '@loomcli/plugins/skills/extension';

const list = new Command('list', {
  description: 'List the notes, newest first.',
  extensions: [skillCommand({ guidance: 'Read each row with `--format json`, and pass its `id` to the Command that changes a note.' })],
});
```

The declarations module, `@loomcli/plugins/skills/extension`, holds `skillCommand`, through which the author adds guidance for an agent to a Command's command reference. It is declarations alone, apart from the plugin's entry, so a Command library adds guidance without importing the plugin, as the [MCP](mcp.md) and [manifest](manifest.md#manifest-extension) extension modules do.

- **The extension.** `skillCommand` is an ordinary [extension](../core/extensions.md) on Commands with the identity `@loomcli/plugins/skills/command`, so a later value replaces an earlier one whole and a Command carries one guidance. Its published schema is a [Standard Schema](https://standardschema.dev) whose input and output are `SkillCommandFacts`, so an author's type check loads no validation library's declarations. `guidance` is Markdown under the [Markdown rule](help.md#help-extensions) help's `details` follows: a string that holds a character other than whitespace, with blank lines allowed, carried as written. A value the schema rejects throws from the call under [`@loomcli/core/invalid-extension-value`](../core/diagnostics.md#loomclicoreinvalid-extension-value). `skills()` lists the descriptor under its `extensions`.
- **Where it appears.** In the Command's command reference, under Guidance, in every skill that selects the Command. A skill cannot give a Command a guidance of its own; workflow prose that differs between skills belongs in each skill's own files.
- **What it holds.** Advice an agent needs to use the Command well inside the skill's workflow, such as which view to read or which Command comes next. A fact every reader of the Command needs belongs in its description, or in `manifestCommand`'s `details`, which the manifest and the command reference both show.

## Reading skills outside an install

```ts
import { commandReferences, skillFolders } from '@loomcli/plugins/skills';

import { notes } from './application.js';

const graph = notes.inspect();
const folders = await skillFolders(graph); // [{ name: 'notes', files: [{ path: 'SKILL.md', ... }, ...] }]
const references = commandReferences(graph, { commands: [[]], guidance: false }); // index.md, notes.md, ...
```

Two functions give a tool outside an install what an install writes, read from an Application the tool has loaded, without running a skills Command. A tool that writes or checks a skill's files calls `skillFolders`, as [`loom skills export`](../toolchain/skills.md) does to write a copy into a repository and [`assertSkillsMatch`](../libs/testing.md#assertskillsmatch) does to fail a test on a stale committed copy; a tool that documents the application's Commands calls `commandReferences`, as [`loom docs`](../toolchain/docs.md) does.

- **`commandReferences(graph, settings)`.** It renders the files the paths in `settings.commands` select, as a skill's `commands` selects them: `index.md` first, then each Command's file in graph order, each as its `name`, the file name alone, and its `content`. `settings.guidance` says whether each file carries its Command's Guidance block. `commands: []`, or paths that select only hidden Commands, gives `[]`. It judges the paths as the build does and throws the first fault's `DeclarationError` under the same rules, with sentences that name no skill: `The path ["note", "show"] names no Command.`, `Commands "config set" and "config-set" both give the file notes-config-set.md.`, and `The root of index gives the file index.md, which is the name of the index.`, with the corrections above. It is synchronous, reads no host, writes nothing, and gives the same bytes for the same graph and settings. The graph is one `inspect()` returned or a run's.
- **`skillFolders(graph, options?)`.** For the graph of an application that installs the plugin, it resolves to each declared skill, in the order an install writes them, with every file an install writes in the skill's folder, the generated files included and an author's file at an owned name left out, under [What an install writes](#what-an-install-writes). It reads the skills folder as an install in the same process does, the copy a `loom build` artifact carries or else the folder the setting names, and a relative `folder` setting resolves against `options.moduleDirectory`, as `loom build` resolves it, when the option is given. It calls each loader once, in declaration order, and judges every result as an install does, so a fault rejects with the same `DeclarationError` and a loader that throws or rejects rejects as it did. It writes nothing, reads no installation record and no host fact, and logs nothing.
- **When it resolves to `undefined`.** Exactly when the graph's application installed no skills plugin, the graph did not come from a build, such as a copy of one, or the application's copy of `@loomcli/plugins` is older than the record and so recorded nothing. Any graph `inspect()` or a run built for an application that installs the plugin has its skills.
- **How `skillFolders` finds the skills.** Core keeps a plugin's settings to itself, and a loader is not plain data, so no graph fact can carry them. The plugin's `onGraphBuilt` hook records, for each graph it receives, an entry `{ format: 1, read }`, where `read` is the reader of the `skills()` call that built it, in a `WeakMap` keyed by the graph object, so the graphs a test builds are collected with them. A change to the entry's shape raises its format, as the registry's does, and a copy that finds an entry whose format it does not know throws a `DeclarationError` under the rule `@loomcli/plugins/skills/folder`, `This @loomcli/plugins cannot read the skills the application's @loomcli/plugins recorded.`, corrected by `Install @loomcli/plugins at one version, and run again.` The map lives on the global object under `Symbol.for('@loomcli/plugins/skills/graphs')`, as the registry `loom build` reads lives under `Symbol.for('@loomcli/plugins/skills/registry')`, and the first copy that needs it creates it. So a second copy of `@loomcli/plugins` in the process, such as a nested dependency of a test library or the `loom` bin's own copy, finds what the application's copy recorded, and calls that copy's reader, so the copy that would install the skills reads and generates them. The hook adds nothing to the graph, and two applications in one process never read each other's skills. [ADR-0188](../decisions/0188-the-skills-plugin-generates-each-skills-command-references-from-the-graph-at-install.md) narrows [ADR-0060](../decisions/0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md) to allow the record.

## Global installs

- **Checks first.** At global scope, `install`, `update`, `uninstall`, and `status` check, in this order, before they load files or read the record, and fail with a `FatalError` and exit 1 at the first that fails. `<home>`, unless every selected target is `claude` and `CLAUDE_CONFIG_DIR` is absolute: `notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`. Then the record's directory, `applicationDirectory('installation', name, host)`, which answering `{ variable }` fails: `notes cannot find its installation record because XDG_STATE_HOME is not an absolute path. Set XDG_STATE_HOME to an absolute path, then run the command again.`, naming the variable the lookup answers.
- **The record.** Each target's skill folders are recorded as installed folders in its own plugin's file in the record's directory, `skills.claude.json` and `skills.agents.json`, through the module [Installed files](../core/installation-record.md#installed-files) defines, under its rules, so an install into one target never removes the other's folders. Each folder is recorded with the relative path and SHA-256 digest of every file the install wrote in it, the author's files and the generated files alike, and each command reference, a file at a name the plugin owns under `references/commands/` in a skill that selects Commands, under [The names belong to the plugin](#command-references), is marked `generated`. The marked files' digests decide whether a skill is modified, below; every file's digest lets the module finish an interrupted install; and what this version writes decides whether a skill is stale, under [Status](#status). Before it writes, a child reads each selected target's plugin's file through the module, and one that is damaged or holds an unknown `format` fails with `<record> cannot be read, so notes will not change the folders it lists. Remove it and the folders it lists, then run notes skills install again.`, with `uninstall` in place of `install` for that child; `status` fails with `<record> cannot be read, so notes cannot tell which skills it installed. Remove it and the folders it lists, then run notes skills install again.`
- **The old format.** A plugin's file an earlier version wrote, in `format` 1, records each folder by its path alone. The children read it once, under [ADR-0189](../decisions/0189-skills-status-reports-each-skill-per-target-and-the-record-keeps-a-digest-of-each-installed-skill-file.md): such a folder carries no digest, so it is never modified, and is replaced or removed whole whatever it holds, as the earlier version promised. `install` and `update` always write a target whose plugin's file is format 1, so the first of them after the upgrade records every folder with its files' digests; one that stops partway leaves each folder it had not yet swapped recorded by its path alone, under the module's Recovery, and the next run replaces it. `uninstall` removes such a file's folders whole and deletes the file. `status` reads it and writes nothing.
- **A folder is replaced whole.** A skill folder is the unit every global child acts on. A recorded folder is written, replaced, and removed whole, never file by file, so a new version may restructure its skill freely. The digests decide only whether a recorded folder must be kept.
- **A modified skill.** A recorded folder is modified when one of its marked command references is in the folder as anything but a regular file holding its recorded digest, read without following a symbolic link inside the folder, so a reference below a linked folder inside it reads as gone. Nothing else makes a folder modified: not an edit to an author's file, such as `SKILL.md` or a reference the author wrote; not a recorded file that is gone, which the next install writes again; not an entry the record does not list, such as a `.DS_Store` or a `__pycache__` a shipped script left; and not a mode, executable or not. A modified folder is kept, as the [man page plugin](manpage.md#writing-the-pages) keeps a changed page: `install` and `update` refuse it, and `uninstall`, and an install that no longer lists it, leave it in place. Every other recorded folder is replaced or removed whole whatever it holds, so an edit to an author's file does not survive an update, which `status` reports as stale beforehand, and an entry the record does not list does not survive a write of its folder, which changes no state.
- **What is at a folder's path.** Whatever is at a skill folder's path is never read through, and a link among the path's parent directories is followed. At a path the target's plugin's file records, a symbolic link or any other file that is not a directory holds none of the recorded files, so it is never modified: `install` and `update` replace it, a link by removing the link alone, never what it points to, `uninstall` and an install that no longer lists it remove it the same way, and `status` reports it stale. At a path the plugin's file does not record, anything, a link included, refuses `install` and `update` as Folders in the way states, `install --force` replaces it, a link by removing the link alone, and `status` reports it unmanaged.
- **One folder for both targets.** Before it reads the record, a child resolves each selected target's skills directory, `<claude>/skills` and `<home>/.agents/skills`, to its real path through the nearest ancestor that exists, so a link such as `~/.claude/skills` pointing at `~/.agents/skills` is seen. When both resolve to one directory, the child acts on the first selected target alone, records the folders there, and prints `<agents> is the same folder as <claude>, so notes acts on it once, for claude.` through `out.info`, naming the two skills directories as configured; `status` reports on it once, for claude, and prints `<agents> is the same folder as <claude>, so notes reports on it once, for claude.` An explicit `--agent agents` acts on it for agents, where a folder the claude record owns refuses as one the record does not list.
- **Folders in the way.** For `install` and `update`, anything at the path of a folder the install writes, a folder of a skill this version declares, that the target's plugin's file does not record, a directory, a symbolic link, or any other file, and such a recorded folder that is modified, refuse. A modified folder of a skill this version no longer declares never refuses: it is left in place and dropped from the record, as `install` states. Both check every selected target before they write any, so a refusal writes nothing to any target. The child prints, through `out.warn`, `<folder> was not installed by notes skills install.` for each folder the record does not list, and `<file> changed since notes skills install wrote it.` for each changed command reference of a modified folder, where `<file>` is the reference's absolute path, then fails: `notes skills install changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way.`, corrected by `Copy any file you want to keep out of them, then remove them or run notes skills install --force to replace them.` `update` uses `notes skills update` in the failure sentence and the same correction. Under `install --force`, nothing refuses: the module replaces what is there and records the folder, and the child prints `Replaced <folder>, which notes skills install did not install.` or `Replaced <folder>, whose command references changed since notes skills install wrote them.` through `out.info`. `--force` acts only on the folders the install writes; a modified folder of a skill no longer declared is left in place, as below.
- **Unchanged.** A skill is unchanged at a target when its state is current, under [Status](#status). A target whose skills are all unchanged, and whose plugin's file is committed in format 2, records every folder with its files, never by its path alone, and records no other folder, is not written, and each of its skills prints `<folder> is unchanged.`; an entry the record does not list stays until a write replaces its folder.
- **`install`.** Every selected target that is not unchanged is installed through the module with every skill's folder and files listed, in the force mode when `--force` is given. Each listed folder is written whole and recorded with its files' digests and marks. Each recorded folder the install no longer lists, a skill the application stopped declaring, is removed whole and prints `Removed <folder>.`, or, when it is modified, is left in place and prints `<folder> was left in place, because command references in it changed since notes skills install wrote them. Copy what you want to keep, then remove the folder.` through `out.warn`; either way the record no longer lists it. Each skill prints `Installed <name> for <target> in <folder>.`
- **`update`.** It acts on each target whose plugin's file records at least one folder, as `install` with no `--force` would, and prints `Updated <name> for <target> in <folder>.` in place of the installed line. It never touches a project folder. With no target recording a folder, it prints `notes has no skills installed in your home folder, so there is nothing to update. Run notes skills install to install them.` and exits 0.
- **`uninstall`.** For each selected target, the module removes every recorded folder that is not modified whole, and a link or other non-directory at a recorded path by removing it alone, leaves each modified folder in place, removes each parent directory it created that is then empty, and deletes the plugin's file. Each removed folder prints `Removed <folder>.`, each modified folder prints the left-in-place line `install` prints, through `out.warn`, and a recorded folder already gone prints `<folder> was already gone.` through `out.info`. A folder left in place is no longer recorded, so `status` then reports it unmanaged. With no selected target recording a folder, it prints `notes has no skills installed in your home folder, so there is nothing to remove.` and exits 0. A folder the record does not list is never removed.

## Project installs

- **The root.** `--project` starts at `host.cwd`, or at `--directory` resolved against it, and walks up through each parent to the first directory that holds an entry named `.git` of any kind, a directory in a clone and a file in a worktree or submodule. That directory is the root; with none up to the file system's root, the start is the root. A `--directory` that is not a directory fails with an `InputError` and exit 2: `Option "--directory" names /home/me/src/missing, which is not a directory. Name a directory that exists.` Both checks come before loading.
- **Never the global folder.** When a skill's project folder is that target's global folder, as when the root is the home folder, the install fails with a `FatalError` and exit 1 before it writes anything: `notes skills install --project would write to /home/me/.claude/skills/notes, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.` A listed skill's clash is checked before anything loads, and a folder skill's once the folder is read, because only the folder knows its name, still before anything is written. The global folder is computed as Agent targets states, and both folders are resolved to their real paths through the nearest ancestor that exists before they are compared, so a project folder that reaches the global folder through a linked root, a linked `.claude` or `.agents`, or a linked home refuses too.
- **Replacing.** For each selected target and each skill, the plugin replaces whatever is at the skill's project folder, a directory with everything in it, removing each symbolic link inside it as a link and never following one, a symbolic link by removing the link alone, or any other file, with the skill's folder, generated files included, written whole through a staging folder and renames as [Installed files](../core/installation-record.md#installed-files) writes an installed folder. Nothing is recorded, so a project folder has no update, uninstall, or `--force`; its repository's history shows what changed, and `status --project` compares it with what this version writes, under [Status](#status). Each skill prints `Installed <name> for <target> in <folder>.`, or `Installed <name> for <target> in <folder>, replacing the copy that was there.` when something was at the folder.
- **A failed write.** A file system call that fails throws the runtime's error, which fails the run through the ordinary failure path, and the staging folder is removed. A failure between moving the old folder aside and renaming the new one into place can leave no folder and a leftover beside it; the next project install of that skill removes the leftovers of the skill's own name, as Installed files names them, and writes the folder whole.

## Status

```text
$ notes skills status
notes for claude: stale
  folder  /home/me/.claude/skills/notes
  note    Run notes skills update to bring it up to date, once no skill reads modified or unmanaged.

notes for agents: modified
  folder   /home/me/.agents/skills/notes
  changed  references/commands/notes-note-list.md
  note     Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent agents --force to replace the folder.
$ notes skills status --format json
[
  {
    "skill": "notes",
    "target": "claude",
    "scope": "global",
    "state": "stale",
    "folder": "/home/me/.claude/skills/notes",
    "files": [
      "references/commands/index.md",
      "references/commands/notes-note-list.md"
    ],
    "notes": [
      "Run notes skills update to bring it up to date, once no skill reads modified or unmanaged."
    ]
  },
  {
    "skill": "notes",
    "target": "agents",
    "scope": "global",
    "state": "modified",
    "folder": "/home/me/.agents/skills/notes",
    "files": [
      "references/commands/notes-note-list.md"
    ],
    "notes": [
      "Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent agents --force to replace the folder."
    ]
  }
]
$ notes skills status --project --agent claude
notes for claude: missing
  folder  /home/me/src/acme/.claude/skills/notes
  note    Run notes skills install --project --agent claude to install it.
```

`status` reports each declared skill at each selected target as one of five states, one result row each, and changes nothing. Above, version 1.5.0 changed the `note list` Command, so both copies 1.4.0 installed differ from what 1.5.0 writes, and the operator edited `references/commands/notes-note-list.md` in the agents copy, so that copy reads modified and `notes skills update` refuses until it is resolved, which the claude row's note says. Each note names its own row's target, so a step never acts on the other one. [ADR-0189](../decisions/0189-skills-status-reports-each-skill-per-target-and-the-record-keeps-a-digest-of-each-installed-skill-file.md) records the decision.

- **What it reads.** At global scope it makes the checks of [Global installs](#global-installs), and with `--project` it finds the root and refuses the global folder as [Project installs](#project-installs) does, with `notes skills status --project would read /home/me/.claude/skills/notes, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.` in place of the install's sentence. Then it reads the skills folder, calls each loader, judges the files, and generates the command references, exactly as `install` does under Loading the files, because what this version writes decides stale and current. At global scope it then reads each selected target's plugin's file, as recovery would resolve a `pending` one, without writing it. It writes nothing anywhere: no folder, no record, no leftover removed.
- **What this version writes.** A skill's files as an install would write them now, under [What an install writes](#what-an-install-writes): each path, its content, and whether it is executable, as its `executable` names, the generated files included and an author's file at an owned name left out.
- **The states at global scope.** The first that applies, in this order:

  | State | When |
  | --- | --- |
  | `missing` | Nothing is at the skill's folder path, recorded or not. A dangling symbolic link is something. |
  | `unmanaged` | Something is at the path, and the target's plugin's file does not record a folder there, or there is no plugin's file. |
  | `modified` | The recorded folder is modified, as A modified skill in [Global installs](#global-installs) states: a marked command reference is in the folder as anything but a regular file holding its recorded digest. |
  | `stale` | A file this version writes is absent from the folder, is not a regular file there, or differs in content, or whether it is executable, its mode holding any execute bit, differs from what this version writes; or a file the record lists that this version no longer writes is still in the folder. Something other than a directory at the path holds none of the files, so it reads stale. |
  | `current` | Otherwise: every file this version writes is in the folder as a regular file with its content and executable as this version writes it, and no recorded file this version no longer writes remains. |

  An entry the record does not list never changes a state, and neither does an edit to an author's file beyond making the skill stale. A modified folder reads `modified` whether or not this version writes something else, because `update` refuses it until it is resolved. A change to any file this version writes makes the skill stale, whether the author changed a file the skill supplies, such as `SKILL.md`, or the graph changed a command reference. A format-1 folder is never `modified`.
- **The states at project scope.** A project folder has no record, so status compares the disk with what this version writes, and `modified` never applies: `missing` when nothing is at the path; `unmanaged` when something other than a directory is there, such as a symbolic link to a working copy, because a project install writes only directories; `stale` when a file this version writes is absent from the directory, is not a regular file there, or differs in content, or whether it is executable, its mode holding any execute bit, differs from what this version writes; and `current` otherwise. An entry this version does not write never changes a state. No directory is unmanaged, because without a record nothing tells an earlier version's install from a copy made another way, and `install --project` replaces either.
- **The row.** One `SkillStatus` per skill and target, through `out.results`, with these members in this order:
  - `skill`, the skill's name; `target`, `claude` or `agents`; and `scope`, `global`, or `project` under `--project`.
  - `state`, one of the five `SkillState` words.
  - `folder`, the absolute path of the skill's folder for that target and scope, as configured, before any link is resolved.
  - `files`, relative paths using `/`, in code-point order, each once. For `modified`, each marked command reference that is in the folder as anything but a regular file holding its recorded digest. For `stale`, each file this version writes that the folder lacks, holds as something other than a regular file, or holds with other content, or whether it is executable, its mode holding any execute bit, differs from what this version writes, and, at global scope, each file the record lists that this version no longer writes and that is still in the folder; every file this version writes when something other than a directory is at the path. For every other state, none.
  - `notes`, the sentences the state calls for, below, in that order; none for `current`.

  No path in `folder` or `files` ends with `/`, and every member is present in every row.
- **The notes.** Each note names the row's own target with `--agent <target>`, `claude` in the sentences below, so its step never acts on the other target, and a project row's note adds `--project`, and `--directory` with the root it found when the run was given `--directory`. A step that `install` or `update` would refuse carries the clause `once no skill reads modified or unmanaged`, where a skill is any declared skill at any target, because `update` refuses while any declared skill reads modified at a target it acts on, or unmanaged at a target whose plugin's file records a folder, and `install` refuses the same way at the targets it selects. At global scope: `missing` has `Run notes skills install --agent claude to install it, once no skill reads modified or unmanaged.`; `unmanaged` has `The installation record does not list what is at this path. Remove it, or run notes skills install --agent claude --force to replace it.`, which holds for a folder an uninstall left in place and for a symbolic link alike; `modified` has `Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent claude --force to replace the folder.`; and `stale` has `Run notes skills update to bring it up to date, once no skill reads modified or unmanaged.` `update` takes no `--agent`, so the stale note names no target. At project scope, where nothing refuses: `missing` has `Run notes skills install --project --agent claude to install it.`; `unmanaged` has `notes skills install --project did not write this, because it is not a folder. Run notes skills install --project --agent claude to replace it.`; and `stale` has `Run notes skills install --project --agent claude to replace it with this version's.` A note repeats the application's name, the target, and the root alone, each passed through `escapeControlCharacters` as every sentence's values are.
- **The order.** Rows follow the acting targets in `claude`, `agents` order, and each target's skills in the order an install writes them. An application that declares no skill reports no row.
- **A skill this version no longer declares.** Rows report declared skills alone. At global scope, after the rows, status prints one line through `out.info` for each folder a target's plugin's file records that no declared skill uses and that something is at, in target order and then the record's order. A folder that is not modified prints `notes skills install recorded /home/me/.claude/skills/old-notes, a skill this version no longer declares. Run notes skills update to remove it, once no skill reads modified or unmanaged.`, and a modified one prints `notes skills install recorded /home/me/.claude/skills/old-notes, a skill this version no longer declares, and command references in it changed, so notes skills update will leave it in place. Copy what you want to keep, then remove the folder.`
- **The views.** `status` declares `rows<SkillStatus>` with the views `text`, its default, a row view, and `json: json()` from the [formatter](format.md), so an installed formatter selects either and adds `jsonl`. The `text` view writes one block per row, a blank line before each block but the first: the line `<skill> for <target>: <state>`, then two-space-indented rows, `folder` and the folder's path, for a `modified` skill `changed` and each path in `files`, one row each, and `note` and each note, one row each, the names padded to the longest name in the block plus two spaces. A `stale` row's `files` reach the JSON views alone, because the step is the same whichever files differ. The folder and each file path pass through `escapeControlCharacters`, and no style applies.
- **Exit code.** `status` exits 0 whenever it produced a report, whatever the states. Only the checks above, a plugin's file that cannot be read, a project folder that is the global folder, the option errors under The Commands, a loader that throws or rejects, a fault in a skill's files, and a cancelled run fail it.

## Refreshing after a self-update

`refreshSkills` is an `afterReplace` function for the [self-update plugin](self-update.md), which passes it a context that holds every member `RefreshContext` names. It runs in the replaced process, which holds the old version's skills, so it runs the new binary, and `update` decides what to refresh, unless the installation record holds none of the plugin's files, under [At -v and in the log](#at--v-and-in-the-log):

- **The child.** It runs `path` with the words `skills update` as a child program through [`host.spawn`](../core/host.md#child-programs), with `host.env` as its environment and `host.cwd` as its working directory, no shell, no input, and its standard output and standard error piped into `host.stdout` and `host.stderr`, so the child reads neither as a terminal. It adds no time limit; the run signal ends the child with `SIGTERM`.
- **Never a failure.** A child that exits with any code but 0, or that cannot be started, adds a `warn` [log event](../core/logging.md), `Skills were not refreshed after the update.`, with the fields `path` and `code`, or `error` for a child that cannot start, and `refreshSkills` resolves. The child's own failure sentence, which says what to do, has already reached `host.stderr`. A child that cannot be started writes none, so `refreshSkills` writes one line to `host.stderr` itself: `The skills were not refreshed because /home/me/.local/bin/notes could not start. Run notes skills update.`, with the path passed through `escapeControlCharacters` and the program named by the path's last segment. A child ended by the run signal resolves the same way, and the run resolves its cancellation code under [Signals, cancellation, and shutdown](../core/signals.md). While an installed skill's command reference is modified, the child's `update` refuses it, so the child exits 1 after its warning lines and its failure sentence, which says how to keep the change and points at `install --force`, and the refresh adds its `warn` event and resolves; the self-update still succeeds.

- **Composing.** An application that runs more after a replace calls `refreshSkills(context)` from its own `afterReplace` and awaits it. With nothing recorded, the refresh starts no child and prints nothing at the default verbosity, under [At -v and in the log](#at--v-and-in-the-log).
- **Output.** The per-skill `Installed` and `Updated` lines and the nothing-to lines go through `out.success`; the `is unchanged`, `Replaced`, `Removed`, `already gone`, same-folder, and no-longer-declared lines through `out.info`; and the refused-folder, changed-file, and left-in-place lines through `out.warn`, so stdout stays empty for every child but `status`, whose rows are its stdout. The examples above omit the glyph each lane view adds. Every path, folder, and name a sentence repeats passes through `escapeControlCharacters`. Every refusal and check failure above is a `FatalError` that exits 1, and the option conflicts are the `InputError`s above.
- **Names.** `skills`, `refreshSkills`, `commandReferences`, `skillFolders`, `SkillsSettings`, `FolderSkillsSettings`, `Skill`, `FolderSkillCommands`, `SkillFile`, `RefreshContext`, `CommandReferenceSettings`, `CommandReferenceFile`, `SkillFolder`, `SkillFoldersOptions`, `SkillState`, and `SkillStatus` are exported from `@loomcli/plugins/skills`, and `skillCommand` and `SkillCommandFacts` from `@loomcli/plugins/skills/extension`. Each is public API.

## At -v and in the log

The Commands print a confirmation for each file they write or remove, and `status` prints what it found, so they write one line of their own, at `-vv`, for a file they leave out. The refresh after a self-update writes the other:

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Left out references/commands/notes.md, which the skill notes supplies, because the plugin owns that name for its command references.` | `install`, `update`, or `status` left out an author's file at a name the plugin owns, in a skill that selects Commands, one line per file, in the skill's file order. |
| `-vv` | `Skipped the skills refresh: nothing is installed.` | The refresh did not run, because the installation record holds none of the plugin's files. |

- **Nothing is installed.** Before it starts the child, a refresh whose context carries `name` looks in `applicationDirectory('installation', name, host)` for the plugin's file for any target. When none exists, it starts no child, writes its `-vv` line, and resolves. It reads only whether each file exists, so an unreadable or damaged record still runs the child, whose failure names the fix. A directory that does not resolve, and a context without `name`, run the child. This is the one reason a refresh does not run.
- **Its lines.** The refresh logs its `-v` and `-vv` lines through the context's `log`, which the self-update plugin passes with the graph's `name`. A child that fails or cannot start logs no `-v` line and keeps its `warn` event and its line on `host.stderr`. The left-out line is logged through the action's `log`, with the fields `path` and `skill`.
- **Log events.** Each skill folder the Commands place records one `File written.` under the folder's path, global and project installs alike, and each one they remove one `File removed.`; each target's record file records `File written.` at each write and `File removed.` when deleted. A refresh child that exits 0 records `Program run.` with `{ program: path, arguments: ['skills', 'update'], code: 0 }` through the context's `log`, the self-update action's, so its `plugin` reads `@loomcli/plugins/self-update`. Each event is an `info` [change event](../core/logging.md#change-events), and a Command's events name `@loomcli/plugins/skills`. A leftover staging file the plugin removes beside a file it writes, which a run that was stopped mid-write left, records `File removed.` too, and so does each leftover staging or retired folder beside a skill folder, one event under its path. A modified folder left in place records nothing, because nothing changed it, and a plugin's file rewritten from format 1 records `File written.` as any write does. `status` writes nothing, so it records no change event and writes no `-v` line.
- **Log lines.** Each `-v` line is one `log.debug` call and each `-vv` line one `log.trace` call, whose message is a constant [message template](../core/logging.md#message-templates) with the values the line shows in the event's fields, so the screen reads the sentence the table shows and a record keeps the template. Core shows each through its [log-line view](../core/logging.md#at--v) under the run's [verbosity](../core/verbosity.md): `-v -q` shows none, the lines go to stderr whether or not it is a terminal, an [`app.invoke`](../core/invocation.md#invocation-by-name) shows them in its `messages` when its values ask for them, and under an action's `invoke` or an [MCP](mcp.md) tool call they follow the outermost run's verbosity. Every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Each line is a log event, so an installed [logging plugin](logging.md) records it at its level, and each change event the plugin records shows at `-v` too, as every `info` event does. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto `log`.

## When author code fails

A skill's `files` loader is the one author function the plugin calls. A loader that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). `install` and `update` load before they read the record or write anything, so a failing loader writes nothing. `status` loads as they do, so a failing loader fails it with no report, through the same path, because what the loader returns decides every state but `missing` and `unmanaged`. `uninstall` calls no loader, so a broken loader never blocks a removal. `skillFolders` calls the loaders as an install does, so a loader that throws or rejects makes its promise reject with what the loader threw. The generated files come from the graph and the plugin's own renderer, so no author function runs while they are generated; an author's `skillCommand` guidance or `manifestCommand` details that leave a Markdown construct open, such as a code fence, are inserted as written, and the reader sees what the author wrote.
