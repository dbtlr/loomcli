---
type: adr
title: ADR-0006 - Absence is decided by the declaration, and invalid input never falls back to a default
description: An omitted optional value skips its schema unless it declares validateOmitted, a collection always runs its schema, presence rules live in validation, and a rejected value fails the invocation.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0006 - Absence is decided by the declaration, and invalid input never falls back to a default

## Context

Defaults, omission, and rejection interact, and each framework picks a posture. Loom's posture is that the declaration decides absence and that an operator never receives a silently substituted value.

- An omitted optional scalar with no default is `undefined` and its schema is not called.
- A declared default is stated in the schema's input type and passes through the schema like a supplied value. Defaults are validated once, before any token is parsed, and are not cached across invocations.
- An optional scalar that declares a schema and no default may set `validateOmitted: true`. Core then calls the schema with `undefined` in the invocation phase, with the full validation context, so an omission rule such as "a file or piped stdin" lives in the schema. A returned issue is an ordinary input issue with exit 2, named by the spelling an operator would type.
- A multiple option or variadic argument always runs its schema, and omission is the validated output of `[]`. An empty tail is an accurate empty collection.
- A rejected value is an input error with exit 2 and no dispatch. A default never substitutes for invalid input.

## Considered options

- **Re-validating every default at invocation time.** Rejected. It would let `default: undefined` express the omission rule, but it changes default semantics for every declaration to serve one case. `validateOmitted` is opt-in per declaration.
- **Skipping the schema for an omitted collection.** Rejected. A transforming schema's declared output type would then be a lie for the omitted case, since the action would receive `[]` where the type promised the transformed shape.
- **Presence rules inside the action.** Rejected. An action that checks the terminal exits 1 after dispatch, where the same rule in validation exits 2 before it. The action streams from whichever source validation selected and reads no terminal fact of its own. `-` is an ordinary filename, not a stdin operand.
- **Lenient invalid input that falls back to the default and records the fallback as a queryable fact.** Rejected. It was the earlier specification's posture. An operator who typed a bad value must see the rejection, not a silently different run.

## Consequences

`validateOmitted` beside `required`, a default, `multiple`, `variadic`, a Boolean type, or no schema is a compile error and a declaration error. A schema's input type must accept `undefined` when the flag is set, the same way a declared default must satisfy the input type.
