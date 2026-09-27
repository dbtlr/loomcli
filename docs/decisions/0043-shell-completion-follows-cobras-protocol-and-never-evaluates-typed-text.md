---
type: adr
title: ADR-0043 - Shell completion follows Cobra's protocol and never evaluates typed text
description: The completion plugin prints Bash, Zsh, and Fish scripts ported from Cobra, and a hidden __complete Command answers them in Cobra's line protocol. Every eval is removed, so pressing Tab never runs typed text; an offered word is exact or omitted; the application name enters a script as data; and aliases, hidden members, and deprecated members are never offered.
status: accepted
created: 2026-09-26
modified: 2026-09-27
---

# ADR-0043 - Shell completion follows Cobra's protocol and never evaluates typed text

## Context

Completion is the one place Loom writes code another program executes: a script the operator sources into an interactive shell. The script runs on every Tab, reads what the operator typed, calls the application, and inserts what the application answers. A mistake in that path runs code the operator never meant to run.

Loom's earlier design required a Loom-specific bridge that was lossless for newlines and control characters. The command-line ecosystem already has a standard for this job. Cobra, the Go framework behind kubectl, gh, docker, and helm, prints Bash, Zsh, and Fish scripts that call a hidden `__complete` command with the typed words. That command answers one word per line, with an optional tab and a description, and ends with a `:<n>` line. `<n>` is a bit-flag directive: `1` error, `2` no space, `4` no file completion, `8` filter by file extension, `16` directories only, and `32` keep order, with `0` meaning the shell's default, file completion included. Cobra's scripts have handled years of shell edge cases, such as Bash 3.2 on macOS with or without the bash-completion package. Cobra's Bash script builds its request as a string and runs it with `eval`, so a pasted line holding `$(...)` runs when the operator presses Tab.

## Decision

- **Cobra's protocol.** The plugin speaks Cobra's `__complete` line protocol and its directive numbers, and it invents no framing of its own.
- **Cobra's scripts, ported.** The Bash, Zsh, and Fish scripts are ported from Cobra, with Cobra's Apache-2.0 notice kept and the changes stated.
- **No evaluation.** Every `eval` is removed, and so is every construct that expands an operand, such as Bash's `compgen -W`, through which Cobra's Bash script filters words without descriptions. A script filters offered words by string comparison. A script calls the program with an argument array, so a typed word reaches the application as text and pressing Tab never runs it. Quoting is removed without evaluation, and no expansion is performed, so `~`, `$HOME`, and `$(…)` reach the application as the characters typed. The script offers nothing when it cannot read the word under the cursor without evaluating it.
- **Exact or omitted.** An offered word that holds a newline, a tab, or another control character is left out rather than cut, so completion never inserts a value other than the one the graph holds. This replaces the earlier corpus's lossless-framing requirement.
- **The name as data.** The application name enters a script only as a single-quoted string in its shell's own quoting rules, which differ in Fish, as a function identifier that encodes every character outside `A-Z`, `a-z`, and `0-9` by its code point, so two names never share one identifier, and in the Zsh `#compdef` comment as it is, since every accepted name is a portable name. Any accepted name therefore yields a safe script.
- **What is offered.** Canonical Command names, option spellings, and the values of a closed set in an input's schema. An alias is never offered and never rewritten, because an alias is unadvertised and resolving it is the router's job. A hidden or deprecated Command or option is never offered, and one typed in full still routes.
- **Print only.** The plugin prints scripts. Installing and uninstalling them, and PowerShell, are out of scope.

## Considered options

- **A NUL-terminated Loom bridge.** Rejected. It is lossless, but it is a protocol Loom would own alone, and the values it would preserve, a newline inside a closed-set value, cannot be typed at a prompt anyway.
- **Cobra's scripts unchanged.** Rejected. Pressing Tab would run a pasted `$(...)` in Bash, `compgen -W` would expand an offered value such as `$(touch f)`, and the scripts would put the application name into shell source as it is.
- **Cobra's truncation of a word at its first newline.** Rejected. It inserts a value the validator may reject; leaving the word out inserts nothing wrong.
- **Offering aliases, or offering an alias when no canonical name matches.** Rejected. The menu would advertise a synonym as a name.
- **Scripts written from scratch.** Rejected. Loom would own every shell edge case Cobra has already fixed.

## Consequences

The conformance tests drive the printed scripts in real Bash, Zsh, and Fish shells and hold command-injection sentinels in offered values, in typed words, and in an application name. They pin the removed `eval`, so a later sync from Cobra cannot bring it back without a failing test.

This record supersedes the clause of [ADR-0002](0002-command-graph-is-a-tree-with-hidden-aliases.md) that a completion consumer reads aliases, which ADR-0002 carries as a dated entry. No projection reads `aliases` now.

A word the shell cannot represent is not offered, and a value holding a line break is not completable. Expansions in earlier words are not performed, so a path written with `~` reaches the application unexpanded; completion reads it as structure alone, and the shell completes paths itself under directive `0`.

## Status

Accepted 2026-09-27 with the implementation. The completion plugin ships, and its conformance tests pass in real Bash, Zsh, and Fish shells under Node and Bun.

## Changelog

- 2026-09-26: Proposed with the shell completion contract.
- 2026-09-27: The application name, every Command name, and every alias are portable names, which `new Application()`, `new Command()`, and `alias()` enforce, so the Zsh `#compdef` comment always carries the name and the conditional this record and the contract stated is retired. The quoting, the identifier encoding, and the sentinel tests stay as defense in depth.
- 2026-09-27: Cobra registers its Bash script with `-o default` when `compopt` is missing, as on Bash 3.2, so an error there still falls through to file names. The ported script registers without it on such a Bash and completes file names itself with `compgen -f`, only when the directive allows files and no word was offered, so an error, a failed call, or an unclosed quote offers nothing on every Bash. With `compopt` the registration is Cobra's.
- 2026-09-27: The Fish script removes the quoting from the word under the cursor with `string unescape --style=script`, because Fish 3 reads no current token through `commandline -oct`. It still expands nothing, and the words before the cursor still come from `commandline -opc`.
- 2026-09-27: The answer's words under `value` carry the lead, such as `--format=`, so the scripts add no flag prefix of their own.
- 2026-09-27: Accepted with the implementation.
