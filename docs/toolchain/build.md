---
description: "loom build: one package directory and the build that bundles an application."
---

# loom build
## One package directory

```text
loom build [--target <target>] [--out <path>] [--entry <module>] [--application <module>]
           [--build development|distributed] [--watch]
           [--release [--repository <owner/name>] [--name <name>]] [--facts | --define]
loom changelog check
loom changelog write [--date YYYY-MM-DD] [--narrative FILE] [--dry-run]
loom init [--only <piece>]... [--linter oxlint|eslint] [--test-runner bun|vitest] [--force]
```

```sh
cd packages/notes
pnpm check && loom build --target node
```

Every `loom` command acts on one package: the package whose directory it runs in.

- **The package directory.** It is the directory of the nearest `package.json` at or above the working directory. A command run with no `package.json` at or above it fails with exit 1 and says to run it inside a package directory. `loom init` in an empty directory is the one exception, under [loom init](init.md).
- **One package, never a set.** Loom never acts on a repository root as a set of packages and holds no list of the packages a repository ships. In a monorepo, the monorepo's own tool runs a command in each package, or the author runs it in each one. A command run at a monorepo root acts on the root's own `package.json`.
- **No configuration file.** Every value is a command option, a convention, or a standard `package.json` field, such as `version`, `bin`, or `repository`. An option overrides the convention.
- **Paths.** A path an option names resolves against the working directory, as any command-line path does. A conventional path, such as `src/main.ts`, resolves against the package directory.
- **Bun.** `loom build` does its work under Bun, whichever runtime runs `loom`, so Bun must be on the `PATH`. A missing Bun fails the command with exit 1 and names Bun.
- **Exit codes.** 0 is success. 1 is a failed build, a failed changelog check, invalid content, or an operational failure, reported on stderr. 2 is a command or option error, as in every Loom application.
- **Out of this contract.** Release orchestration stays with each repository: PR guards, publishing to npm or GitHub, prerelease channels, release workflows, and cuts across several packages. The [installer script](install.md) reads the [release shape](install.md#the-release-shape) those workflows publish.

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

`loom build` builds the package's application for one target and bakes its [release facts](../core/release-facts.md) into the artifact through the define `__LOOM_RELEASE__`.

- **One target per call.** `--target` takes `node`, `bun`, or a Bun compile target, `bun-<os>-<arch>` for `linux` or `darwin` on `x64` or `arm64`, then `-musl` on Linux and `-baseline` or `-modern` on x64, such as `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-linux-x64-musl`, or `bun-linux-x64-musl-baseline`. No `bun-windows-*` target is offered, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md); an author who wants a Windows binary calls `bun build --compile` directly. Any other value is an option error that names the targets, `--facts` and `--define` included. The default is the compile target Bun names for a Linux or macOS host. On Windows `--target` has no default, so a run without one is the option error that names the targets, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md). `node` and `bun` write a JavaScript bundle for that runtime, and a compile target compiles a single binary. `browser` is refused, because a Loom application runs as a command. Several targets take several calls, and cross-compiling and building on each platform are both valid.
- **The entry.** `--entry` names the module that calls `run()`. The default is `src/main.ts`.
- **The application module.** `--application` names the module that exports the Application, by default `src/application.ts`, the module a test imports for the assembly check. A `node` or `bun` bundle carries it as a second bundle entry point beside the entry, so an embedded caller or a test imports the built Application with its baked facts. Each entry point's file is named for its module alone, whatever directory the module lives in, such as `main.js` and `application.js`, beside the chunks they share. An entry and an application module with the same base name, such as `src/cli/application.ts` beside `src/application.ts`, would build to one file, so the build fails before it starts, names both modules, and says to rename one of them or name another module with `--entry` or `--application`. A bundle splits, so each plugin's lazily loaded middleware stays in a chunk of its own. When `src/application.ts` does not exist, the bundle carries the entry alone, and a module `--application` names that does not exist fails the build and names it. A compile target compiles the entry alone, so `--application` with a compile target is an option error that says it applies to a `node` or `bun` bundle.
- **The package's Bun configuration.** Bun reads the package's `bunfig.toml`, when it holds one, from any working directory, so a setting such as a `[loader]` applies to the build and to `--watch`.
- **The dependencies.** `loom build` bundles the package's dependencies, `@loomcli/core` included, so the define reaches core and the artifact reads the facts it bakes.
- **The output.** `--out` names a binary's file, by default `dist/<name>`, or a bundle's directory, by default `dist/`. A binary's output that is an existing directory fails the build before anything builds and names `--out`.
- **The name.** A binary's default path and its asset name read the application's name from `package.json` `bin`: a string `bin` gives the package name without its scope, and an object `bin` with one key gives that key. `--name` overrides it. With no `bin`, or a `bin` with several keys, and no `--name`, a build that needs the name fails and names `--name`.
- **The build.** `--build` takes `development` or `distributed`, and the default is `distributed`. Those are the `build` values the artifact reads.
- **Watching.** `--watch` runs `bun build --watch` for the target and passes the facts with `--define`, with `build` set to `development`. It rebuilds on each change until it is stopped, and it writes as `bun build --watch` writes. Bun runs in the package directory, so it follows a source file that an atomic save or a checkout replaces. When the watch ends, a stopped watch included, `loom` removes each output directory it created that nothing filled, and for a compile target the `.bun-build` files that appeared in the package directory while it watched, where Bun writes a binary's temporary file. `--watch` with `--build distributed` is an option error.
- **A release.** `--release` adds the release group. `version` is the package's `version`, and a missing `version` fails the build and names the `package.json` field. `repository` is read from the standard `repository` field, so `git+https://github.com/dbtlr/loomcli.git` and `git+ssh://git@github.com:dbtlr/loomcli.git` read as `dbtlr/loomcli`, or from `--repository <owner/name>`, which overrides it. `--repository` without `--release` is an option error that says it applies to a `--release` build. An address whose path, without its host, `.git`, and a trailing slash, is not exactly two segments, such as a nested group or a path below the repository, cannot be read. `asset` is `<name>-` and the compile target without its `bun-` prefix, such as `notes-linux-x64-musl`, and absent for `node` and `bun`. A value that cannot be read fails the build and names the option to pass.
- **A compiled binary.** A compile target bakes `compiled: true`, with or without `--release`, and `node` and `bun` bake no `compiled` member, so core knows a binary is the whole program when it captures [`host.program`](../core/host.md).
- **Composing a custom build.** `--facts` prints the facts JSON, and `--define` prints the define pair, `__LOOM_RELEASE__=<json>`. Each reads the same options a build reads, prints one line to stdout, and builds nothing, and they exclude each other. `loom build` computes its own facts with the same code, so an author who needs a bundler option `loom build` does not offer composes the same facts into that bundler's define.
- **A failed build changes nothing.** A build writes into a temporary directory beside the output and moves each file into place only after the whole build succeeds, replacing the file of the same name. A failed build leaves any earlier output in place, and files the build does not write are left alone. `loom` holds SIGINT and SIGTERM from before it creates anything until the build has finished or been undone. A signal reaches Bun while Bun runs. One that arrives before the files move into place cleans up as a failed build does, including each output directory the build created that nothing else has filled, and one that arrives while they move lets every file move, so output is never partly replaced. Either way `loom` then ends with the signal, so its shell reads 130 or 143. Bun runs in the temporary directory, so the file a compile writes into Bun's working directory lands there, and builds that run at once in one package, such as one call per target, each have their own. The build never writes into the source tree.

