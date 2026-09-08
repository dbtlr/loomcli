---
type: adr
title: ADR-0014 - Acceptance evidence runs against the packed package through the public API
description: The example applications are the acceptance surface. They use only public core APIs, resolve core through the packed package, and run as real processes under every supported runtime. Passing tests alone do not accept a deliverable.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0014 - Acceptance evidence runs against the packed package through the public API

## Context

A framework's contract is what a consumer receives from the registry, not what its own tests can reach inside the workspace.

The `textstat` and `jsonkit` examples are the acceptance surface. They use only public core APIs, resolve core through the packed package's exports and emitted declarations rather than workspace source aliases, and run as real processes under Node and Bun on macOS, Linux, and Windows. A type consumer compiles against the packed declarations. Process fixtures drive the built examples through the public API.

A deliverable is not accepted because its tests pass. Its SDK syntax must also be acceptable on human review, because the authoring surface is the product.

## Considered options

- **Internal-reaching tests.** Rejected. A test that imports a private module proves the module, not the package a consumer installs.
- **Wrapper reimplementations of routing or parsing inside tests.** Rejected. A wrapper tests the wrapper.
- **Document-only claims of compatibility.** Rejected. A runtime or platform is supported when the examples run on it, not when a document says so.

## Consequences

Adding a runtime or platform to the support statement means adding it to the executable evidence first. A change that the examples cannot exercise needs a new example increment or a public-API fixture before it is accepted.
