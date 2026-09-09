---
description: Trigger, jobs, commands, recovery modes, and repository settings for the workflow that publishes a release and records its tag and GitHub Release.
---

# Release workflow

`.github/workflows/release.yml` reconciles three records with the version in the participating manifests: the npm registry, the annotated tag `v<version>`, and the GitHub Release. Merging the guarded release PR is the only authorization. The workflow holds no registry secret, and every step reads before it writes, so a repeated run changes nothing. [ADR-0016](decisions/0016-a-release-merge-publishes-through-one-idempotent-workflow.md) records the design and the rejected alternatives.

The private Loom CLI carries the logic. `apps/loom/src/commands/release/` holds the two commands, and `apps/loom/src/helpers/` holds the registry, GitHub, plan, and record helpers they share.

## Trigger

The workflow runs on every push to `main`, and on `workflow_dispatch` with no inputs. All runs share one concurrency group named `release`, and a running release is never cancelled.

The manifest version is the signal, not the commit subject. Only a release cut changes that version on `main`, and the [PR guard](pr-guards.md) validates the cut before the merge. A squash title edited in the merge dialog therefore cannot make a release vanish, and a release that no run recorded is picked up by the next push. The plan job fails a run whose ref is not `refs/heads/main`.

## Jobs

Each job holds one permission, and the two writing jobs run under the `release` environment.

| Job       | Runs when                | Permission        | Environment |
| --------- | ------------------------ | ----------------- | ----------- |
| `plan`    | Every run                | `contents: read`  | None        |
| `build`   | Publication is missing   | `contents: read`  | None        |
| `publish` | Publication is missing   | `id-token: write` | `release`   |
| `record`  | The plan asks to record  | `contents: write` | `release`   |

`plan` checks out `main` with full history, builds the CLI, and runs `loom release plan`. It reports `version`, `publish`, `record`, and `libraries` as job outputs. `libraries` is a compact JSON array of the participating directories. No job uploads the plan, because the `record` job derives it again from the same checkout.

`build` checks out the commit the run attests, installs with a frozen lockfile, builds, and runs `pnpm check:packed`. It then packs each directory in `libraries` with `pnpm --dir <directory> pack`, so a private or non-participating package is never packed. It uploads the tarballs as the `release-tarballs` artifact.

`publish` runs Node.js 24 for npm 11.5.1 or newer, which trusted publishing requires. It has no checkout, because the repository's `devEngines` setting makes npm refuse to run inside one. For each tarball it reads the registry first with `npm view <name>@<version> version`. A version the registry already carries is skipped. Every other version is published with `npm publish --access public --provenance --ignore-scripts`, and a failed publication fails the job.

`record` checks out `main` with full history, builds the CLI, runs `loom release plan` again, and then runs `loom release record` with that plan. It runs after a successful publication, and also when `build` and `publish` were both skipped, which is the case for a version that is already on the registry.

Every third-party action is pinned to a full commit SHA with its version tag in a comment. GitHub-owned `actions/*` stay on their major tags.

The packed consumer runs in CI on every pull request: the Linux Node job proves it under Node and the Linux Bun job proves it under Bun, each selected by `LOOM_TEST_RUNTIME`.

## Commands

Both commands read `GH_TOKEN` from the environment. `plan` sends it as a bearer token when it is set, and `record` fails without it. Both accept `--registry` (default `https://registry.npmjs.org`) and `--github-api` (default `https://api.github.com`).

Both also accept `--request-timeout-ms` (default 30000). Every request carries that deadline, and a tarball read carries four times it, because a tarball is larger than a JSON answer. A request that reaches its deadline fails with its method, its url, and the deadline, so a stalled connection ends the run instead of holding it. In `record` that failure counts as one attempt and the retry policy reads again.

### `loom release plan`

```sh
pnpm loom release plan --repository owner/name --output plan.json
```

`--repository` and `--output` are required. `--head` defaults to `HEAD`.

The command reads the participating libraries at the head, takes their synchronized version, and resolves the cut commit: the first-parent commit that set that version. It extracts the notes for the release from the `v<version>` section of `CHANGELOG.md`, and fails when the heading is absent or the section carries no notes. It then reads each library from the registry, the tag, and the Release, and writes this plan to `--output`:

```json
{
  "version": "0.2.0",
  "head": "<sha>",
  "cutCommit": "<sha>",
  "provenanceCommit": "<sha or null>",
  "notes": "<the section body>",
  "libraries": [{ "name": "@loomcli/core", "directory": "packages/core", "published": false }],
  "publish": true,
  "tag": { "present": false, "commit": null },
  "release": { "present": false },
  "record": true
}
```

`publish` is true when any library is absent from the registry. `record` is true when the tag is absent, the Release is absent, or the Release is incomplete.

The manifests carry `0.0.0` until the initial cut. That version is never published, tagged, or released, so the command reports it as the unreleased version with nothing to reconcile and writes a plan with `publish: false`, `record: false`, and empty notes. It reads no registry and needs no changelog section. Every other version carries the notes of its section.

