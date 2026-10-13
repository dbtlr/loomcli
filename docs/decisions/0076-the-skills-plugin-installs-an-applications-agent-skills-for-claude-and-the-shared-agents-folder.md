---
type: adr
title: ADR-0076 - The skills plugin installs an application's agent skills for Claude and the shared agents folder
description: The skills plugin contributes skills install, update, and uninstall. The author hands it each skill as a name and a loader of its files, read only when a skills Command runs. It installs into two agent targets, claude and agents, at global scope through the installation record, one record file per target, or at project scope as an unrecorded copy that replaces the skill's folder at the repository root. An operator's --force takes over files the record does not list or that changed, narrowing ADR-0071's guarantee for this plugin alone. A self-update refreshes installed skills through an exported afterReplace function that runs the new binary.
status: proposed
created: 2026-10-13
modified: 2026-10-13
---

# ADR-0076 - The skills plugin installs an application's agent skills for Claude and the shared agents folder

## Context

Mimir embeds its agent skill, a folder of `SKILL.md`, `references/`, and `agents/openai.yaml`, in its compiled binary, and `mimir skill install` writes it for Claude Code or Codex at global or project scope, so the installed skill never drifts from the surface the binary speaks. It hand-lists ten text imports, overwrites on every run, never removes a file a newer version dropped, and keeps no record. Every application that teaches agents its commands needs the same machinery, so Loom ships it once.

Coding agents read skills from two layouts. Claude Code reads `~/.claude/skills/<name>/`, under `CLAUDE_CONFIG_DIR` when that is set, and `.claude/skills/<name>/` from the directory it starts in up to the repository root. Codex reads `~/.agents/skills/<name>/` and `.agents/skills/<name>/`, the shared location the Agent Skills standard recommends, which Cline, Zed, Warp, and other agents read, and which Cursor, Gemini CLI, Copilot, and OpenCode read at project scope. Codex's own `~/.codex/skills` is deprecated. The `npx skills` installer finds a repository's skills under a root `skills/<name>/` folder.

`loom build` bakes release facts through a define and embeds no files, so the build offers no seam to carry a skill folder. [ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) gives each installing plugin one file in the installation record, and an install removes every recorded file it no longer lists, so one record file for two folders would let an install into one remove the other. ADR-0071 also promises that the installer never takes over a path it did not record, and [ADR-0074](0074-the-service-plugin-supervises-one-user-unit-per-application-through-the-installation-record.md) rejected adoption by flag for service units. [ADR-0073](0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md) gives self-update one `afterReplace` callback that the application supplies, run in the replaced process, which holds the old binary's skill.

## Decision

