---
type: adr
title: ADR-0016 - A release merge publishes through one idempotent, token-free workflow
description: Merging the guarded release PR is the only authorization. One workflow reconciles npm, the annotated tag, and the GitHub Release with the manifest version on every push to main, publishes through OIDC with provenance, and holds no secret. Every external step checks before it acts, so recovery is a re-run or a dispatch, and anything else is fixed forward.
status: proposed
created: 2026-09-08
modified: 2026-09-08
---

# ADR-0016 - A release merge publishes through one idempotent, token-free workflow

## Context

[ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md) makes the release cut the only path that writes a version and leaves publication open. [ADR-0015](0015-publication-retries-reuse-retained-artifacts.md) filled that gap with retained artifact sets, a ledger branch, staged dist-tags, and an operations token. That layer was removed on 2026-09-08 as oversized for one maintainer and one package. This record fills the same gap with the smallest path that keeps three properties: the merge is the authorization, no long-lived registry credential exists anywhere, and a failed run is recoverable without a rebuild ledger.

These facts were verified on 2026-09-08 and shape the design. Dist-tag writes do not receive npm's OIDC authentication, so any staging tag would reintroduce a secret. Trusted publishing needs npm 11.5.1 or newer, and the pinned Node 22.23.2 bundles npm 10.9.8. The root manifest's `devEngines` makes npm refuse to run anywhere inside the checkout. npm provenance attests the run's own commit, so a run must build from the commit it runs on. The PR guard rejects a release whose tag already exists, and the compiler's material-change baseline is the previous version's tag. The repository's squash title setting takes the commit subject for single-commit PRs, and the squash subject stays editable in the merge dialog. The `npm-publication` environment no longer exists, and `@loomcli/core@0.1.0` still carries a `loom-staging` dist-tag.

## Decision

**The merge is the only authorization.** The release PR carries the guarded title `chore(release): Release v<version> - <description>`, passes the required PR guard, and is squash-merged. Only a release cut can change a participating manifest version on `main`, and only a version absent from the registry is ever published. Repository write access is the trust boundary: the guard has no required approver, and the one write-access actor is the maintainer. This keeps ADR-0012's rejection of automatic release on merge. An ordinary merge still never publishes, because it cannot change the version.

**One workflow reconciles on every push to `main`.** `.github/workflows/release.yml` runs on push to `main` and on `workflow_dispatch` with no inputs, in one shared concurrency group with `cancel-in-progress: false`. It reads the participating manifest version and compares it with the registry, the tag, and the Release. When all three exist, the run ends in seconds with no build and no permission used. The trigger reads the manifest, not the commit subject, so a mangled merge title cannot make a release vanish silently. A missed release surfaces on the next push instead.

**Jobs hold one permission each.**

1. *Plan* reads. It resolves the version, extracts the version's section of `CHANGELOG.md` and fails if it is empty, and decides which of publish, tag, and Release are missing. Before publishing it confirms that no participating library, and neither the lockfile nor a shared build input, changed since the cut commit that set the version. That check makes provenance honest: the bytes come from the commit the run attests, and they equal the cut's.
2. *Build* runs only when publication is missing. It installs with a frozen lockfile and `persist-credentials: false`, builds, packs, runs the packed check, and uploads the tarball as a run artifact.
3. *Publish* runs only when publication is missing, under the `release` environment with `id-token: write` and nothing else. It has no checkout. It runs Node 24 for npm 11.5.1 or newer and publishes the tarball from a directory outside any checkout with `npm publish <tarball> --access public --provenance --ignore-scripts` to `latest`. A version-exists conflict counts as success.
4. *Record* holds `contents: write`. It creates the annotated tag `v<version>` at the commit named in the version's registry provenance when the tag is absent. It creates the GitHub Release on that tag when absent, with the changelog section as notes, and attaches the tarball fetched back from the registry, so the record holds the bytes consumers receive. Reads after writes retry with backoff, because the registry propagates with a delay.

**Every external step checks before it acts.** A version already on the registry skips publication. A tag already at the provenance commit is reused. An existing Release is completed: an empty placeholder asset is deleted and re-uploaded, an uploaded asset is never replaced. A tag anywhere else fails the run. No step ever overwrites a published version.

