---
type: adr
title: ADR-0036 - Each value of a multiple option or variadic argument passes the same validator
description: On a multiple option or a variadic argument, `validate` names the validator for one value. Core runs it on each value, reports each issue at its position, and gives the action the array of outputs. The input schema is the validator's own. This supersedes the ADR-0005 clause that rejected per-value validators and the ADR-0006 clauses that ran the validator on omission and kept presence rules out of the action.
status: proposed
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0036 - Each value of a multiple option or variadic argument passes the same validator

## Context

[ADR-0005](0005-validation-delegates-to-standard-schema.md) rejected per-value validators. A multiple option or a variadic argument passed its whole `string[]` to one validator, so the validator could check values, enforce rules over the list, or transform the list into another shape. The record gave two reasons: per-value validators would fork the default rule, and rules over the whole list would have no home. [ADR-0006](0006-absence-rules-and-no-lenient-input.md) built on that design: the validator always ran, omission was the validated output of `[]`, and a presence rule such as "file arguments or piped stdin" lived in validation, never in the action.

That design makes a validator's meaning depend on where it is declared. `integer()` is right on a single option and wrong on a multiple one, where it receives an array. An author must wrap every validator in an array validator, which is a schema library's vocabulary, and a validator catalog would need a combinator for every factory. The values of a multiple option or a variadic argument are uniform: each is one value of the same kind. Work over the whole array, such as counting, uniqueness, or a transform into another shape, is the action's business and needs no validator.

The earlier reasons have answers. A default is an array of raw values, and each passes through the validator exactly like a caller's token, so the default rule does not fork. A rule over the whole list moves to the action, which receives the validated array. ADR-0006's reason for always running the validator was that a transforming validator's output type would be a lie for an omitted list. A validator's output type now describes one value, so `[]` is an honest value of the array type the action receives.

## Decision

- **One validator for every value.** On a multiple option or a variadic argument, `validate` names the validator for one value. Its input type is the type of one raw value, and its output type is the type of one entry of the action's array.
- **One call per value.** Core runs the validator once for each value, in supplied order. The action receives the array of outputs.
- **Positioned issues.** Each issue is reported at the value's position, counted from 0, before the issue's own path: `Option "--field" at 1: Expected a nonempty value.`
- **No values, no call.** No occurrence gives `[]`, and no validator runs. `required: true` remains the structural rule for at least one value.
- **Defaults.** A default is an array of the validator's input type. Like every default, it is validated once per run in the `default` phase, before any token is parsed and whether or not the invocation supplies the input: each value passes through the validator, and a rejected value reports as an invalid default with its position before its message. When no occurrence and no input source supplies the input, the action receives the default values' outputs.
- **The input schema.** The input schema is the one the validator publishes, unchanged, exactly as for a single option. The node's `multiple` or `variadic` flag already says the input takes several values, so core builds no array schema around it.
- **The validation context.** Each call carries the same context. `supplied` still holds the whole raw list, so a validator that needs the other values can read them.

## Considered options

- **Keep whole-array validators and ship an `each(validator)` combinator.** Rejected. It adds one concept for every author of such an input and leaves the validator's meaning dependent on its declaration.
- **Keep whole-array validators and let each catalog factory accept a string or an array.** Rejected. A factory cannot know at construction which it will receive, so its output type becomes a union and its published schema cannot be sound for both.
- **Publish an array schema that core builds around the validator's schema.** Rejected. Moving a library's schema under `items` changes the root its internal references resolve against, so core would have to rewrite them, and ADR-0030 keeps core from editing the fact.
- **One validator for every value, with its schema unchanged.** Chosen.

## Consequences

Rules over the whole list leave the `validate` slot: uniqueness, a maximum count, and a transform of the array into another shape. The action performs them. A rule that depends on the list being empty, such as "file arguments or piped stdin", also moves to the action until a content-stream input exists to express it. The action throws `InputError` for it, so the exit code stays 2, but the check now runs after the middleware chain, where ADR-0006 ran it before. textstat's `files` rule is the one such rule in the examples.

Help reads the accepted values of a multiple option or a variadic argument from the top of its input schema, as it does for a single option, instead of under `items`. A manifest reader reads the input schema beside the node's `multiple` or `variadic` flag.

This is a breaking change. A whole-array validator, such as `z.array(z.string())`, now receives one string and rejects it. Core cannot tell a per-value validator from an array validator at the declaration, because both are Standard Schema values, so the change fragment carries the migration: replace `z.array(value)` with `value` and move any rule over the whole list into the action. jsonkit's `select` changes `--field` from `z.array(z.string().nonempty(...))` to the catalog's `text()`.

## Status

Proposed. It moves to accepted with the implementation that runs the validator once per value, positions its issues, validates each default value, and publishes the validator's schema unchanged, together with the help change and the migrated examples.

## Changelog

- 2026-09-25: Proposed with the validator catalog contract under [ADR-0037](0037-validators-ship-in-their-own-package-as-standard-schema-values.md).
