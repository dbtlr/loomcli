---
type: adr
title: ADR-0132 - A package's changelog cut may choose its version, cut a prerelease, and set a version other manifests share
description: loom changelog write takes --target, a chosen version above the current one whose release part meets the fragment minimum, so fragments keep their kinds. A prerelease target sets the version, writes no changelog section, and leaves the fragments pending, and a plain write from a prerelease finalizes to its release part. The sharedVersion key of loom.config.json lists package.json files that carry the package's version, and write sets each in the same replacement. loom changelog notes prints one version's notes. It supersedes ADR-0067's rejection of a version override and its failure on a prerelease, and narrows the cuts across several packages that ADR-0099 leaves out.
status: proposed
created: 2026-11-01
modified: 2026-11-01
---

# ADR-0132 - A package's changelog cut may choose its version, cut a prerelease, and set a version other manifests share

## Context

[ADR-0067](0067-a-packages-changelog-cuts-its-version-from-three-fragment-kinds.md) has `loom changelog write` compute the next version from the highest fragment kind and rejects an override: "a cut that needs another version needs other fragments". A current version with a prerelease part fails the cut, and [ADR-0099](0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) carries forward ADR-0066's list of what the toolchain leaves out, which names prerelease lanes and cuts across several packages.

Heimdall tried `loom changelog` and kept its own changelog tooling for three gaps:

- **A version per milestone.** Heimdall names a minor version for each milestone, and v0.8.0 shipped with no breaking change. Below `1.0.0` only a breaking fragment advances the minor, so the cut would have been v0.7.3, or a breaking fragment would have misstated a compatible change and carried a migration nobody needs.
- **Release candidates.** Heimdall tags `v0.6.0-rc.1` before `v0.6.0`. The candidate's notes are the pending fragments, and only the final cut consumes them.
- **Three binaries from one tag.** One root `.changes/` and `CHANGELOG.md` cut one version, which three `package.json` files carry.

[ADR-0083](0083-a-synchronized-release-may-select-a-version-above-the-fragment-minimum.md) already lets this repository's synchronized cut choose its version, at or above the fragment-derived minimum, and keeps fragments truthful because the choice is a floor, not a classification. [ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md) lets a package's `paths.changes` and `paths.changelog` name a root fragment folder and changelog, which covers half of the third gap. The release facts already derive a release channel from a version's prerelease part, and `self-update` and the installer script already install a prerelease, so only the cut lacks one.

## Decision

