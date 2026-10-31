---
type: adr
title: ADR-0131 - The post-install declaration moves from the Application into loom.config.json
description: postInstall leaves core's ApplicationOptions and the built graph and becomes a top-level key of loom.config.json with the same message and command. loom init's install piece reads it from the file and no longer loads the application module. No check that the words route survives, in core, in the assembly check, or in init, and @loomcli/core/post-install-unrouted retires. The installer script's behavior is unchanged. A breaking change for every author who declares postInstall. It supersedes ADR-0113's core option, its development check, and init's read of the module.
status: proposed
created: 2026-10-31
modified: 2026-10-31
---

# ADR-0131 - The post-install declaration moves from the Application into loom.config.json

## Context

[ADR-0113](0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md) put the post-install message and command on core's `ApplicationOptions`. Core carries the declaration on the built graph and never acts on it at run time; its one reader is `loom init`, which loads the application module to learn it and renders it into `install.sh`. ADR-0113 rejected a `package.json` key as "a configuration file in another form", which the toolchain's no-file rule ruled out, and an `init` option because a run without it would drop the command. [ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) gives the toolchain a file, so the declaration can sit beside the installer's location, the other fact only the installer reads. The owner: "It shouldn't be in the application, it only landed there because config didn't exist yet."

## Decision

- **A key of the file.** `loom.config.json` holds `postInstall`, an object of `message`, a string, and `command`, a non-empty array of strings, each optional, with ADR-0113's meaning: the message prints last, and the command is the words an operator types after the application's name. A `postInstall` with neither member declares nothing. The plugin's rules for a value the schema rejects apply, so a `command` that is not a non-empty array of strings is dropped and named at `-v`, and the script then has no post-install command.
- **It leaves core.** `ApplicationOptions` loses `postInstall`, and the built graph loses the fact, so `inspect()` no longer reports it.
- **Init reads the file.** The piece `install` reads `postInstall` through `provided.config` with the rest of the file, so it no longer loads the application module. The install piece's warnings for a module that cannot be loaded or exports no Application, and its failure for a declaration fault, go with that read. The entry piece still loads the module to learn how the entry imports the Application.
- **No routing check.** Nothing checks that the words route to a Command with an action: not core in a development build, not `check()` or the assembly check, and not `init`. `@loomcli/core/post-install-unrouted` retires. Words that route nowhere fail on the operator's install through the script's failure path, which says the application is installed and prints the command to run again. The owner: "Don't over test."
- **The script is unchanged.** Every rule ADR-0113 gives the installer script stands: the command runs once after the record and the PATH advice, its stdin is the operator's terminal or none, a failure warns and the script exits 0, `--skip-post-install` skips it, the message prints last, self-update never runs it, and an application's own file in the installation record is its own.

## Considered options

- **Keeping the declaration on the Application.** Rejected. Core would carry a fact only the toolchain reads, apart from the installer location that now lives in the file.
- **The assembly check reading `loom.config.json` to keep the routing check.** Rejected by the owner. `@loomcli/testing` would read the toolchain's file, a second reader for one check.
- **A routing check in `loom init`.** Rejected. It would load the application module on every run that writes `install.sh`, which the move removes, and ADR-0113 already found that an author who renames a Command without re-running init would not see it.

## Consequences

This is a breaking change for every author who declares `postInstall`, Mimir among them: `new Application(name, { postInstall })` no longer compiles. The migration moves the same value into `loom.config.json` and re-runs `loom init --only install`, which renders the same script. [Application declarations](../core/application.md), [Graph inspection](../core/graph-inspection.md), [Installation record](../core/installation-record.md), [loom init](../toolchain/init.md), [The installer script](../toolchain/install.md), [@loomcli/testing](../libs/testing.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships the move.

## Changelog

- 2026-10-31: Proposed with the toolchain configuration contract (LM-434). It supersedes ADR-0113's core option, its development check that the words route and `check()`'s run of it, its rule that init loads the application module to read the declaration, and its rejection of "a check only in `loom init`", which gives way to no check. ADR-0113 carries a dated entry.
