---
description: Pull request rules and examples for fix, feature, and breaking library change fragments, skip decisions, and corrections to unreleased entries.
---

# Change fragments

This directory holds the pending entries for the root [changelog](../CHANGELOG.md). Run `pnpm loom changelog check` to validate the pending fragments. The [compiler reference](../docs/maintaining/changelog-compiler.md) describes the synchronized release cut and its dry run. The [PR guard reference](../docs/maintaining/pr-guards.md) describes automated fragment admission and version checks.

## Choose a fragment or a skip label

For a change observable by a published library's consumer, add one fragment per PR. Examples include public exports, inferred types, accepted inputs, output, errors, and supported runtime requirements.

For a change without a consumer-visible effect, apply the PR label `skip-changelog` and explain why in the PR description. Examples include internal refactors that preserve behavior, tests, repository chores, and documentation without behavior changes.

A documentation-only diff can describe changed behavior. Judge the consumer effect rather than the file extension. A `skip-changelog` label does not excuse an invalid fragment already present in the branch.

## Name the fragment

- Use `<slug>.md` for a fix, `feature.<slug>.md` for a compatible addition, and `breaking.<slug>.md` for a breaking change.
- Choose a unique, nonempty slug. Only the `feature.` and `breaking.` prefixes carry meaning. A bare `feature.md` or `breaking.md` is invalid.
- Keep fragments directly in `.changes/`. Names are case-sensitive. Subdirectories and other file formats are invalid. A hidden entry, one whose name starts with `.`, is ignored.
- Keep this `README.md` as the directory guide. It is not a fragment and does not satisfy the fragment requirement.

## Describe the consumer result

Write one or more Markdown bullets. Start each entry with a verb such as `Add`, `Fix`, `Change`, `Remove`, `Allow`, `Support`, or `Stabilize`.

State what a consumer can do or what behavior changed. Use indented sub-bullets or fenced examples when adoption needs an explanation. Keep implementation history out of the entry.

For example, a feature fragment named `feature.hidden-command-aliases.md` could contain:

```markdown
- Add aliases for named commands. Aliases route to the command while inspection and failures report its canonical name.
```

Fragments have no frontmatter, package attribution, or kind headings. This is an exception to the repository's ordinary Markdown frontmatter convention.

Write links relative to the repository root, where the compiled entry will live. For example, use `[core reference](docs/core/README.md)` inside a fragment. The guide you are reading uses normal file-relative links.

## Explain a breaking change

A change is breaking when code an application author already wrote must change or now fails, when the application's requirements rise, or when a new rule rejects a value that an earlier release accepted. Mark it with the filename prefix even when the change fixes a bug.

Judge a change to an export by its tag on the changed name's line in the API report diff, and by the position of the changed member, as the [public exports](../docs/core/public-exports.md) page states. Every published library's exports carry the tags, so every changed export has a tag to read. An interface or a type alias takes the type rows below; a class takes the class rows, and its constructor takes the function row.

- `@public @sealed` on a type marks a sealed type: a Loom library builds every value, `@loomcli/testing`'s builders included, and the author reads it, such as `Out`, the host, every context, `Command`, `Plugin`, or `OptionNode`.
- `@public` on a type without `@sealed` marks an author-built type: the author builds the value and hands it to a library, such as `CommandOptions`, `PluginDefinition`, a view, a validator, a translator, `ProcessHandle`, or a testing builder's input.
- `@sealed` on a class means the author must not subclass it. A class without it, such as `LoomError` or `FatalError`, is one the author may extend.
- A member the author reads, such as a field of a sealed type or a parameter core passes to an author's callback, is in read position. A member the author builds, such as a field of an author-built type or a callback's return value, is in build position. Position flips at each function parameter, so a parameter of a function the author calls is in build position. A member in both positions, such as a context member a testing builder's input copies, follows both rows, so any change but a new optional member breaks.
- A type narrows when its new type is a subtype of the old one, and widens when it is a supertype, judged over the whole member type, a function type included.

| Changed export | Breaking | Not breaking |
| --- | --- | --- |
| Any export | It is removed or renamed. | It is added. |
| A function, a constant, a method, or a class constructor | A call that worked before no longer satisfies its parameters, or code that uses its result no longer compiles or runs. | A new optional parameter. |
| A member in read position | It is removed, it widens other than by a string-literal union gaining a member, a member of its string-literal union is removed, or an object union gains a variant. | Its type narrows other than by losing a string-literal member, or its string-literal union gains a member. |
| A sealed type | A member is removed, or a member changes as the read-position row states. | A new member, such as a required readonly field like `schema` on `OptionNode` or an opt-in authoring method. |
| A member in build position | It is removed, it becomes required, or its type narrows. | Its type widens. |
| An author-built type | A new required member, or a member that changes as the build-position row states. | A new optional member. |
| A class with `@sealed` | A member changes as the sealed-type row states. | A new member. |
| A class without `@sealed` | A new or changed instance or static member, because it can collide with a subclass's own. | A new subclass of it. |
| A type parameter | It is removed or reordered, one without a default is added, or its constraint narrows. | One with a default is added, or its constraint widens. |
| A type or class that loses `@sealed` | | Always not breaking: the author may now build or subclass it. |
| A type or class that gains `@sealed` | Always breaking: code that builds or subclasses it is no longer supported. | |

A string-literal union core produces, such as `CancellationReason`'s `source`, may gain a member in any release, so author code that reads one handles a value it does not know. A union of object variants, such as `ChildExit`, may not, because a new variant changes how the existing ones match. A computed type, such as `OptionsOf` or `ActionHandler`, takes the category of the type it computes, and a change to its result for an input that already worked is a change to that type. A re-exported external type, such as `StandardSchemaV1`, follows its package's version range: raising that range past a major version is breaking.

Three rules hold whatever the tag:

- A raised minimum runtime version is breaking.
- A declaration rule that rejects a default an earlier release accepted is breaking, even though the application compiles unchanged.
- A change to a template's text is never breaking. When the help page's bytes or a description's wording change, no application has to change its code, so the fragment is a fix or a feature.

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

All publishable first-party libraries share one exact version. The compiler increments from that current `package.json` version, and rejects mismatched library versions. During `0.x`, a breaking fragment advances the minor and resets the patch. Feature and fix fragments advance the patch. These automatic bumps also set the minimum for an explicit `loom release cut --target VERSION`. A larger target does not change fragment kinds or migration requirements. The release section lists entries under `### Breaking Changes`, `### Features`, and `### Fixes`. The first release defaults to `0.1.0`; manifests remain at `0.0.0` until that cut.

Keep library manifest versions unchanged in ordinary PRs. Leave fragments pending for the release cut instead of editing release history or adding an Unreleased section. Only release preparation uses `pnpm loom release cut`.

## Finish the PR

Before requesting review:

1. Read the final diff and choose a fragment or `skip-changelog` using the consumer-effect rule above.
2. Check every new or modified fragment for the filename, body, links, and migration requirements.
3. Correct any earlier fragment invalidated by the final diff.
4. State the fragment path or skip reason in the PR description, alongside the change's outcome and relevant validation.

For library upgrades, use the root changelog as the migration index. Read every Breaking Changes section between the installed and target versions. Pin first-party libraries at the same exact version.
