---
description: Trigger, jobs, commands, recovery modes, and repository settings for the workflow that publishes a release and records its tag and GitHub Release.
---

# Release workflow

`.github/workflows/release.yml` reconciles three records with the version in the participating manifests: the npm registry, the annotated tag `v<version>`, and the GitHub Release. Merging the guarded release PR is the only authorization. The workflow holds no registry secret, and every step reads before it writes, so a repeated run changes nothing. [ADR-0016](../decisions/0016-a-release-merge-publishes-through-one-idempotent-workflow.md) records the design and the rejected alternatives.

This reference documents this repository's own release, and the [toolchain reference](../toolchain/README.md) documents the public commands that act on one package directory.

The Loom CLI, `@loomcli/loom` in `packages/loom`, carries the logic. It participates in the release set like the libraries, and its release commands are hidden, so no listing advertises them. `packages/loom/src/commands/release/` holds `plan`, `record`, and the synchronized `cut`. It also holds `formula`, an author command in the same hidden `release` group that `loom release --help` lists. `packages/loom/src/helpers/` holds the registry, GitHub, plan, and record helpers they share. The workflow runs a published, pinned copy of the CLI, the [release tool](#release-tool), not the one in the checkout.

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

`plan` checks out `main` with full history, installs the release tool, and runs `loom release plan`. It installs and builds nothing from the checkout. It reports `version`, `publish`, `record`, and `libraries` as job outputs. `libraries` is a compact JSON array of the participating directories. No job uploads the plan, because the `record` job derives it again from the same checkout.

`build` checks out the commit the run attests, installs with a frozen lockfile, builds, and runs `pnpm check:packed`. It then packs each directory in `libraries` with `pnpm --dir <directory> pack`, so a private or non-participating package is never packed. It uploads the tarballs as the `release-tarballs` artifact.

npm shows the README a version was published with, so each packed README links to the docs at its own version's tag. Each published package's `prepack` script runs `scripts/readme-links.mjs pin`, which rewrites every `blob/main/` link in its README to `blob/v<version>/`, taking the version from the package's `package.json`, and its `postpack` script runs `unpin`, which restores the source README. The source READMEs keep `blob/main/`, so they read correctly on GitHub between releases. A link is live once the release creates its tag. `pnpm check:packed` fails when a packed README links anywhere else in the repository or when packing leaves a source README changed, and `packages/core/tests/readme-links.test.ts` fails when a source README links into the repository other than through an absolute `blob/main/` URL, which also catches a README a failed pack left rewritten. A relative link counts as one of those, a Markdown link or an HTML `src` or `href` alike, because npm resolves it against the default branch, so a package README links to the repository's files only by absolute URL.

`publish` runs Node.js 24 for npm 11.5.1 or newer, which trusted publishing requires. It has no checkout, because the repository's `devEngines` setting makes npm refuse to run inside one. For each tarball it reads the registry first with `npm view <name>@<version> version`. A version the registry already carries is skipped. Every other version is published with `npm publish --access public --provenance --ignore-scripts`, and a failed publication fails the job.

`record` checks out `main` with full history, installs the release tool, runs `loom release plan` again, and then runs `loom release record` with that plan. Like `plan`, it installs and builds nothing from the checkout. It runs after a successful publication, and also when `build` and `publish` were both skipped, which is the case for a version that is already on the registry.

Every third-party action is pinned to a full commit SHA with its version tag in a comment. GitHub-owned `actions/*` stay on their major tags.

The packed consumer runs in CI under Node and Bun, each selected by `LOOM_TEST_RUNTIME`: on Linux for every push to `main` and every pull request that changes code, and on macOS for every pull request and every push to `main`. The macOS jobs, `node_macos` and `bun_macos`, declare no `needs`, so Hugi can run them as the lanes `.github/hugi.yaml` declares, and they cannot skip a documentation-only change.

## Release tool

The `plan` and `record` jobs run the published `@loomcli/loom` that `.github/release-tool` pins. [ADR-0075](../decisions/0075-the-release-workflow-runs-a-pinned-published-loom-cli.md) records the design.

An explicit `release cut --target VERSION` is recorded in the synchronized manifests and changelog before merge. The PR guard builds the checkout's tool to validate that target. The pinned `plan` and `record` commands read the committed version, so target selection requires no new workflow option or release-tool bootstrap.

`.github/release-tool/package.json` names `@loomcli/loom` at one exact version, and `.github/release-tool/package-lock.json` pins it and every package it depends on by integrity. Each job copies both files into `$RUNNER_TEMP/release-tool`, outside the checkout so the install leaves the working tree the plan reads untouched, and runs `npm ci --ignore-scripts` there. The jobs then run `$RUNNER_TEMP/release-tool/node_modules/.bin/loom` from the checkout.

A change to `release plan` or `release record` therefore reaches the workflow one release later: a release publishes it, and then the pin moves to that version. The pinned version must carry every command and option the workflow calls. The `build` job still installs and builds the workspace, because it packs the release from the commit the run attests.

Dependabot proposes each new version of the release tool as a pull request. To move the pin by hand, set the exact version in `.github/release-tool/package.json`, then regenerate the lockfile from that directory, which npm treats as its own project:

```sh
cd .github/release-tool
npm install --package-lock-only --ignore-scripts
```

Move the pin when a release changes the release commands, and check that the workflow's calls still match the new version's options.

## Workspace directory

`release plan`, `release record`, `release cut`, and `pr check` run in the workspace directory: the directory that holds `pnpm-workspace.yaml`, beside `packages/`, `.changes/`, `CHANGELOG.md`, and `pnpm-lock.yaml`. The workspace directory can sit at the git root or in a directory below it, and no option names it: each command takes its working directory as the workspace directory.

Before it reads anything else, each command checks that its working directory holds `pnpm-workspace.yaml`. In any other directory, such as a package folder or the git root above a workspace, it writes nothing, exits with status 1, and prints `Run <command> from the workspace directory, the one that holds pnpm-workspace.yaml.`, with the command's name in place of `<command>`, such as `Run release plan from the workspace directory, the one that holds pnpm-workspace.yaml.` `release cut` refuses the same way with `--dry-run`.

Git prints changed paths from the top of the work tree, and the commands run git with `diff.relative` off, so a repository's setting cannot change that. The commands rewrite each changed path relative to the workspace directory, so each path they print or compare, and each `libraries[].directory` in a plan, is relative to the workspace directory. A path outside the workspace climbs to the git root first, as `../docs/decisions/README.md` does. The file paths an operator passes, such as `--output`, `--plan`, and `--narrative`, are read from the working directory, which is the workspace directory.

The commands give the same plan, cut, record, and verdict in both layouts:

- `libraries[].directory` in a plan names the library's directory relative to the workspace directory, such as `packages/core` in both layouts. The `build` job passes it to `pnpm --dir`, so the job's pack step runs in the workspace directory.
- The decision records stay in `docs/decisions/` at the git root, shared by every workspace below it. The [PR guard](pr-guards.md) reads them there.
- The build-path policy judges a path inside the workspace from the workspace directory, and a path outside it from the git root. Under either, `docs/` and top-level Markdown files never affect a build, and any other path does, such as `.github/workflows/ci.yml` at the git root.

The workspace can move from the git root to a directory below it, in one commit or with `.changes/` moved in a later first-parent commit than the rest, and the history before the move stays readable. `pnpm-workspace.yaml` and `packages/` move in the same commit, because a revision that holds the workspace file in one place and the libraries in the other holds no libraries, which ends the material-change baseline walk there. A command that reads the workspace at an earlier revision finds it where that revision held `pnpm-workspace.yaml`: in the working directory when the revision holds the file there, else at the git root when the revision holds it there, else in the working directory. That rule covers every read of a workspace file at a revision: the libraries' manifests, such as the version each earlier commit set and the libraries at a pull request's merge base, the change fragments, `CHANGELOG.md`, `pnpm-lock.yaml`, the authoring skill, and the files a release PR's lockfile is prepared from. A read of a path at the git root, such as `docs/decisions/`, names that path at every revision. Each path a command prints stays relative to the current workspace directory, so a file read where an earlier revision held the workspace at the git root reads as `../CHANGELOG.md`.

The material-change baseline walk follows each library's manifest at both places, the path in the current workspace directory and the same path at the git root, so the first cut after the move takes its baseline from the release before the move. A cut's landing order, which the release PR's check derives again, takes each pending fragment's newest first-parent commit that added it in the current workspace directory. When that commit carried the fragment from the git root, which its first parent shows by holding the fragment there, the fragment keeps the commit that added it at the git root, so a fragment that landed before the move keeps its landing order after it, whether one commit moves the whole workspace or a later commit moves `.changes/` after the rest. Every other fragment lands where the current workspace directory added it, so a fragment that reuses the name of one a cut consumed before the move sorts where it landed, and an uncommitted fragment fails the commit check whatever the git root's history holds.

The material report reads a file that the move carried to the same path in the workspace, with the same mode and content, as unchanged, so the move alone changes no library materially. A file the move edited or deleted counts against the library that held it, so the first cut after a move that edits one library's file reports the libraries the move left as they were unchanged.

Publish a pending cut before the move merges. `release plan` refuses a version cut before the move and published after it, because its diff from the cut commit to the head sees every file the move carried as changed.

## Commands

Both commands read `GH_TOKEN` from the environment. `plan` sends it as a bearer token when it is set, and `record` fails without it. Both accept `--registry` (default `https://registry.npmjs.org`) and `--github-api` (default `https://api.github.com`), each an http or https URL; a value with no scheme, such as `registry.npmjs.org`, is a usage error before any request.

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

Each `directory` is relative to the [workspace directory](#workspace-directory). `publish` is true when any library is absent from the registry. `record` is true when the tag is absent, the Release is absent, or the Release is incomplete.

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
2. **Fix the workflow on `main`, then dispatch it.** A defect in the workflow is fixed through an ordinary PR. Dispatch the workflow from `main` afterwards. It publishes only while the participating tree is unchanged since the cut commit.

   A defect in the release commands lives in the pinned, published CLI, so a fix in `packages/loom` reaches the workflow only after a release publishes it. When an earlier published version works, a PR moves the pin back to it. When the defect blocks the release that would publish its fix, a PR switches the `plan` and `record` jobs to install the workspace and run `node packages/loom/dist/main.js` after `pnpm build` for that release, and a later PR restores the release tool and moves its pin to the fixed version.
3. **Fix forward with a new cut.** Nothing is ever repaired in place. What the next cut says depends on whether bytes reached the registry.

A version that never published is abandoned as unpublished. This happens when the plan refuses publication, for example after a tag landed at the wrong commit or a participating file changed after the cut. The version never reaches the registry, the material-change baseline stays the commit that set it, and the next cut supersedes it. Say so in the narrative of the next cut.

A version whose published bytes are defective stays on the registry with its tag and its Release. npm forbids a republication of the same version, so the next cut supersedes it in the ordinary way.

## Repository settings

The workflow depends on settings that live outside this repository's files.

- The repository allows squash merges and rebase merges, and no merge commits. An ordinary PR merges with squash, and the squash title is the PR title followed by ` (#NNN)`. A PR that lands several tasks as one commit per task merges with rebase, so each commit lands on `main` as its own. Branch protection on `main` stays required for administrators, and it requires a branch to be up to date with `main`, so a PR whose base moves rebases and passes CI again before it merges.
- Branch protection requires three status checks: `Node LTS / verify`, `Bun / verify`, and `PR / fragment and version guards`. Each verify check reports once its slowest job finishes, and requires its macOS job on every change, so a merge waits for both.
- The `release` environment exists, holds no secrets, has no reviewers, and its deployment branch policy allows `main` alone. That policy is the only control that pins publication, the tag, and the Release to `main`, because a dispatch can name any ref.
- Each library has an npm trusted publisher configured on npmjs.com or through `npm trust` in npm 11.15.0 or newer. The publisher carries exactly these values:

  | Field                | Value                       |
  | -------------------- | --------------------------- |
  | Organization or user | `dbtlr`                     |
  | Repository           | `loomcli`                   |
  | Workflow filename    | `release.yml`               |
  | Environment name     | `release`                   |
  | Allowed actions      | `npm publish` enabled       |

  A card that does not match fails the `publish` job for that library. A workflow filename that differs, such as `release.yaml`, fails with `ENEEDAUTH`. A card that allows only `npm stage publish`, which npm always allows, fails with `E403 OIDC permission denied`. The workflow publishes directly because the `record` job reads the registry right after the publish, and a staged version waits for a maintainer's approval before it reaches the registry. Correct the card on npmjs.com, then run `gh run rerun <run-id> --failed`. The re-run reads the current state and publishes only what is missing.

  npm attaches a trusted publisher only to a name that already exists on the registry, so a library joining the release set is first published by the maintainer as a placeholder `0.0.0`, from a directory outside this repository, and its publisher is configured on that record before the cut that carries it merges. The workflow reads only the version the manifests carry, so the placeholder never enters a plan, and the maintainer can deprecate it or unpublish it within npm's window once the first real version is on the registry.

  Configure the publisher when the cut that first publishes the library is ready to merge. After the placeholder is visible, an authenticated maintainer can configure and inspect its publisher through the CLI. Run outside this repository, replacing `<package>` with its full name:

  ```sh
  npm trust github <package> --file release.yml --repo dbtlr/loomcli --env release --allow-publish --yes
  npm trust list <package> --json
  ```

  Check that the result names the repository, workflow, and environment above and includes `createPackage`, the direct publication permission. npm also grants staged publication. These commands can require interactive two-factor authentication, even after `npm login`. See the [npm trust reference](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

  A new configuration must complete its first successful trusted publication within 48 hours. That publication validates the configuration; validated configurations do not expire under this rule. If the window lapses, delete the expired configuration and create a matching replacement before re-running the failed release job. See [trusted publisher configuration expiry](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

## Accepted risks

The `record` job runs third-party code while it holds `contents: write`: the pinned `@loomcli/loom` and the packages it depends on. Every one of them is integrity-pinned by the release tool's lockfile and installed with scripts disabled, and the job installs and builds nothing from the checkout, so a new dependency version reaches the job only through a reviewed pull request.

## A run with nothing to do

When the version is on the registry, the tag exists, and the Release exists, the plan reports `publish=false` and `record=false`. The `build`, `publish`, and `record` jobs are all skipped, and the run ends in seconds with the plan summary as its only output. No permission beyond `contents: read` is used, and no external record changes.

A repository whose manifests still carry `0.0.0` ends the same way. Before the initial cut there is no version to publish and no section to read, so every push to `main` reports that `0.0.0` is the unreleased version and skips the same three jobs.
