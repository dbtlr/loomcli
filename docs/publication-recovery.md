---
description: Manual publication and recovery of retained library releases, including workflow identity, npm authentication, completion checks, and reconciliation boundaries.
---

# Publish and resume a retained release

The **Publication artifacts** workflow publishes an existing release artifact set through its `publish` mode. The same operation resumes an interrupted release. Preparation remains a separate dispatch. Release merges do not trigger publication.

## Authorize and select the release

1. Complete the [bootstrap prerequisites](initial-publication.md), including the protected preparation ledger and package ownership checks.
2. Obtain explicit authorization for this release and its npm and GitHub mutations.
3. Configure the `npm-publication` environment with the required reviewers and allowed source refs.
4. Configure its `NPM_OPERATIONS_TOKEN` secret for authenticated registry reads and `dist-tag` writes.
5. Select a branch or tag whose commit equals the retained source SHA.
6. Dispatch **Publication artifacts** from that ref with `mode: publish`.
7. Supply `source`, `run`, `artifact`, and `digest` from the retained ledger record.
8. Select `auth: bootstrap` for first publication or `auth: trusted` for configured trusted publishers.

A dispatch ref must exist at the release source. If `main` advanced, an authorized operator can establish a temporary source branch. The workflow refuses a different run SHA because npm provenance uses the Actions run identity. It never creates an early version tag to make dispatch possible.

`tooling` optionally selects a full machinery commit SHA. It defaults to the run SHA. A repair can use a later tooling commit while the dispatch ref and retained packages keep the original release source. The selected tooling must contain this publication interface.

The workflow verifies the ledger selection and runs all six packed consumer lanes before granting publication permissions. All lanes and the publishing job use the same retained artifact identity. Publication shares the preparation workflow's concurrency group and does not cancel an active run.

## Configure authentication

The publishing job uses Node 22.23.2 and the private CLI's pinned npm 11.11.1 dependency. Package manifests must name the destination as `git+https://github.com/<owner>/<repository>.git`. An optional `publishConfig` can contain only `access: public`; registry and tag overrides are rejected.

For `bootstrap`, `NPM_OPERATIONS_TOKEN` also supplies the first-publish credential. For `trusted`, the npm publish process receives no token fallback. Registry reads and tag operations still receive the operations token. The token is exposed only to the publication step, after tooling builds and consumer verification.

The trusted publisher must permit direct `npm publish` and name `publication.yml`, the repository, and the `npm-publication` environment. The job requests `id-token: write` for provenance. Trusted publishing does not authenticate registry reads or dist-tag changes. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

The operations token requires package write access for promotions. Its lifetime and scope follow the [bootstrap procedure](initial-publication.md). Credentials stay in the environment and npm configuration, outside command arguments and retained artifacts.

## Publication sequence

The private CLI revalidates the local artifact set and its ledger identity before external mutations. It authenticates registry access and inspects every participating package, the source tag, and existing GitHub Release attachments.

1. Publish missing package versions with `--access public --provenance --tag loom-staging --ignore-scripts`.
2. Compare every registry `dist.integrity` with its retained SHA-512 integrity.
3. Promote each package's `latest` tag only after every package matches.
4. Verify every promotion before preparing the draft GitHub Release.
5. Create the annotated `v<version>` tag at the retained source SHA.
6. Attach the unchanged manifest, every tarball, and `publication.json` to the draft.
7. Download and compare the attachments before publishing the GitHub Release.
8. Read back the registry, annotated tag, published release, and attachments before reporting completion.

Promotions are individual registry writes. The staging tag remains in place. GitHub's separate latest-release designation is not changed by this workflow.

`publication.json` binds the repository, source, base, version, original run, artifact ID, and manifest digest. It has schema version `1`. Its presence alone does not prove completion. Completion requires all external facts above.

Existing releases must match the exact title, source SHA, tag name, changelog notes, and non-prerelease status. Existing annotated tags must target the retained commit. Existing attachments must match byte-for-byte. Conflicts stop recovery without replacing the conflicting state. A failed upload's empty `starter` placeholder is removed before uploading the retained bytes again. Uploaded or nonempty conflicting assets are never replaced. [GitHub upload failure behavior](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset)

## Resume an interrupted release

1. Preserve the original source, run, artifact ID, and digest.
2. Resolve the failed operation's credential, service, or machinery error.
3. Repeat `publish` with the same retained identity.

A retry reads external state instead of trusting an earlier command's acknowledgement. It skips matching package versions, promotions, tags, and attachments. A completed retry performs no external writes.

An older incomplete release cannot change `latest` after a newer version appears. Either a participating package's `latest` tag or a published GitHub Release establishes that boundary. A completed historical release is verified without restoring its old `latest` tags.

Failed npm reads retain registry-inspection guidance even when their error output is empty or malformed. A failed read counts as absence only when its structured error code is `E404` and the operation allows absence. Invalid JSON from a successful npm read stops recovery for reconciliation.

Automatic `latest` comparisons accept stable `0.x` versions only. An unsupported value, such as `0.2.0-beta.1` or `1.0.0`, stops comparison for reconciliation before the affected publication or promotion. Recovery never treats that value as absent or skips the comparison to permit a write. A newer published GitHub Release still permits verification of a completed historical release without comparing its current `latest` tags.

An expired or missing Actions artifact still stops automatic recovery, even when GitHub Release attachments exist. Attachments provide durable history; automatic selection from that storage is outside this workflow. A lost ledger, incomplete reservation, integrity mismatch, conflicting tag, or conflicting attachment requires maintainer reconciliation. Rebuilding or substituting package bytes is never a recovery action. [ADR-0015](decisions/0015-publication-retries-reuse-retained-artifacts.md)

Replacement cuts and version overrides remain separate work.

## CLI reference

The workflow invokes the built private CLI from the release-history checkout:

```sh
node /path/to/tools/apps/loom/dist/main.js publication publish \
  --artifacts "$artifact_directory" --digest "$manifest_digest" \
  --head "$release_source" --repository "$repository" \
  --run "$artifact_run" --artifact "$artifact_id" --auth trusted
```

Every option is required. `--auth` accepts `bootstrap` or `trusted`. The command requires GitHub Actions environment identity matching `--head` and `--repository`, plus `GH_TOKEN` and `NODE_AUTH_TOKEN`. It targets GitHub.com and the public npm registry.

Successful stdout is one JSON object with `status: complete`, `source`, `version`, and `digest`. Operational failures exit 1. Invalid CLI inputs exit 2. Arguments after `--` are rejected.

## Isolated rehearsals

```sh
pnpm run build
pnpm exec vp test --run apps/loom/tests/publication-release.test.ts apps/loom/tests/publication-services.test.ts apps/loom/tests/publication-workflow.test.ts
```

The recovery suite creates a real two-package release cut and retained tarballs. It runs the publication entrypoint with simulated npm process and GitHub HTTP boundaries. Lost acknowledgements leave committed external state for the next attempt. The suite covers each publication boundary, conflicts, missing artifacts, and old-release retries. A localhost registry also exercises staging-only tag reads with the pinned npm executable.

These rehearsals do not contact npm for publication or create real GitHub releases. Hosted provenance, credentials, permissions, and registry propagation require the separately authorized first publication.
