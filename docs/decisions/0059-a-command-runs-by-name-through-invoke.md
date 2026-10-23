---
type: adr
title: ADR-0059 - A Command runs by name through invoke
description: Core gains invoke(path, values, options?), on the action context and on Application, which runs one Command of a built graph with named values lowered to the tokens argv would give, captures what the selected view and the lanes write, renders a failure's view into the captured messages and lets the caller's handler add structure, reports inputs by declared name, marks the failure and source contexts with invokedBy, and touches no process. run() is unchanged.
status: accepted
created: 2026-10-05
modified: 2026-10-24
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

Accepted in 0.9.0.

## Changelog

- 2026-10-05: Proposed with the contract.
- 2026-10-06: [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), proposed, gives the outcome and the caller's handler the failure form. `failed` gains `form`, and the handler's context gains `form` beside `application`, `path`, and `exitCode`, so a caller reads the failure's code, exit code, message by build, and hints with no handler at all. The hints this record kept out of the handler now reach it as plain lines inside the form. `invoke` writes no encoded line: its `messages` keep the failure view's text whatever media type the selected view declares. A working directory that `app.invoke` cannot capture resolves `failed`, under [An unreadable working directory](../core/host.md#an-unreadable-working-directory). It binds with this record and ADR-0064.
- 2026-10-07: [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), proposed, adds `release` to the host fields this record lists: an action's `invoke` takes `env`, `cwd`, `platform`, `readSource`, and `release` from its run's host, and `app.invoke` captures those five or takes whole-field overrides of them. A `host` field outside the five is the `@loomcli/core/invoke-options` defect. It binds when that record is accepted. ADR-0065 also replaces the packet this record's two doors render by: both render by the run's release facts, which `app.invoke` captures and an action's `invoke` reads from its run.
- 2026-10-14: [ADR-0081](0081-content-inputs-prepare-lazy-handles-and-one-command-claims-stdin.md), proposed, narrows equivalence to argv input for native content stdin. An invocation by name has no available stdin, including when called from an argv action. It binds when accepted; every other clause remains unchanged.
- 2026-10-19: [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md), proposed, adds `onProgress` to the invocation options: it receives each typed progress event of the call's run, in order, synchronously inside the report or region close that built it, and a call without it collects nothing. A call inherits no observer from its parent run. An observer that throws is called no more, and `invoke` rejects with that throw once the run settles, as it does for the failure handler's. The call has no terminal, so no live region draws into its captured output, and an `onProgress` that is not a function is the `@loomcli/core/invoke-options` defect. Every other clause stands. It binds when that record is accepted.
- 2026-10-22: [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md), proposed, ends the `@loomcli/core/invoke-options` defect the 2026-10-07 and 2026-10-19 entries name, and the view-selection fault for a starting view that is not a string. The types reject a malformed call, an `onProgress` that is not a function, and a `view` that is not a string, and a value that bypasses them meets the platform's own error. A `host` field outside the five and a `values` key other than `args`, `options`, and `passthrough` are not read. A starting view the routed Command cannot render stays the view-selection defect. Every other clause stands. It binds when that record is accepted.
- 2026-10-23: [ADR-0105](0105-core-is-the-only-process-listener-and-cleanup-runs-on-every-path-out.md), proposed, gives each call its own `defer`. Its cleanups run at the call's unwind, newest first, and finish before the call resolves its outcome. An action's call counts with its run, so its pending cleanups keep core listening and are called on the immediate path, while a cleanup inside `app.invoke` never starts core listening, because `app.invoke` touches no process. A call still claims no process signal. A cancelled outcome's `exitCode` gains 129 and 131. Every other clause stands. It binds when that record is accepted.
- 2026-10-23: [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md), proposed, replaces ADR-0105's entry above. Each call has its own `onShutdown`, scoped to the call, in place of `defer`. An action's call counts with its run, so its handlers keep core listening, while a handler inside `app.invoke` never starts core listening, because `app.invoke` touches no process, though a shutdown under way aborts every live run, `app.invoke` included, and calls the handler. A call still claims no process signal. A cancelled outcome's `exitCode` gains 129 and 131. Every other clause stands. It binds when that record is accepted.
- 2026-10-24: [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md), proposed, replaces `app.invoke`'s `host` option, the whole-field overrides of `env`, `cwd`, `platform`, `readSource`, and `release`, with `process`, one process handle the call binds when it enters and never replaces. `app.invoke` captures the call's host facts from that handle as `run()` does, the real process's handle when it is given none, and an action's `invoke` binds its own run's handle. A call still claims no process signal and never writes the handle's `exitCode`, and a shutdown under way on the handle's signal source aborts the call's run and calls its handlers. Named values, the captured output, the outcome, and every other clause stand. It binds when that record is accepted.
