---
type: adr
title: ADR-0158 - The loom bin reads loom.config.json strictly, so a broken file or a rejected value fails the run
description: The loom bin installs the configuration plugin with strict set to true. A loom.config.json that the lookup finds and cannot use, and a value its schema rejects, fail every loom command that reads the file with code 2, instead of warning or dropping while the command runs on conventions. --no-config still runs on conventions. It supersedes ADR-0130's clauses that a rejected value is dropped and its convention applies, and that a broken file warns once and the run uses conventions, and ADR-0131's clause that a rejected post-install command is dropped.
status: accepted
created: 2026-11-15
modified: 2026-11-17
---

# ADR-0158 - The loom bin reads loom.config.json strictly, so a broken file or a rejected value fails the run

## Context

[ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) gave the `loom` bin the configuration plugin's forgiving rules. A value the schema rejects is dropped and its convention applies. A broken file warns once, and the run uses conventions. Each rule suits an operator at a shell. Neither suits CI, where nobody reads a warning and the exit code is the only signal.

Heimdall found the case while moving onto `loom changelog`. Its `loom.config.json` names a fragment folder through `paths.changes`. When that file did not parse, `loom changelog check` warned `Skipped loom.config.json: …`, read the conventional `.changes/`, which held nothing, printed `Checked 0 fragments.`, and exited 0. The PR guard passed with nothing checked. A rejected value takes the same path: `"paths": { "changes": "" }` is dropped, and the command reads `.changes/` with no line at the default verbosity. For `loom changelog write` the cost is higher. A cut on conventions prepends to the conventional `CHANGELOG.md`, and deletes fragments from the conventional folder.

[ADR-0155](0155-the-configuration-plugins-strict-setting-fails-the-run-for-a-value-at-or-under-a-path-it-lists.md) gives the configuration plugin `strict`, and its 2026-11-15 entry has `strict` fail the run for a discovered file that cannot be used. The owner settled three questions in grooming (LM-524):

- **Where the rule lives.** The owner chose the plugin's `strict` setting, with the bin turning it on, over a public report of what the lookup found and over the bin reading the file a second time. The same silent fallback reaches every application's supervised service, and `strict` already exists to prevent it there.
- **How strict.** The owner chose `strict: true` over a list such as `['paths']`, so a rejected value fails the run as a broken file does.
- **The sentence.** The owner chose the plugin's existing fix for each clause, with no hint to run with `--no-config`.

## Decision

- **`strict: true`.** The bin's `configuration()` call sets `strict: true`. Every other setting stays as ADR-0130 states.
- **A broken file fails the run.** A `loom.config.json` the lookup finds that cannot be read or does not parse, or whose top level is not a JSON object, fails the run with code 2, under the configuration plugin's [strict setting](../plugins/config.md#the-strict-setting). The failure names the file and the fix, such as `loom: Configuration file loom.config.json is not valid JSON at line 3, column 5. Correct its syntax, or remove it.`
- **A rejected value fails the run.** A value the file's schema rejects, such as an empty `paths.changes` or a `postInstall.command` that is not a non-empty list of strings, fails the run with code 2, and one failure names every such value with its path and the schema's message. `sharedVersion` passes through the schema as written, so `loom changelog write` still validates it itself, as [ADR-0132](0132-a-packages-changelog-cut-may-choose-its-version-cut-a-prerelease-and-set-a-shared-version.md) states.
- **Unknown keys stay ignored.** The file's schema is valibot's and publishes no JSON Schema, so the plugin learns of no unknown key and no unknown key fails a run, as ADR-0155 states for such a schema.
- **Which commands.** The commands that read the file fail: `build`, `init`, `changelog check`, `changelog write`, and `changelog notes`. A command that reads no configuration, such as `loom pr check`, never reads the file and is unaffected, and so is a takeover such as `loom build --help`, which reads no configuration.
- **What stays.** A missing file is no fault, and every key is still optional. `--no-config` reads no file, so a run under it uses conventions whatever the file holds. `--config <path>` already fails the run for a missing or broken file, and now fails it for a rejected value too.
- **`init` in a new application.** `init` that scaffolds a new application still ignores the configuration, but the lookup still reads the package file above the new directory, so a broken or rejected file there fails the scaffold. The operator corrects that file, or runs `init` with `--no-config`.

The [configuration file](../toolchain/build.md#the-configuration-file) page and [loom init](../toolchain/init.md) carry the contract.

## Considered options

- **A public report of what the lookup found.** Not chosen in grooming. A provider would say whether a run read no file, read one, or skipped a broken one, and each command would fail on its own. It adds a public surface, every author writes the failure by hand, and it leaves a supervised service's silent fallback in place.
- **The bin reads the file a second time.** Rejected. `changelog check` would repeat the lookup with the shared JSON scanner and rebuild what `--config` and `--no-config` mean, which keeps a second lookup beside the plugin's.
- **`strict: ['paths']`.** Not chosen in grooming. A broken file and a rejected path would fail, and a malformed `postInstall` would still drop, so `init` would render an installer without the author's command. One rule for the whole file reads more simply.
- **Naming `--no-config` in the failure.** Not chosen in grooming. Correcting or removing the file is the fix nearly every time, and a CI failure that suggests skipping the configuration invites the silent pass this record removes. The `init` page names `--no-config` for the one case it serves.
- **Failing `changelog check` alone.** Not taken. `changelog write` and `build` act on the paths the file names, so a run on conventions writes or bundles the wrong files, which is worse than a check that passes.

## Consequences

A package whose `loom.config.json` is broken, or holds a value the schema rejects, now fails every `loom` command that reads it, where it ran on conventions before. That is breaking for such a package, and its fragment carries a Migration section. A package with no file, or a valid one, runs as before. The release workflow runs the published `loom` pinned under [ADR-0075](0075-the-release-workflow-runs-a-pinned-published-loom-cli.md), so this repository's release side picks the rule up only after a release and a reviewed pin move.

ADR-0130's clauses that a value the schema rejects is dropped and its convention applies, under **The file** and **The paths**, and that a broken file warns once and the run uses conventions, under **The file** and **A new application uses conventions**, are superseded, and so is its consequence that `init` in a package whose file does not parse writes the missing pieces after the warning. Its 2026-11-01 entry's note that `sharedVersion` is the one key whose rejected value does not fall back no longer holds: no rejected value falls back. [ADR-0131](0131-the-post-install-declaration-moves-from-the-application-into-loom-config-json.md)'s clause under **A key of the file** that a `command` the schema rejects is dropped and named at `-v`, leaving the script with no post-install command, is superseded too: it fails the run. ADR-0130 and ADR-0131 carry dated entries.

## Status

Accepted in 0.19.0.

## Changelog

- 2026-11-15: Proposed with the strict read of `loom.config.json` (LM-524). It supersedes ADR-0130's drop clauses, its broken-file clauses, and its consequence for `init` in a package whose file does not parse, and ADR-0131's drop clause for a rejected post-install command. ADR-0130 and ADR-0131 carry dated entries.
