---
description: "loom build: one package directory, the build that bundles an application, and the npm launcher and platform packages."
---

# Build reference

This page documents how `loom` finds the one package directory a command acts on, the configuration file it reads there, and how `loom build` bundles an application. An author uses it to build an application for development or for distribution, and to ship its binaries through npm as [launcher and platform packages](#the-npm-launcher-packages).

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

A package may keep `loom.config.json` beside its `package.json` to depart from a convention. Every key is optional, and a package with no file builds on conventions. [ADR-0130](../decisions/0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) records the decision, and [ADR-0158](../decisions/0158-the-loom-bin-reads-loom-config-json-strictly-so-a-broken-file-or-a-rejected-value-fails-the-run.md) its strict read.

- **The lookup.** `loom` installs the [configuration plugin](../plugins/config.md) with the file `loom.config.json`, the project scope alone, and `package.json` as its root marker. A run reads the first `loom.config.json` from the working directory up to the package directory, and never one above the package directory, in the home directory, or in a user folder.
- **Reading.** The file reads as JSON with comments. `loom` passes the configuration plugin no TOML or YAML [reader](../plugins/config.md#readers), so its bundle holds neither parser. An unknown key is ignored with no line at any verbosity, because the file's schema is valibot's and publishes no JSON Schema, under [naming unknown keys](../plugins/config.md#naming-unknown-keys).
- **A wrong file fails the run.** `loom` reads the file under the configuration plugin's [`strict: true`](../plugins/config.md#the-strict-setting), so a broken file or a rejected value never leaves a CI run on conventions. An unknown key, such as a misspelled `paths.changse`, is still ignored, under **Reading**. A file that cannot be read, does not parse, or does not hold a JSON object fails the run with code 2, and so does a value the file's schema rejects, such as an empty `paths.changes`. One failure names every rejected value with its path, the file, and the schema's message, as in `loom: Configuration value paths.changes in loom.config.json: Invalid length: Expected >=1 but received 0. Correct the value, or remove it.`, and a broken file reads `loom: Configuration file loom.config.json is not valid JSON at line 3, column 5. Correct its syntax, or remove it.` Every command that reads the file fails this way: `build`, `init`, `changelog check`, `changelog write`, and `changelog notes`. A command that reads no configuration, such as `loom pr check`, never reads it, and neither does a takeover such as `loom build --help`. A missing file is no fault.
- **`--config` and `--no-config`.** `--config <path>` reads that file in place of the lookup, as JSON with comments whatever its name, except a `.toml`, `.yaml`, or `.yml` file, which fails the run with code 2 and `loom: Option "--config": File "x.toml" is TOML, which this application does not read. Supply a JSON file.` A missing, broken, or rejected file fails the run with code 2 too. `--no-config` reads no file, so a run under it uses conventions whatever the file holds, and CI can check that a package also builds on conventions.
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

  Each path is a nonempty string, relative or absolute, and a relative path may hold `..`; an empty string or a value of another type fails the run, under **A wrong file fails the run**. `application` and `entry` follow `source` unless set themselves. The file names no skills folder: the [skills plugin](../plugins/skills.md#the-skills-folder)'s `folder` setting names it, and the build reads it there, under [The skills folder](#the-skills-folder).
- **One base.** Every path in the file resolves against the package directory, whichever directory the file sits in, and an absolute path stays as written. A path may leave the package directory, such as a monorepo's root `install.sh`.
- **`sharedVersion`.** A list of `package.json` files that carry this package's version, which [`loom changelog write`](changelog.md) sets in the same replacement as the package's own, such as `["../hub/package.json"]`. Each entry resolves against the package directory. `loom changelog write` validates the value itself, and anything but a list of nonempty strings fails the cut before any file changes, because the schema passes the value through as written.
- **`postInstall`.** The [post-install command and message](install.md#the-post-install-command) the installer script runs and prints: `{ "message": "…", "command": ["setup"] }`.
- **`npm`.** Turns on the [npm launcher packages](#the-npm-launcher-packages) that `loom build --target npm` writes: `{ "launcher": true, "platforms": ["darwin-arm64", "linux-x64"] }`. `launcher` is a Boolean, `false` when absent. `platforms` is optional, and each entry is one of the six release asset platforms. A package with no `npm` key builds exactly as it did before.
- **Fixed paths.** `package.json`, `tsconfig.json`, the linter's configuration file, `bunfig.toml`, the [changelog skill](init.md#managed-files), and the authoring skill are where other tools look for them, so the file does not move them.

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
loom build --target npm                           # dist/npm/notes and one dist/npm/notes-<platform> per binary

# A custom build composes the same facts into its own bundler call.
bun build src/main.ts src/application.ts --outdir dist --splitting --target node \
  --define "$(loom build --target node --define)"
```

`loom build` builds the package's application for one target and bakes its [release facts](../core/release-facts.md) into the artifact through the define `__LOOM_RELEASE__`.

- **One target per call.** `--target` takes `node`, `bun`, or a Bun compile target, `bun-<os>-<arch>` for `linux` or `darwin` on `x64` or `arm64`, then `-musl` on Linux and `-baseline` or `-modern` on x64, such as `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-linux-x64-musl`, or `bun-linux-x64-musl-baseline`. No `bun-windows-*` target is offered, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md); an author who wants a Windows binary calls `bun build --compile` directly. Any other value is an option error that names the targets, `--facts` and `--define` included. The default is the compile target Bun names for a Linux or macOS host. `node` and `bun` write a JavaScript bundle for that runtime, and a compile target compiles a single binary. `browser` is refused, because a Loom application runs as a command. `npm` writes the [npm launcher packages](#the-npm-launcher-packages), and only in a package whose configuration file turns them on. Several targets take several calls, and cross-compiling and building on each platform are both valid.
- **The entry.** `--entry` names the module that calls `run()`. The default is `paths.entry`, `src/main.ts` by convention. A module `--entry` names, or an `entry` key the file sets names, that does not exist fails the build and names the option or the key.
- **The application module.** `--application` names the module that exports the Application, by default `paths.application`, `src/application.ts` by convention, the module a test imports for the assembly check. A `node` or `bun` bundle carries it as a second bundle entry point beside the entry, so an embedded caller or a test imports the built Application with its baked facts. Each entry point's file is named for its module alone, whatever directory the module lives in, such as `main.js` and `application.js`, beside the chunks they share. An entry and an application module with the same base name, such as `src/cli/application.ts` beside `src/application.ts`, would build to one file, so the build fails before it starts, names both modules, and says to rename one of them or name another module with `--entry` or `--application`. A bundle splits, so each plugin's lazily loaded middleware stays in a chunk of its own. When the conventional application module does not exist, `<source>/application.ts` included when the file sets only `source`, the bundle carries the entry alone, and a module `--application` names, or an `application` key the file sets names, that does not exist fails the build and names the option or the key. A compile target compiles the entry alone, so `--application` with a compile target is an option error that says it applies to a `node` or `bun` bundle.
- **The package's Bun configuration.** Bun reads the package's `bunfig.toml`, when it holds one, from any working directory, so a setting such as a `[loader]` applies to the build and to `--watch`.
- **The dependencies.** `loom build` bundles the package's dependencies, `@loomcli/core` included, so the define reaches core and the artifact reads the facts it bakes.
- **The output.** `--out` names a binary's file, by default `<out>/<name>`, or a bundle's directory, by default `<out>/`, where `<out>` is `paths.out`, `dist` by convention. A binary's output that is an existing directory fails the build before anything builds and names `--out`.
- **Node's compile cache.** A `node` bundle's entry turns on Node's compile cache before it loads the rest of the bundle, so after an operator's first run, Node reads the bundle's compiled code from the cache instead of compiling it again. The entry Bun writes moves, unchanged, into a chunk named for its content, and the entry's file, such as `main.js`, keeps its first-line shebang and its mode, turns on the cache, then imports that chunk; the application module does not turn it on, so a caller or a test that imports it leaves Node as it was. Because the entry's code runs from that chunk, an entry that runs its application only as the main module checks `import.meta.main`, which the build keeps true, rather than comparing `import.meta.url` with `process.argv[1]`, which names the entry's file. Node keeps the cache in `node-compile-cache` under the operator's temporary directory, and an operator moves it with `NODE_COMPILE_CACHE` or turns it off with `NODE_DISABLE_COMPILE_CACHE=1`, as Node documents. Bun running a `node` bundle answers the call with a cache of its own in the same place, under the same variables, and a Node without the cache skips it. A `bun` bundle and a compile target have no such entry, and `--watch` writes as `bun build --watch` writes.
- **The name.** A binary's default path and its asset name read the application's name from `package.json` `bin`: a string `bin` gives the package name without its scope, and an object `bin` with one key gives that key. `--name` overrides it. With no `bin`, or a `bin` with several keys, and no `--name`, a build that needs the name fails and names `--name`.
- **The build.** `--build` takes `development` or `distributed`, and the default is `distributed`. Those are the `build` values the artifact reads. A distributed build runs Bun with `NODE_ENV` set to `production`, whatever the shell holds, so the bundle resolves each dependency's production export where the dependency ships a `development` one beside it, and bundled code that reads `process.env.NODE_ENV` reads `production`. A development build runs Bun in the environment `loom` runs in, where Bun resolves development exports unless `NODE_ENV` is `production`. Both hold for a bundle and for a compile target alike.
- **Watching.** `--watch` runs `bun build --watch` for the target and passes the facts with `--define`, with `build` set to `development`. It rebuilds on each change until it is stopped, and it writes as `bun build --watch` writes. Bun runs in the package directory, so it follows a source file that an atomic save or a checkout replaces. When the watch ends, a stopped watch included, `loom` removes each output directory it created that nothing filled, and for a compile target the `.bun-build` files that appeared in the package directory while it watched, where Bun writes a binary's temporary file. `--watch` with `--build distributed` is an option error.
- **A release.** `--release` adds the release group. `version` is the package's `version`, and a missing `version` fails the build and names the `package.json` field. `repository` is read from the standard `repository` field, so `git+https://github.com/dbtlr/loomcli.git` and `git+ssh://git@github.com:dbtlr/loomcli.git` read as `dbtlr/loomcli`, or from `--repository <owner/name>`, which overrides it. `--repository` without `--release` is an option error that says it applies to a `--release` build. An address whose path, without its host, `.git`, and a trailing slash, is not exactly two segments, such as a nested group or a path below the repository, cannot be read. `asset` is `<name>-` and the compile target without its `bun-` prefix, such as `notes-linux-x64-musl`, and absent for `node` and `bun`. A value that cannot be read fails the build and names the option to pass.
- **A compiled binary.** A compile target bakes `compiled: true`, with or without `--release`, and `node` and `bun` bake no `compiled` member, so core knows a binary is the whole program when it captures [`host.program`](../core/host.md).
- **The npm package name.** With `--release`, the build bakes `release.npmPackage` from the package's `package.json` `name`, if it is a nonempty string. The name includes its scope. A compiled binary can also be shipped through npm, so the package name is baked for every release target with a name in the manifest. The build does not need an npm publish target. If the manifest gives no name, the field is absent. `loom build --target npm` bakes the same name, the launcher package's, into every platform binary it compiles, so an npm installation's [update notice](../plugins/self-update.md#update-notices) names the package the operator installed.
- **Composing a custom build.** `--facts` prints the facts JSON, and `--define` prints the define pair, `__LOOM_RELEASE__=<json>`. Each reads the same options a build reads, prints one line to stdout, and builds nothing, and they exclude each other. `loom build` computes its own facts with the same code, so an author who needs a bundler option `loom build` does not offer composes the same facts into that bundler's define.
- **A failed build changes nothing.** A build writes into a temporary directory beside the output and moves each file into place only after the whole build succeeds, replacing the file of the same name. A failed build leaves any earlier output in place, and files the build does not write are left alone. An ending signal cancels the run. The run's cancellation stops Bun, which receives the signal `loom` received, and the build undoes its own work on that cancelled path, within the [shutdown](../core/signals.md#the-shutdown) budget. From before it creates anything until the build has finished or been undone, the run holds [`onShutdown`](../core/signals.md#onshutdown) handlers that kill Bun with `SIGKILL` and undo the build, which run only when the shutdown ends before the build has undone itself: the budget runs out, a second signal arrives, or `SIGQUIT` skips the budget. A signal that arrives before the files move into place cleans up as a failed build does, including each output directory the build created that nothing else has filled, and one that arrives while they move lets every file move, so output is never partly replaced. Either way `loom` then ends with the signal, so its shell reads 129, 130, 131, or 143. Bun runs in the temporary directory, so the file a compile writes into Bun's working directory lands there, and builds that run at once in one package, such as one call per target, each have their own. The build never writes into the source tree.

## The skills folder

```ts
// src/application.ts
import { skills } from '@loomcli/plugins/skills';

skills({ folder: new URL('../../../skills/', import.meta.url) }) // a monorepo's root skills/
```

`loom build` carries the [skills folder](../plugins/skills.md#the-skills-folder) an application names into what it builds, so a bundle or a binary installs the skills wherever it runs. [ADR-0133](../decisions/0133-the-skills-plugin-reads-a-skills-folder-that-loom-build-carries-into-the-artifact.md) records the decision.

- **Reading the declaration.** Before it bundles, for every target, the build loads the application module under Bun in a process of its own, as [`loom init`](init.md) reads it: the module `--application` or `paths.application` names for a bundle, and the one `paths.application` names for a compile target. It reads the `folder` that `skills()` was given while the module loaded, and none of init's checks of the module's exports. A URL names its folder, an absolute path is itself, and a relative path resolves against the application module's directory. A module that throws while it loads fails the build with [`@loomcli/loom/application-load-failed`](../core/diagnostics.md#loomcliloomapplication-load-failed), and two `skills()` calls that each name a folder fail the build and name both folders.
- **When it cannot read.** A package that does not resolve `@loomcli/plugins`, has no application module, or whose application module is the entry, which would run the application, is not loaded. When the build then bundles the skills plugin, it warns `notes carries the skills plugin, but loom build could not load the application module, so it carried no skills folder. Export the Application from the module paths.application names, src/application.ts by convention, if skills() names a folder.` and succeeds, because the plugin may have been given only loaders. A module that loads without running `skills()`, as when a function the entry calls makes the Application, names no folder either, and a bundle that holds the skills plugin then warns `notes carries the skills plugin, but skills() did not run while loom build loaded the application module, so it carried no skills folder. Call skills() as the module paths.application names loads, src/application.ts by convention, if it names a folder.` and succeeds. A `skills()` call that ran and named no folder gives no warning. `--watch` writes as `bun build --watch` writes and gives no warning.
- **Judging the folder.** The build reads the folder as the plugin does and fails before it bundles at the first fault the plugin would raise, naming the folder: a missing folder, a folder with no skill when `skills()` lists none, a skill directory whose name is not a skill name, a link directly inside the folder that names nothing, a skill with no `SKILL.md`, a link inside a skill that names a folder or nothing, an entry inside a skill that is neither a file nor a folder, a folder skill that holds a listed skill's name, or a `FolderSkillCommands` entry, one in the `skills` list without `files`, that names a skill the folder does not hold. An entry whose name starts with `.` is skipped, not judged or carried, so an editor's lock link never fails the build. A registry whose format this `loom` does not know fails the build and says to install `@loomcli/plugins` and `@loomcli/loom` at one version. A bad skill fails the build, not an operator's install.
- **What the artifact carries.** The build bakes the define `__LOOM_SKILLS__`, which the skills plugin alone reads:

  | Build | Carries |
  | --- | --- |
  | `development`, any target | the source folder's absolute path, read and judged when a skills Command loads files, so an edit during `--watch` installs as it now stands |
  | `distributed` `node` or `bun` | the judged files, links followed, in `loom-skills/` in the output directory beside the chunks, with `loom-skills/index.json`, which names each skill's files and their executable bits |
  | `distributed` compile target | the same files and index embedded in the binary, the index naming each file's executable bit, because an embedded file keeps no mode |
  | a build that read nothing, or found no folder, `skills()` not having run included | which of the two, so a run whose setting names a folder fails and says why |

  The define never names a file, so a folder of any number of files passes through Bun's command line, whose arguments Linux limits to 128 KiB each.

- **The bundle's `loom-skills/`.** It is the build's own folder, unlike the other files a build does not write. Every bundle build, a development one included, removes it whole once the build succeeds, and a build that carries a copy puts the new one in its place, so a skill the source folder dropped, a folder the declaration no longer names, a skills plugin the application removed, and a development build after a distributed one leave no stale copy. `--watch` writes as `bun build --watch` writes and leaves it alone. A bundle whose `loom-skills/` would be the skills folder, inside it, or hold it, as `--out skills` does in a package whose folder is `skills/`, fails before it builds, a development build included, because the build never writes into the source tree.
- **Watching.** `--watch` reads the declaration once, when it starts, so a change to the `folder` setting takes a restart, and a change inside the folder needs none.
- **A custom build.** `--define` and `--facts` print the release facts alone, so a bundle built with Bun directly carries no folder, and its skills plugin reads the setting as a source run does.

## The npm launcher packages

```jsonc
// loom.config.json
{
  "npm": { "launcher": true, "platforms": ["darwin-arm64", "linux-x64", "linux-x64-musl"] }
}
```

```sh
loom build --target npm
```

```text
dist/npm/
  notes/                  @acme/notes, the launcher package
  notes-darwin-arm64/     @acme/notes-darwin-arm64, a platform package
  notes-linux-x64/        @acme/notes-linux-x64
  notes-linux-x64-musl/   @acme/notes-linux-x64-musl
```

A package can ship its compiled binary through npm as a set of packages. The [launcher package](../glossary.md#toolchain) `<pkg>` holds a small Node.js launcher. Each [platform package](../glossary.md#toolchain) `<pkg>-<os>-<arch>[-musl]` holds one platform's binary. The launcher lists every platform package as an optional dependency, and the package manager installs only the one whose `os`, `cpu`, and `libc` match the host. This is the pattern that esbuild and Biome follow. No install script runs, so the binary arrives under the lockfile's integrity check and npm's provenance, even with `--ignore-scripts`. [ADR-0213](../decisions/0213-an-opt-in-npm-target-writes-a-launcher-package-and-a-platform-package-per-binary.md) records the decision.

- **Turning it on.** The configuration file's `npm.launcher` set to `true` turns the mode on, and `npm.platforms` names the platforms. Each entry is one of `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`, and `linux-x64-musl`, the platforms of the [release assets](install.md#the-release-shape). Without `platforms`, the build writes all six. An empty list, an unknown or repeated entry, and `platforms` without `launcher: true` fail the run with code 2, under [A wrong file fails the run](#the-configuration-file). The mode changes no other target.
- **The target.** `loom build --target npm` writes the packages. In a package whose file does not turn the mode on, it fails with code 2: `loom: --target npm builds the launcher and platform packages, which loom.config.json does not turn on. Set "npm": { "launcher": true } in loom.config.json, or build a bundle with --target node.`
- **The binaries.** For each platform, the build compiles the binary that `loom build --release --target bun-<platform>` compiles: a distributed release binary whose release facts name the asset `<name>-<platform>`. Each binary also bakes `release.npmPackage` as `<pkg>`, the launcher package's name, under ADR-0211, so its update notice names the package the operator installed. `--release` is implied. `--repository`, `--name`, `--entry`, and `--out` apply. `--application`, `--build development`, `--watch`, `--facts`, and `--define` are option errors. A custom build reads each platform's facts with `--target bun-<platform> --release --facts`. A `-baseline` or `-modern` variant and a Windows binary produce no package.
- **The layout.** The packages go into `<out>/npm`, or into the directory `--out` names. Each package's directory is named for the package without its scope, such as `notes` and `notes-linux-x64` for `@acme/notes`. Each holds `package.json` and `bin/<name>`, mode 755: the launcher in the launcher package, the binary in a platform package. The launcher package also holds copies of the package directory's `README*` files, and every package holds copies of the `LICENSE*` and `LICENCE*` files. The build checks the `name` in `package.json` against npm's package name rule before anything compiles: at most 214 characters, lowercase letters, digits, `-`, `.`, and `_`, starting with a letter or a digit, with an optional `@scope/` before it, and never `node_modules` or `favicon.ico`, the whole names npm reserves, the rule `@loomcli/core` exports as [`isNpmPackageName`](../core/release-facts.md#release-facts). A name outside it, such as `..` or `@acme/Notes`, fails with code 2, because it could name a directory outside the packages, and nothing is written.
- **Ownership.** The build replaces or removes only a package directory it owns: an entry at that name that is a directory, read without following a link, whose `package.json` has a `name` equal to the package the build writes there, `<pkg>` for the launcher's directory and `<pkg>-<platform>` for a platform's. Every directory the build writes carries that name, so a rebuild replaces what an earlier build wrote. An entry the build does not own at a name it would write, such as `../shared/notes-linux-arm64` holding only `draft.txt` with `--out ../shared`, or a file or link of that name, fails the build with exit 1 before anything compiles and changes nothing: `../shared/notes-linux-arm64 is not a folder whose package.json names @acme/notes-linux-arm64, and loom build replaces only the npm packages it wrote, so move or remove it, or name another directory with --out.` The build replaces each package directory it writes as a whole. It removes a `<base>-<platform>` directory for a platform it no longer writes, where `<base>` is the launcher's directory name, only when it owns it, so a file, a link, or a folder the build did not write at that name stays. It leaves every other entry alone. An output directory that is the package directory or holds it, such as `--out ..` in `packages/notes`, would let the build replace the package directory itself, so it fails with code 2 before anything compiles: `loom: .., where loom build writes the npm packages, holds the package directory ., and the build replaces each package's directory whole, so name a directory with --out that neither is nor holds the package directory.`
- **One build or none.** The whole set is written in the build's temporary directory and moved into place only after every binary compiles, as [A failed build changes nothing](#loom-build) states for every build. A platform whose compile fails fails the build, and the set from an earlier build stays as it was. The move puts every platform package's directory in place first, then the launcher package's, then removes dropped platforms' directories, so a move cut short never leaves a new launcher beside an old platform directory. It can leave new platform directories beside the old launcher, because platform directories keep their names across builds. That set is mismatched until the next build: the old launcher checks each platform package's version against its own, so it fails with the missing-package step on each platform already replaced, and runs only on the platforms the move had not reached.
- **The names.** `<pkg>` is the `name` field of `package.json`, and a build with no `name` fails and names the field. A platform package is `<pkg>-<platform>`, and a scoped name keeps its scope: `@acme/notes` gives `@acme/notes-linux-arm64-musl`. `<name>`, the binary's file name and the launcher's bin key, follows [The name](#loom-build), and the build checks it against the portable name rule of `isPortableName` before anything compiles, so `--name ../package.json`, `a/b`, or `..`, or a `bin` key such as `x/y`, fails with code 2 and nothing is written. The package name an npm installation's update command names is the baked `release.npmPackage`, which is `<pkg>` in every platform binary, and never read from a platform package's name.
- **The launcher's `package.json`.** Its fields, in this order, are: `name`; `version`, from `package.json`, where a missing one fails and names the field; `description`, `keywords`, `homepage`, `bugs`, `license`, `author`, and `repository`, copied as written when present; `bin`, `{ "<name>": "bin/<name>" }`; `files`, `["bin"]`; `optionalDependencies`, each written platform package at the exact version; and `publishConfig`, copied when present. It has no dependencies, no scripts, and no `engines`.
- **A platform package's `package.json`.** Its fields, in this order, are: `name`; `version`; `description`, `The <platform> binary of <pkg>.`; `license` and `repository`, copied when present; `os`, `["darwin"]` or `["linux"]`; `cpu`, `["arm64"]` or `["x64"]`; `libc`, `["glibc"]` or `["musl"]` on Linux alone; `files`, `["bin"]`; `preferUnplugged`, `true`, so Yarn Plug'n'Play extracts the binary; and `publishConfig`, copied when present. It has no `bin`, so only the launcher is linked onto `PATH`.

### The launcher

```text
$ notes --version
notes 1.4.0
$ npm install -g --omit=optional @acme/notes && notes
notes: The package @acme/notes-linux-x64@1.4.0, which holds the binary for linux-x64, is not installed. Install @acme/notes again without --omit=optional, or install @acme/notes-linux-x64@1.4.0 beside it.
```

The launcher is `bin/<name>` in the launcher package. It is a CommonJS file with the line `#!/usr/bin/env node`, and it requires only Node's built-in modules. Loom renders it, so the author writes none of it.

- **The platform.** It reads `process.platform` and `process.arch`. On Linux, it reads the C library as core reads [`host.libc`](../core/host.md): `glibc` when `process.report.getReport().header.glibcVersionRuntime` names a glibc version, and `musl` otherwise. It sets `process.report.excludeNetwork` to `true` around the read where the runtime has it, as core does, so the report never waits on resolving a socket's peer. A musl host appends `-musl`. A platform the package does not ship fails: `notes: @acme/notes has no binary for linux-arm64-musl. It runs on darwin-arm64, linux-x64, and linux-x64-musl.`
- **The package.** It resolves `<pkg>-<platform>/package.json` with `require.resolve` from its own file, and runs `bin/<name>` in that directory. That `package.json` must name `<pkg>-<platform>` at the launcher's own version. A package that does not resolve fails with the sentence above, which names the package to install, and so does one of another name or version, such as a copy hoisted into an ancestor `node_modules` or found through `NODE_PATH`. This happens, for example, after `--omit=optional` or `--no-optional`.
- **The exec.** On a Node that has `process.execve`, which Linux and macOS have in every 22.x release from 22.23.2 and every release from 23.11, the launcher replaces itself with the binary, passing the arguments after the script and its own environment. The binary keeps the launcher's process ID, process group, terminal, working directory, and descriptors, so every signal reaches it alone and the shell reads its own status, a death by signal included. The launcher touches none of `process.stdin`, `process.stdout`, and `process.stderr`, and writes nothing before the exec.
- **The spawn, on a Node without `process.execve`.** Node 23.0 through 23.10 lacks the call, and the launcher package declares no `engines`, so it also runs under an older Node. There it adds its signal listeners, then spawns the binary with the same arguments, inherited stdio, and its own environment and working directory. When the child exits with a code, the launcher exits with that code. When a signal ends the child, the launcher removes its listeners and raises the same signal on itself, so the shell reads a death by that signal, and a loop such as `while true; do notes wait; done` stops at Ctrl-C, as [The shutdown](../core/signals.md#the-shutdown) promises. Node opens its inspector on `SIGUSR1` and ignores `SIGPIPE` and `SIGXFSZ`, so for those three the launcher raises nothing and exits with 128 plus the signal's number: the shell reads the same `$?`, but a parent that tells an exit from a death by signal sees an exit. Should any other raise not end it within 100 ms, the launcher exits with the same status as a guard.
- **Signals, on the spawn path.** While the child runs, `SIGINT`, `SIGTERM`, `SIGHUP`, and `SIGQUIT` do not end the launcher. `SIGTERM` is always forwarded to the child. `SIGINT`, `SIGHUP`, and `SIGQUIT` are forwarded only when none of the launcher's stdin, stdout, and stderr is a terminal. When one of them is a terminal, Ctrl-C, Ctrl-\\, and a hangup already reach the child through the terminal's process group. A second copy from the launcher would end the application's [shutdown](../core/signals.md#the-shutdown) without its budget, so the launcher holds the signal and waits. Three limits remain on this path, and the exec path has none of them:
  - Ctrl-Z at a raw-mode prompt stops only the child, because the prompt raises `SIGTSTP` on its own process, under [Raw-mode readers](../core/signals.md#raw-mode-readers). The shell waits on the launcher, which keeps running, so the prompt does not come back until the child is continued from another terminal.
  - A signal sent to the process group, such as `kill -TERM -<pgid>`, reaches the child twice, once directly and once forwarded, so its shutdown ends at once without its budget.
  - While any of stdin, stdout, and stderr is a terminal, a `SIGINT`, `SIGHUP`, or `SIGQUIT` sent only to the launcher's process ID, such as `kill -HUP <pid>` or `docker kill -s HUP` on a container run with `-t`, is held and never reaches the binary. To stop the application, signal the process group, as `kill -INT -<pgid>` and a shell's job control do, or send `SIGTERM`.
- **A binary that cannot start.** Before either path starts the binary, the launcher checks that it exists, is a regular file, has execute permission, and starts with the magic number of an ELF or Mach-O program. A file that is no program, a shell script included, fails with `ENOEXEC` rather than run through `/bin/sh` on the spawn path or end Node on the exec path. A Node from 26 throws a failed exec, and the launcher catches it. One case stays outside the sentence: a binary with a valid magic number for another architecture, on the exec path of a Node before 26, ends Node with `SIGABRT` and Node's own report. Every other failure, such as a file without execute permission, a directory, or a file inside an archive that Yarn Plug'n'Play did not extract, fails and names the file, the package, and the cause: `notes: Cannot start /home/me/.npm-global/lib/node_modules/@acme/notes/node_modules/@acme/notes-linux-x64/bin/notes from @acme/notes-linux-x64, because permission was denied. Install @acme/notes-linux-x64@1.4.0 again so its binary is an executable file on disk.` The causes are the bin's own words for `ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, and `ENOEXEC`, and any other code shows as the bare code in parentheses.
- **Its sentences.** A failure of the launcher's own prints one line to stderr that starts with `<name>: ` and exits 1. Each sentence lives in `loom build`'s messages module, and the build renders it into the launcher with the names, version, and platforms it knows. The host's platform and the binary's path, which only the run knows, are escaped as every Loom message escapes a value, so a path that holds a line break prints on one line.
- **How the binary reads its installation.** After `npm install -g`, the binary runs from its platform package beneath npm's global root, such as `/usr/local/lib/node_modules/@acme/notes/node_modules/@acme/notes-linux-x64/bin/notes`, so core reads the installation method `npm` from its path, and the baked `release.npmPackage` names the launcher package. [Update notices](../plugins/self-update.md#update-notices) then name `npm install -g @acme/notes@<version>` for the version they announce, and [self-update](../plugins/self-update.md) refuses with the command for the version asked for. The command names the launcher package, never a platform package. A launcher installed as a project dependency or run through `npx` reads no installation.

### Publishing the packages

```yaml
# .github/workflows/release.yml, in the job that publishes
permissions:
  contents: read
  id-token: write
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
  - uses: oven-sh/setup-bun@v2
  - run: pnpm install --frozen-lockfile
  - run: pnpm exec loom build --target npm
  - run: |
      # A prerelease publishes under its channel, next for 1.6.0-next.2. A backport, a stable version
      # below latest such as 1.4.3 after 1.5.0, publishes under its major line's tag, v1-latest.
      # The newest stable version publishes with no --tag.
      version=$(node -p "require('./package.json').version")
      v=${version%%+*}
      tag=
      case $v in
        *-*) tag=${v#*-}; tag=${tag%%.*} ;;
        *)
          latest=$(npm view @acme/notes dist-tags.latest 2>/dev/null || true)
          newest=$(printf '%s\n%s\n' "$latest" "$v" | sort -V | tail -n 1)
          if [ -n "$latest" ] && [ "$newest" != "$v" ]; then tag=v${v%%.*}-latest; fi
          ;;
      esac
      for dir in dist/npm/notes-*/; do npm publish --provenance ${tag:+--tag "$tag"} "$dir"; done
      npm publish --provenance ${tag:+--tag "$tag"} dist/npm/notes
```

Publishing is the author's workflow, as [One package directory](#one-package-directory) leaves all release orchestration to each repository. `loom build --target npm` writes the directories and publishes nothing. Bun cross-compiles every platform, so one Linux job can build the whole set.

1. **Check the names.** Every platform package is a name on the registry that the author must own. A scoped `<pkg>` keeps every platform package in the author's own scope, where no one else can claim the name. For an unscoped `<pkg>`, check that `npm view <pkg>-<platform>` answers `E404` for each platform before the first release.
2. **Make scoped packages public.** npm publishes a scoped package as restricted unless told otherwise. Set `"publishConfig": { "access": "public" }` in the author's `package.json`, and every package copies it.
3. **Bootstrap each name.** npm attaches a trusted publisher only to a name that already exists on the registry. For each package name, publish a placeholder `0.0.0` by hand from a directory outside the repository, as [ADR-0037](../decisions/0037-validators-ship-in-their-own-package-as-standard-schema-values.md) did for a new Loom package. The placeholder's directory holds only a `package.json` with the name and version `0.0.0`. Run `npm publish --access public --tag bootstrap` while logged in to npm, so the placeholder goes under a tag of its own and not `latest`. Run `npm dist-tag ls <name>` afterwards: if the registry points `latest` at the placeholder anyway, as a registry may for a name's only version, deprecate it at once with `npm deprecate <name>@0.0.0 "Placeholder with no launcher. Install a release."`. `npm install -g <pkg>` installs the application from the first stable release on, which publishes with no `--tag` and so moves `latest` to it. Before that release, an operator installs a prerelease by its channel, such as `npm install -g @acme/notes@next`. The workflow publishes only the version in `package.json`, so the placeholder never reaches an operator's install of a release. Deprecate the placeholder once the first real version is on the registry, if you have not already.
4. **Add a trusted publisher to each package.** npm creates trusted publishers one package at a time and offers no way to set them for a group of packages. On npmjs.com, open each package's settings and add a GitHub Actions trusted publisher with the repository's owner, its name, the workflow's file name, such as `release.yml`, and the environment, if the job uses one. With npm 11.15.0 or newer, `npm trust github <package> --file release.yml --repo <owner>/<name> --allow-publish --yes` does the same from the command line, one package per call, and may ask for two-factor authentication. A new trusted publisher must complete its first publication within 48 hours, so add the publishers when the first release is ready to publish.
5. **Publish platform packages first.** The launcher pins each platform package at its exact version, so publishing the launcher first would let an operator install a launcher whose binary is not on the registry yet. Publish every platform directory, then the launcher's. `--provenance` needs `id-token: write`, and npm checks that `repository` names the repository that runs the workflow. A package with no `repository` field fails that check. Trusted publishing itself needs npm 11.5.1 or newer, which Node.js 24 ships, as Loom's own [release workflow](../maintaining/release-workflow.md) notes.
6. **Tag a prerelease with its channel, and a backport with its line.** npm 11 refuses to publish a prerelease version without `--tag`. Publish every package of a prerelease under its release channel, the first prerelease identifier, as core derives it: `1.6.0-next.2` publishes with `--tag next`. `latest` then keeps naming the newest stable release, and an operator on the channel installs with `npm install -g @acme/notes@next`, the command self-update's refusal names for `--channel next`. npm refuses a tag it reads as a version range, such as the `1` of `1.6.0-1`, so name prerelease channels with words. The channel is read after build metadata is removed, so `1.6.0+build-5` is stable. The newest stable version publishes with no `--tag`. A stable backport, such as 1.4.3 published after 1.5.0, needs a tag too: npm 11 refuses to publish a version lower than `latest` without one, and `--tag latest` would move `latest` back to it. Publish it under a tag of its own, such as `--tag v1-latest` for its major line or `--tag backport`.
7. **Re-run safely.** npm refuses to publish a version again. A workflow that may re-run after a partial failure checks each package first, for example with `npm view <name>@<version> version`, and publishes only the packages that are missing, platform packages still before the launcher.
8. **Add a platform later.** A platform added to `npm.platforms` is a new package name. Bootstrap it and add its trusted publisher before the release that first carries it, or that release's publish fails for the new package before the launcher is published.
