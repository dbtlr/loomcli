# @loomcli/loom

The Loom CLI toolchain. It exports no module. Its `loom` bin acts on one package: the directory of the nearest `package.json` at or above the working directory. `loom build` does its work under [Bun](https://bun.sh), so Bun must be on the `PATH`.

## Install

```sh
pnpm add -D @loomcli/loom
```

## Init

`loom init` scaffolds a new application in an empty directory, or adds the pieces an existing package lacks.

```sh
mkdir notes && cd notes
bunx @loomcli/loom init   # package.json, src/, its test, the lint configuration, tsconfig.json, .changes/README.md, and the changelog skill
pnpm install
pnpm check
```

In an empty directory nothing is installed yet, so the first run goes through the package runner. Inside a package that already depends on `@loomcli/loom`, the bin is `loom`.

- **Paths.** Each path below is a convention. A `loom.config.json` beside `package.json` moves any of them through its `paths` key, such as `"source": "lib"` or `"installer": "../../install.sh"`, and holds the installer's `postInstall` step. See [the configuration file](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain/build.md#the-configuration-file).
- **Scaffold files.** `src/application.ts`, `src/main.ts`, `tsconfig.json`, `src/application.test.ts`, the lint file (`.oxlintrc.json` or `eslint.config.js`), and the `package.json` keys `bin`, `scripts.build`, `scripts.check`, the Loom dependencies, and the tool packages at the ranges `@loomcli/loom` declares are written once, only when missing. Init never overwrites them, because they are your code from then on.
- **Managed files.** `.changes/README.md`, the fragment guide, `.agents/skills/loom-changelog/SKILL.md`, the changelog skill, and `install.sh`, the installer script, carry a header with a checksum. Init re-renders an unedited one, so it follows the installed toolchain. An edited one draws a warning and is left alone, and `--force` restores it. Delete the header to keep the file as your own.
- **The installer script.** When `package.json` `repository` names a GitHub repository, such as `owner/name`, init writes `install.sh`, executable. Under POSIX `sh` on Linux and macOS it downloads the platform's binary from the repository's GitHub Release, verifies it against the release's `SHA256SUMS`, installs it into `~/.local/bin` or the `--dir` it is given, and records the installation. A package whose `loom.config.json` declares `postInstall` gets a script that then runs its post-install command, which `--skip-post-install` skips, and prints its post-install message. Without a GitHub repository, init writes no script and prints a warning. See [the installer script](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain/install.md) for its arguments and the release shape your release workflow publishes.
- **The check script.** `scripts.check` runs `tsc --noEmit`, the linter, and the test runner. The test passes the Application to the assembly check of `@loomcli/testing`, so a fault only the assembled application reveals fails there.
- **Options.** `--only <piece>` limits init to `application`, `entry`, `tsconfig`, `test`, `lint`, `package`, `changes`, `skill`, or `install`, and may repeat. `--linter oxlint|eslint` and `--test-runner bun|vitest` choose the tools, by default oxlint and Bun. A lint configuration or a `vitest` dependency the package holds selects its tool, and at a terminal init asks when nothing does. Init installs nothing, so run your package manager afterward.

See [loom init](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain/init.md) for the contract.

## Changelog

A package keeps its pending changes as fragments in `.changes/`, or the folder `paths.changes` names in `loom.config.json`, and cuts its `package.json` version from them. `CHANGELOG.md` is likewise the default of `paths.changelog`.

```sh
mkdir -p .changes
printf -- '- Add the `--tag` option to `notes list`.\n' > .changes/feature.list-by-tag.md
loom changelog check
git add .changes && git commit -m 'Add list-by-tag fragment'
loom changelog write --dry-run
loom changelog write --date 2026-10-07
```

- **Fragments.** `breaking.<slug>.md` is a breaking change and carries one `### Migration` section with the five labels, `feature.<slug>.md` is a feature, and `<slug>.md` is a fix. A body is Markdown bullets with no frontmatter or headings. `.changes/README.md` is the guide, not a fragment.
- **`loom changelog check`** validates every fragment and names each invalid one. It needs no git history, so CI runs it.
- **`loom changelog write`** computes the next version from the highest kind present, renders one section with `### Breaking Changes`, `### Features`, and `### Fixes`, prepends it to `CHANGELOG.md`, sets `version` in `package.json`, and deletes the consumed fragments. From `1.0.0`, breaking advances the major, feature the minor, and fix the patch; below it, breaking advances the minor and anything else the patch. It orders fragments by the commit that added them, so it needs full git history. `--date YYYY-MM-DD` dates the release, `--narrative FILE` copies prose above the entries, and `--dry-run` prints the section and the next version and writes nothing.

`write` refreshes no lockfile; run your package manager after the cut. See [The package changelog](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain/changelog.md) for the contract.

## Build

`loom build` bundles the package's application for one target and bakes its release facts into the `__LOOM_RELEASE__` identifier, which core reads into `host.release`.

```sh
loom build --target node                       # dist/main.js and dist/application.js, { build: 'distributed' }
loom build --target bun-linux-x64 --release    # dist/<name>, a binary with its version, repository, and asset
loom build --watch --target node               # rebuilds on change, { build: 'development' }
```

- **Targets.** `--target` takes `node`, `bun`, or a Bun compile target such as `bun-linux-x64`, by default the host's compile target. One call builds one target.
- **The modules.** The entry is `src/main.ts`, or `paths.entry` in `loom.config.json`, or `--entry`. A bundle also carries the application module, `src/application.ts`, `paths.application`, or `--application`, as a file named for the module, such as `application.js`, so a test imports the built Application with its baked facts. When the conventional application module does not exist, the bundle carries the entry alone.
- **The release.** `--release` reads `version` and `repository` from `package.json`, and `--repository <owner/name>` overrides the field. A binary's path and asset name read the application's name from `bin`, or `--name`.
- **A failed build changes nothing.** The build writes into a temporary directory and moves its files into place only once it succeeds.

A custom build composes the same facts into its own bundler call:

```sh
bun build src/main.ts --outdir dist --target node --define "$(loom build --target node --define)"
```

`--facts` prints the facts JSON instead, for a bundler's `define` option. See [loom build](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain/build.md#loom-build) and [Release facts](https://github.com/dbtlr/loomcli/blob/main/docs/core/release-facts.md) for the contracts.
