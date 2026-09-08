---
description: Commands, artifact identity, storage, verification, and rehearsal for preparing library publication without publishing packages.
---

# Publication artifacts

The private Loom CLI prepares one release artifact set from a pinned, compiler-validated release commit. Preparation does not publish packages.

## Commands

Commands run from a repository with full Git history. The built private CLI can belong to a separate tooling checkout. Inputs use full commit SHAs.

```sh
node /path/to/tools/apps/loom/dist/main.js publication prepare \
  --base "$release_base" --head "$release_source" --title "$release_title" \
  --output "$artifact_directory"

node /path/to/tools/apps/loom/dist/main.js publication verify \
  --artifacts "$artifact_directory" --digest "$manifest_digest" \
  --head "$release_source" --runtime bun
```

`prepare` requires `--base`, `--head`, `--title`, and `--output`. `verify` requires `--artifacts`, `--digest`, and `--head`. Both accept `--runtime node|bun`, with `node` as the default. Arguments after `--` are rejected.

Each command returns one JSON object on stdout: `base`, `source`, `version`, and `digest`. Failures exit 1 with a diagnostic on stderr. Invalid CLI inputs exit 2.

### Preparation

The shared PR guard replays the compiler against the original base and release head. An existing version tag rejects a new preparation.

Preparation clones the pinned release into a temporary directory. It installs with the frozen lockfile, runs `pnpm run verify`, and packs each participating library with pinned pnpm. Build and pack operations cannot change tracked source files or leave untracked source files.

Tarball inspection checks package identity, export targets, declarations, file inventory, and dependency versions against the committed manifests. Internal dependencies retain `workspace:*` in source and become exact release versions in tarballs. External dependency declarations remain unchanged. Surviving `workspace:` references fail inspection.

The current package format is ESM with explicit export entries containing `types` and `import` targets. The `files` array uses literal files or directories. Wildcard exports, alternate condition maps, and glob-based file policies require an explicit extension to the inspector. Links, special files, unsafe paths, duplicate paths, and expanded contents above 100 MiB are rejected.

Every exported entry loads in the selected runtime and compiles through an independent TypeScript consumer. The `textstat` and `jsonkit` examples compile and run their existing process tests outside the source workspace, against the retained packages. Core's positive and negative declaration checks also consume its retained tarball.

The output directory appears only after verification succeeds. An existing output directory fails without rebuilding or overwriting it. Preparation does not select a different directory automatically on retry.

### Verification and reuse

The manifest digest comes from the original preparation result, kept separately from the downloaded set. It is not recomputed as the expected value from untrusted downloaded contents. The source SHA is also an independent input.

Verification checks the digest, exact source, original base, consumed fragment contents, participating libraries, tarball integrity, and inventory. It repeats the release guard and consumer checks. An existing version tag is permitted only when it is annotated and resolves to the retained source SHA.

The verifier creates a temporary checkout of the original source and installs test dependencies without lifecycle scripts. It compiles consumers but does not invoke the release build or pack commands. The tooling checkout can contain a later machinery repair. The retained package bytes and release source remain unchanged.

## Artifact set and storage

`manifest.json` contains schema version `1`, the source SHA, original base, release title, version, consumed fragment names and contents, and package records. Each package record contains its name, version, source directory, tarball filename, SHA-512 SRI integrity, file inventory, and export names.

Tarballs are named `package-0.tgz`, `package-1.tgz`, and so on in participant discovery order. SHA-256 of the exact manifest bytes identifies the set. The SHA-512 integrity values use npm's registry integrity format.

The manually dispatched **Publication artifacts** workflow has three modes:

- `prepare` produces a new set from the supplied release source, base, and title.
- `publish` verifies an existing set across all consumer lanes, then publishes or resumes it through the [recovery workflow](publication-recovery.md).
- `verify` downloads an existing set using its original run ID, artifact ID, source SHA, and manifest digest.

The workflow reserves the source and version in `ledger.json` on the dedicated `publication-ledger` branch before building. It rejects an existing reservation for either identity, even after deletion of every Actions artifact record. A missing or unreadable ledger stops the workflow.

The workflow stores the set as `release-<source SHA>` with 90-day retention. After upload, it records the original run ID, artifact ID, and manifest digest in the reservation. Verification requires these inputs to match the ledger. The workflow also rejects preparation when that source already has an Actions artifact record, including an expired record. A full rerun of a preparation attempt is rejected. Failed consumer jobs can be rerun, or a new `verify` dispatch can reuse the original set.

All six Node and Bun platform lanes download the same artifact ID. Each lane builds its private tooling in a separate checkout, then verifies the retained release without rebuilding its source. A set becomes publication-ready only when all lanes succeed for that artifact identity. An upload alone is not acceptance evidence.

The ledger has schema version `1` and an array of `records`. Each record binds `source`, `base`, `title`, `version`, and the original `run`. Its state moves once from `reserved` to `retained`, which adds `artifact` and `digest`. Records remain after completion or artifact loss. Updates create commits with the observed branch head as their parent and advance the ref without force. Competing writes fail instead of admitting two builds.

A failed build, failed upload, or interrupted ledger update leaves the reservation in place. Stop for maintainer reconciliation; do not remove the reservation or rerun preparation. An uploaded set without its final ledger record is not automatically reusable. Reconciliation must recover the original identity from independent run evidence and preserve the existing record.

Retain the successful verification run with the release record. Actions retention is finite. Missing or expired artifacts require reconciliation, never automatic reconstruction. The ledger prevents accidental rebuilding after artifact loss; it does not protect against an administrator deliberately rewriting repository history.

The retention job receives `contents: write` for ledger commits. The publication job receives it for release tags and attachments in `publish` mode. Consumer jobs retain read-only permissions. Initialize and protect the ledger branch using the [bootstrap procedure](initial-publication.md#initialize-the-preparation-ledger). The local `prepare` command remains a primitive for isolated rehearsals. It does not enforce hosted reservation history.

The `publish` mode attaches the identical manifest and tarballs to the GitHub Release for durable history. Registry mutations require that explicit mode and successful consumer verification. The [publication and recovery procedure](publication-recovery.md) defines its authorization, authentication, and retry behavior. [ADR-0015](decisions/0015-publication-retries-reuse-retained-artifacts.md) fixes this retry rule.

## Isolated rehearsal

The rehearsal runs against the current committed checkout. It creates an isolated cut with the existing compiler, prepares the real packages, copies the set to simulate download, removes the original copy, advances the checkout, and verifies the downloaded bytes again. The `0.0.0` sentinel produces `0.1.0`; later versions receive a temporary rehearsal fragment before the cut. When the current version has no tag, the temporary clone receives a baseline tag before preparing that next cut. Existing tags remain unchanged.

```sh
pnpm install --frozen-lockfile
pnpm run build
node scripts/rehearse-publication.mjs
LOOM_REHEARSAL_RUNTIMES=node,bun node scripts/rehearse-publication.mjs
```

CI runs the rehearsal on Linux, macOS, and Windows. Both runtimes consume the same set within each rehearsal. The rehearsal removes its temporary directories on completion. It never pushes its cut, changes tags in the source repository or remote, or contacts npm for publication. Registry downloads for dependency installation remain necessary.

The [bootstrap procedure](initial-publication.md) defines the separately authorized first publication.
