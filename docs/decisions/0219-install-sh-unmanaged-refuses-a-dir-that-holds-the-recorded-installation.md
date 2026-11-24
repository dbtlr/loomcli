---
type: adr
title: ADR-0219 - install.sh --unmanaged refuses a --dir that holds the recorded installation
description: Under --unmanaged, the installer script refuses, before it downloads anything and with exit 2, a --dir whose <dir>/<name> is the path the existing install.json records, so a side copy never replaces the recorded binary and leaves its digest naming other bytes. It compares the two paths as text, after the trailing slash --dir may carry is stripped, and also refuses a --dir that is the same physical directory as the recorded binary's, compared by pwd -P. With no record, a record it cannot read, or a record that names another path, --unmanaged installs as before, and the mode is still never inferred from --dir. It supersedes in part ADR-0210's clause that the flag does not guard a --dir naming the live install's directory.
status: proposed
created: 2026-11-24
modified: 2026-11-24
---

# ADR-0219 - install.sh --unmanaged refuses a --dir that holds the recorded installation

## Context

[ADR-0210](0210-install-sh-unmanaged-places-a-verified-side-copy-and-writes-no-installation-record.md) has `install.sh --unmanaged` place a verified side copy and write no `install.json`. It requires `--dir`, because the default directory holds the live binary, and it states that a `--dir` naming the live install's directory replaces the live binary, which the flag does not guard against.

That case does more harm than a replaced binary. The [installation record](../glossary.md#compilation-and-invocation) still names the path, so core reads the installation, but its digest names the bytes the script placed before. Self-update refuses the binary as one that changed since it was installed, and an application that checks the recorded digest at start and fails closed refuses every run until the operator installs again without the flag. The side copy that was meant to leave the live install alone has broken it, and nothing told the [operator](../glossary.md#people) at install time. The case was reported from an application that fails closed on that digest.

## Decision

- **The refusal.** Under `--unmanaged`, after the install path's character check and before any download, the script reads the existing `install.json` in the installation record's directory. When the `path` it records is `<dir>/<name>`, the script prints `<name>: --unmanaged cannot install into <dir>, which holds the installation that install.json records. Choose another directory for the side copy with --dir.` and exits 2, as an argument error does. The binary and `install.json` stay as they were.
- **What it compares.** The script compares the recorded path with `<dir>/<name>` as text, after it strips the trailing slash `--dir` may carry, so `/home/me/.local/bin` and `/home/me/.local/bin/` both match. It also refuses when the recorded path's basename is the application's name and `<dir>` is the same physical directory as the recorded path's directory, each found with `cd` and `pwd -P` in a subshell, so a link to the directory, `.`, and `..` spellings match, as core treats a record whose path resolves to the same real file. It compares directories, not the files with `-ef`: a link at `<dir>/<name>` to the recorded binary is replaced by the rename and leaves the recorded binary alone, so refusing it would refuse a safe install. It uses no `realpath` or `readlink -f`.
- **What it leaves alone.** With no `install.json`, one it cannot read, or one that records another path, `--unmanaged` installs as ADR-0210 states. The script still writes no record, resolves and creates no record directory, and runs no post-install command, and the check reads the record only to refuse. The mode is never inferred from `--dir`: a `--dir` that differs from the recorded path does not select it, and one that matches refuses rather than installing a managed copy. A run without `--unmanaged` is unchanged.

## Considered options

- **Inferring a managed install when `--dir` matches the recorded path.** Rejected. ADR-0210 rejects inferring the mode from `--dir`, and that rejection stands: an operator who typed `--unmanaged` asked for a side copy, and installing a managed copy instead would rewrite the record and run the post-install command they meant to skip.
- **Comparing the files with `-ef`, or resolving with `realpath` or `readlink -f`.** Rejected. `-ef` refuses a safe install, because a link at `<dir>/<name>` is replaced by the rename and the recorded binary stays. `realpath` and `readlink -f` are not on every supported system, while `pwd -P` is POSIX.
- **Comparing text alone.** Rejected. A directory reached through a link, such as `~/bin` for `~/.local/bin`, would still replace the recorded binary.
- **Warning and installing anyway.** Rejected. The install would still leave the record's digest naming other bytes, which is the fault the refusal exists to prevent.

## Consequences

An operator who points `--unmanaged` at the live install's directory learns it before anything is downloaded, and the live install keeps its binary, its record, and its self-update. A `--dir` that is the recorded directory by another route is refused too. An unreadable record installs as before, silently. The rendered script gains the check, so `loom init` reports a managed `install.sh` as out of date once. [The installer script reference](../toolchain/install.md#a-side-copy) documents the refusal.

This record supersedes in part ADR-0210's **A directory is required.** clause: its sentence that a `--dir` naming the live install's directory replaces the live binary, and that the flag does not guard against it. The rest of ADR-0210 stands. ADR-0210 carries a dated entry.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-24: Proposed for the refusal of a `--dir` that holds the recorded installation (LM-671). It supersedes in part ADR-0210's sentence that the flag does not guard a `--dir` naming the live install's directory. ADR-0210 carries a dated entry.
