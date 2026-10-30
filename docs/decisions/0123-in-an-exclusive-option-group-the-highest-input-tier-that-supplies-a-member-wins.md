---
type: adr
title: ADR-0123 - In an exclusive option group, the highest input tier that supplies a member wins
description: Within an exclusive option group, the members the highest input tier supplied stay supplied, and each member a lower tier filled is withdrawn right after the input-source stage, before validation. A withdrawn member reads as unfilled by every tier and is absent from the supplied record. A conflict is reported only between members one tier supplied. Named values of an invocation by name are the argv tier. oneRequired and requiredTogether still count every tier's fills. This narrows ADR-0085's clause that no cross-option source precedence suppresses an exclusive conflict.
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0123 - In an exclusive option group, the highest input tier that supplies a member wins

## Context

[ADR-0085](0085-a-command-declares-option-groups-over-supplied-local-options.md) counts a fill from the environment or the configuration source as a supplied member, the same as a token, and states that "No cross-option source precedence suppresses an exclusive conflict." So with `exclusive('json', 'yaml')`, a configuration file that sets `json = true` and an operator who types `--yaml` fail the run with exit 2, and so does every later run that types `--yaml` until someone edits the file.

That contradicts Loom's own precedence. Under [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), argv wins over the environment, which wins over the configuration source, so when `json` declares `polarity: 'both'`, a typed `--no-json` overrides the same file's `json = true` for that one option. An exclusive group's members are alternatives for one choice, and a typed member is the operator's choice for this run, yet it cannot override a lower tier's choice made through a sibling.

## Decision

- **The highest tier wins the group.** In an exclusive group, the members the highest tier supplied stay supplied, and each member a lower tier filled is withdrawn. The tiers rank as ADR-0032's precedence ranks them for one option: argv, then the environment, then the configuration source. A token in any spelling the option accepts and an [implied value](../core/options.md#implied-values) are argv. So `json = true` in the file with a typed `--yaml` runs with `yaml`, and, with `json` bound to `EXPORT_JSON`, `EXPORT_JSON=1` with a configured `yaml = true` runs with `json`.
- **A conflict is within one tier.** Members the winning tier supplied still conflict: `--json --yaml`, two bound variables, and two configured keys each fail under ADR-0085, and the diagnostic still names each member's source.
- **Decided before validation.** Core withdraws each losing member right after the input-source stage fills and before validation, so its lower tier's value is never validated, as a lower tier of one option is never read once a higher tier fills it. A withdrawn member reads as unfilled by every tier, under [Absence and defaults](../core/validation.md#absence-and-defaults): its declared default applies, or it is omitted, as a fill [ADR-0117](0117-a-configuration-value-its-validator-rejects-falls-back-and-validates-against-its-files-directory.md) drops does. It is absent from the validation context's and the action's `supplied` record, because no tier it was read from counts, and it activates nothing. Core writes no line for it, as it writes none when a higher tier overrides one option.
- **A rejected variable beside a typed sibling.** A bound variable outside its option's grammar fills nothing and is a usage failure. When a member of the same exclusive group is supplied by argv, that failure is not reported, because the variable is the member's lower tier and the run never reads it, as a lower tier of one option is never read once argv fills it. Beside a sibling a lower tier or the same tier supplied, the failure stands.
- **Named values are argv.** The named values of an [invocation by name](../core/invocation.md#invocation-by-name) are the argv tier, as `invoke()` behaves as `run()` on the argv that spells the same values. So a tool call's member wins over a member the server's environment or configuration fills, and two named members still conflict.
- **Judged on every tier's fills.** Each exclusive group reads the tiers of the fills the input-source stage left, before any member is withdrawn, so a member in two exclusive groups withdraws when either holds a member a higher tier supplied, and the outcome does not depend on declaration order.
- **The other groups count every tier.** `oneRequired` and `requiredTogether` count every tier's fills, a withdrawn member included. Their problem's `supplied` list names what they counted, and their diagnostic names the source that filled a withdrawn member. A fill ADR-0117 drops still counts for no group.

Every other rule of ADR-0085 stands: defaults never count, an unanswered configuration request suppresses only the failure that depends on it, and completion, help, the manifest, and MCP read the group facts as before.

## Considered options

- **Keep the conflict, as ADR-0085 states.** Rejected. A configured member breaks every run that types a sibling, while the same file never breaks a run that types the member's own negative form.
- **Withdraw the losing member after validation.** Rejected. Its lower tier's value would still be validated, and a value from the environment that its validator rejects fails the run with code 2, for a value the run never uses.
- **Keep the withdrawn member in the supplied record.** Rejected. The action would read it as supplied beside its sibling, the state the group rules out.
- **Count `oneRequired` and `requiredTogether` after the withdrawal.** Not taken. It changes no group over the same members as the exclusive group, because a member withdraws only when a sibling stays supplied, and for a group over other members it would make that group's outcome depend on an exclusive group's, a relationship ADR-0085's direct pairs never infer.

## Consequences

Validation gains one step between the input-source stage and the first validator, which reads each member's tier from the provenance the stage already keeps. The `InputProblem` shapes and messages are unchanged. [Options](../core/options.md#declared-option-groups) and [Input sources](../core/input-sources.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release whose implementation withdraws a lower tier's member of an exclusive group before validation.

## Changelog

- 2026-10-30: Proposed with the fix. It narrows ADR-0085's clause that no cross-option source precedence suppresses an exclusive conflict, and ADR-0032's "Supplied in every sense" for a member of an exclusive group a lower tier filled beside a sibling a higher tier supplied. ADR-0032 and ADR-0085 carry dated entries.
