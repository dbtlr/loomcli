---
description: The router into the loom toolchain. What @loomcli/loom is, then one page per command, each listed with the moment to open it.
---

# Toolchain reference

`@loomcli/loom` is the Loom toolchain. An application installs it as a development dependency, and its `loom` bin builds, versions, and scaffolds that application, and the installer script rendered by `loom init` installs its release binary. The runtime the application ships depends on `@loomcli/core` alone. [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md), [ADR-0067](../decisions/0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md), [ADR-0068](../decisions/0068-init-writes-scaffold-files-once-and-owns-managed-files.md), and [ADR-0072](../decisions/0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) record the decisions, and the [release facts](../core/release-facts.md) a build bakes in are core's contract.

The toolchain has no `check` command: the assembly check from [`@loomcli/testing`](../libs/testing.md), which `loom init` wires into a test, replaces it under [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md). `loom build` offers no `win32` default target and no `bun-windows-*` target, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md).

## Commands

- [loom build](build.md): open it when you build an application for Node, Bun, or a compiled binary, or need the facts a build bakes in.
- [The package changelog](changelog.md): open it when you write change fragments or cut a package's version and changelog.
- [loom init](init.md): open it when you scaffold a new application or refresh the files init manages.
- [The installer script](install.md): open it when an operator installs your release binary with `install.sh`.

This repository's own release commands are hidden and not part of this contract. The [changelog compiler](../maintaining/changelog-compiler.md), [PR guards](../maintaining/pr-guards.md), and [release workflow](../maintaining/release-workflow.md) references document them.
