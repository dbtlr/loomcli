---
type: adr
title: ADR-0052 - A plugin, extension, and view identity follows one grammar, checked at the declaring call
description: A plugin, extension, or view identity is an npm package name, scoped or unscoped, followed by zero or more kebab-case subpath segments. plugin(), extension(), and view() check it at the call and raise one shared rule, @loomcli/core/invalid-identity, for a value outside it. A diagnostic rule's identity is this grammar plus a kebab-case rule name, built from the same source in core. The check rejects identities accepted since 0.2.0, so it is a breaking change.
status: proposed
created: 2026-09-30
modified: 2026-09-30
---

# ADR-0052 - A plugin, extension, and view identity follows one grammar, checked at the declaring call

## Context

An identity keys what a plugin contributes. Core finds a plugin installed twice by its identity, compares extension descriptors and declared views by identity to find two copies of one package, and names the plugin in every diagnostic. Since [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md), an identity also prefixes the rule identities its package declares, such as `@loomcli/plugins/manifest/failure-name-conflict` under the plugin `@loomcli/plugins/manifest`.

[ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md) made the package name a plugin identity's convention, and [ADR-0020](0020-first-party-plugins-ship-in-one-package-as-subpaths.md) extended it to `<package>/<plugin>` for a package that ships several. Neither made it a rule. `plugin()` accepted any nonempty string, and `extension()` and `view()` accepted any value, so an identity such as `Help` or `audit/owner_name` passed while a rule identity with the same prefix failed `diagnosticRule()`. The rule-identity grammar itself was written twice, once in core and once in `@loomcli/validators` for issue codes.

## Decision

- **The grammar.** A plugin, extension, or view identity is an npm package name, scoped or unscoped, followed by zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens. `help`, `@acme/config`, `@loomcli/plugins/help`, and `@loomcli/core/lanes/stdout` are identities. `''`, `Help`, `@acme`, `@acme/`, `a b`, `x//y`, `@loomcli/plugins/Help`, and `x/under_score` are not.
- **One source.** A rule identity is an identity followed by a mandatory kebab-case rule name. Core builds both grammars from one package-name pattern and one segment pattern, so every rule identity's prefix is a valid identity. Core exports `isRuleIdentity(value)`, and `@loomcli/validators` checks its issue codes with it instead of a copy.
- **At the declaring call.** `plugin()`, `extension()`, and `view()` check the identity before any other rule on the call, under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md): the call holds the data that proves the fault, so graph build does not wait for it.
- **One rule.** A value that is not a string, an empty string, and a string outside the grammar report under one rule, `@loomcli/core/invalid-identity`, headlined `Invalid identity`, under ADR-0051's one rule per reason. The sentence names the declarer, `A plugin declares`, `An extension declares`, or `A view declares`, and quotes the identity escaped, and the finding marks the identity on the rebuilt call. The rule replaces `@loomcli/core/plugin-identity`. `@loomcli/core/rule-identity` stays a separate rule, because a rule identity also requires a rule name.
- **A break.** The check rejects identities accepted since 0.2.0, so it ships as a breaking change with migration steps.

The contract is in [Identity and installation](../core.md#identity-and-installation) and the row in [Plugin declaration errors](../core.md#plugin-declaration-errors).

## Considered options

- **Keep the convention unchecked.** Rejected. A rule prefix and a plugin identity could disagree, and an identity outside the convention surfaced only as an odd string in a diagnostic.
- **Check at graph build.** Rejected. An extension or a view never reaches build on its own, and a fault at build carries no stack at the offending line.
- **One rule for each declarer.** Rejected. The reason is the same for all three calls, and ADR-0051 keys a rule on the reason, not on the declarer.
- **A narrower grammar, the npm package name alone.** Rejected. Extensions and views are named under their plugin's identity with a suffix, and a package that ships several plugins names each with a subpath.

## Status

Proposed. It moves to accepted when the implementation lands and the release that carries it publishes.

## Changelog

- 2026-09-30: Proposed with the identity grammar. The implementation lands in this change: `plugin()`, `extension()`, and `view()` raise `@loomcli/core/invalid-identity` at the call, core builds both grammars in one module and exports `isRuleIdentity`, and `@loomcli/validators` checks its issue codes with it.
