---
type: adr
title: ADR-0085 - A Command declares option groups over supplied local options
description: Three immutable declarations constrain supplied local options, and validation and projections read one graph fact.
status: proposed
created: 2026-10-16
modified: 2026-10-16
---

# ADR-0085 - A Command declares option groups over supplied local options

## Context

An action can check relationships between options, but help, completion, and machine projections cannot read that code.
Three declared relationships cover common choices without adding a rule language or changing action types.
This narrows [ADR-0036](0036-each-value-passes-the-same-validator.md) for these relationships alone.
[ADR-0044](0044-a-global-option-declares-no-presence-rule.md) continues to exclude global presence rules.

## Decision

`exclusive(...names)` permits at most one supplied member. `oneRequired(...names)` requires at least one.
`requiredTogether(...names)` permits all members or none. Exclusive and one-required declarations over the same members express exactly one.
Each call returns a new Command, names at least two already-declared local options, and closes at `action()`.
The unnamed root follows the same rules through Application authoring. Arguments and globals cannot be members.
Action option types remain unchanged. Lifecycle hooks make the same group calls through the erased attached Command,
under ADR-0028's existing exemption from action closure.

Presence is core's existing supplied fact, independent of validation success.
Tokens and environment or configuration fills count, including a filled false, zero, or empty list.
Defaults and automatically assembled stdin do not count. Named calls first undergo their ordinary lowering:
a Boolean value without a matching spelling, zero occurrences, and an empty list lower to absence.
No cross-option source precedence suppresses an exclusive conflict.

Declaration checks reject unknown local names, repeated members, fewer than two members, and these direct conflicts:

- An exclusive group contains an individually required member. Its siblings would be unusable when that requirement applies.
  This includes `required: 'non-interactive'`, and native content with `required: true` or a positive `min`.
  Named calls have no stdin, so a stdin claim does not remove the content conflict.
- An exclusive group and a required-together group share at least two members. Those members cannot coexist and be supplied together.

Checks apply in either declaration order. Redundancy is allowed, including repeated group declarations and an individually required member in `oneRequired`.
Core does not infer transitive relationships or run a constraint solver.

Each failed group adds one `InputProblem` to the ordinary exit-2 `InputError`, after individual input problems, in group declaration order.
Its `reason` names the group kind and it carries `inputs`, `spellings`, and `supplied` lists in member order, without a singular subject.
Messages retain core's source labels. A supplied value its validator rejects still participates.
Messages and structured spelling lists follow the existing reported-spelling convention, including when a negative form or alias supplied the option.
Grammar-rejected environment values and named values that cannot lower supply nothing.
An unanswered configuration request is unknown: a group is not reported when its failure depends only on unanswered members.
An exclusive conflict already established by supplied members still reports.
Partial validation passes never evaluate groups. The shared complete pass governs `run()`, `invoke()`, and MCP before action dispatch.

`CommandNode.optionGroups` publishes frozen `{ kind, options }` entries in declaration order, empty when absent.
Inspection retains hidden members. Help prints one plain sentence per group and the manifest copies each group fact.
Both omit a group with any hidden member. Help notes that piped stdin does not count for any group containing a stdin-claiming option.
An exclusive group constrains supplied options, so stdin may still attach to an unsupplied content member beside a supplied sibling. Completion suppresses exclusive siblings using only supplied words from `locate()`.
Hidden members can constrain visible completions without being advertised.

MCP omits groups containing unexposed members. It encodes named supplied presence with value predicates where needed:
Boolean polarity, positive counts, and nonempty lists differ from property presence.
Exclusive constraints remain sound with external sources because two named supplied members cannot become absent.
Positive requirements are projected only when every member has no environment binding and no extensions.
An extension might bind a configuration source, whose identity the graph does not publish, so an uncertain group stays a runtime rule.
This conservatism keeps schemas sound without adding a new input-source capability fact.

## Consequences

The produced `InputProblem` union gains group variants. Readers narrow `reason` before reading singular fields.
Existing missing and invalid problem construction remains valid. The failure form keeps its existing shape.
The addition is opt-in and follows the repository's change-fragment rule for expanding produced unions.

Richer relationships, relationships involving globals or arguments, and rules over one option's values remain application logic.
No group changes middleware takeover or held-fault ranking.

## Status

Proposed until the release ships the implementation and its declaration, invocation, source, type, and projection tests.

## Changelog

- 2026-10-16: Proposed with the declared option-group contract.
