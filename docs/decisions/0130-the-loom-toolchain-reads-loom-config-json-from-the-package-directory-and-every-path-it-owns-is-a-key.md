---
type: adr
title: ADR-0130 - The loom toolchain reads loom.config.json from the package directory, and every path it owns is a key
description: The loom bin installs the configuration plugin with the file loom.config.json, the project scope alone, and package.json as its root marker, so the lookup reads the file at or below the package directory and never a file above it; --config names any file in its place. Every key is optional. paths holds source, application, entry, out, changes, changelog, installer, and skills, each defaulting to today's convention, and application and entry follow source. Every path in the file resolves against the package directory, an option beats the file, and the file beats the convention. A path another tool dictates stays fixed. init uses only conventions when it scaffolds a new application, and writes no loom.config.json. The bin still acts on one package directory. It supersedes ADR-0099's rule that the bin reads no configuration file, and the fixed locations of ADR-0067, ADR-0068, and ADR-0072.
status: proposed
created: 2026-10-31
modified: 2026-11-01
---

# ADR-0130 - The loom toolchain reads loom.config.json from the package directory, and every path it owns is a key

## Context

[ADR-0099](0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) carries forward ADR-0066's rule that the `loom` bin reads no configuration file: every value is a command option, a convention, or a standard `package.json` field. ADR-0066 rejected a file because "every value it would hold already has a home". Three cases have no good home:

- **A location a re-run must keep.** Mimir's monorepo serves its installer from the repository root, because a `curl | sh` address ends up in READMEs and scripts, but `loom init` renders `install.sh` in the package directory under [ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md). Mimir keeps a byte-for-byte copy at the root and a test that fails when the two differ. An `init` option cannot hold the location, because, as [ADR-0113](0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md) found for the post-install command, a run without the option would drop it.
- **A layout other than the convention.** `src/`, `dist/`, `.changes/`, and `CHANGELOG.md` are fixed in [ADR-0067](0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md), [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md), and the build, and only `loom build` takes options for its paths. A package whose source lives in `lib/`, or whose changelog lives above it, has no way to say so to `init` or `loom changelog`.
- **A fact only the toolchain reads.** The post-install declaration sits on the Application only because no file existed, under [ADR-0131](0131-the-post-install-declaration-moves-from-the-application-into-loom-config-json.md).

The 2026-10-07 withdrawal of a root `loom.config.ts` withdrew two things together: the file and the repository as one release unit. This record restores a file and keeps the bin on one package. The [configuration plugin](../plugins/config.md) now reads a file through one schema, so the bin adopts it as any author does, and the project scope and root marker of [ADR-0129](0129-an-author-chooses-the-configuration-scopes-an-application-reads-and-a-root-marker-where-the-project-walk-stops.md) keep the file to one package.

## Decision

- **The file.** The `loom` bin installs `configuration()` with `file: 'loom.config.json'`, `scopes: ['project']`, and `root: 'package.json'`. It sets no variable and no directory option. A run reads the first `loom.config.json` from the working directory up to the package directory, and never one above the package directory, in the home directory, or in a user folder. The file reads as JSON with comments, under [ADR-0120](0120-a-json-configuration-file-holds-comments-and-a-file-that-does-not-parse-names-its-line-and-column.md), and its schema follows the plugin's rules: every key is optional, an unknown key is ignored, a value the schema rejects is dropped and its convention applies, and a broken file warns once and the run uses conventions. The bin installs the [verbose plugin](../plugins/verbose.md), so `-v` names each dropped value, as the plugin writes it at that level.
- **`--config` and `--no-config`.** The plugin declares them, so they appear on `loom`'s help as on any application that installs it. `--config <path>` reads a file of any name, and `--no-config` runs on conventions alone, which CI can use to check that a package builds without its file.
- **The paths.** The `paths` object holds every path whose convention the bin owns:

  | Key | Default | Read by |
  | --- | --- | --- |
  | `source` | `src` | `init`, for the scaffold's source files |
  | `application` | `<source>/application.ts` | `build`, `init` |
  | `entry` | `<source>/main.ts` | `build`, `init` |
  | `out` | `dist` | `build`, `init` |
  | `changes` | `.changes` | `changelog check`, `changelog write`, `init` |
  | `changelog` | `CHANGELOG.md` | `changelog write` |
  | `installer` | `install.sh` | `init` |
  | `skills` | `skills` | `build`, under a later record |

  Each path is a nonempty string, relative or absolute, and a relative path may hold `..` to leave the package directory; an empty string or a value of another type is dropped and its convention applies. `application` and `entry` follow `source` unless they are set themselves, so `"source": "lib"` moves both to `lib/`. `skills` names the folder of the agent skills the application installs for its operator, the layout `npx skills` reads. How the build reads that folder is the subject of a later record, which this record leaves to it.
