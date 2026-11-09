---
type: adr
title: ADR-0140 - The help plugin attaches a help Command on opt-in
description: With help({ command: true }), the help plugin attaches a visible plugin Command, help, whose optional variadic argument names a Command path. Its action resolves the words child by child from the root, aliases and hidden Commands included, and prints that Command's extended help page, paged under the same setting as --help. A word that names no child is the ordinary unknown-command failure. With no settings, or command false, help attaches nothing.
status: proposed
created: 2026-11-09
modified: 2026-11-09
---

# ADR-0140 - The help plugin attaches a help Command on opt-in

## Context

The help plugin answers `--help` and `-h` at any placement, and nothing else. Its reference rejected a `help` Command in one sentence: it would share the root's namespace with the application's own Commands, and it would be a second way to say one thing. No decision record carried that rejection.

The command-line ecosystem sets the opposite habit. git, go, and cargo answer `help <command>`. Cobra, clap, Commander, and oclif attach a `help [command]` subcommand, and Optique offers `help: 'both'`. An agent probing an unknown CLI tries `app help` early, and an operator who learned the habit from git types it without thinking. Under principle 6, an operator's habits carry over, and a Loom application that cannot answer `app help get` fails a convention every competing framework meets.

A plugin already attaches ordinary Commands to the root under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md), and a collision with an application's own root child is a declaration error. An application that declares its own `help` Command, or a Command aliased `help`, exists today and is the author's to keep.

## Decision

- **The setting.** `HelpSettings` gains `command?: boolean`. `help({ command: true })` attaches the help Command, and with no settings or `command: false` help attaches no Command and every byte the application prints is unchanged. The types reject a `command` that is not a Boolean, and help adds no rule for one, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **An ordinary plugin Command.** The help Command is `help`, visible, with the description `Show help for a command.`, one optional variadic string argument, `command`, and no options. Every Command rule applies to it under ADR-0033: it leads the root's Command rows in plugin installation order, the manifest, the man page set, and completion list it as they list any Command, and the [MCP](../plugins/mcp.md) plugin makes it no tool, because it carries no `mcpCommand` value. Each `help()` call builds its own Command value.
- **The words name a Command path.** The action starts at the root and takes each word in order as the name or an alias of a child of the Command reached so far, so `app help` names the root, `app help cache` the `cache` group, and `app help cache clear` its child. A hidden Command and a deprecated Command resolve, as `--help` after their path reaches them.
- **The page is the extended page.** The action prints the resolved Command's extended help page, the page `--help` after that path prints, through the plugin's declared `helpPage` view, so an application's override of `helpPage` draws it. With `paging: true` the page goes to the pager under [ADR-0115](0115-help-pages-a-long-page-through-the-operators-pager-on-opt-in.md) exactly as a `--help` page does. The run exits 0, or with the cancellation code when it is cancelled while the pager is open.
- **A word that names no child.** A word that names no child of the Command reached, a word after a Command with no children included, fails the run with `UnknownCommandError`, the failure routing raises for an unknown Command, with the word as its `token` and the reached Command's visible children that are not deprecated as its `candidates`. It is a usage failure with exit code 2, and its sentence names the candidates, so `app help gte` reads `Unknown command "gte". Use one of: get, set.` Every plugin that reads that failure reads it unchanged: help's own failure hint points at the help Command's page, and the suggestions plugin, which matches against the children of the Command the run routed to, finds none under `help` and leaves core's sentence as it is.
- **The help option still takes over.** The help Command is an ordinary Command, so `app help --help` and `app help get -h` print the help Command's own page, as the help option does after any path.
- **Collisions are the ordinary rule.** An application that also declares a root child named or aliased `help` fails at its `command()` call under `@loomcli/core/sibling-name-taken`. Its remedy is to leave `command` off or rename its own Command. A root that declares arguments cannot hold the help Command, the limit every plugin Command has under ADR-0033.

The contract and its acceptance are in [The help Command](../plugins/help.md#the-help-command).

## Considered options

- **On by default, with `command: false` to opt out.** Rejected by the owner's ruling. It matches Cobra and clap, but it would break the build of every application that already holds a root `help` child, and it would add a row to every root page, a man page, and a completion word to every application that installs `help()`.
- **The compact page, or a variant chosen by an option on the help Command.** Rejected. `help <command>` is a request to learn the Command, which is the extended page's job under [ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md), and `-h` after the path already prints the compact page.
- **Resolving the words through routing, by rerunning the invocation with `--help` appended.** Rejected. The help Command's action would start a second run of the application, and a word that fails routing would report against the rerun's path rather than the help Command's.
- **Leaving a word under a leaf to that Command's arguments, so `app help get extra` prints `get`'s page.** Rejected. The help Command's words name a path and nothing else, and a silently dropped word would hide a typo such as `app help cache clera` under a leaf.
- **Hiding the help Command from the root page and completion.** Rejected. The Command exists so an operator can find and use it, and a hidden plugin Command would be the special case ADR-0033 rules out.
- **The suggestions plugin matching against the failure's `candidates` rather than the routed Command's children, so `app help gte` reads `Did you mean "get"?`.** Not chosen. It changes the suggestions plugin's candidate rule, which reads the graph because a failure an action built may carry any field, and core's sentence already names every candidate the operator can use.
- **Completing Command names for the `command` argument.** Deferred. Completion offers no values for a free string argument, and a dynamic completion source belongs to the completion work that follows, not to the help Command.

## Consequences

`HelpSettings` gains `command`, in a feature fragment of `@loomcli/plugins`. An application that leaves it off sees no change. An application that turns it on gains a root Command, a row on its root help page, a man page, and a completion word.

The help plugin's middleware and the help Command's action print a page through one function, so the page, the view, and the paging rule cannot drift between `--help` and `help <command>`.

This narrows ADR-0040's selection rule, under which the spelling of the help option selects the variant: the help Command is a second request for a page, which names no variant, and it prints the extended page, the answer ADR-0040 gives a request that names none. ADR-0040 carries a dated entry. ADR-0033 and ADR-0115 are unchanged.

The glossary gains Help Command.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-09: Proposed with the contract for the help Command (LM-369). It reverses the help reference's rejection of a `help` Command and narrows ADR-0040's selection rule, which carries a dated entry.