**Recovery has three modes, in order.** A transient failure is a re-run of the failed job. A defect in the workflow is fixed on `main`, then the workflow is dispatched. The dispatch runs at `main`'s head, so it publishes only while the participating tree is unchanged since the cut. Anything else, including a tag at the wrong commit or a defect in published bytes, is fixed forward: the version is abandoned as unpublished and the next cut supersedes it with the next version. Nothing is ever repaired in place.

**Trust is bound by identity, not by a secret.** The npm trusted publisher for `@loomcli/core` names this repository, the `release.yml` filename, and the `release` environment, and permits direct `npm publish`. The environment's deployment branch policy, restricted to `main`, is the only control that pins publication to `main`, because the publisher does not bind a branch. The environment holds no secrets and has no reviewers. Tags are not protected; the only actor who could create one outside the workflow is the maintainer.

**The GitHub Release is the only durable record.** There is no ledger, no retained Actions artifact beyond the run's own tarball upload, and no staging tag. Completeness is read from the registry, the tag, and the Release.

**Packed evidence is a runtime consumer, not the examples.** The packed check packs core, installs the tarball into a temporary consumer, compiles a single-file runtime entry with JavaScript emit, and runs it once under Node and once under Bun on Linux with fixed arguments and an asserted exit code. It runs in CI on every PR and in the build job before publication. The examples keep running as processes against the workspace build, which already proves behavior on every PR. This narrows the packed-package clause of [ADR-0014](0014-acceptance-evidence-runs-against-the-packed-package.md), recorded there as a dated addendum conditioned on this record: packaging is proved by the consumer on Linux, behavior by the examples on every supported platform.

## Considered options

- **Retained artifact sets with a ledger and staged promotion.** Rejected. This was ADR-0015. It defended against byte drift between a build and its retry at a cost that one maintainer and one package do not repay. This record accepts that a re-run may pack different bytes, never republishes, and makes the registry the truth instead.
- **Triggering on the release title in the head commit subject.** Rejected. The squash subject is editable at merge time, and a mangled title would leave no failed run to notice. The manifest version is the signal the guard already protects.
- **A tag push as the trigger.** Rejected. A hand-pushed tag is a second authorization step after the merge and can point at the wrong commit. The merge already carries the validated version.
- **Dispatch with a tag input, workflow file from `main`, source at the tag.** Rejected. Provenance attests the run's own commit, so the statement would name a commit whose tree did not produce the bytes.
- **Waiting on the CI workflow before publishing.** Rejected. Branch protection requires the PR to be up to date and green before merge, so the squash commit's tree is the tree CI verified. The build job re-runs only the packed check.
- **Re-running the PR guard on push.** Rejected. Branch protection enforces the guard for administrators too, and the guard rejects an existing tag, which recovery needs. The plan job checks what publication depends on: version, changelog section, and an unchanged participating tree.
- **Manual publication from a maintainer machine as a recovery path.** Rejected. It needs an interactive login and produces a version without provenance.
- **Reusing the `publication.yml` filename to keep the existing publisher binding.** Rejected. The publisher needs a visit anyway to bind the environment and permit direct publish, and the name described the removed layer.

## Consequences

Repository settings change: squash-only merges for every PR, squash titles from the PR title, and the existing protection of `main` with administrator enforcement stays required. The `release` environment is created restricted to `main`. The publisher's environment field must be set before the first release, since it is the branch pin.

The material-change baseline stops depending on a tag. An abandoned version has no tag, so the compiler and guard derive the baseline from the first-parent commit that set the current version, which is consistent with ADR-0012's rule that tags never determine versions. The release-cut prerequisite accepts a previous version that was explicitly abandoned as unpublished, and the next cut's narrative says so.

The release-cut skill, the README, and the compiler and guard references stop saying publication is not automated. The skill's post-merge step becomes confirming that the release workflow completed.

The `v0.1.0` Release predates this record and keeps its three assets. The `loom-staging` dist-tag is removed once by hand with an interactive login, since dist-tag writes have no token-free path.

The first release through the workflow is the acceptance evidence for this record. Until then a violation is a warning, not an error.

## Status

This record moves to accepted when one release has published through `release.yml` and its registry version, annotated tag, and GitHub Release all exist as described.
