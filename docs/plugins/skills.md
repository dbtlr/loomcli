---
description: "The skills plugin: installing an application's agent skills globally or into a project."
---

# Skills plugin

```ts
// @loomcli/plugins/skills
import type { Host, Log, Plugin } from '@loomcli/core';

export interface SkillFile {
  readonly path: string; // relative to the skill's folder, such as references/commands.md
  readonly content: string | Uint8Array; // the file's text or bytes
  readonly executable?: boolean; // written with mode 755 when true, else 644
}
export interface Skill {
  /** The skill's folder name, such as notes. */
  readonly name: string;
  /** Loads the skill's files, called only when a skills Command runs. */
  readonly files: () => Promise<readonly SkillFile[]> | readonly SkillFile[];
}
export interface SkillsSettings {
  readonly skills: readonly Skill[];
}
export interface RefreshContext {
  readonly path: string; // the binary that replaced this one
  readonly host: Host; // the run's host
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log
}
export declare function skills(settings: SkillsSettings): Plugin;
export declare function refreshSkills(context: RefreshContext): Promise<void>;
```

```ts
// src/skill.ts: the files of skills/notes/, read only when a skills Command calls the loader
import type { SkillFile } from '@loomcli/plugins/skills';

export async function notesSkill(): Promise<readonly SkillFile[]> {
  const [skill, commands] = await Promise.all([
    import('../skills/notes/SKILL.md', { with: { type: 'text' } }),
    import('../skills/notes/references/commands.md', { with: { type: 'text' } }),
  ]);
  return [
    { path: 'SKILL.md', content: skill.default },
    { path: 'references/commands.md', content: commands.default },
  ];
}
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills, skills } from '@loomcli/plugins/skills';

import { notesSkill } from './skill.js';

export const notes = new Application('notes', {
  plugins: [help(), skills({ skills: [{ name: 'notes', files: notesSkill }] }), selfUpdate({ afterReplace: refreshSkills })],
});
```

```text
$ notes skills install
Installed notes for claude in /home/me/.claude/skills/notes.
Installed notes for agents in /home/me/.agents/skills/notes.
$ notes skills update
/home/me/.claude/skills/notes is unchanged.
/home/me/.agents/skills/notes is unchanged.
$ notes skills install --project --agent claude
Installed notes for claude in /home/me/src/acme/.claude/skills/notes.
$ notes skills uninstall
Removed /home/me/.claude/skills/notes.
Removed /home/me/.agents/skills/notes.
```

Text imports are Bun's: a compiled binary and a Bun bundle inline each file the loader imports, and an author who builds for Node returns the files another way, such as from a module generated before the build. The loader is the author's code, so where its bytes come from is the author's choice.

`skills()` is the skills plugin. It installs the application's agent skills where coding agents read them, keeps them current with the binary, and removes them. Its identity is `@loomcli/plugins/skills`, and its whole contribution is one [plugin Command](../core/plugin-contract.md#plugin-commands) group. [ADR-0076](../decisions/0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) records the decision.

- **Settings.** The settings type bounds the list and each skill's `files`, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). `skills()` judges each skill's name in order at the call and throws a `DeclarationError` for the first fault, with the finding marked on `skills`:
  - **Skill name.** Each entry's `name` is a skill name: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).
  - **Unique names.** No two entries repeat one name: [`@loomcli/plugins/skills/settings`](../core/diagnostics.md#loomclipluginsskillssettings).

  A skill name is one or more runs of lowercase ASCII letters and digits joined by single `-`, 64 characters at most, the Agent Skills grammar, so it is safe as one path segment. A name the diagnostic repeats passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition).
