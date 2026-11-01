---
description: "loom build: one package directory and the build that bundles an application."
---

# Build reference

This page documents how `loom` finds the one package directory a command acts on, the configuration file it reads there, and how `loom build` bundles an application. An author uses it to build an application for development or for distribution.

## One package directory

```text
loom build [--target <target>] [--out <path>] [--entry <module>] [--application <module>]
           [--build development|distributed] [--watch]
           [--release [--repository <owner/name>] [--name <name>]] [--facts | --define]
loom changelog check
loom changelog write [--target VERSION] [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
loom changelog notes <version>
loom init [--only <piece>]... [--linter oxlint|eslint] [--test-runner bun|vitest] [--force]
```

```sh
cd packages/notes
pnpm check && loom build --target node
```

Every `loom` command acts on one package: the package whose directory it runs in.

- **The package directory.** It is the directory of the nearest `package.json` at or above the working directory. A command run with no `package.json` at or above it fails with exit 1 and says to run it inside a package directory. `loom init` is the one exception: it scaffolds an empty directory, and at a terminal it offers to create a `package.json` in a directory that has none, under [loom init](init.md).
- **An unreadable `package.json`.** Every command reads `package.json` through one reader. A file that is not valid JSON fails with exit 1 and names the file's path, the line and column where the JSON breaks, counted from 1 with the column in characters, what JSON needs there, and the fix: `/work/notes/package.json is not valid JSON: line 3, column 1 needs a property name in double quotes, so fix it there and run loom again.` A file that holds JSON other than an object fails and names its path, and a leading byte order mark is ignored.
- **One package, never a set.** Loom never acts on a repository root as a set of packages and holds no list of the packages a repository ships. A package's `sharedVersion` key names other `package.json` files its own cut writes, which makes none of them a package `loom` acts on. In a monorepo, the monorepo's own tool runs a command in each package, or the author runs it in each one. A command run at a monorepo root acts on the root's own `package.json`.
- **Where values come from.** Every value is a command option, a key of the [configuration file](#the-configuration-file), a convention, or a standard `package.json` field, such as `version`, `bin`, or `repository`. An option beats the file, and the file beats the convention.
- **Paths.** A path an option names resolves against the working directory, as any command-line path does. A path in the configuration file and a conventional path, such as `src/main.ts`, resolve against the package directory.
- **Bun.** `loom build` does its work under Bun, whichever runtime runs `loom`, so Bun must be on the `PATH`. A missing Bun fails the command with exit 1 and names Bun.
- **Exit codes.** 0 is success. 1 is a failed build, a failed changelog check, invalid content, or an operational failure, reported on stderr. 2 is a command or option error, as in every Loom application.
- **Out of this contract.** Release orchestration stays with each repository: PR guards, publishing to npm or GitHub, release workflows, and acting on several packages. A package's cut may cut a prerelease and set its version in the files `sharedVersion` lists, under [ADR-0132](../decisions/0132-a-packages-changelog-cut-may-choose-its-version-cut-a-prerelease-and-set-a-shared-version.md). The [installer script](install.md) reads the [release shape](install.md#the-release-shape) those workflows publish.

## The configuration file

```jsonc
// packages/cli/loom.config.json
{
  "paths": {
    "source": "lib",
    "installer": "../../install.sh"
  }
}
```

A package may keep `loom.config.json` beside its `package.json` to depart from a convention. Every key is optional, and a package with no file builds on conventions. [ADR-0130](../decisions/0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) records the decision.

- **The lookup.** `loom` installs the [configuration plugin](../plugins/config.md) with the file `loom.config.json`, the project scope alone, and `package.json` as its root marker. A run reads the first `loom.config.json` from the working directory up to the package directory, and never one above the package directory, in the home directory, or in a user folder.
- **Reading.** The file reads as JSON with comments. An unknown key is ignored, and a value the file's schema rejects is dropped, its convention applies, and `-v` names it, except `sharedVersion`, which fails the cut instead; `loom` installs the [verbose plugin](../plugins/verbose.md) for that. A file that cannot be read or does not parse warns once, and the run uses conventions, as the plugin's [broken files](../plugins/config.md#missing-and-broken-files) rule states.
- **`--config` and `--no-config`.** `--config <path>` reads that file, of any name, in place of the lookup, and a missing or broken one fails the run with code 2. `--no-config` reads no file, so CI can check that a package also builds on conventions.
- **`paths`.** Each key names where the package keeps something `loom` reads or writes:

  | Key | Default | Read by |
  | --- | --- | --- |
  | `source` | `src` | `init` |
  | `application` | `<source>/application.ts` | `build`, `init` |
  | `entry` | `<source>/main.ts` | `build`, `init` |
  | `out` | `dist` | `build`, `init` |
  | `changes` | `.changes` | `changelog check`, `changelog write`, `changelog notes`, `init` |
  | `changelog` | `CHANGELOG.md` | `changelog write`, `changelog notes` |
  | `installer` | `install.sh` | `init` |

  Each path is a nonempty string, relative or absolute, and a relative path may hold `..`; an empty string or a value of another type is dropped and its convention applies. `application` and `entry` follow `source` unless set themselves. The file names no skills folder: the [skills plugin](../plugins/skills.md#the-skills-folder)'s `folder` setting names it, and the build reads it there, under [The skills folder](#the-skills-folder).
- **One base.** Every path in the file resolves against the package directory, whichever directory the file sits in, and an absolute path stays as written. A path may leave the package directory, such as a monorepo's root `install.sh`.
- **`sharedVersion`.** A list of `package.json` files that carry this package's version, which [`loom changelog write`](changelog.md) sets in the same replacement as the package's own, such as `["../hub/package.json"]`. Each entry resolves against the package directory. `loom changelog write` validates the value itself, and anything but a list of nonempty strings fails the cut before any file changes, rather than being dropped, because a dropped list would leave the listed files at the old version.
- **`postInstall`.** The [post-install command and message](install.md#the-post-install-command) the installer script runs and prints: `{ "message": "…", "command": ["setup"] }`.
- **Fixed paths.** `package.json`, `tsconfig.json`, the linter's configuration file, `bunfig.toml`, and the [changelog skill](init.md#managed-files) are where other tools look for them, so the file does not move them.

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

`loom build` builds the package's application for one target and bakes its [release facts](../core/release-facts.md) into the artifact through the define `__LOOM_RELEASE__`.

- **One target per call.** `--target` takes `node`, `bun`, or a Bun compile target, `bun-<os>-<arch>` for `linux` or `darwin` on `x64` or `arm64`, then `-musl` on Linux and `-baseline` or `-modern` on x64, such as `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-linux-x64-musl`, or `bun-linux-x64-musl-baseline`. No `bun-windows-*` target is offered, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md); an author who wants a Windows binary calls `bun build --compile` directly. Any other value is an option error that names the targets, `--facts` and `--define` included. The default is the compile target Bun names for a Linux or macOS host. `node` and `bun` write a JavaScript bundle for that runtime, and a compile target compiles a single binary. `browser` is refused, because a Loom application runs as a command. Several targets take several calls, and cross-compiling and building on each platform are both valid.
- **The entry.** `--entry` names the module that calls `run()`. The default is `paths.entry`, `src/main.ts` by convention. A module `--entry` names, or an `entry` key the file sets names, that does not exist fails the build and names the option or the key.
- **The application module.** `--application` names the module that exports the Application, by default `paths.application`, `src/application.ts` by convention, the module a test imports for the assembly check. A `node` or `bun` bundle carries it as a second bundle entry point beside the entry, so an embedded caller or a test imports the built Application with its baked facts. Each entry point's file is named for its module alone, whatever directory the module lives in, such as `main.js` and `application.js`, beside the chunks they share. An entry and an application module with the same base name, such as `src/cli/application.ts` beside `src/application.ts`, would build to one file, so the build fails before it starts, names both modules, and says to rename one of them or name another module with `--entry` or `--application`. A bundle splits, so each plugin's lazily loaded middleware stays in a chunk of its own. When the conventional application module does not exist, `<source>/application.ts` included when the file sets only `source`, the bundle carries the entry alone, and a module `--application` names, or an `application` key the file sets names, that does not exist fails the build and names the option or the key. A compile target compiles the entry alone, so `--application` with a compile target is an option error that says it applies to a `node` or `bun` bundle.
- **The package's Bun configuration.** Bun reads the package's `bunfig.toml`, when it holds one, from any working directory, so a setting such as a `[loader]` applies to the build and to `--watch`.
- **The dependencies.** `loom build` bundles the package's dependencies, `@loomcli/core` included, so the define reaches core and the artifact reads the facts it bakes.
- **The output.** `--out` names a binary's file, by default `<out>/<name>`, or a bundle's directory, by default `<out>/`, where `<out>` is `paths.out`, `dist` by convention. A binary's output that is an existing directory fails the build before anything builds and names `--out`.
- **The name.** A binary's default path and its asset name read the application's name from `package.json` `bin`: a string `bin` gives the package name without its scope, and an object `bin` with one key gives that key. `--name` overrides it. With no `bin`, or a `bin` with several keys, and no `--name`, a build that needs the name fails and names `--name`.
- **The build.** `--build` takes `development` or `distributed`, and the default is `distributed`. Those are the `build` values the artifact reads. A distributed build runs Bun with `NODE_ENV` set to `production`, whatever the shell holds, so the bundle resolves each dependency's production export where the dependency ships a `development` one beside it, and bundled code that reads `process.env.NODE_ENV` reads `production`. A development build runs Bun in the environment `loom` runs in, where Bun resolves development exports unless `NODE_ENV` is `production`. Both hold for a bundle and for a compile target alike.
- **Watching.** `--watch` runs `bun build --watch` for the target and passes the facts with `--define`, with `build` set to `development`. It rebuilds on each change until it is stopped, and it writes as `bun build --watch` writes. Bun runs in the package directory, so it follows a source file that an atomic save or a checkout replaces. When the watch ends, a stopped watch included, `loom` removes each output directory it created that nothing filled, and for a compile target the `.bun-build` files that appeared in the package directory while it watched, where Bun writes a binary's temporary file. `--watch` with `--build distributed` is an option error.
- **A release.** `--release` adds the release group. `version` is the package's `version`, and a missing `version` fails the build and names the `package.json` field. `repository` is read from the standard `repository` field, so `git+https://github.com/dbtlr/loomcli.git` and `git+ssh://git@github.com:dbtlr/loomcli.git` read as `dbtlr/loomcli`, or from `--repository <owner/name>`, which overrides it. `--repository` without `--release` is an option error that says it applies to a `--release` build. An address whose path, without its host, `.git`, and a trailing slash, is not exactly two segments, such as a nested group or a path below the repository, cannot be read. `asset` is `<name>-` and the compile target without its `bun-` prefix, such as `notes-linux-x64-musl`, and absent for `node` and `bun`. A value that cannot be read fails the build and names the option to pass.
- **A compiled binary.** A compile target bakes `compiled: true`, with or without `--release`, and `node` and `bun` bake no `compiled` member, so core knows a binary is the whole program when it captures [`host.program`](../core/host.md).
- **Composing a custom build.** `--facts` prints the facts JSON, and `--define` prints the define pair, `__LOOM_RELEASE__=<json>`. Each reads the same options a build reads, prints one line to stdout, and builds nothing, and they exclude each other. `loom build` computes its own facts with the same code, so an author who needs a bundler option `loom build` does not offer composes the same facts into that bundler's define.
- **A failed build changes nothing.** A build writes into a temporary directory beside the output and moves each file into place only after the whole build succeeds, replacing the file of the same name. A failed build leaves any earlier output in place, and files the build does not write are left alone. An ending signal cancels the run. The run's cancellation stops Bun, which receives the signal `loom` received, and the build undoes its own work on that cancelled path, within the [shutdown](../core/signals.md#the-shutdown) budget. From before it creates anything until the build has finished or been undone, the run holds [`onShutdown`](../core/signals.md#onshutdown) handlers that kill Bun with `SIGKILL` and undo the build, which run only when the shutdown ends before the build has undone itself: the budget runs out, a second signal arrives, or `SIGQUIT` skips the budget. A signal that arrives before the files move into place cleans up as a failed build does, including each output directory the build created that nothing else has filled, and one that arrives while they move lets every file move, so output is never partly replaced. Either way `loom` then ends with the signal, so its shell reads 129, 130, 131, or 143. Bun runs in the temporary directory, so the file a compile writes into Bun's working directory lands there, and builds that run at once in one package, such as one call per target, each have their own. The build never writes into the source tree.

## The skills folder

```ts
// src/application.ts
skills({ folder: new URL('../../../skills/', import.meta.url) }) // a monorepo's root skills/
```

`loom build` carries the [skills folder](../plugins/skills.md#the-skills-folder) an application names into what it builds, so a bundle or a binary installs the skills wherever it runs. [ADR-0133](../decisions/0133-the-skills-plugin-reads-a-skills-folder-that-loom-build-carries-into-the-artifact.md) records the decision.

- **Reading the declaration.** Before it bundles, for every target, the build loads the application module under Bun in a process of its own, as [`loom init`](init.md) reads it: the module `--application` or `paths.application` names for a bundle, and the one `paths.application` names for a compile target. It reads the `folder` that `skills()` was given while the module loaded, and none of init's checks of the module's exports. A URL names its folder, an absolute path is itself, and a relative path resolves against the application module's directory. A module that throws while it loads fails the build with [`@loomcli/loom/application-load-failed`](../core/diagnostics.md#loomcliloomapplication-load-failed), and two `skills()` calls that each name a folder fail the build and name both folders.
- **When it cannot read.** A package that does not resolve `@loomcli/plugins`, has no application module, or whose application module is the entry, which would run the application, is not loaded. When the build then bundles the skills plugin, it warns `notes carries the skills plugin, but loom build could not load the application module, so it carried no skills folder. Export the Application from the module paths.application names, src/application.ts by convention, if skills() names a folder.` and succeeds, because the plugin may have been given only loaders. `--watch` writes as `bun build --watch` writes and gives no warning.
- **Judging the folder.** The build reads the folder as the plugin does and fails before it bundles at the first fault the plugin would raise, naming the folder: a missing folder, a folder with no skill when `skills()` lists none, a skill directory whose name is not a skill name, a link directly inside the folder that names nothing, a skill with no `SKILL.md`, a link inside a skill that names a folder or nothing, an entry inside a skill that is neither a file nor a folder, or a folder skill that holds a listed skill's name. A registry whose format this `loom` does not know fails the build and says to install `@loomcli/plugins` and `@loomcli/loom` at one version. A bad skill fails the build, not an operator's install.
- **What the artifact carries.** The build bakes the define `__LOOM_SKILLS__`, which the skills plugin alone reads:

  | Build | Carries |
  | --- | --- |
  | `development`, any target | the source folder's absolute path, read and judged when a skills Command loads files, so an edit during `--watch` installs as it now stands |
  | `distributed` `node` or `bun` | the judged files, links followed, in `loom-skills/` in the output directory beside the chunks, with `loom-skills/index.json`, which names each skill's files and their executable bits |
  | `distributed` compile target | the same files and index embedded in the binary, the index naming each file's executable bit, because an embedded file keeps no mode |
  | a build that read nothing, or found no folder | which of the two, so a run whose setting names a folder fails and says why |

  The define never names a file, so a folder of any number of files passes through Bun's command line, whose arguments Linux limits to 128 KiB each.

- **The bundle's `loom-skills/`.** It is the build's own folder, unlike the other files a build does not write. Every bundle build, a development one included, removes it whole once the build succeeds, and a build that carries a copy puts the new one in its place, so a skill the source folder dropped, a folder the declaration no longer names, a skills plugin the application removed, and a development build after a distributed one leave no stale copy. `--watch` writes as `bun build --watch` writes and leaves it alone. A bundle whose `loom-skills/` would be the skills folder, inside it, or hold it, as `--out skills` does in a package whose folder is `skills/`, fails before it builds, a development build included, because the build never writes into the source tree.
- **Watching.** `--watch` reads the declaration once, when it starts, so a change to the `folder` setting takes a restart, and a change inside the folder needs none.
- **A custom build.** `--define` and `--facts` print the release facts alone, so a bundle built with Bun directly carries no folder, and its skills plugin reads the setting as a source run does.
