---
description: Index of the Loom CLI architecture decision records, with the rule for how each status binds planning, implementation, and review.
---

# Decision records

Each record captures one hard-to-reverse decision, the reasoning behind it, and the alternatives it rejected. Read the index while planning and reviewing, and open a record before touching the area it governs. The [glossary](../glossary.md) supplies the vocabulary the records use.

## How a status binds the work

| Status       | Binding                                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`   | Load-bearing. Code and plans rely on it, a violation fails acceptance, and its language is locked. Changing it means writing a new record that supersedes it.                                |
| `proposed`   | Records the agreed shape ahead of the code that will enforce it. A violation is a warning that re-opens the decision or the feature, not an error. Details may still move before acceptance. |
| `superseded` | Kept for history. It names the record that replaced it and no longer binds anything.                                                                                                         |
| `deprecated` | Kept for history. The feature it governed was retired, or the proposal was rejected. Its closing section records why.                                                                        |

## Records

| Record                                                                       | Decision                                                                                                  | Status   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| [ADR-0001](0001-immutable-declarations-with-typed-authoring-order.md)        | Commands are immutable values, and the authoring order is a compile-time rule.                            | accepted |
| [ADR-0002](0002-command-graph-is-a-tree-with-hidden-aliases.md)              | The command graph is a tree; hidden aliases replace multi-parent attachment.                              | accepted |
| [ADR-0003](0003-globals-are-application-owned-and-nothing-inherits.md)       | Global options are one application-owned value, and nothing inherits along a path.                        | accepted |
| [ADR-0004](0004-arguments-and-children-are-exclusive.md)                     | A Command declares arguments or attaches children, never both.                                            | accepted |
| [ADR-0005](0005-validation-delegates-to-standard-schema.md)                  | Validation delegates to Standard Schema, with context passed through the standard's channel.              | accepted |
| [ADR-0006](0006-absence-rules-and-no-lenient-input.md)                       | The declaration decides absence, and invalid input never falls back to a default.                         | accepted |
| [ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md)   | Failures are public classes with typed facts, rendered by class-keyed renderers on the Application.       | accepted |
| [ADR-0008](0008-rendered-output-is-a-neutral-call.md)                        | Rendered output is a separate neutral call with a pure synchronous renderer.                              | accepted |
| [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md)         | Core captures the host, accepts whole-field overrides, and resolves an exit code.                         | accepted |
| [ADR-0010](0010-one-graph-serves-runtime-and-projections.md)                 | One immutable graph serves runtime execution and every projection.                                        | accepted |
| [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md)                  | Bun-first developer workflow with a portable published core.                                              | accepted |
| [ADR-0012](0012-synchronized-versions-from-manifests-and-owned-fragments.md) | Synchronized library versions derive from manifests and owned fragments; only a release cut changes them. | accepted |
| [ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md)      | Core installs no plugins by default; contributions compose first-in-wins with single-owner slots.         | proposed |
| [ADR-0014](0014-acceptance-evidence-runs-against-the-packed-package.md)      | Acceptance evidence runs against the packed package through the public API.                               | accepted |
| [ADR-0015](0015-publication-retries-reuse-retained-artifacts.md)             | Publication retries reuse one retained artifact set and stop on artifact loss.                            | deprecated |
| [ADR-0016](0016-a-release-merge-publishes-through-one-idempotent-workflow.md) | A release merge publishes through one idempotent, token-free workflow that reconciles npm, tag, and GitHub Release with the manifest version. | accepted |
| [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) | Plugins act on an invocation through one middleware chain between routing and local parsing, with declared activation that defers loading. | proposed |
| [ADR-0018](0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) | One run signal carries cancellation, fed by a caller or by the single plugin that owns the signals slot; core brackets the run and resolves 130 or 143. | proposed |
| [ADR-0019](0019-plugin-facts-are-descriptor-keyed-extension-values-and-core-owns-the-universal-facts.md) | Plugin facts attach as descriptor-keyed extension values, and core owns description and version as graph facts. | proposed |

## Adding a record

Number the file after the highest existing record. Use the frontmatter fields the existing records carry: `type`, `title`, `description`, `status`, `created`, `modified`, and `superseded_by` when it applies. A record needs a context section; add considered options or consequences only when they carry information a reader would otherwise have to rediscover. A `proposed` record adds a status section stating what would move it to accepted. Record later status changes and addenda as dated entries in a closing changelog section rather than editing the decision text.
