---
type: adr
title: ADR-0004 - A Command declares arguments or attaches children, never both
description: A Command with children and no action is a group that routing passes through. Invoking a group, or a Command with neither children nor an action, is an error rather than a fallback.
status: accepted
created: 2026-09-07
modified: 2026-09-08
---

# ADR-0004 - A Command declares arguments or attaches children, never both

## Context

A bare token under a Command with children is either a route or a positional input. Allowing both on one Command forces the router to guess, and the guess changes when a child is added later.

One Command declares arguments or attaches children, never both, and the rule applies to the unnamed root. The types remove the conflicting call at the second declaration, and graph build reports the same fault for JavaScript authors.

A Command with children and no action is a group. Routing passes through it to a child. An invocation that commits to a group fails in the routing phase with exit 2 and lists the children's canonical names, ranking before any local parsing so `store cache --verbose` reports the missing subcommand rather than an unknown option. A Command with children and an action runs the action when routing selects no child. A Command with neither children nor an action is a build error.

## Considered options

- **Silent fallback to the parent action on an unknown child.** Rejected. A typo would run the parent with the typo as an argument. An unknown child is always an unknown-command error with candidates.
- **Groups with their own local options.** Rejected under ADR-0003. Locals never inherit, so an option on a group reaches no handler.

## Consequences

A root with children accepts no arguments and reports that when given some. Help and manifest consumers can treat every Command as either a leaf with inputs or a container of children, with the mixed case only for a Command that has children and an action but no arguments.

## Changelog

- 2026-09-08: ADR-0017, proposed, places the plugin middleware chain between routing and the group check. Under it, an invocation that commits to a group still fails with exit 2, lists the children's canonical names, and ranks before any local parsing, but the check is judged after the chain rather than inside routing, so a plugin such as help can take over a group invocation. The failure's class, code, and rank are unchanged; only its position relative to the chain moves, and that placement binds when ADR-0017 is accepted.
