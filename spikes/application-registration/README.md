---
description: Location of the executable evidence for Application registration and library extension configuration.
---

# Application registration evidence

The preliminary compiler model has been replaced by checks against the actual SDK.

- `pnpm check:types` compiles isolated Application projects against workspace and packed declarations. It compiles a neutral library first, then tests consumer enrichment, extracted handlers, global output types, plugin tuple types, attachment failures, and exact negative diagnostics.
- `pnpm check:packed` compiles and runs a separate library and registered Application against installed core and plugin tarballs under Node and Bun. The consumer replaces the library's help details through the real help plugin.
- `packages/core/tests/automatic-globals.test.ts` checks validated Application globals at a detached action.
- `packages/core/tests/extended-command.test.ts` checks immutable replacement, typed reads, retained facts, invocation, and invalid layers.

The governing contracts are [ADR-0026](../../docs/decisions/0026-applications-declare-global-options-through-a-fluent-method.md) and [ADR-0025](../../docs/decisions/0025-completed-commands-accept-immutable-extension-configuration.md).
