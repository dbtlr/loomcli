---
type: adr
title: ADR-0075 - The release workflow runs a pinned, published Loom CLI
description: The release workflow's plan and record jobs run a published @loomcli/loom pinned to an exact version by a committed lockfile in .github/release-tool, installed outside the checkout with scripts disabled, and never install or build the workspace. A change to the release commands takes effect once a release publishes it and the pin moves to it.
status: accepted
created: 2026-10-13
modified: 2026-10-13
---

# ADR-0075 - The release workflow runs a pinned, published Loom CLI

## Context

[ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md) splits the release workflow into jobs that hold one permission each. Its `plan` and `record` jobs ran the hidden `loom release plan` and `loom release record` commands from the checkout, so each installed the whole workspace from the frozen lockfile and built every package first. In `record`, that install and build ran in the job that holds `contents: write`, before the step that uses the token. The release workflow reference listed this as an accepted risk, and the risk's stated remedy was running the published `@loomcli/loom`, which carries the release commands and ships in the synchronized release set.

The release commands are the same in `0.10.0` and at the head of `main` when this record was written, and `0.10.0`'s `release plan` produced the expected plan against this repository from an install outside the checkout. The release tool's own `package.json` makes `.github/release-tool` its own npm project, outside the root's `devEngines` setting, and the jobs still install it into the runner's temporary directory so the working tree the plan reads stays untouched.

## Decision

- **A pinned, published CLI.** `.github/release-tool/package.json` names `@loomcli/loom` at one exact version, and `.github/release-tool/package-lock.json` pins it and every package it depends on by integrity. The release tool is not a workspace package and joins no release.
- **No workspace install or build in `plan` or `record`.** Each job checks out `main`, sets up Node.js, copies the two release-tool files into the runner's temporary directory, runs `npm ci --ignore-scripts` there, and runs the installed `loom`. The `build` job keeps installing and building the workspace, because it packs the release from the commit the run attests.
- **The pin moves only through a pull request.** Dependabot proposes a new version of the release tool, and a maintainer may move it by hand. Either way the change is reviewed like any other.
- **Release commands lag by one release.** A change to `release plan` or `release record` reaches the workflow only after a release publishes it and the pin moves to that version. The pinned version must carry every command and option the workflow calls.

## Considered options

- **An exact pin with no lockfile.** Rejected. npm would resolve every dependency of the CLI from its version range at run time, so a new release of any of them would run in the job that writes tags and Releases with no pull request in between, which is weaker than the risk this record closes.
- **An `npm-shrinkwrap.json` in the published `@loomcli/loom`.** Rejected. It would pin the CLI's dependencies for every application that installs `loom`, and it takes effect only one release later.
- **The version the run releases, or the registry's `latest`.** Rejected. The `plan` job runs before that version is published, and a release whose release commands are defective could not record itself.
- **Keep building the CLI from the checkout.** Rejected. It leaves the build in the `contents: write` job.

## Consequences

A defect in the pinned version's release commands is no longer fixed by an ordinary pull request alone, because the workflow runs the published bytes. When an earlier published version works, the pin moves back to it. When the defect blocks the release that would publish its fix, a pull request switches `plan` and `record` to build the CLI from the checkout for that release, and a later pull request restores the pin.

## Status

Accepted in 0.11.0.

## Changelog

- 2026-10-13: Proposed with the release workflow change.
