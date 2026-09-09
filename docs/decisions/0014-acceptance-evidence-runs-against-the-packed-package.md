---
type: adr
title: ADR-0014 - Acceptance evidence runs against the packed package through the public API
description: The example applications are the acceptance surface. They use only public core APIs, resolve core through the packed package, and run as real processes under every supported runtime. Passing tests alone do not accept a deliverable.
status: accepted
created: 2026-09-07
modified: 2026-09-09
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

## Changelog

- 2026-09-08: The runtime check that ran the examples against packed tarballs was retired with the publication layer. `packages/core/tests/check-types.mjs` still compiles a consumer against the packed declarations. The examples now run as processes against the workspace build. The decision is unchanged.
- 2026-09-08: [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md) proposes narrowing the Context sentence that has the examples resolve core through the packed package. That sentence is historical since the entry above. Under ADR-0016, packaging is proved by a runtime consumer that installs the packed tarball on Linux under Node and Bun, and behavior is proved by the examples against the workspace build on every supported platform. The narrowing binds when ADR-0016 is accepted; the decision text stays as written because accepted language changes only by supersession.
- 2026-09-08: Windows left the CI matrix. The examples now run as processes under Node and Bun on macOS and Linux only, and the support statement narrows to match, as this record requires. The platform list in Context is historical.
- 2026-09-09: [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md) is accepted, so the narrowing recorded on 2026-09-08 binds: `pnpm check:packed` proves packaging with a runtime consumer on Linux under Node and Bun on every PR and before every publication, and the examples prove behavior against the workspace build on every supported platform.
