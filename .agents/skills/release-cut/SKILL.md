---
name: release-cut
description: Prepare a Loom CLI library release pull request from pending change fragments, or resume an existing release cut for review.
---

# Prepare a release cut

Produce one reviewable release commit and a ready-for-review PR. Use the existing compiler and version writer for every generated file.

This procedure prepares a cut. Publication machinery and recovery records are not implemented in this repository yet. Record missing publication evidence as a blocker; a successful local guard does not prove release readiness.

## Establish the release inputs

Read the repository's [fragment guide](../../../.changes/README.md), [compiler reference](../../../docs/changelog-compiler.md), and [PR guard reference](../../../docs/pr-guards.md). Resolve these paths from the repository root if the skill is installed elsewhere.

1. Resolve the repository root, configured Git remote, and its GitHub repository identity. Use the intended upstream repository for all external checks.
2. Fetch the current `main` and tags without overwriting conflicting local tags. Record the exact upstream `main` SHA as the cut base.
3. Inspect open release PRs and recent release merges. Resume a matching unfinished cut instead of creating a duplicate. Stop if another cut or incomplete publication needs reconciliation.
4. Read all participating manifests at the cut base. Participation and version arithmetic belong to the compiler. Keep the package list, current version, and base SHA together in the release evidence.
5. Complete the applicable publication prerequisite below before invoking `write`.

### Initial release

The initial cut starts from synchronized `0.0.0` manifests and uses `--initial` to prepare `0.1.0`.

Verify the upstream release history, tags, and each package's registry history. Establish that no previous or incomplete Loom library release exists and that the target package versions are available. Authentication errors, network errors, and ambiguous registry responses do not prove absence. A package name already owned by another project requires maintainer reconciliation.

The first publication needs a separately verified bootstrap procedure and explicit release authorization. Record its readiness in the PR. If publication preparation is incomplete, the cut remains a preparation artifact with an explicit merge blocker.

### Later releases

Require the previous release's retained artifact set: package list, version, source SHA, original base, consumed fragments, tarballs, and digests. Verify all of the following against GitHub and the configured registry:

- Each package version exists and its registry integrity matches its retained tarball.
- Every participating package's `latest` tag points to the completed release version.
- The annotated version tag resolves to the recorded source SHA, which is an ancestor of the cut base.
- The matching GitHub Release is published against that tag.
- No newer reserved version, incomplete release, or unfinished publication supersedes that state.

Use the previous release's package list for this audit, including packages removed from the current tree. Audit registry reservations and initial-publication readiness for newly participating packages separately.

Missing artifacts or inconsistent state stops the cut. Tag presence alone is insufficient. Resume the original publication or request maintainer reconciliation. Replacement cuts and version overrides remain unsupported.

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

Replace the date with one valid UTC release date for both commands. Add `--initial` to both preparation commands for the initial cut. If a narrative is warranted, pass the same `--narrative FILE` to both. Use the default material baseline; normal cuts do not use `--since` overrides.

An empty fragment set after the initial release does not create a release. A failed or interrupted write is not a prepared cut. Inspect its diagnostic; preserve the failed checkout for diagnosis and restart preparation from the recorded base in a fresh checkout when necessary.

Review the complete diff. It must contain only participating manifest version changes, the lockfile, the compiled changelog section, and consumed-fragment deletions. Preserve `workspace:*` references in repository manifests. Commit these changes together once; obtain the target version from the generated manifests.

Validate the committed cut using its exact base and head. Set `base_sha` and `head_sha` from the recorded Git SHAs. Write the exact release title as one newline-terminated line in a file outside the checkout. Use a file-writing tool, preserving the title as data. Set `release_title_file` to that file's path.

```sh
IFS= read -r release_title < "$release_title_file"
pnpm loom pr check --base "$base_sha" --head "$head_sha" --title "$release_title"
```

Use the title form `chore(release): Release v<version> - <description>`. Keep prose out of shell source, including variable assignments. Run the repository verification commands against the prepared cut. Package builds and publication remain the publishing workflow's responsibility; local verification does not publish anything.

## Publish the PR for review

Refresh upstream state before pushing. If `main` advanced, prepare again from the new base and repeat the publication prerequisite and cycle review. Do not rerun `write` on an already bumped release commit. Preserve any earlier cut until its replacement is validated; do not overwrite another contributor's branch.

Recheck target-version reservations and unfinished cuts. Push the reviewed branch and create or update its ready-for-review PR using the exact validated title. The PR body records:

- The release purpose and upgrade actions, if any.
- The base SHA, cut SHA, version, and participating packages.
- Previous-release completion evidence, or initial-release absence evidence.
- Validation results and any publication/bootstrap merge blocker.
- Consumed fragments and optional narrative rationale.

Use a body file or a structured API argument to preserve Markdown and avoid shell evaluation. The generated release diff is its changelog decision; it needs no new fragment or `skip-changelog` exemption.

Watch the exact PR head through the required checks and review. Resolve findings before declaring the cut ready. A changed base requires refreshed preparation even if old checks passed.

Report the PR URL, validated head, check state, and remaining blockers. Explicit maintainer merge approval remains required, and the merge must preserve the release title. This skill never merges, publishes packages, promotes registry tags, or creates a Git tag or GitHub Release.
