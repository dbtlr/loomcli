---
type: adr
title: ADR-0093 - Help pages a long page through the operator's pager on opt-in
description: Core adds out.text(data, view), which returns the text out.render would write and writes nothing. With help's paging setting on, and only on a stdout terminal whose TERM is set and not dumb, help hands a page that holds at least the terminal's rows of lines to PAGER, less by default, run through the platform shell with LESS=FRX when LESS is unset. An empty PAGER or cat turns it off, a pager that cannot start leaves the page unpaged, and the run exits 0 whatever the pager does. Ctrl-C cancels the run as it does anywhere else and ends the pager with it.
status: proposed
created: 2026-10-19
modified: 2026-10-19
---

# ADR-0093 - Help pages a long page through the operator's pager on opt-in

## Context

Help wraps its prose to the terminal under [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), so a page holds about one line per screen row, and an extended page with details and examples runs past the screen. The operator then scrolls back to find the masthead and the usage. git and man send such a page through the operator's pager, named by `PAGER`, and the original help specification asked for the same: off by default, and when enabled, a long page on an interactive terminal goes through a pager, never on a pipe.

Help could not do it. Its middleware writes the page only through `out.render`, so no plugin sees the resolved page or sends it anywhere but stdout. `help()` takes no settings. The pack's one spawner runs a child with no input and no shell. A broken output pipe exits 1, which an operator quitting less early would trigger if help wrote the pager's stream through core.

## Decision

- **Core resolves a view to text.** `Out` gains `text(data, view): string`, which returns exactly the text `out.render(data, view)` would write at that moment, resolved for `out.render`'s destination with its styles, color depth, live `columns`, glyph forms, and the application's override, and writes nothing. It takes a whole view alone, bare or declared. A view that throws makes the call throw to its caller. Core spawns nothing and gains no stream redirection.
- **The author opts in.** `help({ paging: true })` turns paging on. Off is the default, and with it every page prints as before. A `paging` that is not a Boolean is a declaration error of `@loomcli/plugins/help/settings` at the call.
- **When a page is paged.** Help pages only when `host.terminal.stdout.isTTY` is true, `TERM` in `host.env` is set and not `dumb`, `PAGER` does not turn paging off, `host.terminal.stdout.rows` is known, and the page from `out.text` holds at least that many lines. Otherwise it calls `out.render` as before. Help judges stdout alone, never the interaction decision, so a pipe, an invocation by name, and an MCP tool call never page.
- **The operator's pager.** `PAGER` names the pager, and `less` stands in when it is unset. An empty `PAGER`, or `cat`, turns paging off: the standard switch, with no Loom flag and no application variable. Help runs the text through the platform shell, as git and man-db do: `/bin/sh -c` on POSIX and `ComSpec` with `/d /s /c` on `win32`. The pager's environment is `host.env`, with `LESS=FRX` when `LESS` is unset, so less passes color through, quits on a page that fits, and leaves the page on the screen. On `win32` it also holds `NoDefaultCurrentDirectoryInExePath=1`, so `cmd` never runs a program from the working directory, as the pack's other program lookups refuse one.
- **A named exception to the pack's no-shell rule.** The pack runs every child with an argument array and no shell. The pager runs through the shell because `PAGER` is the operator's own command line from the operator's own environment, and a quoted path or a pipeline in it must work as it does under git. The spawner gains a shell request that only the pager makes, input text it writes to the child's standard input and closes, on request, the caller's streams handed to the child as its own, and a way for the caller to end the child with `SIGTERM` itself, as the run signal does for every caller; every other caller keeps its piped or captured output. An executable fixture proves the piped input and the shell spawn under Node and Bun.
- **Help owns the pager's input.** Help writes the page to the pager's standard input, and the pager inherits `host.stdout` and `host.stderr` as its own descriptors, so it draws on the terminal itself. Every exit code of the pager but the three that mean it could not start is ignored, and the run exits 0. A quit before the pager read the whole page closes help's pipe, not the run's output, so it is not the broken output pipe that exits 1.
- **A pager that cannot start.** When the shell cannot start, when it reports that it could not run the command (127 or 126 from `/bin/sh`, 9009 from `cmd`), or when a stream cannot be handed to the child, help prints the page through `out.render`, unpaged, and exits 0.
- **Ctrl-C ends the application.** While the pager is open, `SIGINT` cancels the run as it does anywhere else, the pager ends with the run, and the run exits with the cancellation code. With a signals owner, the aborted run signal makes the spawner end the shell with `SIGTERM`. With no owner, help listens for `SIGINT` and `SIGTERM` itself while the pager is open; on one that arrives before the run signal aborts, it ends the pager with `SIGTERM`, waits for it, removes its listeners, and re-raises the signal, so the process ends with the conventional status and leaves no pager running on the terminal.
- **Only the help page.** Compact and extended help page alike. No other output pages, and no option of the application, a quiet option included, changes paging.