- **Loading the files.** `install` and `update` call each skill's `files` once, in declaration order, after every check under Global installs or Project installs that comes before loading, and before they read the record or write anything, and await each; `uninstall` calls no loader, so a broken loader never blocks a removal. A loader that throws or rejects takes the ordinary failure path, as [When author code fails](#when-author-code-fails) states. The result is judged before anything is written, and the first fault throws a `DeclarationError`, which fails the run through the same path:
  - **Inside the folder.** A file's path is relative and stays inside the skill's folder, so it neither starts with `/` nor has a `..` segment: [`@loomcli/plugins/skills/files`](../core/diagnostics.md#loomclipluginsskillsfiles).
  - **A SKILL.md.** The list holds an entry whose path is `SKILL.md`: [`@loomcli/plugins/skills/files`](../core/diagnostics.md#loomclipluginsskillsfiles).

  A path the diagnostic repeats passes through `escapeControlCharacters`. The result's type bounds its shape, and the plugin judges no file's content.
- **The Commands.** `skills`, visible, with the description `Install this application's agent skills.`, and three children, each visible with no arguments:
  - `install`, `Install the skills for your coding agents.`, with the string option `--agent`, `The agents to install for: claude, or agents for Codex and others. Both when left out.`, validated to `claude` or `agents`; the Boolean option `--project`, `Install into the current repository instead of your home folder.`; the string option `--directory` with the short spelling `-C`, `Find the repository from this directory instead of the current one.`; and the Boolean option `--force`, `Replace skill files that something else wrote or that you changed.`
  - `update`, `Bring installed skills up to date with this version.`, with no options.
  - `uninstall`, `Remove the skills from your coding agents.`, with `--agent`, `The agents to remove the skills from: claude or agents. Both when left out.`, validated the same way.

  An `--agent` value outside the set is core's usage error for that input, with exit 2. `--directory` without `--project` is an `InputError` the action throws, `Option "--directory" needs --project. Add --project, or leave out --directory.`, with exit 2. `--force` with `--project` has no effect, because a project install always replaces. No child declares a result. A root that declares arguments cannot hold children, so such an application cannot install the plugin, and an application installs it once, because a second `skills` collides under [Plugin Commands](../core/plugin-contract.md#plugin-commands).
- **Agent targets.** `claude` and `agents`, in that order, which every child follows. A child with no `--agent` acts on both.

  | Target | Global folder | Project folder |
  | --- | --- | --- |
  | `claude` | `<claude>/skills/<name>/`, where `<claude>` is `CLAUDE_CONFIG_DIR` when it is an absolute path, else `<home>/.claude` | `<root>/.claude/skills/<name>/` |
  | `agents` | `<home>/.agents/skills/<name>/` | `<root>/.agents/skills/<name>/` |

  `<home>` is `HOME`, read from `host.env`, on every platform.
- **File modes.** Each file is written with mode `755` when `executable` is true and `644` otherwise, whatever the umask, at both scopes. Folders are created with the process's default mode.
- **Any build.** Every child acts from a `source`, `development`, or `distributed` build alike, because a skill does not depend on the binary's path.

## Global installs

- **Checks first.** At global scope, `install`, `update`, and `uninstall` check, in this order, before they load files or read the record, and fail with a `FatalError` and exit 1 at the first that fails. `<home>`, unless every selected target is `claude` and `CLAUDE_CONFIG_DIR` is absolute: `notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`. Then the record's directory, `applicationDirectory('installation', name, host)`, which answering `{ variable }` fails: `notes cannot find its installation record because XDG_STATE_HOME is not an absolute path. Set XDG_STATE_HOME to an absolute path, then run the command again.`, naming the variable the lookup answers.
- **The record.** Each target's skill folders are recorded as installed folders in its own plugin's file in the record's directory, `skills.claude.json` and `skills.agents.json`, through the module [Installed files](../core/installation-record.md#installed-files) defines, under its rules, so an install into one target never removes the other's folders. The record says which folders the plugin owns; it keeps no digest of what is inside them. Before it writes, a child reads each selected target's plugin's file through the module, and one that is damaged or holds an unknown `format` fails with `<record> cannot be read, so notes will not change the folders it lists. Remove it and the folders it lists, then run notes skills install again.`, with `uninstall` in place of `install` for that child.
- **A folder is replaced whole.** A skill folder is the unit every global child acts on. A recorded folder is replaced or removed whole, whatever someone changed, added, or removed inside it, so a new version may restructure its skill freely and an operator's edits do not survive an update. Whatever is at a folder's path is never read through: a symbolic link there is removed, never what it points to, and a link among the path's parent directories is followed.
- **One folder for both targets.** Before it reads the record, a child resolves each selected target's skills directory, `<claude>/skills` and `<home>/.agents/skills`, to its real path through the nearest ancestor that exists, so a link such as `~/.claude/skills` pointing at `~/.agents/skills` is seen. When both resolve to one directory, the child acts on the first selected target alone, records the folders there, and prints `<agents> is the same folder as <claude>, so notes acts on it once, for claude.` through `out.info`, naming the two skills directories as configured. An explicit `--agent agents` acts on it for agents, where a folder the claude record owns refuses as one the record does not list.
- **Folders the record does not list.** For `install` and `update`, anything at a skill folder's path that the target's plugin's file does not record, a directory, a symbolic link, or any other file, refuses. Both check every selected target before they write any, so a refusal writes nothing to any target. The child prints one line for each refused folder through `out.warn`, `<folder> was not installed by notes skills install.`, then fails: `notes skills install changed nothing, because folders it did not install are in the way.`, corrected by `Remove them, or run notes skills install --force to replace them.` `update` uses `notes skills update` in the failure sentence and the same correction. Under `install --force`, nothing refuses: the module replaces what is there and records the folder, and the child prints `Replaced <folder>, which notes skills install did not install.` through `out.info`.
- **Unchanged.** A skill is unchanged at a target when its folder is recorded, is a directory, and holds exactly the skill's files, no other file or folder, each with its content and the mode its `executable` names, read without following a symbolic link inside it. A target whose skills are all unchanged, and whose plugin's file records no other folder, is not written, and each of its skills prints `<folder> is unchanged.`
- **`install`.** Every selected target that is not unchanged is installed through the module with every skill's folder and files listed, in the force mode when `--force` is given. Each listed folder is written whole, and each recorded folder the install no longer lists, a skill the application stopped declaring, is removed whole. Each skill prints `Installed <name> for <target> in <folder>.`, and each removed folder prints `Removed <folder>.`
- **`update`.** It acts on each target whose plugin's file records at least one folder, as `install` with no `--force` would, and prints `Updated <name> for <target> in <folder>.` in place of the installed line. It never touches a project folder. With no target recording a folder, it prints `notes has no skills installed in your home folder, so there is nothing to update. Run notes skills install to install them.` and exits 0.
- **`uninstall`.** For each selected target, the module removes every recorded folder whole, a symbolic link there by removing the link alone, then each parent directory it created that is then empty, and deletes the plugin's file. Each removed folder prints `Removed <folder>.`, and a recorded folder already gone prints `<folder> was already gone.` through `out.info`. With no selected target recording a folder, it prints `notes has no skills installed in your home folder, so there is nothing to remove.` and exits 0. A folder the record does not list is never removed.

## Project installs

- **The root.** `--project` starts at `host.cwd`, or at `--directory` resolved against it, and walks up through each parent to the first directory that holds an entry named `.git` of any kind, a directory in a clone and a file in a worktree or submodule. That directory is the root; with none up to the file system's root, the start is the root. A `--directory` that is not a directory fails with an `InputError` and exit 2: `Option "--directory" names /home/me/src/missing, which is not a directory. Name a directory that exists.` Both checks come before loading.
- **Never the global folder.** When a skill's project folder is that target's global folder, as when the root is the home folder, the install fails with a `FatalError` and exit 1 before it loads or writes anything: `notes skills install --project would write to /home/me/.claude/skills/notes, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.` The global folder is computed as Agent targets states, and both folders are resolved to their real paths through the nearest ancestor that exists before they are compared, so a project folder that reaches the global folder through a linked root, a linked `.claude` or `.agents`, or a linked home refuses too.
- **Replacing.** For each selected target and each skill, the plugin replaces whatever is at the skill's project folder, a directory with everything in it, removing each symbolic link inside it as a link and never following one, a symbolic link by removing the link alone, or any other file, with the skill's folder, written whole through a staging folder and renames as [Installed files](../core/installation-record.md#installed-files) writes an installed folder. Nothing is recorded, so a project folder has no update, uninstall, or `--force`; its repository's history shows what changed. Each skill prints `Installed <name> for <target> in <folder>.`, or `Installed <name> for <target> in <folder>, replacing the copy that was there.` when something was at the folder.
- **A failed write.** A file system call that fails throws the runtime's error, which fails the run through the ordinary failure path, and the staging folder is removed. A failure between moving the old folder aside and renaming the new one into place can leave no folder and a leftover beside it; the next project install of that skill removes the leftovers of the skill's own name, as Installed files names them, and writes the folder whole.

## Refreshing after a self-update

`refreshSkills` is an `afterReplace` function for the [self-update plugin](self-update.md), which passes it a context that holds every member `RefreshContext` names. It runs in the replaced process, which holds the old version's skills, so it runs the new binary, and `update` decides what to refresh:

- **The child.** It runs `path` with the words `skills update` as a child process, with `host.env` as its environment and `host.cwd` as its working directory, no shell, no input, and its standard output and standard error piped into `host.stdout` and `host.stderr`, so the child reads neither as a terminal. It adds no time limit; the run signal ends the child with `SIGTERM`.
- **Never a failure.** A child that exits with any code but 0, or that cannot be started, adds a `warn` [log event](../core/logging.md), `Skills were not refreshed after the update.`, with the fields `path` and `code`, or `error` for a child that cannot start, and `refreshSkills` resolves. The child's own failure sentence, which says what to do, has already reached `host.stderr`. A child that cannot be started writes none, so `refreshSkills` writes one line to `host.stderr` itself: `The skills were not refreshed because /home/me/.local/bin/notes could not start. Run notes skills update.`, with the path passed through `escapeControlCharacters` and the program named by the path's last segment. A child ended by the run signal resolves the same way, and the run resolves its cancellation code under [Signals and cancellation](../core/signals.md).

- **Composing.** An application that runs more after a replace calls `refreshSkills(context)` from its own `afterReplace` and awaits it. With nothing recorded, the child prints `update`'s nothing-to-update line, which names the install Command.
- **Output.** The per-skill `Installed` and `Updated` lines and the nothing-to lines go through `out.success`; the `is unchanged`, `Replaced`, `Removed`, and `already gone` lines through `out.info`; and the refused-folder lines through `out.warn`, so stdout stays empty for every child. The examples above omit the glyph each lane view adds. Every path, folder, and name a sentence repeats passes through `escapeControlCharacters`. Every refusal and check failure above is a `FatalError` that exits 1, and the option conflicts are the `InputError`s above.
- **Names.** `skills`, `refreshSkills`, `SkillsSettings`, `Skill`, `SkillFile`, and `RefreshContext` are exported from `@loomcli/plugins/skills`.

## When author code fails

A skill's `files` loader is the one author function the plugin calls. A loader that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). `install` and `update` load before they read the record or write anything, so a failing loader writes nothing. `uninstall` calls no loader, so a broken loader never blocks a removal.
