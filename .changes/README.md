---
description: Pull request rules and examples for ordinary and breaking library change fragments, skip decisions, and corrections to unreleased entries.
---

# Change fragments

This directory holds the pending entries for the root [changelog](../CHANGELOG.md). Run `pnpm loom changelog check` to validate the pending fragments. The [compiler reference](../docs/changelog-compiler.md) describes preview and release-file preparation. The [PR guard reference](../docs/pr-guards.md) describes automated fragment admission and version checks.

## Choose a fragment or a skip label

For a change observable by a published library's consumer, add one fragment per PR. Examples include public exports, inferred types, accepted inputs, output, errors, and supported runtime requirements.

For a change without a consumer-visible effect, apply the PR label `skip-changelog` and explain why in the PR description. Examples include internal refactors that preserve behavior, tests, repository chores, and documentation without behavior changes.

A documentation-only diff can describe changed behavior. Judge the consumer effect rather than the file extension. A `skip-changelog` label does not excuse an invalid fragment already present in the branch.

## Name the fragment

- Use `<slug>.md` for an ordinary change and `breaking.<slug>.md` for a breaking change.
- Choose a unique, nonempty slug. Only the `breaking.` prefix carries meaning. A bare `breaking.md` is invalid.
- Keep fragments directly in `.changes/`. Names are case-sensitive. Subdirectories and other file formats are invalid.
- Keep this `README.md` as the directory guide. It is not a fragment and does not satisfy the fragment requirement.

## Describe the consumer result

Write one or more Markdown bullets. Start each entry with a verb such as `Add`, `Fix`, `Change`, `Remove`, `Allow`, `Support`, or `Stabilize`.

State what a consumer can do or what behavior changed. Use indented sub-bullets or fenced examples when adoption needs an explanation. Keep implementation history out of the entry.

For example, an ordinary fragment named `hidden-command-aliases.md` could contain:

```markdown
- Add aliases for named commands. Aliases route to the command while inspection and failures report its canonical name.
```

Fragments have no frontmatter, package attribution, or kind headings. This is an exception to the repository's ordinary Markdown frontmatter convention.

Write links relative to the repository root, where the compiled entry will live. For example, use `[core reference](docs/core.md)` inside a fragment. The guide you are reading uses normal file-relative links.

## Explain a breaking change

A change is breaking when it makes the public TypeScript contract, documented runtime behavior, or supported consumer requirements incompatible. Mark it with the filename prefix even when the change fixes a bug.

After the change bullets, add one `### Migration` section with all five labels shown below. Give exact affected surfaces, a reason, before-and-after examples, ordered steps, and validation commands.

This example describes a hypothetical increase in the library's minimum Node.js version:

````markdown
- Require Node.js 24 or later.

### Migration

**Affected surface.** Applications running the library on Node.js 22 or 23.

**Why.** The library now uses a runtime API available from Node.js 24.

**Before and after.**

Before, in the application's `package.json`:

```json
{ "engines": { "node": ">=22" } }
```

After:

```json
{ "engines": { "node": ">=24" } }
```

**Steps.**

1. Upgrade development, CI, and deployment runtimes to Node.js 24 or later.
2. Update the application's `engines.node` requirement to `>=24`.

**Validation.** Run `node --version` in each environment to check its runtime. Run the application's test command under the new runtime before deployment.
````

The heading and five labels define the required structure. Review must also establish that the instructions cover the break and that the validation demonstrates a successful migration.

## Correct an unreleased entry

When a later PR changes or removes a result described by an earlier fragment, amend or delete that fragment in the same PR. Add the new PR's fragment when its final consumer effect requires one. The pending set describes the behavior that remains after all changes land.

## Keep release versions separate from feature PRs

All publishable first-party libraries share one exact version. The compiler increments from that current `package.json` version, and rejects mismatched library versions. During `0.x`, a breaking fragment advances the minor and resets the patch. Compatible additions and fixes advance the patch. The first release is `0.1.0`; manifests remain at `0.0.0` until that cut.

Keep library manifest versions unchanged in ordinary PRs. Leave fragments pending for the release cut instead of editing release history or adding an Unreleased section. Only release preparation uses `pnpm loom changelog write`.

## Finish the PR

Before requesting review:

1. Read the final diff and choose a fragment or `skip-changelog` using the consumer-effect rule above.
2. Check every new or modified fragment for the filename, body, links, and migration requirements.
3. Correct any earlier fragment invalidated by the final diff.
4. State the fragment path or skip reason in the PR description, alongside the change's outcome and relevant validation.

For library upgrades, use the root changelog as the migration index. Read every Breaking Changes section between the installed and target versions. Pin first-party libraries at the same exact version.
