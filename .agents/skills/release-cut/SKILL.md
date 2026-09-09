---
name: release-cut
description: Prepare a Loom CLI library release pull request from pending change fragments, or resume an existing release cut for review.
---

# Prepare a release cut

Produce one reviewable release commit and a ready-for-review PR. Use the existing compiler and version writer for every generated file.

This procedure prepares a cut. Merging the release PR is the only authorization to publish; the [release workflow](../../../docs/release-workflow.md) then reconciles the registry, the version tag, and the GitHub Release with the merged manifest version. A successful local guard does not prove release readiness.

## Establish the release inputs

Read the repository's [fragment guide](../../../.changes/README.md), [compiler reference](../../../docs/changelog-compiler.md), and [PR guard reference](../../../docs/pr-guards.md). Resolve these paths from the repository root if the skill is installed elsewhere.

1. Resolve the repository root, configured Git remote, and its GitHub repository identity. Use the intended upstream repository for all external checks.
2. Fetch the current `main` and tags without overwriting conflicting local tags. Record the exact upstream `main` SHA as the cut base.
3. Inspect open release PRs and recent release merges. Resume a matching unfinished cut instead of creating a duplicate. Stop if another open cut needs reconciliation.
4. Read all participating manifests at the cut base. Participation and version arithmetic belong to the compiler. Keep the package list, current version, and base SHA together in the release evidence.
5. Complete the previous-release prerequisite below before invoking `write`.

### Previous-release prerequisite

Confirm that the previous version, the one the manifests carry at the cut base, is in one of two states:

- **Published.** It is tagged `v<version>` at the commit its registry provenance names, which is an ancestor of the cut base, and every participating package is published on npm at that version with `latest` pointing at it.
- **Abandoned unpublished.** It never reached the registry, has no tag and no GitHub Release, and the maintainer confirms that it was abandoned, for example because its release run refused publication. Record the abandonment in the cut's narrative so the changelog says the version was never published.

Any other state, such as a published version without its tag or Release, stops the cut for maintainer reconciliation: dispatch the release workflow on `main` first. The initial cut has no previous release; it starts from synchronized `0.0.0` manifests and uses `--initial` to prepare `0.1.0`.

Each package's trusted publisher on npmjs.com names the workflow file `release.yml` and the `release` environment. A package joining the release for the first time needs that publisher before its cut merges, and only the maintainer can see or set it.

## Review the cycle

Read the pending fragments and the full cycle diff from the last completed release SHA to the cut base. For the initial release, inspect the public library surface and its history.

Identify the release's purpose, consumer-visible changes, and required migrations. Check for unmarked breaking changes and fragments that describe behavior later removed or changed. Land corrections in an ordinary preparatory PR before the cut, then refresh the base and repeat the review.

Choose a short release description from the actual changes. Add an optional narrative only when users need connected explanations, a new mental model, compatibility context, or upgrade actions. Keep the narrative file outside the release checkout. Review the compiler's no-material-changes list against the cycle diff and library dependencies.

## Prepare in isolation

Create a dedicated worktree or checkout at the recorded base, with a release branch. Preserve existing worktrees and user changes. Install dependencies using the pinned package manager and frozen lockfile, then build the private Loom application using the repository scripts.

Run these commands from the isolated repository root:

```sh
pnpm loom changelog check
pnpm loom changelog preview --date YYYY-MM-DD
pnpm loom changelog write --date YYYY-MM-DD
```

Replace the date with one valid UTC release date for both commands. Add `--initial` to both preparation commands for the initial cut; an initial cut that consumes no fragments also requires `--narrative`, because the section carries no entries. If a narrative is warranted, pass the same `--narrative FILE` to both. Use the default material baseline; normal cuts do not use `--since` overrides.

An empty fragment set after the initial release does not create a release. A failed or interrupted write is not a prepared cut. Inspect its diagnostic; preserve the failed checkout for diagnosis and restart preparation from the recorded base in a fresh checkout when necessary.

Review the complete diff. It must contain only participating manifest version changes, the lockfile, the compiled changelog section, and consumed-fragment deletions. Preserve `workspace:*` references in repository manifests. Commit these changes together once; obtain the target version from the generated manifests.

Validate the committed cut using its exact base and head. Set `base_sha` and `head_sha` from the recorded Git SHAs. Write the exact release title as one newline-terminated line in a file outside the checkout. Use a file-writing tool, preserving the title as data. Set `release_title_file` to that file's path.

```sh
IFS= read -r release_title < "$release_title_file"
pnpm loom pr check --base "$base_sha" --head "$head_sha" --title "$release_title"
```

Use the title form `chore(release): Release v<version> - <description>`. Keep prose out of shell source, including variable assignments. Run the repository verification commands against the prepared cut. Local verification does not publish anything.

## Publish the PR for review

Refresh upstream state before pushing. If `main` advanced, prepare again from the new base and repeat the previous-release prerequisite and cycle review. Do not rerun `write` on an already bumped release commit. Preserve any earlier cut until its replacement is validated; do not overwrite another contributor's branch.

Recheck that the target version is still unpublished and untagged, and that no other cut is open. Push the reviewed branch and create or update its ready-for-review PR using the exact validated title. The PR body records:

- The release purpose and upgrade actions, if any.
- The base SHA, cut SHA, version, and participating packages.
- Previous-release tag and npm evidence, or a statement that this is the initial cut.
- Validation results and any merge blocker.
- Consumed fragments and optional narrative rationale.

Use a body file or a structured API argument to preserve Markdown and avoid shell evaluation. The generated release diff is its changelog decision; it needs no new fragment or `skip-changelog` exemption.

Watch the exact PR head through the required checks and review. Resolve findings before declaring the cut ready. A changed base requires refreshed preparation even if old checks passed.

Report the PR URL, validated head, check state, and remaining blockers. Explicit maintainer merge approval remains required, and the merge must preserve the release title. This skill never merges, publishes packages, or creates a Git tag or GitHub Release; the release workflow does that after the merge.

## Confirm the release after the merge

The squash merge is the only publication step. Watch the `Release` workflow run for the merge commit on `main` until it completes, then confirm the three records it reconciles:

- Every participating package is on npm at the new version with `latest` pointing at it, and its provenance names the commit the run published from. That is the merge commit, unless a dispatch recovered the release after later commits landed on `main`.
- The annotated tag `v<version>` exists at the commit the run published from.
- The GitHub Release `v<version>` exists on that tag with the changelog section as its notes and one registry tarball per package as its assets.

If the run failed, follow the recovery order in the [release workflow reference](../../../docs/release-workflow.md): re-run the failed job, dispatch the workflow on `main` after fixing the workflow, or abandon the version unpublished and cut the next one. Never publish, tag, or create a Release by hand.
