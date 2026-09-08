---
description: First-publication prerequisites and the manual bootstrap sequence for retained library artifacts, including npm credentials, provenance, and completion evidence.
---

# Bootstrap the first library publication

This procedure prepares an operator for the first publication of each participating library. Executing registry mutations, creating credentials, changing publishing configuration, and creating release tags or GitHub Releases require explicit release authorization.

The preparation workflow does not implement these mutations. Its [artifact verification](publication-artifacts.md) is an input to this procedure, not proof that publication is complete.

## Initialize the preparation ledger

Before the first hosted preparation, initialize the dedicated `publication-ledger` branch once. This is a repository metadata operation, separate from npm publication.

1. Inspect remote branches, Actions runs, artifacts, and release history. Confirm that no earlier preparation needs reconciliation.
2. If ledger history existed before, recover that history. Do not initialize an empty replacement.
3. In a new temporary repository, create and push the initial ledger commit. Set `repository_url` to the target GitHub repository URL.

```sh
ledger_directory="$(mktemp -d)"
git init --initial-branch=publication-ledger "$ledger_directory"
printf '%s\n' '{"schema":1,"records":[]}' > "$ledger_directory/ledger.json"
git -C "$ledger_directory" add ledger.json
git -C "$ledger_directory" commit -m "Initialize publication preparation ledger"
git -C "$ledger_directory" remote add origin "$repository_url"
git -C "$ledger_directory" push origin HEAD:refs/heads/publication-ledger
```

4. Protect `publication-ledger` against deletion and force pushes. Permit the preparation workflow to append ledger commits without requiring unrelated source CI or PR checks.
5. Keep normal repository changes on the default branch. Do not merge the ledger branch into source history.

The workflow never creates a missing ledger. A missing branch, denied write, or concurrent update stops preparation before the release build. Branch administration and history reconciliation require explicit maintainer action.

## Establish the release identity

1. Obtain the approved release cut, original base, package list, version, and title.
2. Verify the upstream release history, tags, open cuts, and incomplete publication records.
3. Obtain the artifact run ID, artifact ID, manifest digest, and source SHA from the retained record in `publication-ledger:ledger.json`.
4. Require successful packed consumer verification under Node and Bun on Linux, macOS, and Windows for that set.
5. Download the retained set and run `publication verify` with the recorded digest and source SHA.

If any retained artifact or verification evidence is missing, stop for reconciliation. Do not rebuild packages to replace a missing set.

## Verify npm ownership and prerequisites

Requirements below were checked against npm documentation on 2026-09-08. Recheck the linked sources before the authorized publication.

1. Confirm the target registry and authenticated npm account.
2. Verify publish access to each package or permission to create it in its scope.
3. Inspect each package's versions, dist-tags, and any staged versions visible to the authenticated account.
4. Reconcile any occupied target version against the retained SHA-512 integrity before continuing.
5. Verify the public repository URL in each packed manifest matches the GitHub repository exactly.

A public registry 404 does not prove scope ownership or permission to create a package. Authentication failures, timeouts, and ambiguous responses do not prove absence. The publication scope is `@loomcli`. Authenticated creation rights in that scope remain an operator prerequisite.

Routine trusted publishing requires npm 11.5.1 or later, Node 22.14.0 or later, a supported hosted runner, and `id-token: write`. The package's trusted publisher configuration binds the repository and workflow filename, plus an environment when configured. Configuration is not validated by npm until publication. Public-package provenance also requires a public repository. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

npm's separate `npm stage publish` feature requires an existing package and cannot bootstrap a new package. Loom's temporary dist-tag sequence publishes actual package versions before promotion. [npm staged publishing](https://docs.npmjs.com/staged-publishing/)

## Prepare first-publish credentials

1. Enable account 2FA and verify scope creation rights with the maintainer account.
2. For the first hosted-runner publication, create a granular write token with the shortest practical lifetime and required scope access.
3. Enable bypass 2FA only for this non-interactive publication token.
4. Supply the token through the separately authorized publishing job's secret environment.
5. Keep credentials out of the artifact set, logs, command arguments, and source checkout.

A new package has no package settings in which to configure its trusted publisher. The bootstrap therefore uses the authorized account's token, then configures trusted publishing once the package exists. The token cannot grant access that its owning account lacks. Token-based publication also depends on the package's token-access policy. [npm token creation](https://docs.npmjs.com/creating-and-viewing-access-tokens/), [npm publishing access and 2FA](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

## Publish the retained bytes after authorization

1. Pin the publishing job to the retained release source and bind its workflow identity to that source.
2. Verify the downloaded artifact identity before any registry mutation.
3. Publish each retained tarball with public access, provenance, and a temporary dist-tag such as `loom-staging`.

The per-package command shape is:

```sh
npm publish "$retained_tarball" --access public --provenance --tag loom-staging --ignore-scripts
```

Run this command from the separately authorized hosted publishing job, with the required OIDC permission for provenance. The packed repository URL must match the publishing repository. A local rehearsal does not generate production provenance. [npm provenance requirements](https://docs.npmjs.com/generating-provenance-statements/)

4. Compare each registry version's `dist.integrity` with the manifest's retained integrity.
5. After all packages match, promote each package's `latest` tag to the release version.
6. Extract the nonempty version section from `CHANGELOG.md` and prepare a draft GitHub Release.
7. Create the annotated version tag at the retained source SHA, then publish the prepared GitHub Release against that tag.
8. Attach the unchanged artifact set and its identity record to the completed GitHub Release.
9. Verify package integrity, every `latest` tag, the annotated source tag, the published GitHub Release, and its artifact attachments.

If any step fails, record completed external steps and resume the same set. Existing versions must match retained integrity. Tag presence alone does not establish completion. Automatic recovery and replacement cuts remain separate implementation work.

## Configure routine publication

1. Add the exact future publishing workflow as each package's trusted publisher.
2. Permit direct `npm publish` for the agreed temporary-dist-tag sequence.
3. Verify the configuration through an authorized publication before removing the working bootstrap path.
4. Revoke the bootstrap token after its use and the required transition checks.
5. Restrict traditional token access according to the approved publishing configuration.

New trusted publisher configurations default to permitting `npm stage publish`; direct `npm publish` needs its own permission. Registry reads and dist-tag mutations do not receive npm publish's OIDC authentication automatically. The later publication implementation must verify credentials for those operations separately. [npm trusted publishing permissions and limitations](https://docs.npmjs.com/trusted-publishers/)
