---
type: adr
title: ADR-0025 - Completed Commands accept immutable extension configuration
description: Command and Application extend calls remain available after action registration and replace complete values by descriptor while preserving the action and input contract.
status: accepted
created: 2026-09-13
modified: 2026-09-24
---

# ADR-0025 - Completed Commands accept immutable extension configuration

## Context

An Application may import a completed Command from a library and supply its own help details, examples, or another command-targeted plugin fact. Constructor-only extensions prevent this because the library already registered its action. Closing input declarations protects the action's contract; it need not close extension configuration.

## Decision

`Command.extend(...values)` and `Application.extend(...values)` accept command-targeted `ExtensionValue` values and return new immutable declarations. They remain available in every authoring state, including after `action()`, outside the state-dependent method union. They preserve arguments, local options, global types, action, children, aliases, core facts, Application plugin/environment types, and remaining input/action methods. The original value remains unchanged. Initial `extensions` configuration remains available during construction; both paths use the same graph validation and storage mechanism.

One call is one extension layer. Within a layer, two values with the same identity remain a declaration error. Across layers, a value for the same descriptor replaces the complete earlier value. Fields from the earlier value are not retained; the replacement schema's output is authoritative. There is no object merge or array concatenation. Other descriptors retain their values. An empty call returns an equivalent new declaration. Layers and their entries validate in authoring order, using the existing descriptor-registration-before-value-validation order. Every layer is validated, so a replacement does not hide an invalid earlier declaration. Two distinct descriptor objects sharing an identity still fail, even when one would replace the other.

Input and action declarations keep their existing order rules. Registering an action closes argument, option, alias, child, and further action declarations. `extend()` does not reopen them. Graph build applies those rules to JavaScript callers as before.

An extracted handler that uses `ActionHandler<typeof declaration>` keeps the initializer ending in `action()` as its type anchor. Enrichment can derive from that completed exported declaration. Appending `extend()` inside the self-referencing initializer introduces TypeScript circular inference; an inline handler has no such self-reference.

This decision supersedes ADR-0001's blanket closure of all declaration calls and ADR-0019's rejection of a generic extension call. All other provisions of those records, including their addenda, are incorporated by reference. In particular: declarations are immutable and private; relocation preserves action types; authoring state restricts calls; arguments and children are exclusive; extension values are descriptor-keyed, schema-typed facts with target brands; one identity means one descriptor; build synchronously validates and freezes plain-data output; inspection and typed reads use that output; uninstalled facts remain inert; and core owns the universal graph facts with their established absence rules. Constructor configuration and post-import enrichment are two stages of the same extension mechanism, not separate storage paths.

The final frozen record is registered with its descriptor ownership map so `readExtension()` reads the same values that inspection publishes. Replacement does not delete and reinsert keys; records use ordinary JavaScript object key ordering. Empty enrichment is a useful immutable clone of a declaration; any shared descendants still obey the one-parent rule.

## Scope

Core facts and input-targeted extension configuration retain their existing construction rules. Inputs are closed after the action, so this API cannot enrich an imported option or argument. Hook and event lifecycles remain deferred. Their future APIs may remain available after action registration, but this decision adds no executable callbacks to extension data. Extension values remain plain data under the existing descriptor contract.

## Status

Accepted 2026-09-13 with immutable extension configuration in the public SDK. `pnpm verify` passes 937 tests and the workspace/packed declaration checks. The same 937 tests pass with `LOOM_TEST_RUNTIME=bun`. `pnpm check:packed` compiles an independent library and a registered Application, then verifies automatic globals and customized library help under Node and Bun. Type checks reject unknown globals, incompatible attachments, union collisions, invalid registration, wrong extension targets, and reopened input/action methods.

- 2026-09-14: The results-lane contract in [Results](../core.md#results) adds `views()` beside `extend()` as a second call published outside the state-dependent method union, on a declaration that carries a result, in every state including after `action()`. It reshapes presentation alone and reopens no input or action declaration, the same split this record made for extension configuration. The type closes with the action; the views stay open.
- 2026-09-15: [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md), proposed, exempts a call a plugin's `onCommandAttach` hook issues from the closure above: the order rules exist to keep the action's types true to the author's declaration, and nothing a hook adds reaches the types. `extend()` still reopens nothing. It binds when that record is accepted.
- 2026-09-18: [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md), proposed, applies the universal-facts rule this record carries from ADR-0019 to an input's shape: the JSON Schema a validated input's schema publishes is read by the manifest, the help page, and a completion script alike, so build derives it and the node carries it as a core fact rather than as any plugin's extension value. It binds when that record is accepted.
- 2026-09-24: Proposed [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md) supersedes the replacement clause for a collecting extension, one declared with `collect: true`: across layers and lifecycle hooks, its values accumulate in order instead of replacing the complete earlier value. One layer still holds one value per extension, and the replacement rule stands for every ordinary extension. It also reverses the rejection of contribution queues this record carries forward by reference from ADR-0019's considered options. It binds when ADR-0031 is accepted.
- 2026-09-24: [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md) is accepted, so a collecting extension's values accumulate across layers and hooks. The replacement clause binds every ordinary extension as before.
- 2026-09-24: [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), proposed, applies the universal-facts rule this record carries from ADR-0019 to `env`: the variable an option binds changes parsing for every run and is read by help and the manifest alike, so it is a core declaration key on the option config and a core fact on the node rather than any plugin's extension value. A configuration binding stays an extension value of the plugin that declares the source. It binds when that record is accepted.
