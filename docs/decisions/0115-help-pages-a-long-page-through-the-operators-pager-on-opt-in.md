---
type: adr
title: ADR-0115 - Help pages a long page through the operator's pager on opt-in
description: Core adds out.text(data, view), which returns the text out.render would write and writes nothing. With help's paging setting on, and only on a stdout terminal whose TERM is set, not empty, and not dumb, outside CI, help hands a page that holds at least the terminal's rows of lines to PAGER, less by default, run through /bin/sh -c with LESS=FRX when LESS is unset, through host.spawn. An empty PAGER or cat turns it off, a pager that cannot start leaves the page unpaged, and the run exits 0 whatever the pager does. Ctrl-C cancels the run as it does anywhere else and ends the pager with it.
status: proposed
created: 2026-10-27
modified: 2026-10-27
---

# ADR-0115 - Help pages a long page through the operator's pager on opt-in

## Context

Help wraps its prose to the terminal under [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), so a page holds about one line per screen row, and an extended page with details and examples runs past the screen. The operator then scrolls back to find the masthead and the usage. git and man send such a page through the operator's pager, named by `PAGER`, and the original help specification asked for the same: off by default, and when enabled, a long page on an interactive terminal goes through a pager, never on a pipe.

Help could not do it. Its middleware writes the page only through `out.render`, so no plugin sees the resolved page or sends it anywhere but stdout, and `help()` takes no settings. A run starts a child program only through `host.spawn` under [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md), which already writes input text to a child, hands it the run's own stdout and stderr, ends it with `SIGTERM` when its signal aborts, and treats a child that exits before it reads its input as no failure. The bounded shutdown of [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md) gives a run's code `onShutdown` to end a child before the process ends.

## Decision

- **Core resolves a view to text.** `Out` gains `text(data, view): string`, which returns exactly the text `out.render(data, view)` would write at that moment, resolved for `out.render`'s destination with its styles, color depth, live `columns`, glyph forms, and the application's override, and writes nothing. It takes a whole view alone, bare or declared. A view that throws makes the call throw to its caller. Core spawns nothing and gains no stream redirection.
- **The author opts in.** `help({ paging: true })` turns paging on. Off is the default, and with it every page prints as before. The types reject a `paging` that is not a Boolean, and help adds no rule for it, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **When a page is paged.** Help pages only when `host.terminal.stdout.isTTY` is true, `TERM` in `host.env` is set, not empty, and not `dumb`, the run is not under CI as [ADR-0114](0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md) reads `CI`, `PAGER` does not turn paging off, `host.terminal.stdout.rows` is known, and the page from `out.text` holds at least that many lines. Otherwise it calls `out.render` as before. Help judges stdout and the environment, never the interaction decision, so `app --help < /dev/null` on a terminal pages, while a pipe, an invocation by name, and an MCP tool call never do.
- **Not under CI.** A pager waits for keys, and a CI runner that gives the run a pseudo-terminal sends none, so a long page would hold the job until it times out. Help reads `CI` from `host.env` by ADR-0114's rule, set, nonempty, and not `false`, because that record adds no export for it, and `CI=false` lets help page again.
- **The operator's pager.** `PAGER` names the pager, and `less` stands in when it is unset. An empty `PAGER`, or `cat`, turns paging off: the standard switch, with no Loom flag and no application variable. Help runs the text through `/bin/sh -c`, as git and man-db run it through the shell, by starting `/bin/sh` through `host.spawn` with the arguments `-c` and the `PAGER` text. The pager's environment is `host.env`, with `LESS=FRX` when `LESS` is unset, so less passes color through, quits on a page that fits, and leaves the page on the screen.
- **The shell is the operator's.** `host.spawn` runs no shell, and Loom's other children keep that rule. The pager runs through one because `PAGER` is the operator's own command line from the operator's own environment, and a quoted path or a pipeline in it must work as it does under git. Help names `/bin/sh` as the program, so `host.spawn` gains no shell request.
- **Help owns the pager's input.** Help hands the page to `host.spawn` as the child's input, and the pager inherits the run's stdout and stderr, so it draws on the terminal itself. Every exit code of the pager but the two that mean it could not start is ignored, and the run exits 0. A quit before the pager read the whole page closes the child's input, not the run's stdout, so it is not the closed reader that ends a run with 141 under [ADR-0104](0104-a-closed-reader-on-stdout-ends-the-run-with-141.md).
- **A pager that cannot start.** When the shell cannot start, an `unstarted` exit, or when it reports that it could not run the command, exit 127 or 126, help prints the page through `out.render`, unpaged, and exits 0.
- **Ctrl-C ends the application.** While the pager is open, `SIGINT` cancels the run as it does anywhere else, the pager ends with the run, and the run exits with the cancellation code. Help passes the run's `signal` to `host.spawn`, so the run's abort ends the pager with `SIGTERM`, and it registers an `onShutdown` handler that ends the pager while the pager is open, so a run the shutdown cuts off leaves no pager on the terminal either. Help holds no signal and adds no listener.
- **Only the help page.** Compact and extended help page alike. No other output pages, and no option of the application, a quiet option included, changes paging.

