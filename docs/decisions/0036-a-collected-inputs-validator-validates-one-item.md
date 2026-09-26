---
type: adr
title: ADR-0036 - A collected input's validator validates one item
description: On a multiple option or a variadic argument, `validate` names the validator for one item. Core runs it on each item, indexes each issue, gives the action the array of outputs, and publishes the item's schema as the array's `items`. This supersedes the ADR-0005 clause that rejected per-item validators.
status: proposed
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0036 - A collected input's validator validates one item

## Context

[ADR-0005](0005-validation-delegates-to-standard-schema.md) rejected per-item validators. A multiple option or a variadic argument passed its whole `string[]` to one validator, so the validator could check items, enforce rules over the list, or transform the list into another shape. The record gave two reasons: per-item validators would fork the default rule, and rules over the whole list would have no home.

That design makes a validator's meaning depend on where it is declared. `integer()` is right on a single option and wrong on a multiple one, where it receives an array. An author must wrap every item validator in an array validator, which is a schema library's vocabulary, and a validator catalog would need a combinator for every factory. Items of a collected input are uniform: each occurrence is one value of the same kind. Work over the whole array, such as counting, uniqueness, or a transform into another shape, is the action's business and needs no validator.

Both of ADR-0005's reasons have answers. A collection default is an array of raw values, and each item passes through the item validator exactly like a caller's token, so the default rule does not fork. A rule over the whole list moves to the action, which receives the validated array.

## Decision

- **The item validator.** On a multiple option or a variadic argument, `validate` names the validator for one item. Its input type is the type of one raw value, and its output type is the type of one item of the action's array.
- **One call per item.** Core runs the validator once for each collected item, in supplied order. The action receives the array of outputs.
- **Indexed issues.** Each issue is reported at the item's position, counted from 0, before the issue's own path: `Option "--field" at 1: Supply a nonempty field name.`
- **An empty collection makes no call.** No occurrence gives `[]`, and no validator runs for it. `required: true` remains the structural rule for at least one item.
- **Defaults.** A collection default is an array of the validator's input type. When no occurrence and no input source supplies the input, each default item passes through the validator like a supplied item.
- **The input schema.** When the item validator publishes a schema, the input schema is `{ type: 'array', items: <the item's schema> }`, and help reads accepted values from `items` as it does today.
- **The validation context.** Each item call carries the same context. `supplied` still holds the whole raw list, so a validator that needs its siblings can read them.

## Considered options

- **Keep whole-array validators and ship an `each(validator)` combinator.** Rejected. It adds one concept for every author of a collection input and leaves the validator's meaning dependent on its declaration.
- **Keep whole-array validators and let each catalog factory accept a string or an array.** Rejected. A factory cannot know at construction which it will receive, so its output type becomes a union and its published schema cannot be sound for both.
- **A validator for one item.** Chosen.

## Consequences

Rules over the whole list leave the `validate` slot: uniqueness, a maximum count, and a transform of the array into another shape. The action performs them. A rule that depends on the list being empty, such as "file arguments or piped stdin", also moves to the action until a content-stream input exists to express it. textstat moves its `files` rule into its action, which throws `InputError` with the same message and exit code 2.

This is a breaking change. A whole-array validator on a collected input, such as `z.array(z.string())`, now receives one string and rejects it. Core cannot tell an item validator from an array validator at the declaration, because both are Standard Schema values, so the change fragment carries the migration: replace `z.array(item)` with `item` and move any rule over the whole list into the action. jsonkit's `select` changes `--field` from `z.array(z.string().nonempty(...))` to `z.string().nonempty(...)`.

## Status

Proposed. It moves to accepted with the implementation that runs the item validator per item, indexes its issues, validates each default item, and wraps the published schema, together with the migrated examples.

## Changelog

- 2026-09-25: Proposed with the validator catalog contract under [ADR-0037](0037-validators-ship-in-their-own-package-as-standard-schema-values.md).
