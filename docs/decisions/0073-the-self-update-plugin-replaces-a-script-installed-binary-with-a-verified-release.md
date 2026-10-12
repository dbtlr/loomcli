---
type: adr
title: ADR-0073 - The self-update plugin replaces a script-installed binary with a verified release
description: The self-update plugin contributes self-update [<version>] [--channel <name>] [--check]. It replaces only a release binary whose installation record reads the method script and whose bytes still match the recorded digest. It resolves the newest release on the binary's release channel, never downgrades unless a version is named, verifies the release asset against SHA256SUMS over HTTPS alone, renames it over the binary, rewrites install.json, and then calls the application's afterReplace hook. It keeps no copy of the binary it replaced. The release lane is renamed the release channel, and host.release.lane becomes host.release.channel.
status: proposed
created: 2026-10-12
modified: 2026-10-12
---

# ADR-0073 - The self-update plugin replaces a script-installed binary with a verified release

## Context

[ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) records how an application was installed, and [ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) gives the installer script that writes the record and the release shape it reads. Both name self-update as the second writer of `install.json` and the second reader of that shape, and neither specifies it. Mimir ships its own self-update and asked for Loom's to replace it: channel selection, an exact version in either direction, SHA-256 verification before replacement, a report that replaces nothing, and a hook that lets the application restart its own service.

The release facts already hold what self-update needs to find a release: the version, the repository, and the asset name of the running binary, which is the asset to fetch for this platform. The installation group says whether the binary may be replaced. Core never hashes the binary, so self-update compares the digest itself.

GitHub's `releases/latest` resolves the highest stable release through a redirect to its tag page and never a prerelease. GitHub's REST API lists prereleases, but an unauthenticated caller gets 60 requests an hour. The repository's releases Atom feed lists the newest tags, prerelease tags included, with no authentication and no rate limit, and Mimir resolves its prerelease channel from it. A tag in the feed need not have a release: a workflow publishes a release minutes after its tag is pushed, and deleting a release keeps its tag. GitHub redirects a renamed or transferred repository, which a binary that bakes its repository cannot learn any other way.

ADR-0065 named a release line a lane. Operators know the idea as a channel, from browsers, editors, and toolchains, and the bare word lane already names output areas in core, such as the results lane and the lane views.

## Decision

- **A plugin Command.** `selfUpdate(settings?)` from `@loomcli/plugins/self-update` contributes one [plugin Command](../core.md#plugin-commands), `self-update [<version>] [--channel <name>] [--check]`, and nothing else: no global option, middleware, view, extension, or slot.
- **Only a binary the installer script placed.** The Command refuses, replacing nothing, unless the run is a release binary whose release facts hold an `asset` and an `installation` whose method is `script`, and the recorded path holds a regular file that still has the recorded digest. An application installed any other way belongs to that installer, and a binary changed since it was recorded belongs to whoever changed it. The installer script never leaves a symbolic link at the path, so a link there belongs to whoever placed it, even when it points to identical bytes.
- **The release channel.** A version's release channel is its first prerelease identifier, or `stable`. With no version and no `--channel`, the Command follows the running binary's channel. `stable` resolves through `releases/latest`. A prerelease channel resolves to the highest version, by SemVer precedence, among the tags in the repository's Atom feed that are stable or on that channel and whose release publishes `SHA256SUMS`, so a channel's users move onto a stable release once it outranks their prerelease, and a tag with no release is passed over. The Command follows GitHub's redirect for a renamed repository and compares owners and names without regard to case.
- **No implicit downgrade.** A resolved release that is not newer than the running version replaces nothing and says so. A named version is installed whether it is newer or older, and `--channel` with a version is a usage error.
- **A report that replaces nothing.** `--check` resolves the release and states what an update would do, downloading no asset.
- **Verify, place, record.** The Command downloads the release's `SHA256SUMS` and the asset named in the release facts, verifies the asset's digest under [the release shape](../toolchain.md#the-release-shape), writes it to a staging file in the binary's directory with the replaced file's permission bits, flushes it to disk, and renames it over the file. It then rewrites `install.json` with the same method and path and the new digest, through a temporary file and a rename. A failure before the rename leaves the binary and the record as they were.
- **HTTPS alone.** Every request starts at an HTTPS URL under the repository on `github.com`, and every redirect it follows is to an HTTPS URL. The Command uses no API and no token, and it adds no time limit; the run signal cancels it.
- **The application's hook.** `afterReplace`, the plugin's one setting, runs once after the record is rewritten, in the process that replaced the binary. It never runs for `--check`, for a release that is not newer, or for a refusal. A hook that throws fails the run through the ordinary failure path, and the new binary stays.
- **No copy.** The Command keeps no copy of the binary it replaced. The rename leaves either the old binary or the new one at the path, a release that runs goes back with `self-update <version>`, and a release that cannot start goes back with `install.sh <version>`.
- **Release channel, not lane.** The release lane of ADR-0065 is renamed the release channel. `host.release.lane` becomes `host.release.channel`, derived the same way, and lane names output areas alone.
- **No update notices.** Telling the operator during an ordinary run that a newer release exists is not part of this decision.

The contract and its acceptance are in [Self-update](../core.md#self-update).

## Considered options

- **Mimir's `--next` and `--tag <tag>`.** Rejected. `--next` serves one channel and no other, and `--tag` exposes the `v` that every other Loom surface leaves out. A positional version matches `install.sh [<version>]`, and `--version` belongs to the version plugin.
- **Configuring the repository and asset names on the plugin.** Rejected. The build already bakes both into the release facts, and two sources for one fact can disagree.
- **The REST API for prereleases.** Rejected. Its unauthenticated rate limit is shared by every program on the operator's address, and a token is one more secret to configure. The feed lists only the newest tags, so a channel with no release among them resolves nothing, and a named version still installs.
- **An `onReplace` lifecycle event.** Rejected. No second listener exists, and the application that installs the plugin owns what follows a replacement.
- **Keeping the replaced binary and a `--rollback`.** Rejected. A rename leaves no half-written binary, a release that runs can install an older version itself, and a release that cannot start cannot run its own rollback either; `install.sh` reinstalls any version.
- **Rolling back when the hook fails.** Rejected. The replacement succeeded and the record says so; a failure in the application's own step is the application's to report.
- **A confirmation prompt.** Rejected. Running the Command is the request, `--check` previews it, and a prompt breaks unattended runs.
- **Keeping the word lane.** Rejected. Operators know the idea as a channel, and the bare word lane already names core's output areas.

## Consequences

The release facts' type, `docs/core.md`, `docs/toolchain.md`, and the glossary read channel, and the implementation PR carries a breaking fragment for `host.release.lane`. An application whose root declares arguments cannot install the plugin, the limit every plugin Command has under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md). A repository's release workflow keeps the releases Atom feed's tag links in the shape GitHub publishes, so a prerelease channel resolves only while one of its releases is among the newest GitHub lists there.

## Status

Proposed. It moves to accepted in the release that ships the self-update plugin.

## Changelog

- 2026-10-12: Proposed with the self-update contract.
