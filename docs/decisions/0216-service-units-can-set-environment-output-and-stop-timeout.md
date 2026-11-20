---
type: adr
title: ADR-0216 - Service units can set environment, output, and stop timeout
description: The service plugin can set variables from the install host, send stdout and stderr to one file, and set the manager's stop timeout. Without these settings it writes the same unit as before.
status: proposed
created: 2026-11-20
modified: 2026-11-20
---

# ADR-0216 - Service units can set environment, output, and stop timeout

## Context

[ADR-0074](0074-the-service-plugin-supervises-one-user-unit-per-application-through-the-installation-record.md) leaves a service's environment, stdout, stderr, and stop grace period to the manager. A launchd agent can start with a PATH that omits Homebrew tools and discard the stderr that would explain a failure. A service that tears down a virtual machine can need longer than the manager's default grace period after SIGTERM.

## Decision

- **Environment.** `ServiceSettings.environment` is an optional synchronous function from the install run's `Host` to a readonly record of string names and values. When install renders the unit, it calls the function and writes the entries sorted by name. launchd receives an XML-escaped `EnvironmentVariables` dictionary. systemd receives one quoted `Environment="name=value"` assignment per line, using systemd's C-style escapes and doubling each `%`. A dollar sign is literal in `Environment=`. An empty record adds no directives. On both platforms, install refuses names and values that contain control characters other than tab, line feed, and carriage return before writing anything.
- **Output.** `ServiceSettings.output` names one file for stdout and stderr. Install and status resolve relative paths against `host.home`. launchd receives `StandardOutPath` and `StandardErrorPath`. systemd receives `StandardOutput=append:<path>` and `StandardError=append:<path>`. These directives take the remainder of the line as a path, with literal spaces, quotes, and backslashes and doubled `%` specifiers. Install creates the parent folder recursively before loading the unit. Uninstall leaves the output file and its folder in place.
- **Stop timeout.** `ServiceSettings.stopTimeout` is a positive whole number of milliseconds. Loom writes the requested timeout as `ExitTimeOut` in whole seconds rounded up for launchd and `TimeoutStopSec=<milliseconds>ms` for systemd. An author sets this above the Application's `shutdown.timeout` so the manager gives shutdown time to finish. On macOS 26.4 and later, launchd caps the effective `ExitTimeOut` at 60 seconds. [Apple Developer Technical Support](https://developer.apple.com/forums/thread/854315)
- **Directive order.** In systemd's `[Service]` section, the environment lines, the output lines, and `TimeoutStopSec` follow `SuccessExitStatus` in that order. In the launchd plist, `EnvironmentVariables`, the output keys, and `ExitTimeOut` follow `ThrottleInterval` in that order.
- **Declaration faults.** An empty `output` or an invalid `stopTimeout` throws `DeclarationError` at `service()` through the existing service settings rule, with the finding on the setting.
- **Status.** When `output` is set, status reports its absolute path and whether a regular file is at the path as `output: { path, exists }` and shows an `output` row in text. If status cannot inspect the path, it reports `exists: false`. It shows any logging plugin file destinations separately. With redirected output, it omits the manager capture report.
- **Folder creation.** Under [ADR-0165](0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md), a directory a plugin creates for a file records no event. This applies to the output folder.

## Consequences

This narrows ADR-0074's environment and output defaults to units whose corresponding settings are absent. It also narrows [ADR-0178](0178-operators-control-log-files-and-levels-and-failures-name-the-runs-log.md)'s **Service status names the files** clause. Status reports manager capture only when `output` is absent. Omitting all three settings produces the same unit bytes as before. The [service reference](../plugins/service.md) documents the settings and the generated directives.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-20: Proposed with the service unit settings (LM-591). ADR-0074 and ADR-0178 carry dated entries.
