---
type: adr
title: ADR-0037 - Validators ship in their own package as Standard Schema values
description: A new package, `@loomcli/validators`, ships a catalog of validator factories and `createValidator`. Each value is an ordinary Standard Schema value that publishes a sound input schema, so an author covers common input shapes without a schema library and core still cannot tell a catalog validator from a Zod schema.
status: accepted
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0037 - Validators ship in their own package as Standard Schema values

## Context

[ADR-0005](0005-validation-delegates-to-standard-schema.md) keeps core free of any validator of its own: a value input accepts any Standard Schema value, and core calls the standard interface. That leaves every author who wants a typed port, a bounded integer, or a closed set of words to add a schema library or to write a Standard Schema object by hand. Both examples depend on Zod for exactly those cases.

[ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md) makes the JSON Schema a validator publishes a core graph fact, which help, the manifest, and later completion read. A validator that publishes no schema leaves the input's shape unknown to every projection.

## Decision

- **A catalog package.** `@loomcli/validators` ships validator factories. Each factory returns an ordinary Standard Schema value that validates, transforms, and publishes its input schema through `~standard.jsonSchema.input`. Core gains no validator and cannot tell a catalog validator from a schema library's value; a Zod schema stays accepted in the same `validate` slot for anything the catalog does not cover.
- **The admission rule.** A factory earns its slot by covering an input shape a command-line author would otherwise need a schema library for. The 0.5.0 catalog is `text`, `integer`, `number`, `port`, `oneOf`, `url`, `uuid`, `date`, and `path`.
- **One construction.** Every catalog factory is built with `createValidator`, which the package exports for an author's own validators. An author supplies a parse function and, optionally, the input schema to publish.
- **The soundness rule.** A published input schema is sound, not complete: every token the validator accepts satisfies it. It may be looser than the validator and never stricter, and a constraint that cannot be stated soundly is left out. Each catalog factory carries a test that fails when an accepted token breaks its published schema.
- **Messages.** A catalog message states the expectation in one plain sentence and never repeats the caller's token, because a rejected value may be a secret. Issues carry no code. A code enters only with a reader for it.
- **Faults at the call.** A factory argument that can never work, such as `min` above `max` or an empty `oneOf` list, throws a `DeclarationError` from the factory call under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md).
- **The package.** The package declares `@loomcli/core` as a peer dependency and joins the synchronized release set of [ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md). It is a library of values, not a plugin, so it is not a subpath of `@loomcli/plugins` under [ADR-0020](0020-first-party-plugins-ship-in-one-package-as-subpaths.md).

The factory grammars, outputs, published schemas, and messages are the contract in the [validators reference](../validators.md).

## Considered options

- **Validators in core.** Rejected. ADR-0005's reason holds: core stays free of a second validation vocabulary, and a growing catalog of values does not belong in the package every application loads.
- **A subpath of `@loomcli/plugins`.** Rejected. ADR-0020 describes that package as the plugin pack, and a validator is not a plugin.
- **A closed Loom constraint vocabulary on each validator.** Rejected under ADR-0030. The Standard JSON Schema channel already carries the shape every projection reads.
- **A combinator for multiple options and variadic arguments, and a composition utility.** Rejected. [ADR-0036](0036-each-value-passes-the-same-validator.md) runs the same validator on each of their values, so no combinator is needed, and composition waits for a use no factory option covers.

## Consequences

An application covers common input shapes with one small dependency, and help prints accepted values for a `oneOf` input with no authored line. The package must follow the soundness rule for every factory it adds, and each addition is a public contract.

The package joins the release set the way `@loomcli/plugins` did. It lands with `private: true`. The maintainer publishes a `0.0.0` placeholder to npm from a minimal manifest without `private`, since npm refuses to publish a private package, and binds the trusted publisher to it under [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md). An ordinary pull request then removes `private` at the current synchronized version, and the next release cut publishes it with the other libraries. The release workflow reads only the versions the manifests carry, so the placeholder never enters a plan.

## Status

Accepted 2026-09-25 with the implementation. `@loomcli/validators` lands with `private: true` and ships the nine factories and `createValidator`. Each factory has a soundness test under a draft 2020-12 validator with format assertion, and textstat and jsonkit use the catalog in place of Zod.

## Changelog

- 2026-09-25: Proposed with the contract in the validators reference.
- 2026-09-25: Accepted with the implementation. The `url` protocols pattern leaves `-` unescaped, because `\-` outside a character class is a syntax error under the `u` flag a draft 2020-12 `pattern` is read with.
