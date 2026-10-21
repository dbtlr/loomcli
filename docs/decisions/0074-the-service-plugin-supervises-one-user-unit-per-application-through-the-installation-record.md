---
type: adr
title: ADR-0074 - The service plugin supervises one user unit per application through the installation record
description: The service plugin contributes service install, uninstall, start, stop, restart, and status. It writes one systemd user unit on Linux or one launchd user agent on macOS, named by a required reverse-DNS label, that runs the application with argument words the graph must route. Only a distributed build installs, with no opt-in. The unit file is recorded through the installation record, so a file the plugin did not write is never overwritten. Status returns a typed result and exits 0 whenever it reports, with author rows from an optional probe. The plugin adds no time limit, redirects no output, and exports no supervisor seam.
status: accepted
created: 2026-10-13
modified: 2026-10-13
---

# ADR-0074 - The service plugin supervises one user unit per application through the installation record

## Context

Mimir and Heimdall each hand-built the same thing: Commands that install a long-running Command of the application as a per-user service, a systemd user unit on Linux and a launchd user agent on macOS, then start, stop, restart, report, and remove it. Heimdall's copy is a supervisor interface with two backends, unit and plist writers, a status report with application rows, and a refusal to install from a build that is not compiled. Loom owns the repeated machinery of shipping a command-line application, so it ships this once.

[ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) gives every installer that writes files one record of what it wrote and a shared writer that never overwrites or removes a file it did not record. A service unit is the case it names: an installer that deletes its unit by path also deletes a file someone else put there. [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) gives the daemon's log to the logging plugin, so a unit redirects nothing into a log file.

Both shipped copies run the unit from home with no environment, so the application finds its settings the way an interactive run does. Mimir added an opt-in that let a source build install a real unit and removed it, because a smoke test that passed the opt-in installed real units anyway. Heimdall bounds every service manager call with a five-second timeout and launchd's unload with a fifteen-second poll, where Loom adds no time limit to anything it runs.

## Decision

- **A plugin Command group.** `service(settings)` from `@loomcli/plugins/service` contributes one [plugin Command](../core/plugin-contract.md#plugin-commands), `service`, with the children `install`, `uninstall`, `start`, `stop`, `restart`, and `status`, and nothing else. An application installs it once, so it supervises one unit.
- **A required label.** The author names the unit with a reverse-DNS `label`, such as `com.acme.notes`, used as it is on both platforms: `<label>.service` under the systemd user directory, and the launchd `Label` and `<label>.plist` under `~/Library/LaunchAgents`. A label outside the grammar is a declaration error at the call.
- **Argument words the graph routes.** The author declares what the unit runs as argument words, such as `run: ['serve', '--port', '8080']`. When the graph is built, words that do not route to a Command with an action are a declaration error, so a renamed or mistyped Command fails the build rather than a supervised daemon. The unit runs the running application itself with those words, from the home directory, and sets no environment.
- **The program is a host fact.** The unit runs `host.program`, a new host fact holding the runtime and script prefix that `host.argv` omits: the binary alone for a compiled binary, and the runtime and the script otherwise. A compile target bakes `compiled: true` so core never guesses which, and a test overrides it as any host field. The plugin reads the program from the host and no process global for it; the user id alone comes from the process.
- **Distributed builds alone install.** `install` refuses a `source` or `development` build under [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), with no opt-in, because a unit outlives the working tree that ran it. A distributed bundle runs as its interpreter and its path. The other five Commands act from any build, so a developer can always remove a unit.
- **Through the installation record.** `install` writes the unit through the shared installed-files writer, so a unit file the record does not list refuses the install, and one the operator changed is kept. Moving a hand-built unit over is the adopting application's one-time step. `install` converges: it writes the unit when its text changed, loads and enables it, and always restarts it.
- **Typed status.** `status` returns a result that names the label, whether the unit is installed and running, the manager's state word, the process id, the unit file, notes such as an absent linger, and the author's rows, rendered by a default text view. It exits 0 whenever it produced a report, including a unit that is missing, stopped, failed, or whose state could not be read.
- **An author probe.** `probe`, the plugin's one optional setting, is a function called by `status` once the unit is installed. It receives the state status read and the run's host, `invoke`, signal, and log, and returns rows of names and string values. Configured values reach it through `invoke` of the application's own Command. A probe that throws fails the run through the ordinary failure path.
- **No time limit.** Service manager calls run until they exit. After launchd unloads an agent, the plugin waits until the agent is gone before loading it again, with no deadline and no retry loop. The run signal cancels any wait.
- **No output redirection.** The unit keeps each platform's default for the daemon's stdout and stderr: the journal under systemd, and none under launchd.
- **No supervisor seam.** The plugin exports no supervisor interface, no backend setting, and no test fake. Loom's tests fake the service managers' programs.
- **Linger stays the operator's.** The plugin never enables lingering or starts a login session; status notes when either is absent.

The contract and its acceptance are in [Service](../plugins/service.md).

## Considered options

- **A Command reference for what the unit runs.** Rejected. It cannot carry options, so it would make Heimdall's rule that settings live only in configuration a rule for every application.
- **The plugin reading `process.execPath` and `process.argv[1]`.** Rejected. A Bun-compiled binary's `argv[1]` is a virtual path that is not on disk, so the plugin would guess, and an action reads how the application was built from its host alone.
- **Unchecked argument words.** Rejected. A renamed Command would surface only as a daemon that the manager restarts forever.
- **A label derived from the application name or the repository.** Rejected. The name is permanent and shares one namespace per user, bare names collide, such as two programs named `mimir`, and a build without `--release` has no repository.
- **An opt-in that lets a source or development build install.** Rejected. Mimir shipped it and removed it.
- **The status exit codes `systemctl status` uses.** Rejected. A stopped unit is a fact the report states, and a caller such as Fleet that runs status unattended aborts on any exit but 0.
- **Heimdall's timeouts and bootstrap retries.** Rejected. Loom adds no time limit, waiting for the unload removes the race the retry covered, and an operator cancels a hung manager with the run signal.
- **Adopting a unit the plugin did not write, by flag or setting.** Rejected. It loosens the record's guarantee for every installer to save one deletion on machines that ran a hand-built copy.
- **A public supervisor interface with a fake and pluggable backends.** Rejected. With the Commands in Loom, an author's own code is the label, the words, and the probe, which a build check and a plain function call already cover, and a public backend interface makes every backend change a breaking one.

## Consequences

An application whose root declares arguments cannot install the plugin, the limit every plugin Command has under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md). On macOS, a daemon's logs reach disk only through the logging plugin's file destination. CI proves the backends against fake service manager programs, not against a running systemd user manager or launchd.

## Status

Accepted in 0.11.0.

## Changelog

- 2026-10-13: Proposed with the service contract.
- 2026-10-13: [ADR-0076](0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md), proposed, gives the installed-files module a force mode for an operator's `skills install --force`, so adoption by flag no longer loosens the guarantee for every installer. The service plugin never passes it, and its refusal to adopt a unit it did not write stands.