The contract and its acceptance are in [A view's text without a write](../core.md#a-views-text-without-a-write) and [Help paging](../core.md#help-paging).

## Considered options

- **A core capability on the middleware context that routes one middleware's stdout writes into a plugin-supplied stream, while color and columns still resolve for the real terminal.** Rejected. Core would gain stream redirection and a second place where a write's destination and its resolution part ways. `out.text` gives help the bytes, and the writing stays help's.
- **Core spawning the pager.** Rejected. Core runs no child process, and paging is help's behavior.
- **`PAGER` split on whitespace and run without a shell, keeping the pack's no-shell rule.** Rejected. A quoted path with a space, or a pipeline such as `PAGER='tr a-z A-Z | less'`, would break, and git and man-db run it through the shell.
- **Running a `PAGER` with no shell metacharacter directly, as git does.** Not chosen. It adds a second path for one command line, and the shell's not-found status already tells a missing program from a pager that ran.
- **A `--no-pager` flag or an application variable.** Rejected. The empty or `cat` `PAGER` is the switch every pager-aware tool honors, and a flag would add an option to every application that pages.
- **Judging paging by the interaction decision.** Rejected. The decision reads stdin and stderr, while the pager shows stdout, so `app --help < /dev/null` on a terminal would print unpaged for no reason.
- **Paging every page and relying on less's `F` alone.** Rejected. A pager other than less may not quit on a short page, and a short page would start a process for nothing.
- **Holding `SIGINT` while the pager runs, as git does.** Rejected. The operator presses Ctrl-C to end the application, not to talk to less, and a held interrupt leaves a run that will not stop. Ending the pager with the run keeps the one meaning Ctrl-C has everywhere else in a Loom application.
- **Leaving the pager to the signal's default effect when no plugin owns the signals slot.** Rejected. The process would end while the pager still drew on the terminal, orphaned under the operator's shell.
- **Paging when the terminal's rows are unknown.** Rejected. Help cannot tell that the page runs past a screen it cannot measure.
- **Paging on by default.** Rejected. The original help specification keeps it off, and an author decides whether the application's help is long enough to page.

## Consequences

`Out` gains `text`, a new member of an object core builds, so it ships in a feature fragment of `@loomcli/core`. `help()` gains an optional settings object and `HelpSettings`, and the pack gains the rule `@loomcli/plugins/help/settings`, in a feature fragment of `@loomcli/plugins`. An application without `paging: true` sees no change in any byte.

A paged page holds the bytes help prints unpaged; only where they go changes. Because paging needs `TERM`, a Windows console that sets none, such as Windows Terminal running PowerShell, never pages, while a terminal that sets `TERM`, such as Git Bash, does. A literal wider than the screen counts as one line, so a page within a few rows of the screen's height can print unpaged, and `F` in `LESS` quits at once on a page counted long that fits.

Cleanup on cancellation is guaranteed for a `PAGER` that names one command, and this record accepts a limit for a pipeline. Ending the pager sends `SIGTERM` to the shell alone, so a cancellation that does not come from the terminal's Ctrl-C, such as a `SIGTERM` sent to the process or an abort from the action, ends only the shell, and a member of a pipelined `PAGER` can outlive the run. Ctrl-C at the terminal reaches the whole foreground process group and still ends every member.

This narrows [ADR-0008](0008-rendered-output-is-a-neutral-call.md)'s statement that `out.render` is the one call that resolves a view: `out.text` resolves a view the same way and writes nothing, and `out.render` stays the one call that writes a rendered value. It adds to [ADR-0058](0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md)'s help plugin a factory setting that changes where a long page goes and nothing in its sections or layout, and it reads the wrapped page of [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), laid out at stdout's `columns`, to decide whether the page fits. ADR-0008, ADR-0058, and ADR-0087 carry dated entries.

The glossary gains Help paging and Pager.

## Status

Proposed. It moves to accepted with the release that ships `out.text` and help paging. Tests prove `out.text` equal to `out.render`'s bytes for each destination and policy, help paging off by default, no paging on a pipe, below the row count, or under `TERM=dumb` or an empty or `cat` `PAGER`, a fixture pager receiving the exact page bytes and `LESS=FRX`, a missing pager printing unpaged, an early quit and a failing pager exiting 0, `SIGINT` while the pager waits ending it and the run with the cancellation code, with a signals owner and without one, the shell spawn with a quoted path and a pipeline, and a packed consumer of `help({ paging: true })`, under Node and Bun.

## Changelog

- 2026-10-19: Proposed with the text call and help paging contract.
