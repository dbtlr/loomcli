---
type: adr
title: ADR-0141 - A validator pipe runs a first validator, then steps that read its output, and publishes the first validator's input schema
description: '`@loomcli/validators` exports `pipe(first, ...steps)`. `first` is any Standard Schema value and reads what core hands the input; each of one to eight steps is a Standard Schema value whose input type accepts the previous output, or a parse function that receives that output and the validation context. `first` and each step are the pipe's stages. The first rejection ends the pipe with that stage's issues unchanged, and the pipe answers synchronously unless a stage answers with a promise. The pipe publishes exactly what `first` publishes and adds no message, code, or fault of its own. This supersedes ADR-0037''s rejection of a composition utility.'
status: proposed
created: 2026-11-09
modified: 2026-11-09
---

# ADR-0141 - A validator pipe runs a first validator, then steps that read its output, and publishes the first validator's input schema

## Context

An author who needs `integer({ min: 1 })` and one more rule, such as an even number, today rewrites the integer parse inside their own `createValidator`, because a catalog validator reads a raw string and no catalog value accepts the number another one produced. An author who wants a typed value transformed once more, such as a comma list split after `text()` checks its length, does the same.

[ADR-0037](0037-validators-ship-in-their-own-package-as-standard-schema-values.md) rejected a composition utility because "composition waits for a use no factory option covers", and its 2026-10-13 entry repeats that no pipe or composition factory joins the catalog. Waiting for a request is no longer a reason. [Principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write) makes defining an application Loom's part, and [principle 6](../principles.md#6-standards-before-inventions) has it follow the shape the ecosystem already shares: Valibot's `pipe`, Typanion's `cascade`, and Zod's `.pipe` each let an author follow a parse with further checks, and a command-line author who adds one rule to a catalog validator meets the same need.

Several facts already fit the change.

- **One parse shape.** `createValidator`'s `parse` receives one raw string and the validation context and returns a Standard Schema result, `{ value }` or `{ issues }`, directly or as a promise.
- **The context channel.** Core attaches the validation context to every validator call through the Standard Schema options argument under [ADR-0005](0005-validation-delegates-to-standard-schema.md), and a value that ignores the argument is unaffected.
- **The published schema.** Core asks a validator that implements Standard JSON Schema for its input-side schema once at graph build under [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md), and a published input schema is sound, never stricter than the validator, under ADR-0037.
- **No rule for what the types reject.** A value that bypasses the types meets the platform's own error under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).

## Decision

- **The export.** `@loomcli/validators` exports `pipe(first, ...steps)` from its root. The value it returns is a validator pipe: an ordinary Standard Schema value with `vendor` `'@loomcli/validators'` and `version` 1 that, like a catalog validator, carries no `types` and holds no state between calls, so one pipe may serve many inputs, and on a multiple option or a variadic argument it checks each value under [ADR-0036](0036-each-value-passes-the-same-validator.md).
- **The first validator.** `first` is any Standard Schema value: a catalog validator, a `createValidator` value, a schema library's value, or another pipe. It receives what core hands the input, and the pipe's input type is `first`'s, so a `first` whose input type accepts `undefined` may sit beside `validateOmitted: true`.
- **Steps.** `first` and each step are the pipe's stages. A pipe takes one to eight steps, each typed by its own overload. A step is either:
  - a Standard Schema value whose input type accepts the previous stage's output, or
  - a parse function, `(value, context) => { value } | { issues }`, returning directly or through a promise, as `createValidator`'s `parse` does, whose `value` is the previous stage's output, typed without an annotation.

  The types check the direction of a schema step's fit: the previous output must be assignable to the step's input type, so a step whose input is narrower than that output is a type error, such as `pipe(text(), z.enum(['a', 'b']))`, or a catalog step after a `first` whose output may be `undefined`, which would otherwise read `undefined` as the string `'undefined'`. The schema value being assignable to `StandardSchemaV1<Previous>` is not the test, because Standard Schema's input type is covariant and would let a narrower step through. After an output of type `unknown`, a schema step's fit is not checked, because TypeScript reads a step before it infers a function step's output, and checking an `unknown` output would reject every schema step after a parse function. A step may check or transform. The pipe's output type is the last step's output: a schema step's output type, or the `value` of a parse function's accepting branches. A chain longer than eight steps nests a pipe as one step or as `first`.