- **A chosen version.** `loom changelog write --target <version>` cuts that version. Leaving it out keeps ADR-0067's automatic calculation. A target is `MAJOR.MINOR.PATCH`, optionally followed by `-` and a SemVer prerelease part, such as `0.11.0` or `0.11.0-rc.1`; a leading `v`, leading zeroes, and build metadata are refused. The name matches `loom release cut --target`, which does the same job for this repository. `--version` cannot be an alias, because the version plugin's global `--version` owns that spelling.
- **The floor.** The *last release* is the package's version when it is stable. While the version is a prerelease, it is the highest version among the changelog's release sections, or `0.0.0` when the changelog holds none. A release section's version is the first word of its level-two heading when that word is `v` and a `MAJOR.MINOR.PATCH` version, as `write` renders `## v<version> - <date>`; any other level-two heading names no release. So that a prerelease always finds its last release, a prerelease cut from a stable version other than `0.0.0` fails, before any file changes, unless the changelog holds that version's release section, and the message says to cut a stable release first or add the section. The *fragment minimum* is the version ADR-0067's bump table gives from the last release and the highest pending kind. A target must rank above the current version under SemVer precedence, and its release part, the version without its prerelease part, must meet or exceed the fragment minimum. Every fragment keeps its kind and its migration requirement. A target that fails either rule, or is malformed, fails the cut before any file changes, and the message names the minimum.
- **A prerelease cut.** A target with a prerelease part sets the version and writes no changelog section and deletes no fragment, so the fragments stay pending until a stable cut consumes them. It neither creates nor writes the changelog, and the title, `Unreleased`, and existing-section checks apply at the stable cut that writes the section. `--date` and `--narrative` are still validated, and they shape no section. Each later prerelease ranks above the one before it under the precedence rule.
- **Finalizing.** From a prerelease, `write` without `--target` cuts the release part, `0.11.0-rc.2` to `0.11.0`, when it meets the fragment minimum. When a fragment landed since has raised the minimum past it, the cut fails, names the minimum, and asks for `--target`. A stable cut writes its section and consumes the fragments as ADR-0067 states.
- **Every cut needs a fragment.** A prerelease cut with no pending fragment fails, as any cut does, because its notes would be empty.
- **A shared version.** The top-level `sharedVersion` key of `loom.config.json` lists `package.json` files that carry this package's version, such as `["../hub/package.json", "../dashboard/package.json"]`. Each entry resolves against the package directory under ADR-0130. The file's schema takes the key's value as written, and `write`, `--dry-run` included, validates it as one value, a list of nonempty strings: any other value fails the cut with exit 1 before any file changes, naming `sharedVersion` and what it expects. Unlike a key that falls back to its convention, a dropped list would let the cut succeed and leave the listed manifests at the old version, so a tag would ship binaries that disagree. An entry that names this package's own `package.json` or repeats another counts once. Before it changes anything, `write`, `--dry-run` included, reads each listed file, and fails, naming the key and the file, when one is missing, does not parse, has no `version` string, or holds a version other than this package's. The cut then sets `version` in each listed file in the same replacement as the package's own files, so a failure leaves every file as it was. It changes nothing else in them.
- **Notes.** `loom changelog notes <version>` prints one version's notes for a release page and changes nothing. A stable version prints the body of its changelog section, everything under its heading up to the next release section. A stable version with no section fails, because a tag pushed before its cut would otherwise publish the pending fragments under a version that does not hold them. A prerelease version prints the pending fragments as `write` renders a section's groups, without a heading or narrative, so it needs full git history. It fails when the version is not the package's current version, for the same reason a stable version without a section fails, and when no fragment is pending; `write --target <version> --dry-run` previews a candidate before its cut. It reads `paths.changes` and `paths.changelog`, and the version argument takes the target's form.
- **One package still.** The bin acts on one package directory. `sharedVersion` names files the package's own cut writes. Loom reads no workspace list and builds, orders, or publishes no other package. Of the cuts across several packages that ADR-0099 leaves out, Loom now sets one version in the manifests a package lists; the rest of release orchestration, publishing and release workflows and PR guards included, stays with each repository. The lockfile stays the package manager's job, as ADR-0067 states, and an author refreshes it after a cut that changed a workspace member's version.

## Considered options

- **Any version above the current one.** Rejected. A breaking fragment could ship as a patch, and the version would contradict the notes it carries.
- **A minimum bump in `loom.config.json`.** Rejected. Heimdall chooses a minor per milestone and still cuts patches, so the choice varies per cut and belongs to the command.
- **A prerelease that writes its own section.** Rejected. The final cut would have to fold or repeat the candidates' sections, which is a second rendering rule, and the candidate's notes come from `notes` instead.
- **Reading the last release from git tags.** Rejected, as ADR-0067 rejects tags. The changelog's release sections are files the cut wrote and the diff shows.
- **Setting every workspace member's version.** Rejected. Loom would read the repository as a release unit, which ADR-0130 keeps withdrawn, and could not tell which members ship.
- **Dropping a malformed `sharedVersion`, as the configuration plugin drops a rejected value.** Rejected. The convention is no listed file, so the cut would succeed with only the package's own version set, and only `-v` would say so.
- **`notes` printing the pending fragments for a stable version without a section.** Rejected. `write --dry-run` already previews a cut, and a workflow run on a tag pushed too early would publish notes the version never held.

## Consequences

The changelog skill and fragment guide `loom init` writes describe `--target`, a prerelease cut, and `notes`, and the skill's commit step names the files `sharedVersion` lists beside `package.json`. ADR-0083's boundary that kept the choice to the synchronized cut gives way: both cuts follow the floor rule, while the hidden `loom release cut` keeps its stable `0.x` forms and its other safeguards. The contract is in [The package changelog](../toolchain/changelog.md) and the [configuration file](../toolchain/build.md#the-configuration-file).

## Status

Proposed. It moves to accepted in the release PR of the release that ships `--target`, the prerelease cut, `sharedVersion`, and `notes`.

## Changelog

- 2026-11-01: Proposed with the package changelog's chosen, prerelease, and shared version contract (LM-345).
