---
type: adr
title: ADR-0103 - Process acceptance comes from Loom's own pipeline and the packed consumer
description: Proof that Loom works as a real process comes from Loom's own pipeline, which runs the loom CLI on every check, PR guard, and release, and from the packed consumer, which runs what an author installs under Node and Bun on Linux and macOS. A process test covers only what a process has; everything else, the example applications included, runs in-process, and each runtime's CI job runs the suite under that runtime. Acceptance evidence still uses only the public API. It supersedes ADR-0014.
status: accepted
created: 2026-10-21
modified: 2026-10-21
---

# ADR-0103 - Process acceptance comes from Loom's own pipeline and the packed consumer

## Context

[ADR-0014](0014-acceptance-evidence-runs-against-the-packed-package.md) makes the example applications the acceptance surface and has them run as real processes under Node and Bun on every supported platform. Its dated entries, with [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md), add a runtime consumer that installs the packed tarballs, on Linux only.

Each child process costs 125 to 420 ms to start. A CI run takes a median of 877 s, nearly all of it in tests, and 190 of 239 test files start children, which hold 1,840 s of the 1,891 s the tests take on Linux under Node. Most of those children prove nothing a test worker could not: a fixture such as the configuration plugin's already calls `application().run({ host })` and runs as a separate script only because it reads `process.argv` and `process.env` at the top of the file.

Two sources of process evidence now exist that ADR-0014 did not have:

- **Loom's own pipeline runs the shipped CLI as a process.** `pnpm check` runs the workspace `loom` bin's `loom build` on the textstat and jsonkit examples and `loom changelog check`. The PR guard runs `loom pr check`, and the release workflow runs the published `loom release plan` and `loom release record` under [ADR-0075](0075-the-release-workflow-runs-a-pinned-published-loom-cli.md).
- **`pnpm check:packed` runs what an author installs.** It installs the packed tarballs into a consumer, compiles against their declarations, lints them, and runs the consumer's entries and a `loom build` bundle as processes under Node and Bun. That is closer to an author's application than the examples, which run against the workspace build.

## Decision

- **Real-process acceptance comes from the pipeline and the packed consumer.** Loom's pipeline runs the `loom` CLI as a process on every check, PR guard, and release, and `pnpm check:packed` runs the packed consumer as processes under Node and Bun on every CI platform, Linux and macOS, and before every publication.
- **A process test proves only what a process has.** A test starts a child process only for a behavior an in-process run cannot show: a signal and its exit code, a raw or pseudo-terminal, a real shell sourcing a script, MCP framing over stdio, bundling and the release facts a build bakes, `process.exitCode`, or a removed working directory.
- **Everything else runs in-process.** A test runs an Application through `run({ host })` or `invoke`, with the host facts it needs supplied as data. The example applications run in-process too: they show authoring syntax, and none keeps a process role.
- **Runtimes are a CI matrix axis.** Each runtime's CI job runs the suite under that runtime, once under Node and once under Bun, and a test does not loop over runtimes itself. The Bun jobs do not yet run the suite under Bun, and Consequences states that gap.
- **Evidence uses only the public API.** Acceptance evidence reaches Loom through public APIs, and a type consumer compiles against the packed declarations.
- **Passing tests alone do not accept a deliverable.** Its SDK syntax must also be acceptable on human review, because the authoring surface is the product.
- **Support follows the evidence.** Adding a runtime or platform to the support statement means adding it to the CI matrix, and to `check:packed`, first. A change the examples cannot exercise needs a new example increment or a public-API fixture before it is accepted.

This record supersedes ADR-0014 whole and keeps its other provisions, stated above and under Considered options.

## Considered options

- **Keep the examples as process tests.** Rejected. A process run of an example proves what `check:packed` and the pipeline already prove, against the workspace build rather than what an author installs, at the cost of most of CI's time.
- **Internal-reaching tests.** Rejected, as in ADR-0014. A test that imports a private module proves the module, not the package a consumer installs.
- **Wrapper reimplementations of routing or parsing inside tests.** Rejected, as in ADR-0014. A wrapper tests the wrapper.
- **Document-only claims of compatibility.** Rejected, as in ADR-0014. A runtime or platform is supported when CI runs it, not when a document says so.
- **A test runner per runtime, such as `bun test` under Bun.** Rejected. vitest can run the suite under both runtimes with one runner and one testing API, and `bun test` ran no faster on the in-process files.

## Consequences

The process tests that do not prove a process-only behavior move to in-process runs through `run({ host })` or `invoke`, package by package, and the tests that loop over Node and Bun themselves lose their loops. Until a package moves, its process tests stay and keep passing. `pnpm check:packed` runs on the macOS jobs as well as the Linux ones, so macOS keeps process evidence once the example process tests go.

Today vitest runs under Node in both CI jobs, and the Bun jobs select Bun only for the child processes a process test starts. Until the Bun jobs run the suite under Bun, a test that moves in-process runs under Node alone, and Bun's evidence for that behavior is the packed consumer and the process tests that remain.

## Status

Accepted on merge. It governs Loom's own test suite and CI, which no release ships, so it binds from the merge rather than from a release cut.

## Changelog

- 2026-10-21: Accepted. ADR-0014 moves to superseded in the same change, and [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md), proposed, no longer restates the evidence rules this record holds.
- 2026-10-21: The Bun jobs run the suite under Bun through `pnpm verify:bun`, test workers included, so the gap Consequences states is closed: a test that moves in-process runs under Node in the Node jobs and under Bun in the Bun jobs. `LOOM_TEST_RUNTIME` names the runtime of the whole suite, and a test fails when a worker runs on another. The decision is unchanged.
