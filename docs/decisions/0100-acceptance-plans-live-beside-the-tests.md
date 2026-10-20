---
type: adr
title: ADR-0100 - Acceptance plans live beside the tests
description: Acceptance evidence still runs against what a consumer installs, through the public API, under Node and Bun. Acceptance plans move out of the core reference into the test suites that prove them, and each example application's README states what that example covers. Support that no CI entry runs is not shipped. It supersedes ADR-0014.
status: proposed
created: 2026-10-20
modified: 2026-10-20
---

# ADR-0100 - Acceptance plans live beside the tests

## Context

[ADR-0014](0014-acceptance-evidence-runs-against-the-packed-package.md) makes the example applications the acceptance surface and holds acceptance evidence to the public API. Its dated entries, with [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md), settle how that evidence runs today: `pnpm check:packed` installs the packed tarballs into a runtime consumer on Linux under Node and Bun, compiles it against the packed declarations, and lints the tarballs, and the examples run as processes against the workspace build on every supported platform.

The record says nothing about where an acceptance plan is written, and the plans landed in the core reference. Most contract sections there end in an acceptance list, and those lists are a large share of the reference. A plan in the reference is a second statement of what the tests prove, read by nobody who runs the tests, and it drifts from them. It also teaches that every rule needs a written plan, where principle 8 says a test states a behavior someone relies on and reaches it through the public surface.

Examples also repeat behavior the unit tests already prove, so an example's own coverage is hard to read from its tests.

[ADR-0011](0011-bun-first-workflow-with-a-portable-core.md) already states support only from executable evidence. Code exists that no CI entry runs: the Windows branches of the completion plugin run only under a faked platform in unit tests, because no CI runner has Windows.

## Decision

- **Evidence runs against what a consumer installs.** Acceptance evidence uses only public APIs. Packaging is proved by a runtime consumer that installs the packed tarballs under Node and Bun, compiles against the packed declarations, and lints the tarballs. Behavior is proved by the example applications and by public-API fixtures, which run as real processes under Node and Bun on every supported platform. A type consumer compiles against the packed declarations.
- **Passing tests alone do not accept a deliverable.** Its SDK syntax must also be acceptable on human review, because the authoring surface is the product.
- **Acceptance plans live beside the tests.** The reference states rules. The plan that proves a contract lives in the test suite that runs it, written where the tests are. The core reference and the other references carry no acceptance lists once their suites hold the plans.
- **Each example states its coverage.** Each example application's README states what that example exercises. An example tests what it alone shows, such as a process run of the built application or a behavior that only assembly reveals, and leaves to unit tests what they already prove.
- **Unverified support is not shipped.** Code that no CI entry runs comes out until a CI entry runs it, as ADR-0011 already requires of a support claim. A platform branch exercised only under a faked platform is not evidence.

This record supersedes ADR-0014 whole. Its other provisions are incorporated by reference, with its addenda: the rejection of tests that reach internal modules, of wrapper reimplementations of routing or parsing, and of document-only compatibility claims; the rule that adding a runtime or platform to the support statement means adding it to the executable evidence first; and the rule that a change the examples cannot exercise needs a new example increment or a public-API fixture before it is accepted.

## Considered options

- **Keep the plans in the reference.** Rejected. A plan that nobody running the tests reads drifts from the tests, and it doubles the length of every contract.
- **Keep unverified code behind a support note.** Rejected. A note does not run, and the code it marks fails nowhere when it breaks.

## Consequences

The acceptance lists leave the reference in the documentation restructure, once each suite carries its plan. Example tests that repeat unit tests come out. The Windows install branches of the completion plugin come out under [ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md).

## Status

Proposed. It moves to accepted with the release that moves the acceptance plans beside their tests and gives each example's README its coverage, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
