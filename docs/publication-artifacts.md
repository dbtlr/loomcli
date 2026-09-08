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

The manually dispatched **Publication artifacts** workflow has two modes:

- `prepare` produces a new set from the supplied release source, base, and title.
- `verify` downloads an existing set using its original run ID, artifact ID, source SHA, and manifest digest.

The workflow stores the set as `release-<source SHA>` with 90-day retention. It rejects a repeated preparation when that source has an artifact record, including an expired record. A full rerun of a preparation attempt is rejected. Failed consumer jobs can be rerun, or a new `verify` dispatch can reuse the original set.

All six Node and Bun platform lanes download the same artifact ID. Each lane builds its private tooling in a separate checkout, then verifies the retained release without rebuilding its source. A set becomes publication-ready only when all lanes succeed for that artifact identity. An upload alone is not acceptance evidence.

Retain the manifest digest, source SHA, run ID, artifact ID, and successful verification run with the release record. Actions retention is finite. A deleted record cannot prove that preparation never happened. Missing or expired artifacts require reconciliation, never automatic reconstruction.

The subsequent publication workflow must attach the identical manifest and tarballs to the completed GitHub Release for durable history. That attachment and all registry mutations are outside this preparation workflow. [ADR-0015](decisions/0015-publication-retries-reuse-retained-artifacts.md) fixes this retry rule.

## Isolated rehearsal

The rehearsal runs against the current committed checkout, initially at `0.0.0`. It creates an isolated `0.1.0` cut with the existing compiler, prepares the real packages, copies the set to simulate download, removes the original copy, advances the checkout, and verifies the downloaded bytes again.

```sh
pnpm install --frozen-lockfile
pnpm run build
node scripts/rehearse-publication.mjs
LOOM_TEST_RUNTIME=bun node scripts/rehearse-publication.mjs
```

The rehearsal removes its temporary directories on completion. It never pushes its cut, creates release tags, or contacts npm for publication. Registry downloads for dependency installation remain necessary.

The [bootstrap procedure](initial-publication.md) defines the separately authorized first publication.
