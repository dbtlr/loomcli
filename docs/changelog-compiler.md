---
description: Commands, version rules, inputs, and failure behavior for local changelog compilation and release-file preparation.
---

# Changelog compiler

The changelog compiler prepares release files. It is separate from `pnpm build`, which compiles the library and examples.

An agent release skill coordinates preparation and reviews the result. GitHub Actions can build and publish the approved release. Those release orchestration and publication tools are separate work.

## Commands

Run commands from the repository root after installing dependencies. The compiler runs directly with Node 22.23.2 or Bun 1.4.0.

```sh
pnpm changelog check
pnpm changelog preview --date 2026-09-07
pnpm changelog write --date 2026-09-07
```

`check` validates every file in `.changes/`, except the regular file `README.md`. It accepts an empty set and does not require Git history. The [fragment guide](../.changes/README.md) defines the Markdown grammar. Leading verbs, consumer relevance, and migration accuracy remain review judgments. Fragments and narratives cannot leave Markdown blocks open across generated release headings.

`preview` validates the fragments and prints one proposed release section. It does not change files. Fragments must have a recorded addition in the current branch's first-parent history. Existing fragments can contain local edits during preview.

`write` prints the same section and updates `CHANGELOG.md`, participating library versions, and `pnpm-lock.yaml`. It deletes the consumed fragments. It requires a clean checkout and refuses an existing tag for the proposed version. Only release preparation uses this command.

Both preparation modes accept these options:

| Option              | Meaning                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--date YYYY-MM-DD` | Release date. The default is the current UTC date. Invalid calendar dates fail.                                                                          |
| `--initial`         | Explicitly prepare `0.1.0` from `0.0.0`, including when no fragments exist. Other current versions reject this option.                                   |
| `--since REF`       | Ancestor commit or tag used for the material-change report. The default is `v<current-manifest-version>`. The first release marks all libraries changed. |
| `--narrative FILE`  | Copy Markdown prose before the entries. The file cannot be empty or contain level-one or level-two headings.                                             |

Without `--initial`, an empty fragment set fails preparation. Success exits with status 0. Invalid input or an operational failure exits with status 1 and writes a diagnostic to stderr.

## Version calculation

Every non-private library directly under `packages/` participates. The root package and private packages, including examples, do not participate.

Participating `package.json` versions must be identical stable `0.x` versions. Package names come from those manifests.

| Current version | Fragment set                   | Next version |
| --------------- | ------------------------------ | ------------ |
| `0.0.0`         | Any permitted initial release  | `0.1.0`      |
| `0.4.7`         | At least one breaking fragment | `0.5.0`      |
| `0.4.7`         | Compatible fragments only      | `0.4.8`      |

Git tags never determine the next version. The `--since` option changes only the material-change report. The release agent owns external checks for completed or incomplete publications. This command has no version override for replacement cuts.

## Rendering and material changes

The compiler copies fragment prose verbatim, adding blank lines between entries. Breaking entries precede ordinary entries. Each group uses the commit date that added the fragment to first-parent history, then its filename as a tie-break. Later corrections preserve the original landing position.

The optional narrative appears first. Each breaking fragment retains its migration section once. Empty groups are omitted. A new section precedes existing release sections, preserving prior history and frontmatter. The changelog has no Unreleased section.

A library changes materially when its directory changes or one of its library dependencies changes. Dependencies include regular, optional, development, and peer dependencies. Propagation is transitive, including workspace aliases and relative workspace references.

Shared build inputs conservatively mark all libraries changed. Root Markdown, `docs/`, and fragment metadata do not affect the current library build. Other paths outside participating library directories count as shared inputs. These exclusions must narrow if packaging starts consuming those files.

The material report includes local changes and untracked files during preview. Full Git history and the comparison reference must be available locally. Shallow repositories fail preparation. The compiler does not query GitHub or npm for release state.

## Write failures and retries

Run `write` in an isolated release checkout. The writer copies tracked regular files into a temporary directory and updates the lockfile there. It runs pnpm with scripts and pnpmfile hooks disabled, offline resolution, and a lockfile destination inside that directory. Missing cached dependencies fail preparation.

Invalid inputs and lockfile preparation failures leave release files untouched. Before applying changes, the writer checks that the checkout and release inputs still match. After a filesystem failure, it attempts to restore every affected file. Persistent filesystem failures produce an explicit rollback-incomplete diagnostic naming the files that need recovery. An exclusive lock in the checkout's Git directory prevents concurrent writers.

A process kill or machine crash can interrupt the final multi-file update. Use a fresh isolated checkout after such an interruption. Do not treat a partial working tree as a completed cut. No commit, tag, push, or publication occurs in this command.

A second `write` against the prepared working tree refuses the dirty checkout or empty fragment set. It does not increment the version again. The release skill reviews and commits the prepared files together.
