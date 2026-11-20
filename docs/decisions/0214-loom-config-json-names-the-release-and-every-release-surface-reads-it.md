---
type: adr
title: ADR-0214 - loom.config.json names the release, and every release surface reads it
description: A top-level name key in loom.config.json, a portable name, gives the application's release name. loom build and loom release formula read --name, then the key, then package.json bin; loom init reads the key, then the name it scaffolds with, and renders the installer script's asset through releaseAssetName. The installer keeps the scaffolded name for the installed file, the installation record, and its sentences.
status: proposed
created: 2026-11-20
modified: 2026-11-20
---

# ADR-0214 - loom.config.json names the release, and every release surface reads it

## Context

`loom build --release --name <name>` names a release binary's path and its asset `<name>-<platform>` instead of the name `package.json` `bin` gives. [`loom release formula --name <name>`](../toolchain/install.md#publish-a-homebrew-formula) names the same asset in the Homebrew formula and installs the command under it. The installer script that `loom init` renders under [ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) has no such input. It builds the asset from the name init scaffolds with. So with the manifest bin `probe` and a release built with `--name alternate`, `install.sh` requests `probe-linux-x64`, and the script fails because `SHA256SUMS` lists only `alternate-linux-x64`.

An `init --name` option cannot hold the name. `init` re-renders an unedited managed file on every run, so a later run without the option would silently put the bin's name back into `install.sh`. [ADR-0113](0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md) and [ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) found the same for the post-install command and the installer's location: a value that a re-run must keep belongs in `loom.config.json`.

## Decision

- **The key.** `loom.config.json` takes an optional top-level `name`: the application's release name. The value is a portable name: letters, digits, `.`, `_`, and `-`, not starting with `-` or `.`, checked by `isPortableName` from `@loomcli/core`. That is the rule the `npm` target already applies to the application's name under [ADR-0213](0213-an-opt-in-npm-target-writes-a-launcher-package-and-a-platform-package-per-binary.md), because the value becomes a file name, a URL segment, a Ruby string, and a shell word. A value outside the rule, or a value of another type, is an issue at `name`, which fails the run under [ADR-0158](0158-the-loom-bin-reads-loom-config-json-strictly-so-a-broken-file-or-a-rejected-value-fails-the-run.md)'s `strict: true`. An author needs the key only when the release name differs from the name `bin` gives; a value equal to it changes nothing.
- **The order for build and formula.** `loom build` and `loom release formula` read the name in ADR-0130's order: `--name`, then `name`, then `package.json` `bin`, through the one function the build already uses, `applicationName`, with the file's value passed in when the option is absent. The sentence that reports a missing name names both `--name` and the key, and so does the `npm` target's sentence for a name that is not portable.
- **The order for init.** `loom init` has no name option. It reads `name`, then `scaffoldName`, the name it scaffolds with today, which falls back to the package name without its scope when `bin` has more than one key. A package without the key renders the same script, byte for byte, as before this record.
- **The readers.**

  | Reader | What the name gives |
  | --- | --- |
  | `loom build` | A binary's default path and its release asset, as `--name` gives them today, in `--facts` and `--define` too. For the `npm` target, it gives each platform binary's file name and the launcher's `bin` key, the command a global install through npm, pnpm, Bun, or Yarn puts on `PATH` |
  | `loom release formula` | Each asset the formula downloads and the command it installs, as `--name` gives them today |
  | `loom init` | The asset the installer script requests |

- **The installer's asset.** `loom init` renders the script's asset as the shell word `releaseAssetName` gives for the name, with `$platform` in place of the platform. `releaseAssetName` is the function that names the asset the build bakes, so the two cannot disagree. The name is rendered as a single-quoted shell word through `shellWord`, as `app` is.
- **What the installer keeps.** The installer script installs the binary under `scaffoldName` and records it under that name, and its sentences use it. Core reads the installation record under the Application's name, under [ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md). The Application init scaffolds takes `scaffoldName`, and init cannot learn another name without loading the application module, which [ADR-0131](0131-the-post-install-declaration-moves-from-the-application-into-loom-config-json.md) rules out. The release name therefore changes the asset the script downloads and nothing else in it.
- **A narrowed rule.** ADR-0130 says Loom's own hidden release commands read no key. `loom release formula` sits under the hidden `release` group but is part of the toolchain's contract, as [the toolchain reference](../toolchain/README.md) says. It now opts in to the configuration, so it reads the file strictly under ADR-0158, and it uses only `name`. `loom release cut`, `plan`, and `record` still read no key.
- **A narrowed name.** ADR-0213 reads the `npm` target's `<name>` from `bin` or `--name`. It now reads it in the build's order above, so the key names the binary in each platform package and the launcher's `bin` key.

## Considered options

- **`loom init --name`.** Not taken. A later run without the option would silently re-render `install.sh` with the bin's name.
- **Have the installer pick the asset from `SHA256SUMS` by its platform suffix.** Not taken. A release can publish the assets of several applications, so a suffix match could install the wrong one, and the installer would get an asset rule unlike the build's.
- **Install the binary under the release name, as the formula and the npm launcher do.** Not taken. The record must stay under the scaffolded name, because core never reads a record under the release name. Installing under the release name while recording under the scaffolded name would work. But the installed command would then differ from the name the Application's help and sentences use, which is the scaffolded name unless the author renamed it. Keeping the installed name means no installed command changes. With the key set, the formula and the npm launcher install the command under the release name, and `install.sh` installs it under the scaffolded name. [Install](../toolchain/install.md) says so.
- **A key under a `release` object.** Not taken. The name also names a development build's binary path, which is not a release, so it is the application's name and not a release setting.
- **Accept any nonempty string.** Not taken. One value would then have two rules: the `npm` target's portable-name check and no check elsewhere. A name with a `/` or a quote would fail later, at a path, a URL, or a shell word. The portable-name rule fails it once, at the key.

## Consequences

An author whose release name differs from the bin sets `name` once, then runs `loom init --only install` to re-render the installer script. From then on the build, the formula, the npm target, and the installer name the same asset. An author who keeps passing `--name` to `loom build` and sets no key still gets the mismatch this record fixes. [Build](../toolchain/build.md) and [Install](../toolchain/install.md) name the key where they describe `--name`.

The configuration's schema gains `name`, and [The configuration file](../toolchain/build.md#the-configuration-file) lists it. `loom release formula` now fails with code 2 on a `loom.config.json` that cannot be used, as `build` and `init` already do. The change adds a key and changes no default, so its fragment is a feature.

The acceptance plans live beside the [build](../../packages/loom/tests/build.test.ts), [release formula](../../packages/loom/tests/release-formula.test.ts), and [init](../../packages/loom/tests/init.test.ts) tests.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-20: Proposed for the installer script's release name (LM-585).
