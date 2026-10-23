---
description: "The service plugin: running an application as a user service."
---

# Service plugin

This page documents the service plugin, which runs one of an application's Commands as a user service the platform supervises, and starts, stops, restarts, reports on, and removes it. An author installs it so an operator can keep the application running in the background.

```ts
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
import { help } from '@loomcli/plugins/help';
import { service } from '@loomcli/plugins/service';

export const notes = new Application('notes', {
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
- **The run words.** On every graph build, the plugin's `onGraphBuilt` hook reads `run` with [`locate`](../core/graph-inspection.md#locating-a-word) as the words before a final `--`, and throws a `DeclarationError` unless the result is an `option` position, or a `passthrough` position when `run` holds a bare `--`, whose Command has an action: [`@loomcli/plugins/service/run-unrouted`](../core/diagnostics.md#loomclipluginsservicerun-unrouted). The diagnostic repeats the words, passed through [`escapeControlCharacters`](../core/styles.md#strings-and-composition) and joined by spaces. So an unknown or renamed Command, a group, an unknown or misplaced option, an option still waiting for its value, and an unexpected argument each fail the build under [Judging the built graph](../core/lifecycle-hooks.md#judging-the-built-graph). No validator runs, so a value its validator rejects, and a required option or argument the words leave out, fail when the unit runs.
- **The Commands.** `service`, visible, with the description `Run this application as a background service.`, and six children, each visible with no arguments and no options: `install`, `Install the service and start it.`; `uninstall`, `Stop the service and remove it.`; `start`, `Start the service.`; `stop`, `Stop the service.`; `restart`, `Restart the service.`; and `status`, `Report whether the service is running.` `status` declares the result `ServiceStatus` with the views `text`, its default, and `json: json()` from the [formatter](format.md), so an installed formatter selects either and adds `jsonl`; the other five declare none. A root that declares arguments cannot hold children, so such an application cannot install the plugin, and an application installs it once, because a second `service` collides under [Plugin Commands](../core/plugin-contract.md#plugin-commands).
- **Checks first.** Every child checks, in this order, before it reads or writes anything else, and fails with a `FatalError` and exit 1 at the first that fails. The platform: `host.platform` `linux` selects the systemd backend and `darwin` the launchd backend, and any other fails with `notes cannot run a service on win32. Run it on Linux with systemd or macOS with launchd.` Then `HOME`, which every child requires to be absolute on both platforms, because the unit runs from it: `notes cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.` Then, for `install` alone, the build, under Building below.
- **The unit's path.** On Linux, `<config>/systemd/user/<label>.service`, where `<config>` is `XDG_CONFIG_HOME` when it is absolute, else `$HOME/.config`. On macOS, `$HOME/Library/LaunchAgents/<label>.plist`.
- **What the unit runs.** The unit runs [`host.program`](../core/host.md) followed by `run`, with the working directory `HOME` and no environment of its own. The unit's description is the application's description, on one line with each line break read as one space, as help reads it, or its name when it has none.
- **Stopping cleanly.** systemd and launchd stop the unit with `SIGTERM` and wait before they kill it: systemd waits `TimeoutStopSec`, then sends `SIGKILL`. `SIGTERM` starts the [shutdown](../core/signals.md#the-shutdown), which cancels the service run and gives it the Application's `shutdown.timeout`, 500 ms unless the Application sets another, to unwind. A daemon whose runs need longer to finish a write raises `shutdown.timeout` to cover it and keeps it well under the supervisor's wait. A larger budget makes every cancelled run take longer to end when its work does not stop.
- **The managers.** The plugin runs `systemctl --user`, `loginctl`, and `launchctl` as child processes with `host.env` as their environment, found on its `PATH`, and with no shell. On Linux, an environment with no `XDG_RUNTIME_DIR` gains `/run/user/<uid>`, because `sudo -u` drops it and `systemctl --user` needs it. `<uid>` is the process's user ID, which the plugin reads from `host.uid`, and launchd's domain is `gui/<uid>`. A call runs until it exits, with no time limit; the run signal ends it with `SIGTERM`, and the run resolves its cancellation code under [Signals, cancellation, and shutdown](../core/signals.md). The plugin captures each call's output and prints none of it. A manager that cannot be started fails with exit 1: `notes cannot find systemctl. Install systemd, or run the command where it is available.`, naming the program. A call that exits with a code the steps below do not name fails with exit 1, naming the call and its code and pointing at the manager's own report: `systemctl --user restart com.acme.notes.service exited with 1. Run systemctl --user status com.acme.notes.service to see why.`, or on macOS `launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/com.acme.notes.plist exited with 5. Run launchctl print gui/501/com.acme.notes to see why.`

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
- **A value the file cannot hold.** A `host.program` word, the description after its line breaks read as spaces, or `HOME` holding a control character fails `install` with exit 1 and nothing written: `notes cannot write its service unit because a path or its description holds a control character. Install notes where its path has none.`

## The children

- **Building.** `install` refuses a run whose `host.release.build` is not `distributed`: `notes is a source build, so it cannot install a service that would outlive it. Build it with loom build, then run the built notes service install.`, or `a development build` for `development`. There is no opt-in. The other five children act from any build.
- **The record.** The unit file is recorded in the plugin's file `service.json` in `applicationDirectory('installation', name, host)` through the module [Installed files](../core/installation-record.md#installed-files) defines, under its rules, which `HOME` being absolute always resolves. Before it runs any manager, `install` and `uninstall` read what the plugin's file records through the module, and a plugin's file that is damaged or holds an unknown `format` fails with `<record> cannot be read, so notes will not change the files it lists. Remove it and the files it lists, then run notes service install again.`, with `uninstall` in place of `install` for that child.
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
- **An unreadable state.** A manager that cannot be started, or a call that exits with a code the reading does not name, reads `state` `unknown` and `running` false, with the note `systemctl --user could not report com.acme.notes.service (exit 1). Run systemctl --user status com.acme.notes.service to see why.`, or `launchctl could not report gui/501/com.acme.notes (exit 5). Run launchctl print gui/501/com.acme.notes to see why.`, or for a program that cannot be started, `notes cannot find systemctl. Install systemd, or run the command where it is available.`
- **Session notes.** On systemd, an installed unit runs `loginctl show-user <uid> --property=Linger`, and `Linger=no` adds `Lingering is off, so <label> stops when you log out. Run loginctl enable-linger to keep it running.` On launchd, an installed unit runs `print gui/<uid>`, and exit 113 adds `There is no login session, so <label> starts when you log in.` A session call that fails in any other way adds no note. The plugin never enables lingering or starts a session.
- **The probe.** When `probe` is set and the unit is installed, status calls it once with the state it read, whatever that state is, and the status action's host, `invoke`, signal, and log, and awaits it. Its rows become `details` in the order it returns them; an absent probe, or a unit that is not installed, gives none. A probe that throws or rejects takes the ordinary failure path, as [When author code fails](#when-author-code-fails) states.
- **The result.** status sends one `ServiceStatus` through `out.results`: the state, then `details`. Its members appear in the order the type lists them, and `pid` is absent when the manager reports none.
- **The text view.** The first line is `<label>: <summary>`, where the summary is `running (pid <pid>)` for a running unit with a pid, `running` without one, and otherwise the state word. Then two-space-indented rows: `unit` and the unit's path, each detail's name and value, and `note` and each note, the names padded to the longest name plus two spaces. Manager words and paths pass through `escapeControlCharacters`; the probe's names and values are printed as the author gives them.
- **Exit code.** status exits 0 whenever it produced a report: installed or not, running, stopped, failed, or in an unreadable state. Only the checks under Checks first, a cancelled run, and a probe that throws or rejects fail it.
- **Names.** `service`, `ServiceSettings`, `ServiceStatus`, `ServiceState`, `ServiceDetail`, and `ProbeContext` are exported from `@loomcli/plugins/service`.

## When author code fails

The `probe` setting is the one author function the plugin calls. A probe that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The plugin does not judge the rows a probe returns, so a row the text view cannot print is the author's defect and fails the same way.