- **A plugin Command group.** `skills(settings)` from `@loomcli/plugins/skills` contributes one [plugin Command](../core.md#plugin-commands), `skills`, with the children `install`, `update`, and `uninstall`, and nothing else. Every child acts on every skill the application declares; none takes a skill name.
- **Skills arrive through a loader.** The author declares each skill as a name and a function that returns its files, each a relative path and its content, string or bytes, optionally executable. The plugin calls the function only when a `skills` child runs, so every other run of the application loads no skill bytes. Where the files come from is the author's choice; the documented convention is a root `skills/<name>/` folder read through dynamic text imports, which `npx skills` also finds. `loom build` gains no embedding seam.
- **Names and paths follow the Agent Skills grammar.** A skill name is lowercase letters, digits, and single hyphens, 64 characters at most, judged at the call. A file path is relative, uses `/`, and holds no empty, `.`, or `..` segment, and a skill lists `SKILL.md`; a loader that answers otherwise is a declaration fault reported when the files load, the earliest point that knows it under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md).
- **Two agent targets.** `--agent claude` writes `<home>/.claude/skills/<name>/`, or `$CLAUDE_CONFIG_DIR/skills/<name>/` when that variable is an absolute path, and `.claude/skills/<name>/` at project scope. `--agent agents` writes `<home>/.agents/skills/<name>/` and `.agents/skills/<name>/`. An install or uninstall with no `--agent` acts on both. The option is not named for a host, a term core already owns.
- **Global installs go through the installation record, one file per target.** The plugin keeps `skills.claude.json` and `skills.agents.json`, so an install into one target never removes another's files. This narrows ADR-0071's one file per writer to one file per writer and target for a plugin with independent targets. Edits are detected by digest, an install refuses a changed or unrecorded file, and an update removes the files a newer version no longer ships.
- **`--force` takes over at global scope.** `skills install --force` writes over a file the record does not list, a recorded file whose digest changed, and a symbolic link at a file or at the skill's folder, which it replaces and never writes through, and then records them. A directory or another kind of file where a file belongs still refuses. The output names each path it took over. This narrows ADR-0071's guarantee for this plugin alone: the installer never takes over a path it did not record unless the operator passes `--force` to that install. The service plugin keeps ADR-0074's refusal.
- **Project installs are unrecorded copies at the repository root.** `--project` starts at the working directory, or at the directory `-C` names, and walks up to the nearest directory holding a `.git` entry, a file or a directory, falling back to the start. There it removes `<root>/.claude/skills/<name>/` or `.agents/skills/<name>/` whole, a link at that path by removing the link, and writes the current files, so no stale file survives a newer version. Nothing is recorded, so there is no project uninstall, update, or edit detection; the repository's history is the safety net. `-C` without `--project` is an input error, `--force` has no effect there, and a project folder that resolves to the global folder, as from the home folder, refuses.
- **`update` refreshes what is recorded.** `skills update` takes no options and installs the current skills into each target whose record file lists files, and never touches a project copy. With nothing recorded it says so and exits 0. A changed or unrecorded file refuses the update, which writes nothing to any target, and the message points at `install --force`. `install` is all or nothing across its targets the same way.
- **A self-update refreshes through an exported function.** `refreshSkills` is an `afterReplace` function for `selfUpdate({ afterReplace: refreshSkills })`. It runs the replaced binary's path with `skills update` as a child process, because the replaced process holds the old skill, and passes the child's output through, so the child's own sentences tell the operator what was refreshed or what to do. A child that fails adds a `warn` log event and resolves, not a failure, because the binary update succeeded. An application that needs more after a replace calls it from its own callback.
- **Any build installs.** A skill does not depend on the binary's path, so a source or development build installs as a distributed build does.

The contract and its acceptance are in [Skills](../core.md#skills).

## Considered options

- **A `skills/` folder that `loom build` embeds.** Rejected. Development runs and tests never pass through the build, so the plugin would need a second path that reads the folder from disk, and the build would gain a file-embedding seam for one plugin.
- **The author passing file contents directly.** Rejected. Every run of the application would hold the skill's bytes in memory to serve the one Command that writes them.
- **Global scope only.** Rejected. Mimir's operators install into a repository, and the agents read project skills first.
- **Recording project copies.** Rejected. A repository's copy is committed and shared, so one operator's record would claim a file every teammate holds, and a teammate's install would refuse it as unrecorded.
- **One record file grouping both targets.** Rejected. ADR-0071's module removes every recorded file an install no longer lists, so the module would need a grouping it does not have, where a file per target needs none.
- **Naming the shared target `codex`.** Rejected. The folder serves every agent that follows the Agent Skills standard, and Codex reads it as one of them.
- **Refusing unrecorded files with no override.** Rejected. Every operator who installed with `npx skills` or a hand-made copy, including every Mimir operator, would delete a folder by hand before the first install. An explicit flag that names what it replaced keeps the takeover the operator's choice.
- **A `force` setting or adoption by matching content.** Rejected. A setting moves the choice from the operator to the author, and matching content adopts nothing after any version change.
- **Overwriting project files one by one.** Rejected. A file a newer version dropped would keep giving an agent stale guidance, the defect Mimir has.
- **A `status` Command.** Rejected for now. `update` already brings every recorded target current, and a report of drift has no caller yet.
- **Refreshing in the replaced process, or checking for drift on every run.** Rejected. The replaced process writes the old skill, and a check on every run loads the skill bytes the loader defers.

## Consequences

An application whose root declares arguments cannot install the plugin, the limit every plugin Command has under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md). ADR-0071's installed-files module gains a force mode that only this plugin passes, and ADR-0071 carries a dated entry for both narrowings. ADR-0074's reason for rejecting adoption by flag, that it loosens the guarantee for every installer, no longer holds as written, so ADR-0074 carries a dated entry that its refusal stands for the service plugin. A skill an operator edited at global scope stays until they pass `--force`, and a project copy is replaced without regard to edits.

## Status

Proposed with the skills contract. It moves to accepted in the release PR of the release that ships the implementation.

## Changelog

- 2026-10-13: Proposed with the skills contract.
