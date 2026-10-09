---
type: adr
title: ADR-0066 - The toolchain acts on one package directory
description: The loom bin of @loomcli/loom acts on the package whose directory it runs in, never on a repository as a set of packages, and reads no configuration file. loom build builds one target per call and bakes the release facts, which --facts and --define print for a custom build. loom check imports the application module, runs the package's own TypeScript, and reads every fault through Application.check(). Release orchestration is out of scope.
status: proposed
created: 2026-10-07
modified: 2026-10-09
---

# ADR-0066 - The toolchain acts on one package directory

## Context

`@loomcli/loom` publishes one surface, `@loomcli/loom/build`, and its commands serve the repository that develops Loom alone: the changelog compiler, the PR guards, and the release workflow, all hidden and all written for one synchronized set of libraries. An application author builds with a hand-written `Bun.build` script, checks declarations only by running the application, and versions the package by hand.

[ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md) moves the build fact into a define the build bakes, so something must bake it. [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) left real file and line to a later static check. `inspect()` throws the first declaration fault, and the undescribed check runs only inside `run()` and `app.invoke`, so no public call reports every fault without running the application.

Applications live in single-package repositories and in monorepos. A monorepo already has a tool that runs a command in each member, and every package manager reads a standard set of `package.json` fields.

## Decision

- **A `loom` bin.** `@loomcli/loom` gains a `loom` bin whose public commands are `build`, `check`, `changelog check`, `changelog write`, and `init`. The public contract is [the toolchain reference](../toolchain.md).
- **One package directory.** Every command acts on the package whose directory it runs in: the nearest `package.json` at or above the working directory. Loom never acts on a repository root as a set of packages and holds no list of shipped packages. A monorepo's own tool fans a command out, or the author runs it in each package.
- **No configuration file.** Every value is a command option, a convention, or a standard `package.json` field, and an option overrides the convention.
- **`loom build`, one target per call.** `--target` takes `node`, `bun`, or a Bun compile target `bun-<os>-<arch>[-variant]`, by default the host's compile target. A compile target writes a single binary, and `node` and `bun` a JavaScript bundle that carries the application module, by default `src/application.ts` or the one `--application` names, as a second entry, so an embedded caller or a test imports the built Application with its baked facts. The build bundles the package's dependencies, `@loomcli/core` included, so the define reaches core. `browser` is refused. Several targets take several calls, and cross-compiling and building on each platform are both the author's choice. `--build` takes `development` or `distributed`, by default `distributed`, `--watch` proxies to `bun build --watch` with `build: 'development'`, and `--release` adds the release group from `package.json` `version`, its `repository` field or `--repository`, and, for a compile target, the asset name from `bin` or `--name`. A failed build leaves earlier output in place.
- **Composable facts.** `--facts` prints the facts JSON and `--define` the define pair, and each builds nothing. `loom build` computes its own facts with the same code, so an author who needs a bundler `loom build` does not drive bakes the same facts with it.
- **`loom check`.** It imports the application module, by default `src/application.ts`, finds the exported Application by type, and never imports the entry. It runs the package's own installed TypeScript against the package's `tsconfig.json`. The compiler resolves from the package directory, so a `typescript` hoisted to a monorepo root counts, and the type pass is skipped with a note when no compiler resolves or the package has no `tsconfig.json`. It reads every fault `Application.check()` returns and prints each as its Developer Diagnostic, exiting non-zero on any fault. It warns about a drifted managed file and never fails for one. File and line for a finding come in a later contract.
- **`Application.check()`.** Core gains one method, published in every authoring state as `inspect()` is. It builds the graph with nothing run, runs every check a development run makes before routing that needs no host and no await, whatever the release facts read, and returns the `DeclarationError`s as a list instead of throwing the first. A build-rule fault ends the build and the list. Past a built graph, it collects each failing converter, the undescribed fault, and each rejecting or broken `onGraphBuilt` hook. It does not validate declared defaults or implied values, as `inspect()` does not, because that validation is asynchronous and reads the run's host, so a rejected default is the one fault a development run reports before routing that `check()` leaves out.
- **Orchestration is out of scope.** PR guards, publishing to npm or GitHub, prerelease lanes, release workflows, installer scripts, and cuts across several packages are designed separately. The repository that develops Loom keeps its hidden release commands, and a public command owns any path it shares with one.

## Considered options

- **A configuration file.** Rejected. Every value it would hold already has a home: an option for a choice that varies per call, a convention for the common case, and a standard `package.json` field for what describes the package. A file adds a second place to look and a format to version.
- **Acting on a repository as a set of packages.** Rejected. Loom would need a list of shipped packages and an order among them, which a monorepo's own tool already owns, and a single-package repository would carry machinery it never uses.
- **Several targets in one call.** Rejected. Each target is one artifact with its own output path and asset name, a failed target would leave the set half-built, and a shell loop or a CI matrix runs several calls already.
- **`loom build` as the only way to bake the facts.** Rejected. An author who needs splitting, a second entry, or another bundler would lose the facts, so the facts print for any build to compose.
- **`loom check` importing the entry.** Rejected. The entry calls `run()`, so importing it runs the application.
- **A TypeScript bundled with `loom`.** Rejected. Its version would differ from the one the author's editor and build use, and two compilers disagree on a release boundary.
- **Failing `loom check` on a drifted managed file.** Rejected. An edited guide is the author's choice, and a check that fails for it trains the author to delete the header rather than read the warning.
- **A second `inspect()` mode that collects faults.** Rejected. `inspect()` returns the graph, and a fault list is a different answer. One method per job keeps both types plain.

## Consequences

`@loomcli/loom` gains the `loom` bin and Bun as a requirement of `loom build` and `loom check`, under [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md)'s Bun-first workflow. The examples build with `loom build`.

`Application.check()` is a third door to the build rules beside `inspect()` and `run()`. It changes no moment [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) assigns: a fault at a call or an attach still throws while the module loads, and `inspect()` and `run()` still report the first build fault.

## Status

Proposed 2026-10-07 with the contracts in [the toolchain reference](../toolchain.md) and [Checking the declarations](../core.md#checking-the-declarations). It moves to accepted inside the release PR of the release that ships the implementation: the `loom` bin acting on one package directory, `loom build` and `loom check` as specified, `Application.check()`, and the acceptance in those sections, under Node and Bun.

## Changelog

- 2026-10-07: Proposed with the toolchain contract.
- 2026-10-09: A `node` or `bun` bundle carries the application module as a second entry beside the entry, split into shared chunks, and `loom build` gains `--application`, with the default `loom check` reads, so an embedded caller or a test imports the built Application with its baked facts. A missing `src/application.ts` leaves the entry alone, a missing module `--application` names fails the build, and a compile target compiles the entry alone. The record stays proposed.
