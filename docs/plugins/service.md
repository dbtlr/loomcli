---
description: "The service plugin: running an application as a user service."
---

# Service plugin

This page documents the service plugin, which runs one of an application's Commands as a user service the platform supervises, and starts, stops, restarts, reports on, and removes it. An author installs it so an operator can keep the application running in the background.

```ts sketch
// @loomcli/plugins/service
import type { ActionContext, Host, Log, Plugin } from '@loomcli/core';

export interface ServiceDetail {
  readonly name: string; // the row's name, such as health
  readonly value: string; // the row's text, written as the author gives it
}
export interface ServiceState {
  readonly label: string; // the settings' label
  readonly unit: string; // the unit file's path
  readonly installed: boolean; // whether a file is at the unit's path
  readonly running: boolean; // whether the manager reports a running process
  readonly state: string; // the manager's state word, not installed, not loaded, or unknown
  readonly pid?: number; // the running process, when the manager reports one
  readonly notes: readonly string[]; // sentences about the user's session and an unreadable state
}
export interface ServiceStatus extends ServiceState {
  readonly details: readonly ServiceDetail[]; // the probe's rows, or none
  readonly logs?:
    | { readonly kind: 'files'; readonly files: readonly { readonly path: string; readonly exists: boolean }[] }
    | { readonly kind: 'manager'; readonly capture: 'journald' | 'none' };
}
export interface ProbeContext {
  readonly state: ServiceState; // what status read from the manager
  readonly host: Host; // the run's host
  readonly invoke: ActionContext<unknown>['invoke']; // the status action's invoke
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log
}
export interface ServiceSettings {
  /** The unit's reverse-DNS name, such as com.acme.notes. */
  readonly label: string;
  /** The argument words the unit runs the application with, such as ['serve']. */
  readonly run: readonly string[];
  /** Rows status adds under the unit, once the unit is installed. */
  readonly probe?: (context: ProbeContext) => Promise<readonly ServiceDetail[]> | readonly ServiceDetail[];
}
export declare function service(settings: ServiceSettings): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import type { InvocationOutcome } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { service } from '@loomcli/plugins/service';
import type { ServiceDetail } from '@loomcli/plugins/service';

export const notes = (healthRows: (outcome: InvocationOutcome) => readonly ServiceDetail[]) => new Application('notes', {
  description: 'Keep notes in sync.',
  plugins: [
    help(),
    service({
      label: 'com.acme.notes',
      run: ['serve', '--port', '8080'],
      probe: async ({ state, invoke }) => (state.running ? healthRows(await invoke(['health'], {})) : []),
    }),
  ],
});
```

```text
$ notes service install
Wrote /home/me/.config/systemd/user/com.acme.notes.service.
Started com.acme.notes.
$ notes service status
com.acme.notes: running (pid 4120)
  unit    /home/me/.config/systemd/user/com.acme.notes.service
  health  ok, v1.5.0
  note    Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.
$ notes service stop
Stopped com.acme.notes.
$ notes service uninstall
Removed /home/me/.config/systemd/user/com.acme.notes.service.
```

`service()` is the service plugin. It installs one of the application's own Commands as a per-user service the platform supervises, a systemd user unit on Linux and a launchd user agent on macOS, and starts, stops, restarts, reports, and removes it. Its identity is `@loomcli/plugins/service`, and its whole contribution is one [plugin Command](../core/plugin-contract.md#plugin-commands) group and one graph check. [ADR-0074](../decisions/0074-the-service-plugin-supervises-one-user-unit-per-application-through-the-installation-record.md) records the decision.

