---
type: adr
title: ADR-0181 - A Command may declare that it needs a terminal, and runs only at one
description: A needsTerminal() call publishes a node fact; such a Command fails before its action with TerminalUnavailableError, exit 1, when stdin or stderr is not a terminal or the run is under CI, an invocation by name always refuses it, the MCP plugin rejects it as a tool at build, and help and the manifest show the fact.
status: proposed
created: 2026-11-18
modified: 2026-11-18
---

# ADR-0181 - A Command may declare that it needs a terminal, and runs only at one

## Context

A full-screen dashboard, an editor, or a raw-mode prompt works only at a terminal. Without one, such an action today runs and then fails in its own way, or hangs reading a pipe, and an agent sees the Command as an MCP tool or an `invoke` target it can never use. [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) deferred the declaration: "A Command that declares it needs a terminal. Deferred to a later release. Nothing needs it today." Applications built on Loom now ship such Commands, so the deferral no longer holds.

Core already decides once per run whether it is at a terminal for questions: stdin and stderr are terminals, and the run is not under CI under [ADR-0114](0114-a-ci-run-is-not-interactive-draws-no-live-region-and-renders-as-the-standard-detectors-do.md). The interaction mark then can turn questions off. The mark is about questions, not about the terminal, so it plays no part here.

## Decision

- **The declaration.** `needsTerminal()` on a Command, and on the Application for the root, declares that the action needs a terminal. It takes no argument, may be called once, and closes after `action()`, as `passthrough()` does. A group that declares it is the `@loomcli/core/command-without-action` fault, as a group that declares passthrough or stdin is.
- **The node fact.** `inspect()` publishes `needsTerminal: boolean` on every `CommandNode`, so help, the manifest, and the MCP plugin read it from the graph.
- **The test.** A run has a terminal when `host.terminal.stdin.isTTY` and `host.terminal.stderr.isTTY` are both true and the run is not under CI, the terminal half of the interaction decision. Stdout plays no part, so `app top > out.log` runs. The interaction mark plays no part either, so `--no-input` still runs such a Command.
- **The failure.** A run of such a Command without a terminal fails before the action with `TerminalUnavailableError`, which extends `FatalError`, failure code `terminal-unavailable`, exit 1, and carries `command`, the routed path. Its sentence names the Command and the step: `Command "top" needs a terminal. Run "monitor top" with stdin and stderr at a terminal, outside CI.` Exit 1 says no input the operator supplies fixes it, as `InteractionUnavailableError`'s exit 1 does. Core holds the failure ahead of the middleware chain, so `--help` and every other takeover still answer. It takes the place of the input problems validation collected, and a structural fault, a configuration source's fault, and a validator's own developer error outrank it.
- **By name.** An invocation by name has no terminal, so `invoke` from an action and `app.invoke` always fail such a Command with the same failure, through the same test and no rule of their own.
- **MCP.** `mcpCommand` on a Command that needs a terminal is a build fault, `@loomcli/plugins/mcp/tool-needs-terminal`, so such a Command never reaches `tools/list`.
- **Help, the man page, and the manifest.** Help prints `Needs a terminal: stdin and stderr, outside CI.` under the Command's masthead, the man page prints the same sentence as a paragraph of its DESCRIPTION, and the manifest's Command entry carries `needsTerminal` after `hasAction`.

## Considered options

- **Reading the interaction decision.** Rejected. `--no-input` would then refuse a full-screen Command that asks no question, and the mark states the operator's wish about questions, not a fact about the terminal.
- **A Command fact in the constructor options, beside `hidden` and `deprecated`.** Rejected. Those facts describe how a listing shows the Command, and the root never carries them. This one governs the action, which the root has too, as `passthrough()` and `stdin()` do.
- **Excluding the Command from tools silently.** Rejected. An author who opts a Command in expects a tool, and a tool that is silently missing hides the mistake; a build fault names it.

## Consequences

This supersedes the deferral clause of ADR-0082's considered options, "A Command that declares it needs a terminal. Deferred to a later release. Nothing needs it today." ADR-0082's interaction decision and every other clause stand. The MCP plugin gains a fifth build fault beside those [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) and its later records name. ADR-0082 and ADR-0063 carry dated entries.

Core exports `TerminalUnavailableError`, `CommandBuilder` and `Application` gain `needsTerminal()`, `CommandMethod` gains `'needsTerminal'`, and `CommandNode` gains `needsTerminal`. The glossary gains Terminal need.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-18: Proposed with the declaration, the failure, and the MCP build fault.