### loom build acceptance

`loom build` is proven when process runs of the packed `loom` bin produce these results under Node and Bun, with the artifacts run under both:

- **Targets.** `--target node` and `--target bun` each write a bundle that reads `{ build: 'distributed' }`. The host's compile target, by default and by name, writes `dist/<name>`, a binary that runs with no runtime installed. `--target browser` and an unknown target each exit with an error that names the targets.
- **The application module.** A `--target node` build of a package that holds `src/application.ts` writes `dist/application.js`, which a caller imports to run the Application on the facts the build baked, and a package without it writes the entry alone. `--application` naming a module that does not exist exits 1 and names it.
- **The build.** `--build development` writes an artifact that reads `development`, and `--watch` rebuilds after a source change into an artifact that reads `development`.
- **A release.** `--release` in a package at `1.1.0-next.3` whose `repository` is the `git+https://` form reads version `1.1.0-next.3`, channel `next`, and repository `owner/name`, with an asset only for a compile target. `--repository` overrides the field. A package with no `repository` and no `--repository` exits 1 and names `--repository`. A compile target with no `bin` and no `--name` exits 1 and names `--name`.
- **A compiled binary.** `--facts` for a compile target prints `"compiled":true` with and without `--release`, and for `node` and `bun` prints no `compiled` member. A compiled fixture binary reads `host.program` as its own path alone, and a Node bundle reads `process.execPath` and the bundle's path.
- **Composing.** `--facts` prints the facts JSON and `--define` the pair, and neither writes a file. A `bun build --define` with the printed pair, and a `Bun.build` call with the printed facts, each write an artifact that reads the same facts `loom build` bakes.
- **A failed build.** A syntax error in the entry exits 1, and the earlier output is byte-identical afterward.