- **Settings.** `service()` judges `label` at the call and throws a `DeclarationError`, with the finding marked on `label`, for a label outside the grammar: [`@loomcli/plugins/service/settings`](../core/diagnostics.md#loomclipluginsservicesettings). A label is two or more segments joined by `.`, each a letter or digit followed by letters, digits, and `-`, and 247 characters at most, so `<label>.service` fits systemd's 255-character unit name. The settings type bounds `run` and `probe`, and the graph check below judges the run words.
- **The run words.** On every graph build, the plugin's `onGraphBuilt` hook reads `run` with [`locate`](../core/graph-inspection.md#locating-a-word), and throws a `DeclarationError` unless the words route to a Command with an action and every word reads: an option word names a declared option and has its value, a plain word fills an argument, before a bare `--` or after one, and a word after a bare `--` on a Command that declares the [passthrough mode](../core/options.md#passthrough) reaches its passthrough: [`@loomcli/plugins/service/run-unrouted`](../core/diagnostics.md#loomclipluginsservicerun-unrouted). The diagnostic repeats the words, passed through [`escapeControlCharacters`](../core/styles.md#strings-and-composition) and joined by spaces. So an unknown or renamed Command, a group, an unknown or misplaced option, an option still waiting for its value, and an unexpected argument each fail the build, except that on a Command with children that declares arguments a plain word that names no child fills one of them, as the parser reads it under [Judging the built graph](../core/lifecycle-hooks.md#judging-the-built-graph). No validator runs, so a value its validator rejects, and a required option or argument the words leave out, fail when the unit runs.
- **The Commands.** `service`, visible, with the description `Run this application as a background service.`, and six children, each visible with no arguments and no options: `install`, `Install the service and start it.`; `uninstall`, `Stop the service and remove it.`; `start`, `Start the service.`; `stop`, `Stop the service.`; `restart`, `Restart the service.`; and `status`, `Report whether the service is running.` `status` declares the result `ServiceStatus` with the views `text`, its default, and `json: json()` from the [formatter](format.md), so an installed formatter selects either and adds `jsonl`; the other five declare none. A root that declares arguments holds the plugin's Commands like any children, so such an application can install the plugin, and an application installs it once, because a second `service` collides under [Plugin Commands](../core/plugin-contract.md#plugin-commands).
- **Checks first.** Every child checks, in this order, before it reads or writes anything else, and fails with a `FatalError` and exit 1 at the first that fails. The platform: `host.platform` `linux` selects the systemd backend and `darwin` the launchd backend, and any other fails with `notes cannot run a service on win32. Run it on Linux with systemd or macOS with launchd.` Then the home, [`host.home`](../core/host.md#the-home-and-temporary-folders), which every child requires to be absolute on both platforms, because the unit runs from it: `notes cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.` Then, for `install` alone, the build, under Building below.
- **The unit's path.** On Linux, `<config>/systemd/user/<label>.service`, where `<config>` is `XDG_CONFIG_HOME` from `host.env` when it is absolute, else `<home>/.config`. On macOS, `<home>/Library/LaunchAgents/<label>.plist`. `<home>` is `host.home`.
- **What the unit runs.** The unit runs [`host.program`](../core/host.md) followed by `run`, with the home as its working directory and no environment of its own. The unit's description is the application's description, on one line with each line break read as one space, as help reads it, or its name when it has none.
- **Stopping cleanly.** systemd and launchd stop the unit with `SIGTERM` and wait before they kill it: systemd waits `TimeoutStopSec`, then sends `SIGKILL`. `SIGTERM` starts the [shutdown](../core/signals.md#the-shutdown), which cancels the service run and gives it the Application's `shutdown.timeout`, 500 ms unless the Application sets another, to unwind. A daemon whose runs need longer to finish a write raises `shutdown.timeout` to cover it and keeps it well under the supervisor's wait. A larger budget makes every cancelled run take longer to end when its work does not stop.
- **The managers.** The plugin runs `systemctl --user`, `loginctl`, and `launchctl` as child programs through [`host.spawn`](../core/host.md#child-programs) with `host.env` as their environment, found on its `PATH`, and with no shell. On Linux, an environment with no `XDG_RUNTIME_DIR` gains `/run/user/<uid>`, because `sudo -u` drops it and `systemctl --user` needs it. `<uid>` is the process's user ID, which the plugin reads from `host.uid`, and launchd's domain is `gui/<uid>`. A call that `install`, `uninstall`, `start`, `stop`, or `restart` makes runs until it exits, with no time limit; each read `status` makes runs for at most 5 seconds, under [Status](#status). The run signal ends any call with `SIGTERM`, and the run resolves its cancellation code under [Signals, cancellation, and shutdown](../core/signals.md). The plugin captures each call's output and prints none of it. A manager that cannot be started fails with exit 1: `notes cannot find systemctl. Install systemd, or run the command where it is available.`, naming the program. A call that exits with a code the steps below do not name fails with exit 1, naming the call and its code and pointing at the manager's own report: `systemctl --user restart com.acme.notes.service exited with 1. Run systemctl --user status com.acme.notes.service to see why.`, or on macOS `launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/com.acme.notes.plist exited with 5. Run launchctl print gui/501/com.acme.notes to see why.`

## The unit

```ini
[Unit]
Description=Keep notes in sync.
StartLimitIntervalSec=0

[Service]
ExecStart="/home/me/.local/bin/notes" "serve" "--port" "8080"
WorkingDirectory=/home/me
Restart=always
RestartSec=10
SuccessExitStatus=130 143

[Install]
WantedBy=default.target
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.acme.notes</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/me/.local/bin/notes</string>
    <string>serve</string>
    <string>--port</string>
    <string>8080</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/me</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

- **The text.** Each file is the text above with its values substituted, ending in one newline. The manager restarts the process whenever it exits, ten seconds apart, and never gives up; systemd counts the exit codes `130` and `143`, a run cancelled by `SIGINT` or `SIGTERM`, as a clean stop. The plugin writes each file with mode `644` whatever the umask, because launchd refuses a plist that its group or others can write.
- **systemd quoting.** Each `ExecStart` word is wrapped in `"`, with `\` written `\\`, `"` written `\"`, and `$` written `$$`. Every value doubles `%` to `%%`, so systemd expands no specifier.
- **plist quoting.** Every value escapes `&`, `<`, `>`, `"`, and `'` as XML entities.
- **No output.** The unit sets no standard output or standard error, so the platform's default applies: the journal under systemd, and nothing under launchd. A daemon's records reach a file through the [logging plugin](logging.md), whose file destination is how a macOS daemon keeps a log.
- **A value the file cannot hold.** A `host.program` word, the description after its line breaks read as spaces, or the home holding a control character fails `install` with exit 1 and nothing written: `notes cannot write its service unit because a path or its description holds a control character. Install notes where its path has none.`

## The children

- **Building.** `install` refuses a run whose `host.release.build` is not `distributed`: `notes is a source build, so it cannot install a service that would outlive it. Build it with loom build, then run the built notes service install.`, or `a development build` for `development`. There is no opt-in. The other five children act from any build.
- **The record.** The unit file is recorded in the plugin's file `service.json` in `applicationDirectory('installation', name, host)` through the module [Installed files](../core/installation-record.md#installed-files) defines, under its rules, which an absolute home always resolves. Before it runs any manager, `install` and `uninstall` read what the plugin's file records through the module, and a plugin's file that is damaged or holds an unknown `format` fails with `<record> cannot be read, so notes will not change the files it lists. Remove it and the files it lists, then run notes service install again.`, with `uninstall` in place of `install` for that child.
- **Unchanged.** `install` treats the unit as unchanged only when the file at the unit's path holds the rendered text and the plugin's file records it, alone, with that digest; it then prints `<path> is unchanged.` and writes nothing. Any other file at the path, including one with the rendered text that the record does not list, goes through the module, which refuses it as A refused install states.
- **An earlier unit.** When the plugin's file records a unit file at another path, as after the label or `XDG_CONFIG_HOME` changed, `install` first stops and disables the unit that file names, as `uninstall` does, and the module then removes it, or keeps it when it changed, with the `Removed` or `Kept` line below.
- **`install` on systemd.** The plugin renders the unit. Unless it is unchanged, it installs the unit through the module, prints `Wrote <path>.`, and runs `daemon-reload`. It then runs `enable <label>.service` and `restart <label>.service`, and prints `Started <label>.`
- **`install` on launchd.** The plugin renders the plist. Unless it is unchanged, it installs the plist through the module and prints `Wrote <path>.` Only then does it run anything but the stop of an earlier unit under An earlier unit: `launchctl enable gui/<uid>/<label>`, because a disabled agent cannot load, then it unloads a loaded agent as Stopping states and runs `bootstrap gui/<uid> <path>`, whether or not the plist changed, so launchd always loads the plist on disk, even after an earlier install stopped between writing it and loading it. It then prints `Started <label>.`
- **A refused install.** When the module refuses, because the file at the unit's path is one it did not record, one changed since it was recorded, or not a regular file, `install` fails, has written nothing, and has run no manager: `<path> was not written by notes service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run notes service install again.`, or `<path> changed since notes service install wrote it, so install leaves it alone. Remove it, then run notes service install again.` for a changed file, or `<path> is not a regular file, so install leaves it alone. Remove it, then run notes service install again.` for a link, a directory, or any other kind of file. A unit that a hand-built installer wrote at the same path is moved over by removing it once; the plugin never takes over a file it did not write.
- **Loaded.** On launchd, an agent is loaded when `launchctl print gui/<uid>/<label>` exits 0, and not loaded when it exits 113; any other code is the failure under The managers.
- **Stopping on launchd.** The plugin runs `bootout gui/<uid>/<label>`. Exit codes 3 and 113 mean it was not loaded, and 36 means an unload already in progress; each is no failure. It then runs `print` every 250 milliseconds until the agent is not loaded, with no deadline; the run signal ends the wait. It loads the agent again only after that, so it never retries `bootstrap`.
- **Not installed.** `start`, `stop`, and `restart` with no file at the unit's path fail with exit 1 and run nothing: `com.acme.notes is not installed. Run notes service install first.`
- **`start`.** systemd runs `start <label>.service`. launchd runs `kickstart gui/<uid>/<label>` for a loaded agent and `bootstrap gui/<uid> <path>` for one that is not. It prints `Started <label>.`
- **`stop`.** systemd runs `stop <label>.service`. launchd unloads the agent as Stopping states and leaves the plist, because `KeepAlive` would relaunch a stopped process. It prints `Stopped <label>.`
- **`restart`.** systemd runs `restart <label>.service`. launchd runs `kickstart -k gui/<uid>/<label>` for a loaded agent and `bootstrap` for one that is not. It prints `Restarted <label>.`
- **`uninstall`.** It reads the record first, under The record. With a file at the unit's path that the plugin's file does not record, it fails and runs nothing: `<path> was not written by notes service install, so uninstall leaves it alone. Remove it with whatever installed it.` With nothing recorded and no file at the path, it prints `com.acme.notes is not installed, so there is nothing to remove.` and exits 0. Otherwise it acts on every unit file the plugin's file records, the unit's path or an earlier one left by a changed label or `XDG_CONFIG_HOME`, each named by its file name, whether or not the file is still there, because a unit the manager loaded keeps running after its file is deleted. For each, systemd runs `stop <name>`, where exit 5 means not loaded and is no failure, then `disable <name>` when its file is present; launchd unloads the agent as Stopping states. The module then removes the recorded files, and systemd runs `daemon-reload`. It prints `Removed <path>.` for a removed file, `<path> was already gone.` for a recorded file that was not there, and for a file the module kept because it changed, `Kept <path> because it changed since notes service install wrote it. Remove it yourself when it is no longer needed.`, and exits 0.
- **Output.** `Wrote`, `is unchanged`, `Removed`, `already gone`, and `Kept` lines go through `out.info`, and `Started`, `Stopped`, `Restarted`, and `nothing to remove` through `out.success`, so stdout stays empty for every child but `status`. The examples above omit the glyph each lane view adds. Every path, label, and program name a sentence repeats passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Every refusal and manager failure above is a `FatalError` that exits 1.

## Status

- **Reading the state.** `installed` is whether a file is at the unit's path. Status asks the manager whether or not the file is there, because a unit the manager loaded keeps running after its file is deleted. On systemd, it runs `show <label>.service --property=ActiveState,MainPID`, and `state` is the `ActiveState` value, `running` is `ActiveState` `active` with a `MainPID` above 0, and `pid` is that `MainPID`. On launchd, an agent that is not loaded reads `state` `not loaded`; a loaded one reads `state` from the `state = ` line of `print`'s top level, one tab in, `running` is that state `running` or a `pid = ` line of digits there, and `pid` is that number. A unit with no file at its path that the manager reports as not running, `ActiveState` `inactive` or an agent that is not loaded, reads `state` `not installed`.
- **The read limit.** Each read status makes, the state read above and the session read below, runs for at most 5 seconds from its start, a limit that no setting changes. At the limit the plugin ends the read with `SIGKILL`, so a manager that ignores `SIGTERM` still ends. While a read is running, a run-scoped [`onShutdown`](../core/signals.md#onshutdown) handler kills it with `SIGKILL`, so it never outlives the process. A read ran out only when the plugin's own limit fired before it ended: a read that exits 143 on its own is a call that exits with a code the reading does not name, and a run cancelled during a read resolves its cancellation code with no note about the limit. [ADR-0126](../decisions/0126-service-status-bounds-each-manager-read-at-five-seconds-and-reports-an-unknown-state-when-one-runs-out.md) records the decision.
- **An unreadable state.** A manager that cannot be started, or a call that exits with a code the reading does not name, reads `state` `unknown` and `running` false, with the note `systemctl --user could not report com.acme.notes.service (exit 1). Run systemctl --user status com.acme.notes.service to see why.`, or `launchctl could not report gui/501/com.acme.notes (exit 5). Run launchctl print gui/501/com.acme.notes to see why.`, or for a program that cannot be started, `notes cannot find systemctl. Install systemd, or run the command where it is available.` A state read that runs out reads `state` `unknown` and `running` false too, with the note `systemctl --user did not report com.acme.notes.service within 5 seconds, so status ended the call. Run systemctl --user status com.acme.notes.service to see why.`, or `launchctl did not report gui/501/com.acme.notes within 5 seconds, so status ended the call. Run launchctl print gui/501/com.acme.notes to see why.`
- **Session notes.** On systemd, an installed unit runs `loginctl show-user <uid> --property=Linger`, and `Linger=no` adds `Lingering is off, so <label> stops when you log out. Run loginctl enable-linger to keep it running.` On launchd, an installed unit runs `print gui/<uid>`, and exit 113 adds `There is no login session, so <label> starts when you log in.` A session call that fails in any other way, one that runs out included, adds no note. The plugin never enables lingering or starts a session.
- **The probe.** When `probe` is set and the unit is installed, status calls it once with the state it read, whatever that state is, and the status action's host, `invoke`, signal, and log, and awaits it. Its rows become `details` in the order it returns them; an absent probe, or a unit that is not installed, gives none. A probe that throws or rejects takes the ordinary failure path, as [When author code fails](#when-author-code-fails) states.
- **Logs.** When the [logging plugin](logging.md#the-file-fact) is installed with file destinations, status reads its `loggingFiles` extension fact and calls `resolveLoggingFiles`. Each resolved file gets a `log` row, in declaration order. A file that does not exist still shows its path, followed by `(no records yet)`. Status reads whether each file exists before it calls the manager; its own events then reach each file at that file's level, as any run's do, so a file at `debug` can exist after a status run and show no note on the next. JSON adds `logs: { kind: 'files', files: [{ path, exists }] }`, with absolute paths and an existence flag for each file. The existence flag says nothing about the contents of an existing file.
- **The environment used for logs.** Status resolves paths with its own `host.env`, `host.home`, and `host.platform`, including the operator's log-file variable. It does not read the service's environment from the manager. The unit inherits the manager's environment, which can differ from the shell running status, including the log-file variable and XDG directories. A reported path therefore describes the status host; it names the service's actual file only when those settings agree. This keeps status independent of manager-specific environment formats. To resolve a service override, run status with the same variables the manager gives the service.
- **Console capture.** With a logging installation that declares no files, status adds a `log` row naming the service manager's console capture: `Service console output goes to journald.` on systemd, or `Service console output goes nowhere: launchd discards it.` on launchd. JSON adds `logs: { kind: 'manager', capture: 'journald' }` or `logs: { kind: 'manager', capture: 'none' }`. This reports the generated unit's console capture, not external destinations such as OpenTelemetry or capture overrides made outside the plugin. Without the logging plugin, there is no `log` row and no `logs` field.
- **The result.** status sends one `ServiceStatus` through `out.results`: the state, then `details` and, when present, `logs`. Its members appear in the order the type lists them, and `pid` is absent when the manager reports none.
- **The text view.** The first line is `<label>: <summary>`, where the summary is `running (pid <pid>)` for a running unit with a pid, `running` without one, and otherwise the state word. Then two-space-indented rows: `unit` and the unit's path, each `log` row, each detail's name and value, and `note` and each note, the names padded to the longest name plus two spaces. Manager words and paths pass through `escapeControlCharacters`; the probe's names and values are printed as the author gives them.
- **Exit code.** status exits 0 whenever it produced a report: installed or not, running, stopped, failed, or in an unreadable state, a read that ran out included. Only the checks under Checks first, a cancelled run, and a probe that throws or rejects fail it.
- **Names.** `service`, `ServiceSettings`, `ServiceStatus`, `ServiceState`, `ServiceDetail`, and `ProbeContext` are exported from `@loomcli/plugins/service`.

## At -v and in the log

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Ran systemctl --user show notes.service --property=ActiveState,MainPID.` | Once for each read or refused service manager call that started, once it ends: the reads `status` makes, each `print` of launchd's unload wait, a change call whose code the plugin refused, and a read the five-second limit ended. A program that cannot start writes no line, because its failure names it, and neither does a call the run's cancellation ended. |

An accepted call that changes the unit records `Program run.` instead, so it shows no duplicate `Ran` line. The words are the program and its arguments joined by single spaces, as a manager failure repeats a call: `Ran systemctl --user show notes.service --property=ActiveState,MainPID.`, `Ran loginctl show-user 501 --property=Linger.`, and `Ran launchctl print gui/501/com.acme.notes.` A `Ran` line that cannot be written is let go, so the call's answer, its `Program run.` event, and the steps after it are unaffected. The `Wrote`, `is unchanged`, `Removed`, `Started`, `Stopped`, and `Restarted` lines already confirm the plugin's other acts, so they have no `-v` line.

- **Log events.** Each is an `info` [change event](../core/logging.md#change-events) that names `@loomcli/plugins/service`. The unit file and the plugin's installation record file record `File written.` at each write and `File removed.` when deleted. Each call that changes a unit records `Program run.` once it exits with a code the plugin accepts: `systemctl` with `--user` and `daemon-reload`, `enable`, `restart`, `start`, `stop`, or `disable`, and `launchctl` with `enable`, `bootout`, `bootstrap`, or `kickstart`. `arguments` holds the words passed, such as `['--user', 'stop', 'notes.service']`, and `code` the code accepted, such as `5` from `systemctl stop` for a unit that is not loaded. The reads, `systemctl show`, `loginctl show-user`, and `launchctl print`, record nothing, and so does a call whose code fails the run. A leftover staging file the plugin removes beside a file it writes, which a run that was stopped mid-write left, records `File removed.` too.
- **Log lines.** Each `-v` line is one `log.debug` call and each `-vv` line one `log.trace` call, whose message is a constant [message template](../core/logging.md#message-templates) with the values the line shows in the event's fields, so the screen reads the sentence the table shows and a record keeps the template. Core shows each through its [log-line view](../core/logging.md#at--v) under the run's [verbosity](../core/verbosity.md): `-v -q` shows none, the lines go to stderr whether or not it is a terminal, an [`app.invoke`](../core/invocation.md#invocation-by-name) shows them in its `messages` when its values ask for them, and under an action's `invoke` or an [MCP](mcp.md) tool call they follow the outermost run's verbosity. Every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Each line is a log event, so an installed [logging plugin](logging.md) records it at its level, and each change event the plugin records shows at `-v` too, as every `info` event does. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto `log`.

## When author code fails

The `probe` setting is the one author function the plugin calls. A probe that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The plugin does not judge the rows a probe returns, so a row the text view cannot print is the author's defect and fails the same way.
