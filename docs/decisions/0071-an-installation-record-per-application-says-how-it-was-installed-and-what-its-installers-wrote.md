---
type: adr
title: ADR-0071 - An installation record per application says how it was installed and what its installers wrote
description: Each application keeps one installation record per user, a directory in the platform's state directory named for the application. Its install.json holds the installation that an installer script and self-update write and core reads into host.release.installation when its path is the running executable, and each first-party plugin that installs files keeps its installed files in its own file, written before and after it acts and recovered by digest. Core exports the one directory resolver and writes nothing.
status: proposed
created: 2026-10-12
modified: 2026-10-12
---

# ADR-0071 - An installation record per application says how it was installed and what its installers wrote

## Context

[ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md) fixed the shape of the release facts' installation group, `method`, `path`, and `digest`, and left where the record lives and how core reads it to a later contract. Self-update needs that group to know whether it may replace the binary: a binary that a package manager, npm, or a person copying a file put in place belongs to that installer, and self-update must refuse it. The build cannot answer, because one build may be installed in several ways.

Other plugins install files outside the application: completion scripts, manual pages, an agent skill, and a service unit. Each must know later which files it wrote, so that an update replaces only its own files and an uninstall removes only those, and each writes into a directory that other software shares, such as `~/.config/systemd/user` or a completion directory. Without a shared record, each installer keeps a private one, or none: a service installer that deletes its unit by path also deletes a file someone else put there.

Established installers keep one record per installed thing, never separate records for how it arrived and what it wrote. Homebrew keeps a receipt inside each keg and owns files by layout. Cargo keeps one ledger of installed binaries, and cargo-dist one receipt per application under the user's directory, which its updater checks against the running executable. dpkg, whose packages write into shared directories, keeps a digest for each file, preserves a file a person changed, and resumes an interrupted operation from its status database.

## Decision

- **One record per application.** Each application has one installation record per user: a directory named for the application in the platform's state directory, `$XDG_STATE_HOME/<app>/installation/` on Linux and other Unix systems, `$HOME/Library/Application Support/<app>/installation/` on macOS, and `%LOCALAPPDATA%\<app>\installation\` on Windows. The state directory holds data that persists and belongs to one machine, which an installation is. A configuration directory is often synchronized between machines and would carry a record to a machine it does not describe.
- **One file per writer.** The record holds `install.json`, the installation, and one file for each first-party plugin that installs files, named for the plugin. Each writer replaces only its own file, whole, through a temporary file and a rename, so no writer parses or merges another's, and a shell script can write `install.json` without a JSON parser.
- **The installation.** `install.json` holds `format`, `method`, `path`, and `digest`. An installer script writes it after it moves a verified binary into place, with the method `script`, and self-update rewrites it after it replaces the binary. The method decides who may replace the binary, so the record names no separate owner. It holds no version, repository, or lane, which the baked release facts already state.
- **Core reads it, and trusts it only for the running executable.** Core reads the installation during host capture for a compiled binary built with `--release`, and sets `host.release.installation` only when the recorded path, resolved through symbolic links, is the running executable. A copy of the same application run from elsewhere, through Node, or from source reads no installation. A missing, unreadable, or malformed file never fails a run: it reads as no installation. Core never hashes the binary at startup; a plugin that replaces the binary compares the digest first.
- **Installed files are written before and after the plugin acts.** Before an installer touches any target, its file records each path as pending with the digest the path held and the digest it will hold. After every target is in place, the file records the committed digests. Each target is written through a staging file that the attempt creates exclusively in the target's directory and a rename, so no run renames another's partial content into place. The installer never takes over a path it did not record, and never replaces or removes a recorded file whose digest changed, because someone else changed it.
- **Recovery by observation.** A run that finds its installer's file pending resolves each path by its digest before doing anything else: the intended digest means the write landed, the prior digest means it did not, and any other means someone changed the file, which is left alone. No backup is kept. The binary can always write the intended content again, so an interrupted operation rolls forward.
- **No lock.** Two runs of one installer at once may each recover the other's pending file, so one can fail. Each target still holds whole content, the last commit wins, and the next run recovers.
- **Core resolves, plugins write.** Core exports `applicationDirectory`, which resolves an application's installation or log directory from a run's `env` and `platform` alone, so core, the logging plugin, and every installer compute one path. The writer of installed files is an internal module of `@loomcli/plugins` that the first-party installers share. Core writes no file.

The contract, the file formats, the shell recipe, and the acceptance are in [Installation record](../core.md#installation-record).

## Considered options

- **Two records, a receipt beside the binary and a ledger of files.** Rejected. Both answer what was put on the machine, and an application installed from npm has no binary to put a receipt beside but may still install completions.
- **Only the installation now, and the installed files later.** Rejected. Every installer would wait for it or keep a private record in the meantime.
- **One JSON file per application.** Rejected. The installer script would have to merge into it without a parser, or rewrite it and erase every plugin's entries.
- **A command in the binary that records its own installation.** Rejected. Loom adds no command to an application's binary whose only caller is an installer.
- **A published format that any installer writes.** Rejected for now. The installer script and self-update are the writers, both Loom's, and the reader accepts every format version Loom has written.
- **Hashing the binary at startup.** Rejected. It adds tens of milliseconds to every command of a large binary to protect the one command that replaces it, which compares the digest itself.
- **A durable journal with backups, as dpkg keeps.** Rejected. It restores the prior version of a half-updated file set, which a completion script, a manual page, a skill, or a unit file does not need, because the binary writes the intended content again. Self-update keeps its own copy of the binary it replaces.
- **Rolling back in memory alone.** Rejected. It covers a failed write but not a killed process, which leaves files the record does not list, and the next install would refuse them.
- **A lock file.** Rejected, as [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) rejected one: two runs of one installer rarely overlap, the run that fails says so and the next run recovers, and a lock brings a rule for the lock a killed process leaves behind.
- **An exported writer.** Deferred. Every installer that needs it today is first-party; exporting it later adds to the API without breaking it.

## Consequences

`host.release.installation`, absent until now, is present for a compiled binary an installer script recorded. [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md)'s host capture reads a second file, and [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md)'s release facts take their installation group from the record rather than the build; both carry dated entries. The logging plugin resolves its default directory through `applicationDirectory`, so a `HOME` that is not an absolute path no longer resolves against the working directory; [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) carries a dated entry. A renamed application looks in a new directory, so its earlier installation reads as absent until the installer script runs again.

## Status

Proposed. It moves to accepted in the release that ships the installation record.

## Changelog

- 2026-10-12: Proposed with the contract.
- 2026-10-12: The shell recipe sets `record` and creates the record's directory before a marked comment, and the lines above the comment write no file, so [ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md)'s installer script resolves the record's directory before it downloads the binary and writes `install.json` after the rename. The bytes it writes are unchanged.
