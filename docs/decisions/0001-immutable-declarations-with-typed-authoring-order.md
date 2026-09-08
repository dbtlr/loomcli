---
type: adr
title: ADR-0001 - Commands are immutable values with a typed authoring order
description: Every authoring call returns a new declaration value, and the calls a value still offers are part of its type, so authoring order is a compile-time rule.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0001 - Commands are immutable values with a typed authoring order

## Context

A Command is authored in its own module and composed into an Application elsewhere. Authors export declarations, extract handlers with `ActionHandler<typeof declaration>`, and attach one child under different roots in tests and examples. Two properties make that composition safe.

**Every authoring call returns a new value and never changes its receiver.** `argument()`, `option()`, `alias()`, `command()`, and `action()` all follow this rule. A Command names neither its parent nor its Application, and nothing registers by side effect. Moving a Command changes its path and its projections only, never its handler contract. The collected declarations stay private, so no consumer can read or replace them.

**The calls a declaration still offers are part of its type.** `argument()` removes `command()` and `command()` removes `argument()`, because one Command declares arguments or attaches children, never both (ADR-0004). `action()` removes every declaration call. Declare inputs, attach children, then register the action last. Graph build repeats the same rules for JavaScript authors.

## Considered options

- **Mutating builders.** Rejected. Review found that `base.command(get)` would silently change `base`, so a shared declaration could not be forked and every exported Command became a hidden global.
- **Authoring order as documented advice.** Rejected. A handler that type-imports its own declaration is resolvable only when `action()` is the outermost call in the chain. TypeScript resolves a variable's declared type from that call without checking its arguments, so a handler passed to an inner call reports a circular reference. Making the order a type rule turns that failure into a clear compile error.

## Consequences

The value a call returns is the only one that holds the call's effect, so an author keeps the returned value. A fourth type parameter on `Command` and `Application` lists the remaining calls, and it defaults to `never` so a declaration in any state is accepted where no state is required.