The contract and its acceptance are in [A view's text without a write](../core/output.md#a-views-text-without-a-write) and [Help paging](../plugins/help.md#help-paging).

## Considered options

- **A core capability on the middleware context that routes one middleware's stdout writes into a plugin-supplied stream, while color and columns still resolve for the real terminal.** Rejected. Core would gain stream redirection and a second place where a write's destination and its resolution part ways. `out.text` gives help the bytes, and the writing stays help's.
- **Core spawning the pager.** Rejected. Paging is help's behavior, and `host.spawn` already gives a plugin every part a pager needs.
- **A shell request on `host.spawn`.** Rejected. Naming `/bin/sh` as the program does the same with no new option, and every other child keeps no shell.
- **`PAGER` split on whitespace and run without a shell.** Rejected. A quoted path with a space, or a pipeline such as `PAGER='tr a-z A-Z | less'`, would break, and git and man-db run it through the shell.
- **Running a `PAGER` with no shell metacharacter directly, as git does.** Not chosen. It adds a second path for one command line, and the shell's not-found status already tells a missing program from a pager that ran.
- **A `--no-pager` flag or an application variable.** Rejected. The empty or `cat` `PAGER` is the switch every pager-aware tool honors, and a flag would add an option to every application that pages.
- **Judging paging by the interaction decision.** Rejected. The decision reads stdin and stderr, while the pager shows stdout, so `app --help < /dev/null` on a terminal would print unpaged for no reason. CI is read on its own, by ADR-0114's rule.
- **Paging under CI, leaving it to the operator's `PAGER=cat`, as git does.** Rejected by the owner's ruling. A CI job on a pseudo-terminal would hang on a long page, while ADR-0114 already makes a CI run ask nothing.
- **Paging every page and relying on less's `F` alone.** Rejected. A pager other than less may not quit on a short page, and a short page would start a process for nothing.
- **Holding `SIGINT` while the pager runs, as git does.** Rejected. The operator presses Ctrl-C to end the application, not to talk to less, and a held interrupt leaves a run that will not stop. Ending the pager with the run keeps the one meaning Ctrl-C has everywhere else in a Loom application.
- **Help listening for `SIGINT` and `SIGTERM` itself while the pager runs.** Rejected. Core owns every ending signal under ADR-0106, and the run's signal and `onShutdown` already end the pager.
- **Paging when the terminal's rows are unknown.** Rejected. Help cannot tell that the page runs past a screen it cannot measure.
- **Paging on by default.** Rejected. The original help specification keeps it off, and an author decides whether the application's help is long enough to page.

## Consequences

`Out` gains `text`, a new member of an object core builds, so it ships in a feature fragment of `@loomcli/core`. `help()` gains an optional settings object and `HelpSettings`, in a feature fragment of `@loomcli/plugins`. An application without `paging: true` sees no change in any byte.

A paged page holds the bytes help prints unpaged; only where they go changes. A literal wider than the screen counts as one line, so a page within a few rows of the screen's height can print unpaged, and `F` in `LESS` quits at once on a page counted long that fits.

Cleanup on cancellation is guaranteed for a `PAGER` that names one command, and this record accepts a limit for a pipeline. Ending the pager sends `SIGTERM` to the shell alone, so a cancellation that does not come from the terminal's Ctrl-C, such as a `SIGTERM` that another process sends, ends only the shell, and a member of a pipelined `PAGER` can outlive the run. Ctrl-C at the terminal reaches the whole foreground process group and still ends every member.

A test of a paged page under a [mock](../libs/testing.md#mockprocess) scripts `/bin/sh` in `programs`, because the pager starts through `host.spawn` and a mock refuses a program it has no script for. A process fixture proves the real shell, the terminal, and the signal.

This narrows [ADR-0008](0008-rendered-output-is-a-neutral-call.md)'s statement that `out.render` is the one call that resolves a view: `out.text` resolves a view the same way and writes nothing, and `out.render` stays the one call that writes a rendered value. It adds to [ADR-0058](0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md)'s help plugin a factory setting that changes where a long page goes and nothing in its sections or layout, and it reads the wrapped page of [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), laid out at stdout's `columns`, to decide whether the page fits. ADR-0008, ADR-0058, and ADR-0087 carry dated entries.

The glossary gains Help paging and Pager.

## Status

Proposed. It moves to accepted with the release that ships `out.text` and help paging. Tests prove `out.text` equal to `out.render`'s bytes for each destination and policy, help paging off by default, no paging on a pipe, below the row count, under `TERM=dumb`, under CI, or with an empty or `cat` `PAGER`, a pager receiving the exact page bytes and `LESS=FRX`, a missing pager printing unpaged, an early quit and a failing pager exiting 0, Ctrl-C while the pager waits ending it and the run with the cancellation code, and the shell with a quoted path and a pipeline, under Node and Bun.

## Changelog

- 2026-10-19: Drafted as ADR-0093 with the text call and help paging contract in PR 228.
- 2026-10-27: Proposed as ADR-0115 on the process handle and the bounded shutdown: the pager starts through `host.spawn` with `/bin/sh` as its program, so the spawner gains nothing, and the run's signal and `onShutdown` end it, so help listens for no signal. The owner ruled that help never pages under CI.