- **Running.** The pipe calls `first` and then each step in order, each on the previous stage's accepted value.
  - A schema stage receives the Standard Schema options the pipe received, so core's validation context reaches it.
  - A parse function receives the validation context the options carry. When the call came from outside a run, it receives the same context `createValidator` gives there, whose every field throws a `DeclarationError` under `@loomcli/validators/context-outside-run` when read.
  - The first stage that answers `{ issues }` ends the pipe, and the pipe answers that result unchanged, with its messages, codes, and paths. A later stage never runs.
  - A stage that throws, or answers with a promise that rejects, throws or rejects from the pipe unchanged. This holds for author code and for a catalog stage alike, such as `path` failing a probe with `EIO`, and core reports the throw as a validator failure under [Issues and validator failures](../core/validation.md#issues-and-validator-failures); the pipe adds no catch.
  - The pipe answers synchronously when every stage that ran answered synchronously, and with a promise once any stage answers with one.
- **Publishing.** When `first` implements Standard JSON Schema, the pipe implements it too, and its `input(options)` returns what `first`'s `input(options)` returns for the same options, or throws what it throws, so the pipe publishes the targets `first` publishes. The published schema is as sound as `first`'s, because every token the pipe accepts passed `first`. `output` throws for every target, as a catalog validator's does, because the output side is the action's business. When `first` publishes nothing, the pipe publishes nothing, and the input schema reads `null`. `pipe` takes no schema of its own: an author who wants a richer published schema states it on `first` through `createValidator({ parse, inputSchema })`.
- **Messages, codes, and faults.** The pipe adds no message and no issue code. Each catalog stage keeps its own sentence and code under [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md), and an author's stage owns its sentence, which follows [Failure messages](../core/failures.md). The catalog rule that one factory configuration answers every rejection with one sentence binds each catalog validator, not a pipe of them, so `pipe(integer({ min: 1 }), even)` answers with `integer`'s sentence for `abc` and the step's sentence for `3`. `pipe` declares no declaration fault: a missing step, a step that is neither a schema nor a function, and a step whose input does not accept the previous output are type errors, and a value that bypasses the types meets the platform's own error.

The signature, the published schema, and examples are the contract in the [validators reference](../libs/validators.md#pipe).

## Considered options

- **A union combinator beside `pipe`, such as `either(ip(), host())`.** Rejected. Its published schema, an `anyOf` of the members, would be sound, but its rejection would need one sentence built from the members' sentences, a rule the catalog does not have. The union a command line commonly needs, a host name or an IP address, is a factory option such as `host({ ip: true })`, which the catalog can state in one sentence.
- **Methods on validator values, such as `integer().check(isEven)`.** Rejected. A catalog value would stop being a plain Standard Schema object, which ADR-0037 keeps so core cannot tell a catalog validator from a schema library's value.
- **Standard Schema steps only, with a second factory that turns a function into a typed schema.** Rejected. It adds a second construction beside `createValidator` for the same job, while a parse function step reuses `createValidator`'s `parse` shape and a Zod user loses nothing.
- **A published schema of the pipe's own, as a `pipe` option or a `describeInput(validator, schema)` wrapper.** Rejected. Each is a second way to do what `createValidator` with `inputSchema` already does, under the same soundness burden. A schema library that implements Standard JSON Schema, as Zod 4 does, already publishes through core's channel, and one that does not is wrapped in `createValidator` whose `parse` calls the library's `validate`.
- **One variadic signature over a recursive tuple type, with no step limit.** Rejected. A recursive tuple can check that each schema step fits the previous output, but TypeScript then gives a parse function's `value` no contextual type, so every function step would need an annotation. Eight typed overloads keep `value` typed, and nesting covers a longer chain.

## Consequences

- An author follows a catalog validator with their own rule in one call, and help, the manifest, and every other projection keep reading the catalog validator's published schema.
- A pipe can answer with more than one sentence across its rejections, one per stage, which a catalog factory never does.
- ADR-0037's clause that rejects "a combinator for multiple options and variadic arguments, and a composition utility" is narrowed by this record: the composition utility is no longer rejected, and the combinator for multiple options and variadic arguments stays rejected under ADR-0036. ADR-0037's 2026-10-13 sentence that no pipe or composition factory joins `dateTime` and `duration` is superseded by this record. ADR-0037 remains accepted for every other clause and carries a dated entry.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-09: Proposed with the contract for `pipe` (LM-485). It narrows ADR-0037's rejection of a composition utility and supersedes its 2026-10-13 sentence on `pipe`, and ADR-0037 carries a dated entry.