A Release is incomplete when an expected asset is missing or unfinished. The expected assets are the npm pack names of the participating libraries, and an asset counts as finished only when GitHub reports its state as `uploaded` and its size above 0. One Release is complete despite carrying no expected asset: a Release that carries other assets and none of the expected ones was recorded by another process, and the workflow leaves it alone.

`provenanceCommit` is the commit the registry attests for the published libraries, and it is null while the version is unpublished or the registry reports no attestation yet. Every published library must attest the same commit.

The tag is checked on every run. A published version fails the run when the tag names any commit other than `provenanceCommit`. An unpublished version fails the run when the tag names any commit other than the head.

Before it plans a publication, the command also confirms that the bytes at the head are the bytes of the cut. It refuses when a participating library directory, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, or `scripts/clean.mjs` changed between the cut commit and the head, because npm provenance names the head commit. Changes under `docs/` and to root Markdown files are not in that set and never refuse a publication.

Each refusal names the version, the commits, and the changed paths, and states that the version must be abandoned as unpublished and superseded by the next cut.

Success prints a summary of the version, the two commits, each library, the tag, the Release, and the two decisions. A failure exits with status 1. Invalid command arguments exit with status 2.

### `loom release record`

```sh
pnpm loom release record --repository owner/name --plan plan.json
```

`--repository` and `--plan` are required. `--retry-attempts` defaults to 8, and `--retry-delay-ms` defaults to 5000. The delay doubles for each attempt and stops at 60000, because the registry and the GitHub API both propagate a write with a delay.

The command reconciles in this order, and reads before each write:

1. For each library it reads the published version, its `dist.tarball`, and its `dist.integrity`. It reads the npm provenance attestation and takes the commit the build resolved. The attestation must pass three checks: its subject must carry the package URL of the released version, `pkg:npm/<name with @ percent-encoded as %40>@<version>`; its first resolved dependency must name exactly `git+https://github.com/<repository>@refs/heads/main`; and the commit it resolved must be the head of the checkout or an ancestor of it. Every library must name the same commit, and the downloaded tarball must match its integrity digest.
2. It creates the annotated tag `v<version>` at the attested commit when the tag is absent, reuses a tag that already names that commit, and fails on a tag that names any other commit.
3. It creates the Release on that tag with the plan's notes when the Release is absent. It reuses an existing Release and never edits its notes.
4. For each library the expected asset carries the npm pack name: the package name without its leading `@` and with `/` replaced by `-`, then the version and `.tgz`. `@loomcli/core` at 0.2.0 gives `loomcli-core-0.2.0.tgz`. It uploads the asset when no asset carries that name. An asset that GitHub does not report as `uploaded` with a size above 0 is an interrupted upload: the command deletes it and uploads again. A finished asset is kept and never replaced. Before it sends the token, the command checks that the Release's `upload_url` names the origin of `--github-api` or `https://uploads.github.com`.

The command prints every read, reuse, and write it made.

## Recovery

Recovery has three modes. Take them in order.

1. **Re-run the failed job.** A network failure, a registry timeout, or a cancelled runner needs nothing else. The run reads the current state and continues from it.
2. **Fix the workflow on `main`, then dispatch it.** A defect in the workflow or in the CLI is fixed through an ordinary PR. Dispatch the workflow from `main` afterwards. It publishes only while the participating tree is unchanged since the cut commit.
3. **Fix forward with a new cut.** Nothing is ever repaired in place. What the next cut says depends on whether bytes reached the registry.

A version that never published is abandoned as unpublished. This happens when the plan refuses publication, for example after a tag landed at the wrong commit or a participating file changed after the cut. The version never reaches the registry, the material-change baseline stays the commit that set it, and the next cut supersedes it. Say so in the narrative of the next cut.

A version whose published bytes are defective stays on the registry with its tag and its Release. npm forbids a republication of the same version, so the next cut supersedes it in the ordinary way.

## Repository settings

The workflow depends on settings that live outside this repository's files.

- Every PR merges with squash, and the squash title comes from the PR title. Branch protection on `main` stays required for administrators.
- The `release` environment exists, holds no secrets, has no reviewers, and its deployment branch policy allows `main` alone. That policy is the only control that pins publication, the tag, and the Release to `main`, because a dispatch can name any ref.
- The npm trusted publisher for each library names this repository, the workflow file `release.yml`, and the `release` environment, and permits direct `npm publish`.

## Accepted risks

The `record` job installs from the frozen lockfile and builds the private Loom CLI in the same job that holds `contents: write`, before the step that uses the token. Dependency scripts are disabled and every package is integrity-pinned by the lockfile, so this is the same code that already runs on every pull request. Running a published `@loomcli/loom` instead would remove the build from that job, and the CLI is private.

## A run with nothing to do

When the version is on the registry, the tag exists, and the Release exists, the plan reports `publish=false` and `record=false`. The `build`, `publish`, and `record` jobs are all skipped, and the run ends in seconds with the plan summary as its only output. No permission beyond `contents: read` is used, and no external record changes.

A repository whose manifests still carry `0.0.0` ends the same way. Before the initial cut there is no version to publish and no section to read, so every push to `main` reports that `0.0.0` is the unreleased version and skips the same three jobs.