- **One path base.** Every path in the file resolves against the package directory, whichever directory the file sits in, and an absolute path stays as written. A path may leave the package directory, so `"installer": "../../install.sh"` renders the installer at a monorepo's root. Every key reaches the bin through `provided.config`; no option is linked with `configInput`, which would resolve a linked path against the file's directory instead.
- **The order.** A command option beats the file, and the file beats the convention. `build`'s `--entry`, `--application`, and `--out` keep resolving against the working directory, as any command-line path does. A key with no option takes the file's value or its convention.
- **A missing module.** A module the file names follows the option's rule, not the convention's: an `application` the file sets that does not exist fails `build` and names the key, as a missing `--application` module does, while a missing conventional application module, `<source>/application.ts` included when only `source` is set, leaves the bundle with the entry alone.
- **What follows a key.** `init` writes the application module, the entry, and the test at `application`, `entry`, and `<source>/application.test.ts`, the test importing the application module by its relative path. The `bin` key `init` scaffolds names the entry's bundle in `out`. The fragment guide is the managed file `<changes>/README.md`. `init` renders `install.sh` at `installer` and checks its drift there. `init` creates the directories a path needs, as it does for `src/`.
- **Content follows the keys too.** What `init` writes names the configured paths wherever it names a path: the fragment guide and the changelog skill name the configured fragment folder and changelog, relative to the package directory, and the scaffold's `tsconfig.json` `include`, the linter's file globs, and the `check` script's lint target name the configured `source`.
- **Fixed paths.** A path another tool dictates is not a key: `package.json`, `tsconfig.json`, the linter's configuration file, `bunfig.toml`, and the changelog skill, which stays at `.agents/skills/loom-changelog/SKILL.md` in the package directory, where coding agents look for skills.
- **A new application uses conventions.** When `init` scaffolds a new application, in an empty directory or one where it creates `package.json`, it uses every key's convention and ignores the configuration, a file `--config` names included. The lookup still runs as in any run, so a broken file above the new directory still draws its warning. The project walk from a directory with no `package.json` reaches the package above it, and that package's file describes that package.
- **`init` writes no file.** Conventions need no file, so `init` writes no `loom.config.json`. An author creates one to depart from a convention.
- **One package still.** The bin acts on one package directory and never on a repository as a set of packages, as ADR-0066 rules and ADR-0099 carries forward. A path that leaves the package directory names a file the package's own commands read or write; it makes no other package's directory the bin's. Release orchestration stays with each repository, and Loom's own hidden release commands read no key.

## Considered options

- **One repository file with a section per package.** Rejected. The bin would find a repository root and map each package to its section, which is the release unit withdrawn on 2026-10-07. Sharing a file across a monorepo's packages stays open for an explicit mechanism, such as a key that names a file to extend, which a later change can add without breaking anyone.
- **The plugin's default walk to home and the user file.** Rejected. A build would write somewhere else because of a dotfile in an operator's home, and a package in a monorepo would read the root's file as its own.
- **`loom.json`, a file pattern that also accepts TOML or YAML, or `loom.config.ts`.** Not taken. The owner chose `loom.config.json`. A pattern lets a package hold two files, of which the plugin skips one; a literal name can grow into a pattern later. A TypeScript file is a module the plugin does not read.
- **A `loom` key in `package.json`.** Rejected, as ADR-0113 rejected one: the plugin reads no `package.json` key.
- **Linking `build`'s options to their keys with `configInput`.** Rejected. A linked path resolves against the file's directory, under [ADR-0117](0117-a-configuration-value-its-validator-rejects-falls-back-and-validates-against-its-files-directory.md), and a key read through `provided.config` keeps its text as written, so the file would have two bases.
- **A key for the changelog skill's folder.** Rejected. Where an agent looks for skills is the harness's choice, not the author's.

## Consequences

The bin gains a file read on every run; a JSON file loads no parser package. A broken file leaves a run on conventions, as the plugin's rule for every application has it, so `init` in a package whose file does not parse writes any missing piece at its conventional path after the warning; it never overwrites a file. `loom` gains `-v` and `-q`. An existing package needs no file and builds as before, because every default is today's convention. `build.md`'s rule that the bin reads no configuration file gives way to the file, and `build.md`, [loom init](../toolchain/init.md), [loom changelog](../toolchain/changelog.md), [The installer script](../toolchain/install.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships the file, its paths, and the bin's use of them.

## Changelog

- 2026-10-31: Proposed with the toolchain configuration contract (LM-434). It supersedes ADR-0099's provision, carried forward from ADR-0066, that the bin reads no configuration file; ADR-0067's clause that `.changes/` and `CHANGELOG.md` live in the package directory; ADR-0068's fixed scaffold paths and the fragment guide's fixed path; and ADR-0072's clause that init renders `install.sh` in the package directory. Each location becomes the default of its key. ADR-0067, ADR-0068, ADR-0072, and ADR-0099 carry dated entries.
- 2026-11-01: [ADR-0132](0132-a-packages-changelog-cut-may-choose-its-version-cut-a-prerelease-and-set-a-shared-version.md), proposed, adds the top-level `sharedVersion` key, a list of `package.json` files resolved against the package directory like every path here. `write` validates it as one value and fails on a malformed one rather than dropping it, the one key whose rejected value does not fall back to its convention. It names files the package's own cut writes, so the bin still acts on one package. It binds when that record is accepted.
