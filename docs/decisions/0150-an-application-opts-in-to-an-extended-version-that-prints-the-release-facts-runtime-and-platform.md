---
type: adr
title: ADR-0150 - An application opts in to an extended version that prints the release facts, runtime, and platform
description: version({ extended }) makes -V and --version print the version line, then a records-layout block of six rows, channel, build, asset, installation method, runtime, and platform, each absent fact an empty value the records layout lays out, through a second declared view, versionFacts. When the run's selected view declares application/json or application/jsonl, they print one JSON object of eight keys in a fixed order through a bare view, with null for an absent fact. The host gains an optional runtime fact, the JavaScript runtime's name and version. Without the setting every byte is unchanged.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0150 - An application opts in to an extended version that prints the release facts, runtime, and platform

## Context

`version()` prints one line, `<name> v<version>`, with an optional postfix, from the graph alone. Core already holds how the running copy was built, released, and installed, as the [release facts](../core/release-facts.md) on `host.release`: the build, the release channel, the release asset, and the installation method. An operator filing a bug report, and an agent deciding whether a binary can update itself, cannot read them without a Command the author writes. Other command-line tools print them from their version option: clap's `long_version`, `rustc -vV`, and `gh version` each add build and release facts below the version.

The host holds the platform and the architecture, and no fact names the JavaScript runtime. A plugin reads its run's host and never the `process` global, under [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md), so a runtime the version plugin prints has to come from the host.

## Decision

- **The author opts in.** `VersionSettings` gains `extended?: boolean`. With `extended: true`, both `-V` and `--version` print the extended output. The option stays one option with one meaning, and the operator gets no switch between the two outputs. Only `true` turns it on, and without it every byte the plugin writes is unchanged.
- **The version line first.** The extended output starts with the version line, rendered through `versionLine` as before, the postfix and an override included, so a script that reads the first line reads the same text in both modes.
- **A block of six rows.** Below the line, with no blank line, a second declared view, `versionFacts`, renders six rows in a fixed order: `channel`, `build`, `asset`, `installation method`, `runtime`, and `platform`. The labels reuse the release facts' names, `installation.method` spelled as two words. The block is the [records layout](../plugins/pack-views.md#records) for one record: a `dim` label padded to the widest label, a two-space gap, and an escaped `primary` value. The version is not a row, because the line above prints it.
- **The values.** `channel`, `build`, `asset`, and `installation method` are `host.release`'s, and the plugin derives none of them, so a run without a release group prints no channel. `runtime` is `host.runtime`'s name and version joined by a space, such as `bun 1.3.2`. `platform` is `host.platform` and `host.arch` joined by a hyphen, such as `linux-x64`, the spelling `loom build`'s targets and asset names use.
- **An absent fact.** Every row always prints. A fact the run does not hold prints an empty value, which the records layout lays out as it lays out any empty value: the line ends at its label on a terminal, and keeps its padding and gap off one. No placeholder stands in for it.
- **The JSON form.** When the run's selected view, read from the middleware's `view` when it runs, declares `application/json` or `application/jsonl`, the extended output is one JSON object in place of the line and the block. The object holds eight keys in this order: `name`, `version`, `channel`, `build`, `asset`, `installationMethod`, `runtime`, and `platform`. `name` and `version` are the graph's, the version as declared. The other six are the block's values. An absent fact reads `null`, and every key is always present, as the manifest's absence rule states. The bytes are those the formatter's `json()` and `jsonl()` views write for that object. The object is written through a bare view the plugin does not declare, as the manifest's document is, so no override reaches it. It holds no postfix.
- **The host gains a runtime.** `ProcessHandle` and the host gain an optional `runtime: { name: 'bun' | 'node'; version: string }`. The real process's handle reads `bun` and `process.versions.bun` under Bun, a compiled binary included, and `node` and `process.versions.node` otherwise. `mockProcess` defaults to `{ name: 'node', version: '24.0.0' }`. Core copies it at entry and freezes it, as it copies `platform`. It is optional because a hand-built handle implements every required member, so a required one would break it, and because a test that states a host whole would have to add it.

The contract and its acceptance are in [Extended output](../plugins/version.md#extended-output) and [Host facts](../core/host.md#host-facts).

## Considered options

- **`-V` keeps the line and `--version` prints the extended output.** Rejected by the owner's ruling: `-V` and `--version` stay one option with one meaning. This split is clap's `version` and `long_version`.
- **An operator switch, such as `--version --verbose`.** Rejected by the owner's ruling. The author decides what the application prints.
- **Omitting an absent fact's row.** Not chosen. The block's rows would change with the build, and an absent fact tells the reader something too. The records layout already prints an empty value as its label alone on a terminal.
- **A placeholder such as `none` or `unknown`.** Not chosen. A placeholder reads as a value, and a release channel is an open set of names.
- **A `version` row in the block.** Not chosen. The line above prints the version, and the release group's version matches it for an application built from its package.
- **Reading `--format` by its option name.** Rejected. The version plugin would name another plugin's option, which help declines to do for the formatter. The selected view and its media type are the selection core already exposes and the failure encoders read, so an author's own JSON view works as the formatter's does.
- **The runtime from `host.program`.** Rejected. A compiled binary's program is the binary itself, and the program names no version.
- **`platform` with the C library, such as `linux-x64-musl`.** Not chosen. Core reads `libc` on first read from a costly runtime report, and a compiled binary's asset name already carries it.
- **The JSON form through `versionFacts`.** Rejected. The JSON form is data, so an override that restyles the block must not change it.

## Consequences

`VersionSettings` gains `extended`, `@loomcli/plugins/version/views` gains `VersionFacts` and `versionFacts`, and the host, `ProcessHandle`, `ProcessFields`, and `mockProcess`'s fields gain an optional `runtime`, in one feature fragment. Every new member is optional, so no application or test has to change.

The JSON form reads the selection when the version middleware runs. The middleware takes over, so the formatter has to be installed ahead of `version()` for `--format` to reach it. That is the existing order rule of a takeover chain, which `--help --version` already follows.

The JSON object's key order is a contract that `eslint/sort-keys` would rewrite, so the implementation pins it with a test the fixer cannot rewrite, under the repository's conventions.

This extends [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md)'s host with `runtime`, a process fact the real handle reads, and extends [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md)'s 2026-09-24 exception for the manifest's bare view to the version plugin's JSON form. ADR-0021 and ADR-0107 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the contract for the extended version (LM-391).
