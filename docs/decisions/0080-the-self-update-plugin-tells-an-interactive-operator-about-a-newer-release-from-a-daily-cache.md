---
type: adr
title: ADR-0080 - The self-update plugin tells an interactive operator about a newer release from a daily cache
description: The self-update plugin gains update notices. After the action of a run at a terminal, its middleware reads a cache file and prints one out.info line when the cache names a newer release on the running binary's release channel. A cache older than a day is refreshed by a detached copy of the application, started through host.program and the hidden self-update --refresh-notice, which the run never waits for, so no run waits on the network. The cache lives in a new cache kind of applicationDirectory. The author turns notices off with notices false or names an extra variable, and the operator sets NO_UPDATE_NOTIFIER.
status: accepted
created: 2026-10-14
modified: 2026-10-20
---

# ADR-0080 - The self-update plugin tells an interactive operator about a newer release from a daily cache

## Context

[ADR-0073](0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md) gives the self-update Command and leaves update notices out: an operator learns of a newer release only by running `self-update --check`. Tools that update themselves, such as npm's update-notifier and the GitHub CLI, tell the operator during an ordinary run instead.

A notice needs a release lookup, and the lookup is a network request. Core adds no time limit to a run, so a lookup the run waits for holds a finished command open for as long as the network hangs, which a captive portal or a dropped connection makes plausible. A lookup that races the action and is abandoned when the action ends never completes for a command that finishes in milliseconds, which most do. The run can instead read an answer an earlier lookup left on disk and start a later lookup that it never waits for. [`host.program`](../core.md#host) already gives the words that start the application again, which the service plugin runs, and core supports hidden options.

Core has no hook after an action that succeeds. A middleware with `'always'` activation reads the chain's outcome after `await next()`, which is the hook point the contract offers. `out.render` writes to stdout outside the action of a Command that declares a result, so a middleware reaches stderr only through `out.info`, `out.success`, `out.warn`, and `out.error`, and core's lane views.

`applicationDirectory` resolves the installation record and the logging plugin's directory, both state that must be kept. A remembered lookup can be thrown away, and each platform has a directory for such data.

## Decision

- **A middleware beside the Command.** The plugin adds a middleware with `'always'` activation, unless the author turns notices off. It acts only after `next()` resolves `'dispatched'` and the run signal has not aborted, never before the action, and it adds no rejection of its own: a rejection of `next()` propagates unchanged. `'dispatched'` says the action ran, and a failure a later middleware caught still reaches it, so the notice claims no more than that.
- **Only at a terminal, only for a binary self-update could replace.** The notice and its refresh are both left out when stdout or stderr is not a terminal, so a command substitution in a startup file stays silent, as the GitHub CLI and update-notifier also require, when `CI` is set, when the routed Command is `self-update`, and when the run has no release group with an asset or no installation whose method is `script`. A package manager's installation belongs to that installer, which keeps its own notices.
- **A cache file.** The answer lives in `update.json` in a new kind of `applicationDirectory`, `cache`: `$XDG_CACHE_HOME/<app>/`, or `$HOME/.cache/<app>/`, on Linux and other platforms, `$HOME/Library/Caches/<app>/` on macOS, and `%LOCALAPPDATA%\<app>\Cache\` on Windows. It holds the time of the latest lookup, the repository and channel it looked on, and the newest version it found. A file that is missing, damaged, for another repository or channel, from more than 24 hours ago, or from the future is stale. The interval is fixed.
- **A detached refresh.** A run that finds the cache stale writes the current time into it first and then starts `[...host.program, 'self-update', '--refresh-notice']`, detached, with no streams, in the cache directory, and does not wait. The child resolves the newest release on the running binary's channel by ADR-0073's rules, downloads no asset, and writes what it found. Writing the time before the child starts means a slow or failing network costs one lookup a day, not one per run, and a run that cannot write the time starts no child.
- **One line through `out.info`.** When the cache names a version newer than the running one on its repository and channel, the run prints `notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.` through `out.info`, on every qualifying run until the binary is updated. An application restyles it by overriding `lanes.info`, as for self-update's other sentences.
- **Silent on its own faults.** A cache that cannot be read is stale, a time that cannot be written starts no child, and a child that cannot start is passed over. None is reported, and none changes the run's exit code.
- **Opting out.** The author passes `selfUpdate({ notices: false })`, which installs no middleware, or names an extra variable with `notices: { env: 'NOTES_NO_UPDATE_NOTICE' }`. The operator sets `NO_UPDATE_NOTIFIER`, npm's update-notifier convention, or the author's variable, to any nonempty value. Each turns off the notice and the refresh, so an opted-out run starts no lookup. An operator who types the hidden `--refresh-notice` asks for one.

The contract and its acceptance are in [Update notices](../core.md#update-notices).

## Considered options

- **A lookup after the action that the run waits for.** Rejected. A hung network holds a finished command open, and core adds no time limit to cut it short.
- **A lookup that races the action.** Rejected. A command that ends in milliseconds abandons every lookup, so the cache never refreshes.
- **The child writes the time.** Rejected. Every run between the first child's start and its write would start another.
- **The state directory.** Rejected. It holds records that must be kept, and a cache that can be thrown away belongs in the platform's cache directory.
- **A notice view of the plugin's own.** Rejected. A middleware cannot render a view to stderr without a change to core's output contract, and `lanes.info` already restyles the line.
- **Once per lookup.** Rejected. Showing the line once a day makes it easy to miss, and remembering that it was shown writes the cache on the hot path.
- **A variable derived from the application's name, or a global option.** Rejected. Core derives no variable names under [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), and a global option puts a setting the operator makes once into every Command's help.
- **An interval setting.** Rejected for now. Nothing asks for another interval.

## Consequences

The self-update plugin contributes a middleware and a hidden option on its Command, narrowing ADR-0073's single-Command contribution and replacing its "No update notices" clause. `applicationDirectory` gains the `cache` kind, which [ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) introduced with two kinds. A run of a script-installed binary at a terminal reads one small file after its action, and once a day writes it and starts a process. The notice reaches only operators of applications that install `selfUpdate()`.

## Status

Accepted in 0.12.0.

## Changelog

- 2026-10-14: Proposed with the update notices contract.
- 2026-10-17: [ADR-0086](0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md), proposed, narrows the notice's line: it stays one `out.info` message, and the info lane wraps it with its gutter on a terminal whose `columns` is narrower than the message, which includes an 80-column terminal. Every other rule here stands. It binds when that record is accepted.
- 2026-10-20: [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md), proposed, removes the `%LOCALAPPDATA%\<app>\Cache\` cache directory, because no CI job runs Windows. Windows resolves the cache from `XDG_CACHE_HOME` and `HOME` as other platforms do. It binds when that record is accepted.
