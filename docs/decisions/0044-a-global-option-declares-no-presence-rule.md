---
type: adr
title: ADR-0044 - A global option declares no presence rule
description: A global option declares neither required nor validateOmitted, so its omission is always plain absence and a rule that a value must exist belongs to the Commands that read it. This supersedes the ADR-0026 clause that a global takes the same configuration as option().
status: accepted
created: 2026-09-26
modified: 2026-09-26
---

# ADR-0044 - A global option declares no presence rule

## Context

[ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md) gives `globalOption()` the same configuration as `option()`, presence rules included. A global option's validation runs on every Command, because its value reaches every action. A plugin Command is an ordinary Command under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md), so it runs that validation too.

A presence rule on a global therefore fails every Command, including the ones that never read the value. jsonkit's `--file` global sent its omission to a validator that rejects a terminal stdin, so `jsonkit doctor` exited 2 from an interactive shell. Shell completion under [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) is a plugin Command, so the same rule would fail every completion request and the script request itself. A required global does the same in any application.

## Decision

A global option declares neither `required` nor `validateOmitted`. Its omission is always plain absence: `undefined`, its declared default, or `[]` for a multiple option. A rule that a value must exist belongs to the Commands that read it, which check the value in their actions.

The key is rejected whatever its value, `required: false` included, as a plugin option under [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) rejects its presence rules. TypeScript rejects either key at the `globalOption()` call. A JavaScript caller meets the declaration error `Global option "<name>" declares <required or validateOmitted>. Remove it; an omitted global option is absent, and a Command that needs its value checks for it.`, thrown from that call under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md).

Every other part of a global's configuration stands: spelling, defaults, validators of supplied values, multiple values, environment bindings, core facts, and extensions. A local option keeps both presence rules.

This record supersedes the ADR-0026 clause that `globalOption()` takes the same option configuration as `option()`, for the two presence keys alone. All other provisions of ADR-0026 remain in force.

## Considered options

- **Skip global validation on a Command that does not read the value.** Rejected. Core cannot know which globals an action reads, and a skipped validator would hand an action a value no validator checked.
- **Skip global validation on plugin Commands only.** Rejected. A plugin Command is an ordinary Command under ADR-0033, and the application's own Commands that read no document, such as a version or status Command, fail in the same way.
- **Forbid `required` and keep `validateOmitted`.** Rejected. `validateOmitted` exists to reject an omission, so it fails the same Commands a required global fails.

## Consequences

An application that declared a required global moves the rule into the actions that read it. jsonkit's file-or-stdin rule moves from the `--file` validator into its shared document reader, which throws the same `InputError` with the same text and exit code. That reader check stays until a content-stream input replaces it.

`OptionNode.required` and `OptionNode.validateOmitted` stay in the graph and read `false` on every global option, so a projection does not branch on scope.

## Status

Accepted 2026-09-26 with the implementation. TypeScript rejects `required` and `validateOmitted` on `globalOption()`, the call throws for a JavaScript caller, and `jsonkit doctor` runs when stdin is a terminal while jsonkit's document Commands still report the file-or-stdin rule with code 2.

## Changelog

- 2026-09-26: Accepted with the implementation.
