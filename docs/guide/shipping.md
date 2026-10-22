---
description: "Guide chapter 8. Check pace with the type checker, the linter, and the assembly test, read its version from package.json, then build, release, install, and update it."
---

# Shipping

In this chapter you get `pace` ready for operators. At the end, `pnpm check` proves that the application compiles, follows Loom's lint rules, and assembles; `pace --version` prints the version from `package.json`; `loom build` writes a bundle and release binaries; an operator installs a binary with `install.sh`; and `pace self-update` replaces it with a newer release.

Loom owns the tools for each step: the [toolchain](../toolchain/README.md) builds the application, renders the installer script, and cuts the version and changelog, and the [self-update plugin](../plugins/self-update.md) replaces an installed binary. You keep the parts that belong to your repository: the checks your CI runs, the version you ship, the change fragments you write, and the release workflow that publishes your binaries, which [stays out of Loom's contract](../toolchain/build.md#one-package-directory).

`loom init` added `@loomcli/loom` as a development dependency, so this chapter runs its `loom` bin through `pnpm exec`. The [loom init reference](../toolchain/init.md#scaffold-files) lists the keys it added.

## Check the application

`loom init` wrote two scripts into `package.json`:

```json
{
  "scripts": {
    "build": "loom build --target node",
    "check": "tsc --noEmit && oxlint src && bun test"
  }
}
```

`pnpm check` runs three checks, one after another, and stops at the first that fails. They follow the order in which Loom guides an author, under [principle 7](../principles.md#7-guide-with-types-then-lint-then-diagnostics): a type first, then a lint rule, then a check that only the assembled application can answer.

```sh
pnpm check
```

### The type checker

`tsc --noEmit` type-checks the application and writes nothing, because `loom build` bundles it. It catches the mistakes the earlier chapters left to the types, such as a call in the wrong place on a declaration, which chapter 1 showed, or an action that reads a validated value as the wrong type, which chapter 3 showed.

### The linter

`oxlint src` runs the rules of [`@loomcli/eslint-plugin`](../libs/eslint-plugin.md), which `loom init` configured in `.oxlintrc.json`. A lint rule catches what a type cannot express. The plugin has three rules:

- **[`undescribed`](../libs/eslint-plugin.md#undescribed)** reports a Command, option, or argument with no description. The types allow a declaration without one, but help, the manifest, and the MCP tools from [chapter 7](agents.md) read every description, so a missing one leaves the operator and their agents with nothing to read.
- **[`discarded-declaration`](../libs/eslint-plugin.md#discarded-declaration)** reports an authoring call whose result is thrown away. A declaration is immutable, as chapter 1 showed, so `configured.command(calc);` on a line of its own builds a new declaration and changes nothing.
- **[`name-shape`](../libs/eslint-plugin.md#name-shape)** reports a literal name that core rejects when the module loads, such as a Command name with a space in it.

The linter reports these in your editor while you type, and in CI, before anything runs. A new scaffold can use ESLint instead, through `loom init --linter eslint`, which the [plugin reference](../libs/eslint-plugin.md#eslint) describes.

### The assembly test

`bun test` runs the test that `loom init` wrote in chapter 1. `pace` keeps it as init wrote it:

<!-- example: ../../examples/guide/src/08-shipping/application.test.ts -->
```ts
/// <reference types="bun" />
import { test } from 'bun:test';

import { assertAssembles } from '@loomcli/testing';

import { pace } from './application.js';

// Keep this test. It is the check that the whole application assembles, so a fault only the
// assembled application reveals fails CI rather than the operator's first run.
test('the application assembles', () => {
  assertAssembles(pace);
});
```

[`assertAssembles`](../libs/testing.md#assertassembles) calls `pace.check()`, which applies the build rules to the whole application, and fails the test with the Developer Diagnostic of each fault it finds. Some faults exist only once every Command and plugin is in place. For example, two options that [claim one spelling](../core/diagnostics.md#loomclicorespelling-taken), such as a global option of `pace`'s own and one a plugin declares, compile and lint without complaint, because each declaration is correct on its own.

Keep the test as the application grows. Without it, such a fault first appears when an operator runs the application, and in a distributed build the operator sees only a generic message. [What it covers](../libs/testing.md#what-it-covers) lists the faults the test finds and the ones it leaves to the first run, such as a declared default that its validator rejects.

## Read the version from package.json

Since chapter 1, `pace --version` has printed `0.0.0`, the version an Application reads when it declares none. Set `version` in `package.json` to the version you ship first, and name the GitHub repository the releases belong to:

```json
{
  "name": "pace",
  "version": "1.0.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/acme/pace.git"
  },
  "bin": {
    "pace": "dist/main.js"
  },
  "type": "module"
}
```

Then import the manifest in `src/application.ts`:

<!-- example: ../../examples/guide/src/08-shipping/application.ts#package-import -->
```ts
import Package from '../package.json' with { type: 'json' };
```

And pass its version to the Application:

<!-- example: ../../examples/guide/src/08-shipping/application.ts#version -->
```ts
version: Package.version,
```

`package.json` is now the one place that holds the version. `loom build` bundles the application, so the bundler inlines the value the application reads from its manifest, as the [plugin contract](../core/plugin-contract.md) notes for applications. The [version plugin](../plugins/version.md) prints it:

<!-- transcript: ../../examples/guide/transcripts/08-shipping/version.txt -->
```console
$ pace --version
pace v1.0.0
```

## Build the application

`pnpm build` runs `loom build --target node`:

```sh
pnpm build
```

It writes `dist/main.js`, the bundle of `src/main.ts`, and `dist/application.js`, the bundle of the application module, beside the chunks they share. The `bin` key that `loom init` wrote points `pace` at `dist/main.js`, so a package manager that installs `pace` puts a `pace` command on the operator's `PATH`. `src/main.ts` opens with `#!/usr/bin/env node`, and the bundle keeps that line. [`loom build`](../toolchain/build.md#loom-build) describes every target and option.

The build also bakes [release facts](../core/release-facts.md) into the bundle. They say how the running copy was built, and core delivers them to every run as `host.release`, so you import nothing to read them. The fact that changes what the operator sees is the build:

- **While you develop.** `bun src/main.ts` runs the source, and its release facts read `source`. That is a development build, so a defect shows you its Developer Diagnostic, with the detail you need to fix it.
- **What you ship.** `loom build` writes a distributed build by default, and its release facts read `distributed`. A defect there shows the operator one generic message through the view of `InternalError`.

`pace` overrides that view in [chapter 5](failures.md), so the generic message also says where to report the defect:

<!-- example: ../../examples/guide/src/08-shipping/views.ts#defect-view -->
```ts
/** A defect in a distributed build: the generic message, and where to report it. */
export const defectView: FailureView<InternalError> = {
  render: (_failure, { application, hints }) =>
    lines([
      `${application}: Something went wrong. Report it at https://github.com/acme/pace/issues.`,
      ...hints,
    ]),
};
```

Usage errors and `pace`'s own failures print the same text in both builds. The table in [Development builds](../core/release-facts.md#development-builds) lists what the build changes.

## Release a binary

An operator who does not install Node or Bun runs a compiled binary. `loom build` with a Bun compile target, such as `bun-linux-x64`, compiles a single binary for that platform. With `--release`, it also bakes the release group: the version from `package.json`, the repository from `repository`, and the asset name, such as `pace-linux-x64`.

Your repository's release workflow builds one binary per platform, writes their digests to `SHA256SUMS`, and publishes them as the GitHub Release `v1.0.0`:

```sh
for target in darwin-arm64 linux-x64 linux-arm64; do
  pnpm exec loom build --release --target "bun-$target" --out "dist/pace-$target"
done
(cd dist && sha256sum pace-* > SHA256SUMS)
gh release create v1.0.0 dist/pace-* dist/SHA256SUMS
```

The installer script and self-update read a release in exactly this shape. [The release shape](../toolchain/install.md#the-release-shape) states the tag, the asset names, the `SHA256SUMS` format, and how to publish a prerelease or an older line.

## Install with install.sh

When `package.json` names a GitHub repository, `loom init` writes the [installer script](../toolchain/install.md), `install.sh`, in the package directory. If you ran `loom init` before you set `repository`, init printed a warning and wrote no script. Write it now:

```sh
pnpm exec loom init --only install
```

`install.sh` is a [managed file](../toolchain/init.md#managed-files): init keeps it current each time you run it again, so you leave the file as init wrote it. Commit it, and an operator installs `pace` with one line:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/acme/pace/main/install.sh | sh
```

The script picks the asset for the operator's platform, downloads it from the latest release of `acme/pace`, checks it against `SHA256SUMS`, and places it in `$HOME/.local/bin`. A version argument installs that release instead, and `--dir` chooses another directory:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/acme/pace/main/install.sh | sh -s -- --dir /opt/pace/bin 1.0.0
```

After it places the binary, the script writes the [installation record](../core/installation-record.md), `install.json`, which says that a script installed `pace`, where, and with which digest. When the installed binary runs, core reads the record into `host.release.installation`, under [Reading the installation](../core/installation-record.md#reading-the-installation).

## Let the binary update itself

Install the self-update plugin in `src/application.ts`. Import `selfUpdate` from `@loomcli/plugins/self-update` and `refreshCompletion` from `@loomcli/plugins/completion`, and add the plugin to the list:

<!-- example: ../../examples/guide/src/08-shipping/application.ts#self-update -->
```ts
// A binary the installer placed replaces itself, then refreshes its completion script.
selfUpdate({ afterReplace: refreshCompletion }),
```

The plugin adds the `self-update` Command:

<!-- transcript: ../../examples/guide/transcripts/08-shipping/self-update-help.txt -->
```console
$ pace self-update --help
pace self-update · Replace this application with another release.

USAGE
  pace self-update [version] [options]

ARGUMENTS
  version  A release version to install, newer or older, such as 1.4.0.

OPTIONS
      --channel <channel>  The release channel to follow, such as stable or next.
      --check              Report what an update would do and replace nothing.

GLOBAL OPTIONS
  -u, --unit <unit>      The unit to give a pace in. One of: km, mi.  (default: km)
  -h, --help             Show this help.
  -V, --version          Print the version.
      --manifest         Print this command's manifest as JSON.
      --config <config>  Read configuration from this file alone.
```

`pace self-update` reads the release facts and the installation record, finds the newest release on the binary's release channel, verifies the download against `SHA256SUMS`, replaces the binary, and rewrites the record. It replaces only a binary that `install.sh` placed and that nothing has changed since. Any other copy belongs to the installer that put it there, so the Command refuses before it makes a request. A source run has no release group, so it refuses too:

<!-- transcript: ../../examples/guide/transcripts/08-shipping/self-update.exit-1.txt -->
```console
$ pace self-update
pace was not built as a release binary, so it cannot update itself. Update it the way you installed it.
```

The [self-update reference](../plugins/self-update.md) lists each refusal and its message, and how the Command follows a release channel.

`afterReplace` runs once the new binary and its record are in place. `pace` installs the completion plugin from chapter 6, and an operator may have installed its completion script, so `refreshCompletion` runs the new binary's `completion update` to refresh it. A refresh that fails never fails the update, under [Refreshing completion after a self-update](../plugins/completion.md#refreshing-completion-after-a-self-update).

The plugin also prints an update notice at a terminal when a newer release exists on the binary's channel. It reads a cache and never waits on the network. [Update notices](../plugins/self-update.md#update-notices) says when a notice prints and how you or the operator turn notices off.

## Record changes and cut a version

`loom init` also wrote `.changes/README.md`, the fragment guide. A [change fragment](../glossary.md#releases) in `.changes/` records one change that the people who use `pace` can see: `feature.<slug>.md` for a feature, `breaking.<slug>.md` for a breaking change, and `<slug>.md` for a fix. This chapter added `pace self-update`, so it adds a feature fragment:

```sh
printf -- '- Add `pace self-update`, which replaces an installed binary with a newer release.\n' > .changes/feature.self-update.md
pnpm exec loom changelog check
```

`loom changelog check` validates every fragment and needs no git history, so CI can run it on every change. Commit the fragment with the change it describes.

When you cut a release, `loom changelog write` turns the pending fragments into the next section of `CHANGELOG.md`, sets the new `version` in `package.json`, and deletes the fragments it used. The highest kind present decides the version, so one feature fragment takes `pace` from `1.0.0` to `1.1.0`:

```sh
pnpm exec loom changelog write --dry-run
pnpm exec loom changelog write
pnpm install
```

`--dry-run` prints the section and the next version and writes nothing. `write` refreshes no lockfile, so run the package manager after it. Because `src/application.ts` reads its version from `package.json`, the next build prints the new version and bakes it into the release facts, and your release workflow publishes it as `v1.1.0`. [The package changelog](../toolchain/changelog.md) states the fragment grammar, the version table, and what `write` needs from git.

## Where to go next

`pace` is complete: it is checked, built, released, installed, and kept up to date. From here, the references hold the full rule for everything the guide linked:

- [Loom documentation](../README.md) is the map of every part and where to start.
- The [core reference](../core/README.md) states the contract of `@loomcli/core`, one page per concept.
- [First-party plugins](../plugins/README.md) documents each plugin in `@loomcli/plugins`.
- [Libraries](../libs/README.md) documents validators, prompts, testing, and the lint plugin.
- The [toolchain reference](../toolchain/README.md) documents `loom build`, the changelog, `loom init`, and the installer script.
- The [jsonkit](../../examples/jsonkit/README.md) and [textstat](../../examples/textstat/README.md) examples are complete applications that use every first-party projection.
