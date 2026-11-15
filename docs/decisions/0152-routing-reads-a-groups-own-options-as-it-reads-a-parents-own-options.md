---
type: adr
title: ADR-0152 - Routing reads a group's own options as it reads a parent's own options
description: Core already accepts a local option on a group, the author's or one an onCommandAttach hook declares, and the group's table holds it, but routing read a group's words against the global options alone, so none reached anything. Routing now reads every option on a group as built, the author's and a hook's alike, as it reads a parent's own options at a Command with an action and children, so an occurrence binds to the Command routing finally reaches by the spelling the operator typed, the group itself when routing ends there. An author's option on a group still reaches no action, and a hook's reaches its plugin's middleware under ownOptions, validated under the held missing-subcommand fault. It supersedes ADR-0004's rejection of groups with their own local options and the rule that a group declares no local option, which ADR-0055 relies on and ADR-0026 carries from ADR-0003 through ADR-0024, and widens ADR-0055's routing over a parent's own options to any Command with children.
status: proposed
created: 2026-11-15
modified: 2026-11-15
---

# ADR-0152 - Routing reads a group's own options as it reads a parent's own options

## Context

A group is a Command with children and no action. [ADR-0004](0004-arguments-and-children-are-exclusive.md) rejected groups with their own local options, and [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md) carries from ADR-0003 through ADR-0024 the rule that a group declares no local option, which [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) relies on for unambiguous routing. Core nevertheless accepts a local option on a group, the author's or one a plugin's `onCommandAttach` hook declares, and the group's table holds it, but none reached anything: routing read a group's words against the global options alone, and a group has no action. So with `--force` declared on a `cache` group and on its child `clear`, `store cache --force clear` failed with `Command "cache" accepts no arguments.`.

[ADR-0150](0150-an-application-opts-in-to-an-extended-version-that-prints-the-release-facts-runtime-and-platform.md)'s formatter declares a hidden `--format` on every group, so that a takeover such as the extended version, and a failure encoder, read the media type the operator asked for at the root of a group application. That option is a hook's. Routing could read a hook's option on a group alone, or every option a group holds. The owner ruled: "One rule for all".

## Decision

- **One rule for every option on a group.** Routing reads every option on a group as built, the author's and a lifecycle hook's alike, as it reads a parent's own options at a Command with an action and children. An occurrence binds to the Command routing finally reaches by the spelling the operator typed, the group itself when routing ends there, under ADR-0055's rules for a parent's own option, value classes included. So with `--force` declared on a `cache` group and on its child `clear`, `store cache --force clear` sets `clear`'s `--force`.
- **What each option reaches.** An author's option on a group still reaches no action and no `request`, because a group has neither. A hook's option on a group reaches its plugin's middleware under `ownOptions`: under the held missing-subcommand fault, the held-fault pass validates it for the declaring plugin, as it validates a hook's option on any other routed Command.
- **The group's table.** A group's table holds the global options and its own local options, the author's and those a lifecycle hook declared on it.
- **Routing stays unambiguous.** A group takes no arguments under ADR-0004, so a plain word after a group's own option can only be its value or a child's name. Arguments and children stay exclusive.

The contract is in [Nested Commands and groups](../core/commands.md#nested-commands-and-groups) and [Global consumption and routing](../core/commands.md#global-consumption-and-routing).

## Considered options

- **Routing a hook's option on a group, and not an author's.** Not chosen. The group's one table holds both, and a second routing table for one kind of declarer would split one rule in two. An author's option on a group reaches no handler either way, and reading it as a parent's own option lets the invocation the operator typed reach the child that declares the spelling.
- **Reading a group's option in the routed Command's words alone, not in routing.** Rejected. `notes --format json list` would then read `list` as an argument of the root and fail with `The root Command accepts no arguments.`, where today it names the Command that declares `--format`.

## Consequences

An application without the formatter sees a group invocation change in two cases. An option a plugin's `onCommandAttach` hook declared on a group is read in routing the same way, and when routing ends at the group its plugin's middleware reads the validated value under `ownOptions`, where no pass validated a group's local option. An author's own option on a group, which reached no handler, is now read in routing as a parent's own option. With `--force` declared on a `cache` group, `store cache --force clear` sets `clear`'s own `--force` when `clear` declares one and reports the unknown option on `clear` when it does not, where both failed with `Command "cache" accepts no arguments.`. Every other group invocation is unchanged. What the formatter's hidden `--format` changes at a group is ADR-0150's.

This record supersedes the rule that a group declares no local option, which ADR-0055 relies on for unambiguous routing and ADR-0026 carries from ADR-0003 through ADR-0024, and ADR-0004's rejection of groups with their own local options, for the options core already accepts on a group: routing reads them, and a hook's reaches its plugin's middleware. It widens ADR-0055's routing over a parent's own options from a Command with an action and children to any Command with children, and the held-fault pass that [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) added to ADR-0055 to a hook's option on a group. ADR-0004, ADR-0026, and ADR-0055 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-15: Proposed with the routing rule (LM-391), which ADR-0150 first carried and which moves here whole. It supersedes part of ADR-0004, ADR-0026, and ADR-0055, which carry dated entries.
