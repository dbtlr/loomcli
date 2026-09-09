---
description: Local and CI checks for PR fragments, library versions, and normal or initial release cuts.
---

# PR guards

The private Loom CLI validates committed PR content with the changelog compiler's parser, version calculation, renderer, and build-path policy.

Command-specific code lives in `apps/loom/src/commands/changelog/` and `apps/loom/src/commands/pr/`. Both commands use `apps/loom/src/helpers/` for shared release logic. Helpers do not import command code.

```sh
pnpm build
pnpm loom pr check --base origin/main --title "Fix command output"
pnpm loom pr check --base origin/main --title "Refactor internal code" --label skip-changelog
```

`--base` and `--title` are required. `--head` defaults to `HEAD`. Repeat `--label` for multiple labels. Base and head can be commit references. The command requires full Git history and reads Git objects, so local edits and untracked files do not affect the result. It leaves the checkout, commits, and tags unchanged.

Success prints `PR checks passed.` and exits with status 0. Invalid PR content or missing history exits with status 1. Invalid command arguments exit with status 2.

## Ordinary PRs

The comparison starts at the merge base of the supplied base and head. Changes made only on the base branch do not satisfy fragment admission.

- A build-affecting diff requires an added or modified fragment, or the exact label `skip-changelog`. Root Markdown files and `docs/` are excluded from the build-path policy.
- An unchanged fragment, a deleted fragment, or `.changes/README.md` does not satisfy admission.
- Every fragment at the head must pass validation, even with `skip-changelog` or a documentation-only diff.
- Participating libraries must retain the synchronized stable `0.x` version from the comparison base. New libraries join that version.
- A previously participating manifest cannot change its version by becoming private. Removed libraries need no retained manifest. Private packages and the root package do not participate.

The [fragment guide](../.changes/README.md) governs consumer relevance and skip reasons. CI checks structure; review judges the content and migration instructions.

## Release PRs

Release titles have this exact form:

```text
chore(release): Release v0.4.8 - Improve command output
```

A title beginning with `chore(release)` must match that form. Release PRs are exempt from ordinary fragment admission and must satisfy every release check:

- The head includes the supplied base commit. A stale release branch must incorporate the current base and prepare the cut again.
- Every participating library carries the title version, with the same participation and all other manifest fields preserved.
- The title version matches the compiler's calculation from the base fragments. The initial cut advances `0.0.0` to `0.1.0`. An initial cut that consumes no fragments carries a narrative, because a section without entries would leave the release without notes.
- The corresponding local Git tag is absent, and no pending fragments remain.
- The changelog preserves its introduction and earlier releases. The new section matches the compiler output, including fragment order and the material-change report. An optional narrative follows the compiler's Markdown rules.
- The diff contains only library version fields, `pnpm-lock.yaml`, the new changelog section, and consumed-fragment deletions. Retained files keep their modes, and the lockfile remains a regular file.
- The lockfile exactly matches the version writer's output from the base with bumped manifests. Unrelated dependency-resolution changes require an ordinary PR.

The lockfile comparison uses the pinned pnpm in a temporary directory, with offline resolution and scripts and pnpmfile hooks disabled. Dependencies must be cached. This is the same preparation used by `loom changelog write`.

The material-change baseline is the first-parent commit at the base that set the current version. No tag enters this computation, so a version that was abandoned without a tag gives the same baseline as a published one. The guard needs the full first-parent history of the base, and still rejects an existing local tag for the new version.

Replacement version overrides are rejected. This guard checks only the contents of the pull request. A passing check does not publish; merging the release PR authorizes the [release workflow](release-workflow.md), which publishes only a version absent from the registry.

## GitHub Actions

`.github/workflows/pr.yml` provides `PR / fragment and version guards`. It checks the event's base and head commits with full history and tags. It reruns on PR creation, reopening, new commits, title or base edits, and label additions or removals. A newer run cancels an older run for the same PR.

The job uses read-only repository permissions and passes PR metadata from environment variables directly into a process argument array. Label names retain their exact case. Builds and consumer tests remain in the existing CI workflow.

Repository administrators must require `PR / fragment and version guards` on `main` to make this check a merge gate. This workflow does not change branch protection settings. Release merges must preserve the release PR title as the commit title on `main`.
