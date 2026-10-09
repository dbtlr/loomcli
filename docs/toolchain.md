---
description: The public contract of the loom command, which acts on one package directory to build an application with its release facts, check its declarations, cut its version from its changelog fragments, and scaffold it.
---

# Toolchain reference

`@loomcli/loom` is the Loom toolchain. An application installs it as a development dependency, and its `loom` bin builds, checks, versions, and scaffolds that application. The runtime the application ships depends on `@loomcli/core` alone. [ADR-0066](decisions/0066-the-toolchain-acts-on-one-package-directory.md), [ADR-0067](decisions/0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md), and [ADR-0068](decisions/0068-init-writes-scaffold-files-once-and-owns-managed-files.md) record the decisions, and the [release facts](core.md#release-facts) a build bakes in are core's contract.

## One package directory

```text
loom build [--target <target>] [--out <path>] [--entry <module>] [--application <module>]
           [--build development|distributed] [--watch]
           [--release [--repository <owner/name>] [--name <name>]] [--facts | --define]
loom check [--application <module>]
loom changelog check
loom changelog write [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
loom init [--only <piece>]... [--force]
```

```sh
cd packages/notes
loom check && loom build --target node
```

Every `loom` command acts on one package: the package whose directory it runs in.

- **The package directory.** It is the directory of the nearest `package.json` at or above the working directory. A command run with no `package.json` at or above it fails with exit 1 and says to run it inside a package directory. `loom init` in an empty directory is the one exception, under [loom init](#loom-init).
- **One package, never a set.** Loom never acts on a repository root as a set of packages and holds no list of the packages a repository ships. In a monorepo, the monorepo's own tool runs a command in each package, or the author runs it in each one. A command run at a monorepo root acts on the root's own `package.json`.
- **No configuration file.** Every value is a command option, a convention, or a standard `package.json` field, such as `version`, `bin`, or `repository`. An option overrides the convention.
- **Paths.** A path an option names resolves against the working directory, as any command-line path does. A conventional path, such as `src/main.ts`, resolves against the package directory.
- **Bun.** `loom build` and `loom check` do their work under Bun, whichever runtime runs `loom`, so Bun must be on the `PATH`. A missing Bun fails the command with exit 1 and names Bun.
- **Exit codes.** 0 is success. 1 is a failed build, a failed check, invalid content, or an operational failure, reported on stderr. 2 is a command or option error, as in every Loom application.
- **Out of this contract.** Release orchestration is designed separately: PR guards, publishing to npm or GitHub, prerelease lanes, release workflows, installer scripts, and cuts across several packages.

### One package directory acceptance

The package directory is proven when process runs of the packed `loom` bin produce these results under Node and Bun:

- **The nearest package.** `loom changelog check` run in a package's `src/` validates that package's `.changes/`.
- **A monorepo root.** In a fixture workspace whose root and two member packages each hold fragments, `loom changelog check` at the root validates the root's fragments alone.
- **No package.** `loom build` in a directory with no `package.json` at or above it exits 1 and says to run it inside a package directory.
- **An option over the convention.** `loom build --entry src/cli.ts` builds that module, and with no `--entry` the build reads `src/main.ts`.

## loom build

```text
loom build [--target <target>] [--out <path>] [--entry <module>] [--application <module>]
           [--build development|distributed] [--watch]
           [--release [--repository <owner/name>] [--name <name>]] [--facts | --define]
```

```sh
loom build --target node                          # dist/main.js and dist/application.js, { build: 'distributed' }
loom build --target bun-linux-arm64 --release     # dist/notes, with release and asset facts
loom build --watch --target node                  # rebuilds on change, { build: 'development' }

# A custom build composes the same facts into its own bundler call.
bun build src/main.ts src/application.ts --outdir dist --splitting --target node \
  --define "$(loom build --target node --define)"
```

`loom build` builds the package's application for one target and bakes its [release facts](core.md#release-facts) into the artifact through the define `__LOOM_RELEASE__`.

- **One target per call.** `--target` takes `node`, `bun`, or a Bun compile target, `bun-<os>-<arch>` for `linux`, `darwin`, or `windows` on `x64` or `arm64`, then `-musl` on Linux and `-baseline` or `-modern` on x64, such as `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-windows-x64`, `bun-linux-x64-musl`, or `bun-linux-x64-musl-baseline`. Any other value is an option error that names the targets, `--facts` and `--define` included. The default is the compile target Bun names for the host. `node` and `bun` write a JavaScript bundle for that runtime, and a compile target compiles a single binary. `browser` is refused, because a Loom application runs as a command. Several targets take several calls, and cross-compiling and building on each platform are both valid.
- **The entry.** `--entry` names the module that calls `run()`. The default is `src/main.ts`.
- **The application module.** `--application` names the module that exports the Application, with the default [`loom check`](#loom-check) reads, `src/application.ts`. A `node` or `bun` bundle carries it as a second bundle entry point beside the entry, so an embedded caller or a test imports the built Application with its baked facts. Each entry point's file is named for its module alone, whatever directory the module lives in, such as `main.js` and `application.js`, beside the chunks they share. An entry and an application module with the same base name, such as `src/cli/application.ts` beside `src/application.ts`, would build to one file, so the build fails before it starts, names both modules, and says to rename one of them or name another module with `--entry` or `--application`. A bundle splits, so each plugin's lazily loaded middleware stays in a chunk of its own. When `src/application.ts` does not exist, the bundle carries the entry alone, and a module `--application` names that does not exist fails the build and names it. A compile target compiles the entry alone, so `--application` with a compile target is an option error that says it applies to a `node` or `bun` bundle.
- **The package's Bun configuration.** Bun reads the package's `bunfig.toml`, when it holds one, from any working directory, so a setting such as a `[loader]` applies to the build and to `--watch`.
- **The dependencies.** `loom build` bundles the package's dependencies, `@loomcli/core` included, so the define reaches core and the artifact reads the facts it bakes.
- **The output.** `--out` names a binary's file, by default `dist/<name>`, or a bundle's directory, by default `dist/`. A `bun-windows-*` target's output and asset names end in `.exe`, such as `dist/notes.exe` and `notes-windows-x64.exe`. A binary's output that is an existing directory fails the build before anything builds and names `--out`.
- **The name.** A binary's default path and its asset name read the application's name from `package.json` `bin`: a string `bin` gives the package name without its scope, and an object `bin` with one key gives that key. `--name` overrides it. With no `bin`, or a `bin` with several keys, and no `--name`, a build that needs the name fails and names `--name`.
- **The build.** `--build` takes `development` or `distributed`, and the default is `distributed`. Those are the `build` values the artifact reads.
- **Watching.** `--watch` runs `bun build --watch` for the target and passes the facts with `--define`, with `build` set to `development`. It rebuilds on each change until it is stopped, and it writes as `bun build --watch` writes. Bun runs in a temporary directory beside the output, and `loom` removes that directory when the watch ends, a stopped watch included, along with an output directory it created that Bun wrote nothing into. `--watch` with `--build distributed` is an option error.
- **A release.** `--release` adds the release group. `version` is the package's `version`, and a missing `version` fails the build and names the `package.json` field. `repository` is read from the standard `repository` field, so `git+https://github.com/dbtlr/loomcli.git` and `git+ssh://git@github.com:dbtlr/loomcli.git` read as `dbtlr/loomcli`, or from `--repository <owner/name>`, which overrides it. `--repository` without `--release` is an option error that says it applies to a `--release` build. An address whose path, without its host, `.git`, and a trailing slash, is not exactly two segments, such as a nested group or a path below the repository, cannot be read. `asset` is `<name>-` and the compile target without its `bun-` prefix, such as `notes-linux-x64-musl`, and absent for `node` and `bun`. A value that cannot be read fails the build and names the option to pass.
- **Composing a custom build.** `--facts` prints the facts JSON, and `--define` prints the define pair, `__LOOM_RELEASE__=<json>`. Each reads the same options a build reads, prints one line to stdout, and builds nothing, and they exclude each other. `loom build` computes its own facts with the same code, so an author who needs a bundler option `loom build` does not offer composes the same facts into that bundler's define.
- **A failed build changes nothing.** A build writes into a temporary directory beside the output and moves each file into place only after the whole build succeeds, replacing the file of the same name. A failed build leaves any earlier output in place, and files the build does not write are left alone. `loom` holds SIGINT and SIGTERM from before it creates anything until the build has finished or been undone. A signal reaches Bun while Bun runs. One that arrives before the files move into place cleans up as a failed build does, including an output directory the build created, and one that arrives while they move lets every file move, so output is never partly replaced. Either way `loom` then ends with the signal, so its shell reads 130 or 143. Bun runs in the temporary directory, so the file a compile writes into Bun's working directory lands there, and builds that run at once in one package, such as one call per target, each have their own. The build never writes into the source tree.

### loom build acceptance

`loom build` is proven when process runs of the packed `loom` bin produce these results under Node and Bun, with the artifacts run under both:

- **Targets.** `--target node` and `--target bun` each write a bundle that reads `{ build: 'distributed' }`. The host's compile target, by default and by name, writes `dist/<name>`, a binary that runs with no runtime installed. `--target browser` and an unknown target each exit with an error that names the targets.
- **The application module.** A `--target node` build of a package that holds `src/application.ts` writes `dist/application.js`, which a caller imports to run the Application on the facts the build baked, and a package without it writes the entry alone. `--application` naming a module that does not exist exits 1 and names it.
- **The build.** `--build development` writes an artifact that reads `development`, and `--watch` rebuilds after a source change into an artifact that reads `development`.
- **A release.** `--release` in a package at `1.1.0-next.3` whose `repository` is the `git+https://` form reads version `1.1.0-next.3`, lane `next`, and repository `owner/name`, with an asset only for a compile target. `--repository` overrides the field. A package with no `repository` and no `--repository` exits 1 and names `--repository`. A compile target with no `bin` and no `--name` exits 1 and names `--name`.
- **Composing.** `--facts` prints the facts JSON and `--define` the pair, and neither writes a file. A `bun build --define` with the printed pair, and a `Bun.build` call with the printed facts, each write an artifact that reads the same facts `loom build` bakes.
- **A failed build.** A syntax error in the entry exits 1, and the earlier output is byte-identical afterward.

## loom check

```text
loom check [--application <module>]
```

```text
$ loom check
-- MISSING DESCRIPTION ------------------------------- @loomcli/core/undescribed

1 declaration has no description.
...
warning: .changes/README.md differs from what loom init wrote. Run loom init --force to restore it, or delete its header to keep your edits.
```

`loom check` reports every fault the package's application and code hold before anything runs, except a declared default or implied value its validator rejects, which only a run reports.

- **The application module.** `--application` names the module that exports the Application. The default is `src/application.ts`. `loom check` imports it and finds the exported value that is an Application, whatever its export name. No Application, or more than one, fails the check and names the module. It never imports the entry, because the entry calls `run()`.
- **The type pass.** It runs the package's own installed TypeScript, the `typescript` development dependency, against the package's `tsconfig.json`, emitting nothing, and prints what the compiler reports. Any compiler error fails the check. The compiler resolves from the package directory, so a `typescript` hoisted to a monorepo root counts as installed. When no compiler resolves or the package holds no `tsconfig.json`, the type pass is skipped with a one-line note, and the graph checks still run.
- **The graph checks.** It reads no release facts, so the import is a source run, and it calls the Application's [`check()`](core.md#checking-the-declarations), which builds the graph with nothing run and returns every fault a development run reports before routing, except a declared default or implied value its validator rejects. A `DeclarationError` thrown while the module loads, at an authoring call or an attach, is a fault too, and so is any other throw while it loads, which reports under `@loomcli/loom/application-load-failed`. The check runs under Bun in the package directory, so the package's `bunfig.toml` applies from any working directory, and it ends once it has read the faults, whatever the module left running when it loaded.
- **Output.** Each fault prints as its [Developer Diagnostic](core.md#developer-diagnostics) on stderr, one blank line between faults. Any fault exits 1, and no fault exits 0.
- **Drift.** A [managed file](#managed-files) whose content no longer matches its header draws one warning line naming the file. A warning never fails the check.
- **Not yet.** A finding names no file or line. A later contract adds them.

### loom check acceptance

`loom check` is proven when process runs of the packed `loom` bin produce these results under Node and Bun:

- **Clean.** A new scaffold from `loom init` and the example applications each exit 0 and print nothing on stdout.
- **Every fault.** A fixture whose application has two failing converters, an undescribed option, and a rejecting `onGraphBuilt` hook prints four Developer Diagnostics in that order and exits 1, and no action runs.
- **Load faults.** A module whose `option()` call declares `multiple` on a Boolean option prints that rule's diagnostic and exits 1.
- **The module.** A module that exports no Application and one that exports two each exit 1 and name the module. An Application exported as `default` is found. `--application src/app.ts` reads that module.
- **The type pass.** A type error exits 1 with the compiler's report, and a package with no `typescript` installed prints the one-line note and still reports its graph faults.
- **Drift.** An edited managed file prints one warning, and the check exits 0 when nothing else is wrong.

## The package changelog

```text
loom changelog check
loom changelog write [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
```

```sh
mkdir -p .changes
printf -- '- Add the `--tag` option to `notes list`.\n' > .changes/feature.list-by-tag.md
loom changelog check
git add .changes && git commit -m 'Add list-by-tag fragment'
loom changelog write --dry-run        # prints the section and 1.5.0, writes nothing
loom changelog write --date 2026-10-07
```

A package's changelog cuts its version from its pending fragments. `.changes/` and `CHANGELOG.md` live in the package directory, the version is the package's `package.json` `version`, and git tags never enter.

- **Three kinds.** A fragment named `breaking.<slug>.md` is a breaking change, `feature.<slug>.md` a feature, and `<slug>.md` a fix. A bare `breaking.md` or `feature.md` is invalid. A fragment's body follows the grammar of the fragment guide `loom init` writes: Markdown bullets with no frontmatter or headings, and for a breaking fragment one `### Migration` section with the five labels. A subdirectory or a non-Markdown file in `.changes/` is invalid. A hidden entry, one whose name starts with `.`, is not a fragment and is ignored. `.changes/README.md` is the guide, not a fragment.
- **The bump.** The highest kind present decides the next version.

  | Current version | Highest kind present | Next version |
  | --------------- | -------------------- | ------------ |
  | `0.0.0`         | Any                  | `0.1.0`      |
  | `0.4.7`         | Breaking             | `0.5.0`      |
  | `0.4.7`         | Feature or fix       | `0.4.8`      |
  | `1.4.7`         | Breaking             | `2.0.0`      |
  | `1.4.7`         | Feature              | `1.5.0`      |
  | `1.4.7`         | Fix                  | `1.4.8`      |

  A current version that is not `MAJOR.MINOR.PATCH`, a prerelease included, fails the cut, because prerelease lanes belong to release orchestration.
- **`check`.** It validates every fragment in `.changes/` and exits 1 for any invalid one, naming it. It accepts an empty set and a missing `.changes/`, and it needs no git history, so it runs in CI.
- **`write`.** It validates the fragments, computes the next version, and renders one section: `## v<version> - <date>`, the narrative when given, then `### Breaking Changes`, `### Features`, and `### Fixes`, each omitted when empty. Each breaking fragment keeps its migration section beside its entries. Within a group, fragments sort by the first-parent commit that added each one and then by file name, so `write` needs full git history, and a shallow clone or a fragment no commit added fails it. It prepends the section above the earlier release sections of `CHANGELOG.md`, keeping its frontmatter, title, and history, and creates the file with a `# Changelog` title when it is missing. An existing `CHANGELOG.md` without a level-one title, with an `Unreleased` section, or that already holds a section for the next version fails the cut and changes no file. It sets `version` in `package.json`, changing nothing else in the file, and deletes the consumed fragments. It writes every file through a temporary copy and replaces them together, so a failure before the replacement changes nothing.
- **Options.** `--date` is the release date, by default the current UTC date, and an invalid calendar date fails. `--narrative` copies the prose of a Markdown file above the entries, and the file cannot be empty or hold a level-one or level-two heading. `--dry-run` prints the section and the next version and writes nothing.
- **An empty set.** `write` with no fragments fails, `0.0.0` included, because a cut with nothing to release changes nothing a consumer can read.
- **Left to other tools.** `write` refreshes no lockfile, which is the package manager's job, so the author runs it after the cut. It reports no material changes, keeps no versions synchronized across packages, and checks no tags or PR titles.

### The package changelog acceptance

The package changelog is proven when process runs of the packed `loom` bin produce these results under Node and Bun, in fixture git repositories:

- **The bump table.** Each row of the table cuts its next version from fixtures holding those kinds, and a package at `1.2.0-next.1` fails the cut.
- **Ordering.** Fragments added in three commits render in landing order within each group, breaking entries first, and a fragment edited in a later commit keeps its first position.
- **`check`.** A breaking fragment without its migration labels, a bare `feature.md`, and a fragment in a subdirectory each fail `check` with exit 1 and their names.
- **`write`.** A cut prepends the section, sets `version` with the rest of `package.json` byte-identical, deletes the consumed fragments, and leaves `.changes/README.md`. A shallow clone fails and changes no file. `--dry-run` prints the section and the version and leaves every file byte-identical.

## loom init

```text
loom init [--only <piece>]... [--force]
```

```sh
mkdir notes && cd notes
bunx @loomcli/loom init   # a new application: package.json, src/, .changes/README.md, and the skill
pnpm install
loom check
```

In an empty directory nothing is installed yet, so the first run goes through the package runner. Inside a package that already depends on `@loomcli/loom`, the bin is `loom`, as the rest of this page writes it.

`loom init` scaffolds a new application in an empty directory, or adds the pieces an existing package lacks. It writes two sorts of files: scaffold files, which become the author's at once, and managed files, which init keeps current.

- **Where.** In an empty working directory, init scaffolds a new application there, whatever lies above it. Otherwise it acts on the package directory. A directory that is neither empty nor inside a package fails with exit 1.
- **The pieces.** `application` is `src/application.ts`, `entry` is `src/main.ts`, `package` is the `package.json` keys, `changes` is `.changes/README.md`, and `skill` is the changelog skill. `--only <piece>` limits init to the pieces it names, and it may repeat.
- **Output.** Init prints one line for each file or key it writes and each warning it raises, and it installs nothing. The author runs the package manager afterward.
- **Later pieces.** The release-cut skill, workflows, and installer scripts join init with the release orchestration design.

### Scaffold files

- **The files.** `src/application.ts` exports an Application named with the application's name, with a description and one described action, so a new scaffold passes `loom check`. `src/main.ts` imports it and calls `run()`, and it opens with `#!/usr/bin/env node`, which the bundle keeps.
- **The `package.json` keys.** `bin` maps the application's name to `dist/main.js`. `scripts` gains `build`, `loom build --target node`, and `check`, `loom check`. `dependencies` gains `@loomcli/core`, and `devDependencies` gains `@loomcli/loom`, each at the exact version of the running `loom`. In an empty directory, init first writes a `package.json` whose `name` is the directory's name, `version` is `0.0.0`, and `type` is `module`.
- **The application's name.** It is the `bin` key when `bin` is an object with one key, else the package name without its scope.
- **Written once.** Init writes a scaffold file or key only when it is missing. It never overwrites an existing file or key and never tracks one afterward, because each is the author's code from the moment it is written.

### Managed files

```markdown
<!-- Managed by loom init. sha256:923fbdf28841b97b237ceaed44c491528c9e1776959c0e8f40ee87488b415571 -->

# Change fragments
```

- **The files.** `.changes/README.md` is the fragment guide, covering the three kinds. The changelog skill teaches an agent to keep the package's changelog and is written to `.agents/skills/loom-changelog/SKILL.md` in the package directory.
- **The header.** Each managed file carries a header that holds a checksum of the file's content without the header: a Markdown comment on the first line, or, in a skill, on the first line after its frontmatter.
- **Re-running init.** Init re-renders a managed file whose checksum matches, so an unedited file follows the running toolchain. A file whose content no longer matches its checksum has drifted. Init warns about it and leaves it alone, and `--force` re-renders it. `--force` never touches a scaffold file.
- **Leaving management.** Deleting the header releases a file from management. Init then treats it as the author's file and never writes it again, and `loom check` stops checking it.
- **Drift is a warning.** `loom check` warns about a drifted managed file and never fails for one.

### loom init acceptance

`loom init` is proven when process runs of the packed `loom` bin produce these results under Node and Bun:

- **A new application.** In an empty directory, init writes `package.json`, both scaffold files, and both managed files. After the package manager installs, `loom check` exits 0, `loom build --target node` builds, and the bundle runs under Node and Bun.
- **An existing package.** In a package with its own `src/application.ts` and a `scripts.build`, init writes the missing pieces and leaves both byte-identical. `--only changes` writes `.changes/README.md` alone.
- **Managed files.** Re-running init on an unedited managed file re-renders it. An edited one draws one warning and stays byte-identical, and `--force` re-renders it. A file whose header was deleted stays byte-identical under `--force`, and `loom check` raises no warning for it.

## This repository's release

The repository that develops Loom releases its packages together, at one synchronized version, under [ADR-0012](decisions/0012-synchronized-versions-from-manifests-and-owned-fragments.md). It checks its fragments with the public `loom changelog check`, so its [fragment guide](../.changes/README.md) admits the three kinds. Its synchronized cut, `loom release cut`, the PR guard, `loom pr check`, and `loom release plan` and `loom release record` stay hidden until release orchestration is designed. The [changelog compiler](changelog-compiler.md), [PR guards](pr-guards.md), and [release workflow](release-workflow.md) references document them. No listing advertises them, and they are not part of this contract. A public command owns its path, so the synchronized cut moved from `changelog` to `release cut` when the public `loom changelog` shipped.
