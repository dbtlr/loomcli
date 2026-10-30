---
type: adr
title: ADR-0126 - Service status bounds each manager read at five seconds and reports an unknown state when one runs out
description: The service plugin's status bounds each call it makes to read the unit, the state read and the session read, at a fixed 5 seconds that no setting changes. A read that runs out is ended with SIGKILL, so a manager that ignores SIGTERM still ends. A state read that runs out reads the state unknown with a note naming the call and the limit, and status still exits 0; a session read that runs out adds no note. The plugin tells the limit from its own timer, never from the exit code, and a cancelled run still resolves its cancellation code. install, uninstall, start, stop, restart, and launchd's unload wait keep ADR-0074's rule of no time limit. This narrows ADR-0074's 'No time limit' bullet to the calls that change a unit.
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0126 - Service status bounds each manager read at five seconds and reports an unknown state when one runs out

## Context

[ADR-0074](0074-the-service-plugin-supervises-one-user-unit-per-application-through-the-installation-record.md) runs every service manager call until it exits, with no time limit, and rejected Heimdall's five-second timeouts because "Loom adds no time limit" and an operator cancels a hung manager with the run signal. The same record names Fleet as a caller that runs `status` unattended. An unattended caller has no operator to send the run signal, so a `systemctl`, `loginctl`, or `launchctl` read that never answers leaves `status` waiting with it, and a provisioner that waits on `status` waits forever. Heimdall bounds each manager call at 5 seconds so that `status` always answers.

The owner has since called the rule against timers overstated: a timer is fine for a real need. [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md)'s timer rule governs core, which never uses a timer to cancel or limit work, and [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) keeps timers off the process handle, so `host.spawn` sets no time limit and a caller that wants one sets it.

The run signal ends a child with `SIGTERM` alone, so a manager that ignores `SIGTERM` keeps a call pending after the run is cancelled. A child that `SIGTERM` ends exits with code 143, the same code a manager that exits 143 on its own reports, so the exit code cannot tell a read the plugin ended from one that failed.

The owner ruled on scope: only the reads `status` makes are bounded, at Heimdall's fixed 5 seconds, and the calls that change a unit keep ADR-0074's rule, because `systemctl start` legitimately blocks until the unit has started.

## Decision

- **Status's reads are bounded.** Each call `status` makes to read the unit runs for at most 5 seconds: the state read, `systemctl --user show` on systemd and `launchctl print gui/<uid>/<label>` on launchd, and the session read, `loginctl show-user` on systemd and `launchctl print gui/<uid>` on launchd. Each read has its own bound, measured from its start.
- **The bound is fixed.** No setting, option, or variable changes it, and an author cannot turn it off.
- **A read that runs out is ended with `SIGKILL`.** At the bound the plugin ends the read with `SIGKILL`, which a manager cannot ignore, so `status` answers whatever the manager does with `SIGTERM`. The run signal still ends a read with `SIGTERM`. While a read is running, a run-scoped `onShutdown` handler kills it with `SIGKILL`, so a read never outlives the process.
- **A state read that runs out reads unknown.** `state` reads `unknown` and `running` false, as for any state the manager could not report, with a note that names the call and the limit and points at the manager's own report. `status` exits 0, because it produced a report.
- **A session read that runs out adds no note.** It is a session call that failed, and a session call that fails in any way but the one its note names adds none.
- **The plugin reads its own timer.** A read is one that ran out only when the plugin's own limit fired before the read ended. A read that exits 143 on its own is a state the manager could not report, with its code in the note. A run cancelled while a read is running resolves its cancellation code, such as 130, and prints no note about the limit.
- **The timer is the plugin's.** The service plugin starts a timer of its own for each read, beside the run signal rather than combined with it: the run signal ends the read with `SIGTERM`, and the timer ends it with `SIGKILL`. As with the toolchain's lockfile preparation, the caller that wants a limit sets it. Core, the process handle, and `host.spawn` gain no timer.
- **The calls that change a unit keep no time limit.** `install`, `uninstall`, `start`, `stop`, and `restart` run their manager calls, the `launchctl print` that tells whether an agent is loaded included, until they exit, and launchd's wait for an unloaded agent has no deadline, as ADR-0074 states. The run signal ends any of them.

[Service](../plugins/service.md) carries the contract.

## Considered options

- **Bound every manager call, the calls that change a unit included.** Rejected by the owner's ruling: `systemctl start` legitimately blocks until the unit has started, so a bound fails a start that would have succeeded.
- **A limit the author sets.** Rejected by the owner's ruling, which fixed Heimdall's 5 seconds.
- **A note when a session read runs out.** Not taken. The session note states a fact about the user's session, and a session call that fails in any other way adds none, so a read that runs out follows the same rule.
- **`SIGTERM` at the bound, then `SIGKILL` after a grace.** Not taken. A read changes nothing, so it has nothing to unwind, and a grace would add a second figure.
- **Telling a read that ran out by its exit code.** Rejected. A manager that `SIGTERM` ends exits 143, the same code one that exits 143 on its own reports.

## Consequences

`status` answers within 5 seconds per read, so within about 10 seconds when both its reads hang, and an unattended caller always gets a report. A manager that takes longer than 5 seconds to answer a read that would have succeeded reads unknown. The calls that change a unit still wait as long as the manager takes, so an unattended caller of `install`, `start`, `stop`, `restart`, or `uninstall` still relies on the run signal.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-30: Proposed with the contract. It narrows ADR-0074's "No time limit" to the calls that change a unit and narrows its rejection of Heimdall's timeouts to those calls. ADR-0074 carries a dated entry.
