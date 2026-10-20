---
type: adr
title: ADR-0099 - An assembly check from @loomcli/testing replaces loom check
description: loom check retires, and the loom bin does only what no standard tool does. @loomcli/testing ships an assembly check that bun test and vitest run, which throws an Error whose message is the Developer Diagnostic of each fault Application.check() returns. loom init writes the first test with a comment on why to keep it, and the scaffold's check script runs tsc --noEmit, the linter, and the test runner. Every other provision of ADR-0066 carries forward. It supersedes ADR-0066.
status: proposed
created: 2026-10-20
modified: 2026-10-20
---

# ADR-0099 - An assembly check from @loomcli/testing replaces loom check

## Context

[ADR-0066](0066-the-toolchain-acts-on-one-package-directory.md) gave the `loom` bin a `check` command. `loom check` imports the application module, runs the package's own TypeScript against its `tsconfig.json`, prints each fault `Application.check()` returns as its Developer Diagnostic, exits non-zero on any fault, and warns about a drifted managed file.

Each of those jobs already belongs to a standard tool an author runs. `tsc` checks types. The linter guides, under [ADR-0098](0098-lint-is-the-author-guidance-lane.md). A test runner verifies that the application assembles, in watch mode while the author works and in CI. `loom check` is a fourth command an author wires beside those three, and its type pass repeats `tsc`. Principle 6 has Loom follow a standard such as a test runner before it invents a mechanism, and principle 7 rules out a check framework of Loom's own.

## Decision

- **`loom check` retires.** The `loom` bin's public commands are `build`, `changelog check`, `changelog write`, and `init`. The `loom` bin does only what no standard tool does.
- **The assembly check.** `@loomcli/testing` ships an assembly check that a test calls with the Application. It runs under `bun test` and vitest. It returns when the application assembles, and otherwise throws an `Error` whose message is the Developer Diagnostic of each fault `Application.check()` returns, in order, so the test runner prints the diagnostics and fails the test. Its export names are settled when the package ships.
- **What it covers.** Like `inspect()`, it applies every build rule except passing declared defaults and implied values through their validators, which may answer asynchronously and read the run's host. A bad default therefore surfaces on the application's first run, which reports it. It also runs what `Application.check()` runs beyond the build rules: the input-schema converter check, whatever the release facts read, and every `onGraphBuilt` hook.
- **`Application.check()` stays.** It keeps ADR-0066's contract: it builds the graph with nothing run and returns the `DeclarationError`s as a list, and a build-rule fault ends the build and the list. The undescribed fault leaves the list under ADR-0098.
- **`loom init` writes the first test.** A new application gets a test that calls the assembly check, with a comment that says why to keep it: it is the check that the whole application assembles, so a fault only the assembled application reveals fails CI rather than the operator's first run. The scaffold's `check` script runs `tsc --noEmit`, the linter, and the test runner.
- **Drift warnings stay with `loom init`.** `loom init` warns about a drifted managed file when it re-renders, under [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md), and nothing fails for one.
- **A breaking change.** Retiring `loom check` is a breaking toolchain change. The implementing PR's fragment states the migration: add the assembly test and replace a `loom check` script with `tsc --noEmit`, the linter, and the test runner.

This record supersedes ADR-0066 whole. Every provision of ADR-0066 other than `loom check` is incorporated by reference, with its addenda:

- the `loom` bin acts on the package whose directory it runs in, never on a repository as a set of packages;
- it reads no configuration file;
- `loom build` builds one target per call and bakes the release facts, with `--target`, `--build`, `--watch`, `--release`, and `--application`, and carries the application module as a second bundle entry for `node` and `bun`;
- `--facts` and `--define` print the facts for a custom build;
- `Application.check()` is published in every authoring state, as `inspect()` is;
- release orchestration is out of scope, except the installer scripts [ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) adds to `loom init`;
- the rejected options other than those about `loom check`.

ADR-0066's rejection of failing on a drifted managed file moves with the drift warning to `loom init`.

## Considered options

- **Keep `loom check` beside the test.** Rejected. Two ways to verify one assembly drift apart, and the command's type pass repeats `tsc`.
- **A `loom test` command.** Rejected. The author's test runner already runs tests, in watch mode and in CI.

## Consequences

`@loomcli/testing` joins the release set. A maintainer publishes its `0.0.0` placeholder and binds its trusted publisher before the release cut that ships it, as `@loomcli/loom` joined. The toolchain reference loses `loom check`. [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md) carries a dated entry.

## Status

Proposed. It moves to accepted with the release that ships `@loomcli/testing` with the assembly check, retires `loom check`, and has `loom init` write the test and the new `check` script, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
