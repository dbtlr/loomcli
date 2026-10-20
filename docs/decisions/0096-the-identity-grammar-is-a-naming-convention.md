---
type: adr
title: ADR-0096 - The identity grammar is a naming convention
description: A plugin, extension, or view identity is a string that core compares by equality. plugin(), extension(), and view() stop checking it against the identity grammar and the 214-character package-name limit, and @loomcli/core/invalid-identity goes. The faults for one identity used twice stay. The grammar becomes the naming convention the plugin contract documents, and isRuleIdentity stays exported. It supersedes ADR-0052.
status: proposed
created: 2026-10-20
modified: 2026-10-20
---

# ADR-0096 - The identity grammar is a naming convention

## Context

[ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md) made the package name a plugin identity's convention, and [ADR-0020](0020-first-party-plugins-ship-in-one-package-as-subpaths.md) extended it to `<package>/<plugin>`. [ADR-0052](0052-a-plugin-extension-and-view-identity-follows-one-grammar.md) turned the convention into a rule. `plugin()`, `extension()`, and `view()` check an identity against an npm package name, at most 214 characters with its scope, followed by kebab-case subpath segments, and throw `@loomcli/core/invalid-identity` for any other value. The rule rejected identities accepted since 0.2.0, so it shipped as a breaking change.

Core uses an identity as a key. It finds a plugin installed twice, two descriptors, and two declared views by comparing identities, and it names the plugin in a diagnostic. Equality is all those uses need, and none of them reads the identity's shape. ADR-0052's reason was that an identity outside the convention surfaced only as an odd string in a diagnostic, which is the author's own string.

Principle 4 lets a rule prescribe how an author builds only when a projection cannot work without it. Principle 3 relaxes a rule rather than adding one. The identity check passes neither test.

## Decision

- **No grammar check.** `plugin()`, `extension()`, and `view()` take an identity as a string and stop checking it against the identity grammar and the 214-character limit. `@loomcli/core/invalid-identity` goes, and so does the check of a hand-built descriptor's identity that `plugin()` runs on its `extensions` list.
- **Duplicates stay.** An identity installed twice, two distinct extension descriptors that share an identity, and two distinct declared views that share an identity stay declaration faults, because core keys contributions on the identity and two values under one key would be read as one.
- **A naming convention.** The grammar becomes the naming convention the plugin contract documents: the package name for a package that ships one plugin, `<package name>/<plugin>` for one that ships several, and the plugin's identity with a kebab-case suffix for its extensions and views. Lint is the lane for guidance on it, under [ADR-0098](0098-lint-is-the-author-guidance-lane.md).
- **Rule identities keep their grammar.** A diagnostic rule's identity is still the declaring package's identity followed by a kebab-case rule name, and `diagnosticRule()` still checks it under `@loomcli/core/rule-identity`, as [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) states. `isRuleIdentity` stays exported, and `@loomcli/validators` keeps checking its issue codes with it.

This record supersedes ADR-0052 whole. Its other provisions are incorporated by reference: an identity keys what a plugin contributes, prefixes the rule identities its package declares, and is fixed where the plugin is defined; and core builds the rule-identity grammar from one package-name pattern and one segment pattern, so a rule identity's prefix follows the convention.

## Consequences

Removing the check relaxes a rule, so an application that builds today builds unchanged. A plugin whose identity departs from the convention installs and works. Its package's diagnostic rules still need identities in the rule grammar, so a plugin that declares rules keeps the convention for the prefix they share. [ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md) carries a dated entry.

## Status

Proposed. It moves to accepted with the release that removes the identity check from `plugin()`, `extension()`, and `view()`, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
