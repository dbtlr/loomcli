# @loomcli/loom

The Loom CLI toolchain. It exports no module. Its `loom` bin acts on one package: the directory of the nearest `package.json` at or above the working directory. `loom build`, `loom check`, and `loom init` ship in a later release, as the [toolchain reference](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain.md) describes.

## Install

```sh
pnpm add -D @loomcli/loom
```

## Changelog

A package keeps its pending changes as fragments in `.changes/` and cuts its `package.json` version from them.

```sh
printf -- '- Add the `--tag` option to `notes list`.\n' > .changes/feature.list-by-tag.md
loom changelog check
git add .changes && git commit -m 'Add list-by-tag fragment'
loom changelog write --dry-run
loom changelog write --date 2026-10-07
```

- **Fragments.** `breaking.<slug>.md` is a breaking change and carries one `### Migration` section with the five labels, `feature.<slug>.md` is a feature, and `<slug>.md` is a fix. A body is Markdown bullets with no frontmatter or headings. `.changes/README.md` is the guide, not a fragment.
- **`loom changelog check`** validates every fragment and names each invalid one. It needs no git history, so CI runs it.
- **`loom changelog write`** computes the next version from the highest kind present, renders one section with `### Breaking Changes`, `### Features`, and `### Fixes`, prepends it to `CHANGELOG.md`, sets `version` in `package.json`, and deletes the consumed fragments. From `1.0.0`, breaking advances the major, feature the minor, and fix the patch; below it, breaking advances the minor and anything else the patch. It orders fragments by the commit that added them, so it needs full git history. `--date YYYY-MM-DD` dates the release, `--narrative FILE` copies prose above the entries, and `--dry-run` prints the section and the next version and writes nothing.

`write` refreshes no lockfile; run your package manager after the cut. See [The package changelog](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain.md#the-package-changelog) for the contract.

## Build

Core fills `host.release` from the release facts the build bakes into the `__LOOM_RELEASE__` identifier through a bundler `define`. Until `loom build` ships, bake them with your bundler:

```ts
// scripts/build.ts, run as `bun scripts/build.ts`; the bundle reads { build: 'distributed' }.
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

The define reaches core only when the bundle includes `@loomcli/core`. A bundle built without it reads `{ build: 'source' }`, as the source run does, so a defect prints its Developer Diagnostic. See [Release facts](https://github.com/dbtlr/loomcli/blob/main/docs/core.md#release-facts) for the contract.
