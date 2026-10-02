---
type: adr
title: ADR-0053 - A declared default nests at most ten levels
description: No path through a declared default may hold more than 10 arrays and plain objects, counted from the default itself, with a path ending at a container it already passed through. The declaring call checks it while it takes its one copy and raises @loomcli/core/default-depth for a deeper default. The cap is an internal constant, so raising it later relaxes a rule and breaks no application.
status: proposed
created: 2026-10-02
modified: 2026-10-02
---

# ADR-0053 - A declared default nests at most ten levels

## Context

A declaring call snapshots its default, and the graph publishes that copy to every reader: the run's validator, `inspect()`, help, the manifest, and the request a middleware holds. Each reader walks the copy recursively, so a default nested deeply enough overflows the call stack. Where it overflows depends on the reader and the runtime: the snapshot overflowed near 2,000 nested arrays under Node and near 20,000 under Bun, and each reader's walk spends the stack at its own rate. A default just shallow enough for the declaring call could still break a later reader, such as the manifest, and the same application could pass on one runtime and fail on another.

The overflow also surfaced as `@loomcli/core/unreadable-declaration`, `Option "deep" config could not be read: Maximum call stack size exceeded.`, whose correction to declare properties that read without throwing does not fix it.

No real default needs depth. A default stands in for a value an operator supplies, and the deepest one an application plausibly declares is a small settings object a few levels deep. A deeply nested default comes from a mistake, such as a builder that never stops or a linked structure built in a loop.

## Decision

- **The cap.** No path through a declared default holds more than 10 arrays and plain objects. The default itself is level 1, so `'plain'` holds none, `['a']` holds 1, and `{ a: ['b'] }` holds 2.
- **Paths, not first visits.** A container the default holds twice counts on every path through it, so a list of lists that each hold the one before is as deep as its longest chain, even though each list is first reached one level down. A path ends at a container it already passed through, so a cycle counts each of its containers once.
- **When it throws.** The declaring call takes its copy of the default up to the cap and stops there, so the walk never goes deeper than 10 levels on any runtime. Under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) the fault throws from that call: `argument()`, `option()`, `globalOption()`, an input a lifecycle hook declares, and `plugin()` for an option it declares. It is judged with an unreadable read, before every other rule on the config.
- **Its own rule.** The fault is `@loomcli/core/default-depth`: `Option "deep" default nests deeper than 10 levels.`, corrected by `Nest a default at most 10 levels deep.` The finding marks the default and prints it elided.
- **An internal constant.** The value is a constant inside core, not an Application or input option, as [ADR-0035](0035-a-command-path-nests-at-most-two-levels-below-the-root.md) keeps the Command nesting cap.
- **Defaults alone.** A converter's input schema is snapshotted without the cap, as [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md) states, because a JSON Schema routinely nests deeper than a default does.

## Considered options

- **Catch the overflow and reword it.** Rejected. The depth that fails still depends on the runtime, and a default that passes the declaring call can still overflow a reader that needs more stack.
- **A cap near the stack, such as 100 or 1,000.** Rejected. It leaves the readers' margin to chance on the smallest stack Loom runs on, and no real default comes near it.
- **Count each container where the walk first reaches it.** Rejected. A list of shared lists passes that count at level 2 while `JSON.stringify` walks every path through it.

## Consequences

A default deeper than 10 levels fails at its declaring call, where 0.6.0 accepted one shallow enough for the runtime's stack. That is a breaking change, and the implementation records it with its migration: flatten the default, or move deep structure into the action.

## Status

Proposed with the implementation. It moves to accepted once a release ships the cap.

## Changelog

- 2026-10-02: Proposed with the implementation. A declaring call takes its copy of the default through a walk that records how deep each filled container reaches and stops at the cap, and `plugin()` raises the same rule for an option it declares.
