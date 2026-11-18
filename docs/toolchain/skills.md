---
description: Export an application's declared skills and generated command references into a repository.
---

# loom skills export

`loom skills export` writes the files an application's `skills install` writes, including generated command references, into a directory for committing to a repository.

```sh
loom skills export committed-skills
loom skills export committed-skills --skill notes --skill review
```

The positional directory is required and resolves against the working directory. Each declared skill becomes a subfolder named for that skill. Repeat `--skill` to select skills; omitting it exports all declared skills. An unknown name fails before writing anything. Every selected folder that already holds a `SKILL.md`, as a regular file, is replaced whole, so stale files disappear. Export refuses a destination that is a file, a link, or a directory whose `SKILL.md` is missing or is not a regular file. It also refuses output that would write into the application's source skills folder: a directory that is that folder or lies inside it, and a directory in which a skill folder export would replace holds it. A skill whose `files` loader throws fails the export with the Developer Diagnostic [`@loomcli/loom/skill-loader-failed`](../core/diagnostics.md#loomcliloomskill-loader-failed), and nothing is written. All destinations are checked before anything is written. Other folders and files in the output directory stay as they are. Repeating an export produces the same files, bytes, and executable modes.

The command reads `--application` relative to the working directory, otherwise `paths.application` from `loom.config.json` relative to the package directory, otherwise `src/application.ts` (following `paths.source` when set). It imports the module under Bun with the package's dependencies and calls the one exported Application's public `inspect()`. A relative skills `folder` resolves against the application module's directory. The command runs no application action, but importing the module, building the graph, and loading skills execute author code.

No declared skills, no recorded skills plugin (including an older plugin without the graph record), or a name not declared each fails with exit 1 and a correction. A module that cannot load fails with the application reader's report. File-system failures name the path and the cause in Loom's words. Invalid or missing command options and invalid configuration fail with exit 2.

[`assertSkillsMatch`](../libs/testing.md#assertskillsmatch) checks the committed copy in the application's test suite. [`skills install`](../plugins/skills.md) remains the operator's installation command.
