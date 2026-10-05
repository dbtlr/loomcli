---
type: adr
title: ADR-0059 - A Command runs by name through invoke
description: Core gains invoke(path, values, options?), on the action context and on Application, which runs one Command of a built graph with named values lowered to the tokens argv would give, captures what the selected view and the lanes write, renders a failure's view into the captured messages and lets the caller's handler add structure, reports inputs by declared name, marks the failure and source contexts with invokedBy, and touches no process. run() is unchanged.
status: proposed
created: 2026-10-05
modified: 2026-10-05
---

# ADR-0059 - A Command runs by name through invoke

## Context

An agent protocol, a test harness, and an application that embeds another all need to run a Command without a command line: with named values in, and a structured outcome out. [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md) already lets an Application run again, each run capturing the host and building the graph anew, and core's module state is keyed by immutable declarations, so two runs share nothing mutable. Concurrent runs are already tested. What stands in the way is that `run()` is the wrong door for this caller:

- An action cannot reach its Application, so a plugin Command that wants to run other Commands would need the author to pass the Application in, which is a cycle.
- Named values would be spelled back into argv for the parser to undo.
- The result reaches stdout as text and a failure reaches stderr as text, and `run()` returns an exit code alone. ADR-0009 rejected returning more from `run()`.
- Every `run()` sets `process.exitCode`, installs process listeners when a plugin owns the signals slot, reads terminal facts from the real process, and defaults an unset stream to real stdio, which corrupts a stdio protocol stream.
- Each call rebuilds the graph and reruns every hook.

An MCP plugin could build argv and parse its own JSON output with no core change. Every other embedding host would then rebuild the same round trip, so the operation belongs to core.

## Decision

- **One operation, two doors.** `invoke(path, values, options?)` runs one Command of a built graph. An action reaches it on its context, bound to the graph its run built and to that run's declared-value checks, so no hook runs again. An embedding host reaches it as `app.invoke`, which builds the graph for each call and runs every hook, as `run()` does. Both render by the Application's packet.
- **An invocation by name is an argv invocation without the spelling.** `invoke` behaves as `run()` does on the argv that spells the same path and values. Every other rule follows from this one: the same table, input sources, defaults, validators, middleware, translators, failure views, exit codes, and precedence. A divergence on the same inputs is a defect.
- **Values mirror the action context.** `values` is `{ args, options, passthrough }`, keyed by declared name, because an author's argument and option may share a name. The values are loosely typed, `string | number | boolean | readonly (string | number)[]`, and `invoke` does not type its path. A form that takes a Command value can arrive later through the same function.
- **Values lower to tokens.** A string is its token, a number is the text `String(value)` gives, a Boolean on a Boolean option is a spelling or absence, a number on a counted option is that many occurrences, `true` on a string option with an implied value is the bare spelling, and an array is one occurrence per element. Lowering happens once, where the parser produces its result, never by building argv text. An unlowerable value is an `InputError` problem with exit 2.
- **Unknown names fail as argv's do.** An unknown option name is `UnknownOptionError`, an unknown argument name `UnexpectedArgumentError`, and an unknown path element `UnknownCommandError`, all exit 2.
- **Problems report by name.** An invocation by name types no spelling, so every problem core reports names the input by its declared name, the key the caller wrote.
- **Capture by view.** `output` is every byte written to stdout and `messages` every byte written to stderr. Stdin is empty, every terminal fact is not a TTY, and the captured text is plain. `view` sets the starting view selection a middleware's assignment would set, and a name the Command cannot render is the existing view-selection defect, named for `invoke()`.
- **The failure view renders, and the caller's handler adds structure.** A failure takes `run()`'s path: translators, `onFailure` hints, then the failure view, by build, into `messages`. Then the caller's `failure` handler receives the failure and `{ application, path, exitCode }` and returns what `failed.failure` holds. With no handler, `failed.failure` is the failure. A handler that throws makes `invoke` reject with that throw. A cancellation never reaches it.
- **Where the run was.** The failure view context and the failure hook context gain `invokedBy: 'argv' | 'name'`, so a hint that points at a command line, such as help's, skips an invocation by name, and a suggestion offers names.
- **An invocation is a run with no process.** It installs no process listener, sets no `process.exitCode`, touches no real stdio, and calls no `process.exit()`. An action's `invoke` takes `env`, `cwd`, `platform`, and `readSource` from its run's host. `app.invoke` captures those four or takes whole-field overrides of them, and nothing else.
- **Cancellation flows down.** An action's call derives its signal from its run's signal and the call's own `signal`, and a cancelled call resolves `cancelled` with the code of the cause that aborted it.
- **Loom adds no limit.** Calls may overlap and nest. Loom adds no queue, limit, or timer.
- **The outcome.** `completed` with `output` and `messages`, `failed` with `failure`, `exitCode`, `output`, and `messages`, or `cancelled` with `exitCode`.

## Considered options

- **An MCP plugin that builds argv and parses its own output.** Rejected. It needs no core change, but every embedding host would repeat the round trip, and the parser would undo what the plugin spelled.
- **`run()` as the embedding door.** Rejected. It sets process state, reads the real process, returns an exit code alone, and an action cannot reach it. Widening `run()`'s return would reopen what ADR-0009 settled for every caller that wants one exit code.
- **Typed values handed straight to the validators.** Rejected. Validators receive raw tokens under `SuppliedInputs`, and an input schema describes the value one token must satisfy, so a validator such as the catalog's `integer()` would meet input it was never written for. Lowering keeps one input path.
- **Returning the raw result value.** Rejected. It would be a second encoding beside views, and its document would drift from what `--format json` prints. The view model stays the only encoding, and a caller selects a JSON view.
- **A handler that receives raw throws and replaces the failure view.** Rejected. A handler that saw foreign throws would bypass the author's translators, and one that replaced the view would lose the build-aware defect text, so a distributed build could leak a defect's reason. The view still renders, and the handler adds structure to a translated failure.
- **Values as one flat record.** Rejected. An argument and an option may share a name, and the action context already keeps them apart.
- **`invoke` on the middleware context.** Rejected. A middleware wraps one invocation, and running others from inside it would put a server inside whatever Command an option routed to. A Command that serves others does so in its own action.
- **A concurrency limit or a timeout in core.** Rejected. Core bounds no author's work by time or count, and an application whose actions cannot overlap serializes them itself.

## Consequences

`invoke` returns the structured outcome ADR-0009 rejected for `run()`. `run()` keeps returning an exit code alone, and ADR-0009's reason, that an embedding host observes one result whichever way the invocation failed, holds for `invoke` too: the outcome is that one result.

The action context gains a member, so the implementation measures editor latency against the baseline. The failure contexts gain a field, which a hint plugin reads. Help's hint and the suggestions plugin change behavior for an invocation by name alone. `SourceContext` gains the same field, so a configuration source names a problem's option by its declared name under `invoke`, as core's own problems do.

`invoke` is the path a test harness and the MCP plugin of [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) take. [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md), [ADR-0018](0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md), [ADR-0041](0041-every-action-reads-the-frozen-graph-and-its-routed-command.md), and [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) carry dated entries.

## Status

Proposed 2026-10-05 with the contract in [Invocation by name](../core.md#invocation-by-name). It moves to accepted inside the release PR of the release that ships the implementation: `invoke` on the action context and on Application, the equivalence wedge passing for jsonkit's pinned invocations, process isolation proven with a sentinel host, and the acceptance in that section, under Node and Bun.

## Changelog

- 2026-10-05: Proposed with the contract.
