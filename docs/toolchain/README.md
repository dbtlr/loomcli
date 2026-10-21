---
description: "The router into the loom toolchain: build, the package changelog, init, and the installer script."
---

# Toolchain reference

`@loomcli/loom` is the Loom toolchain. An application installs it as a development dependency, and its `loom` bin builds, versions, and scaffolds that application, and the installer script rendered by `loom init` installs its release binary. The runtime the application ships depends on `@loomcli/core` alone. [ADR-0066](../decisions/0066-the-toolchain-acts-on-one-package-directory.md), [ADR-0067](../decisions/0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md), [ADR-0068](../decisions/0068-init-writes-scaffold-files-once-and-owns-managed-files.md), and [ADR-0072](../decisions/0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) record the decisions, and the [release facts](../core/release-facts.md) a build bakes in are core's contract.

[ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md), proposed, retires the `check` command for an assembly check from `@loomcli/testing`, which `loom init` wires into a test, and [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md), proposed, removes the `win32` default target and the `bun-windows-*` targets of `loom build`, which the code no longer offers.

## This repository's release

The repository that develops Loom releases its packages together, at one synchronized version, under [ADR-0012](../decisions/0012-synchronized-versions-from-manifests-and-owned-fragments.md). It checks its fragments with the public `loom changelog check`, so its [fragment guide](../../.changes/README.md) admits the three kinds. Its synchronized cut, `loom release cut`, the PR guard, `loom pr check`, and `loom release plan` and `loom release record` stay hidden until release orchestration is designed. The [changelog compiler](../maintaining/changelog-compiler.md), [PR guards](../maintaining/pr-guards.md), and [release workflow](../maintaining/release-workflow.md) references document them. No listing advertises them, and they are not part of this contract. A public command owns its path, so the synchronized cut moved from `changelog` to `release cut` when the public `loom changelog` shipped.
