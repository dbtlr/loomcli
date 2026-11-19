# Recorded attestation fixtures

The self-update attestation tests answer GitHub's attestations API, the bundle host, and Sigstore's
TUF repository from these files, so no test reaches the network. Each file was recorded on
2026-11-19 from the public service named below, unauthenticated, and is kept as served, except for
the one change this page names and the whitespace the repository's formatter sets in the JSON
files. TUF signs the canonical form of its metadata, not the served bytes, so that whitespace does
not change what the signatures cover.

## Attestations

Each `<name>.list.json` is the `200` body of
`GET https://api.github.com/repos/<owner>/<repo>/attestations/sha256:<digest>?per_page=10&predicate_type=provenance`,
sent with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`. Each
`<name>.bundle.snappy` is the body of that answer's `bundle_url`, the bundle's JSON in Snappy's block
format, as GitHub's blob storage serves it.

The one change: each `bundle_url` was a signed URL whose query held signing parameters that expired
within the hour, and the recording replaces the whole query with `?sig=recorded`. The tests match
the bundle host by its path.

| Name | Repository and release | Digest asked for | What the attestation shows |
| --- | --- | --- | --- |
| `cargo-dist` | `axodotdev/cargo-dist` v0.34.0 | `01fbf81e…aed5`, of `cargo-dist-aarch64-apple-darwin.tar.xz.sha256` | `.github/workflows/release.yml` of the same repository, run on `refs/tags/v0.34.0`. Rekor log index 3637740920, 2026-11-02. |
| `aqua` | `aquaproj/aqua` v2.66.1 | `5ca3f758…7d33`, of `aqua_2.66.1_checksums.txt` | `.github/workflows/release.yaml` of `suzuki-shunsuke/go-release-workflow`, a reusable workflow of another repository, so the subject alternative name and the Source Repository URI name different repositories. Rekor log index 3692143160, 2026-11-04. |
| `prek` | `j178/prek` v0.5.11 | `5ed7791f…c3c1`, of `prek-aarch64-apple-darwin.tar.gz.sha256` | `.github/workflows/release.yml` of the same repository, run on `refs/heads/main`, not on the tag. Rekor log index 3919535177, 2026-11-16. |

`cargo-dist.asset` is the release asset `cargo-dist-aarch64-apple-darwin.tar.xz.sha256` of
`axodotdev/cargo-dist` v0.34.0, downloaded from the release. Its SHA-256 is the digest above, which
the signed statement names.

## Sigstore's TUF repository

The files in `tuf/` are the metadata `https://tuf-repo-cdn.sigstore.dev` served on 2026-11-19, under
the names the client requests them by: `timestamp.json` (version 838, which expires on
2026-11-25T19:19:46Z), `166.snapshot.json`, and `14.targets.json`. The repository served no
`17.root.json`, so the root that `@sigstore/tuf` 5.0.1 ships, version 16, was current, and the
tests answer that request with `404`. The `trusted_root.json` target is not recorded: the one
`@sigstore/tuf` 5.0.1 ships matched the current target, so the client reads it from its seed.

The tests stand the clock at 2026-11-19T17:48:00Z, while the recorded timestamp metadata is current.

## Why the files can be trusted

The recordings carry their own proof. A test that passes verifies each bundle in full with
`@sigstore/verify` against the trust root that TUF walks to from the root `@sigstore/tuf` ships,
through the recorded metadata, whose signatures that root checks. Metadata or a bundle changed by
hand fails those checks, as the tampered-signature and metadata tests show.

## Recording them again

Recording again changes the fixtures and the facts the tests state, such as the clock, the TUF file
versions, and the request list. Ask the API and the bundle URL as above, decode nothing, and replace
only the whole query of each `bundle_url` with `?sig=recorded`. For the TUF files, run `getTrustedRoot` from `@sigstore/tuf` with a fresh
`cachePath` and `forceInit: true`, note the requests it makes, and copy the metadata it saves under
the names it requested them by.
