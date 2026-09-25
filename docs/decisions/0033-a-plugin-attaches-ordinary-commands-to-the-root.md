---
type: adr
title: ADR-0033 - A plugin attaches ordinary Commands to the root
description: A plugin definition may list Commands, which attach to the root in installation order before the application's own Commands. A plugin Command is an ordinary Command attached from a different point, so every Command rule applies to it unchanged and no projection or invocation stage treats it differently.
status: accepted
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0033 - A plugin attaches ordinary Commands to the root

## Context

Some capabilities are Commands by nature: printing a shell completion script, or showing the resolved configuration. Today a plugin cannot add one. `onCommandAttach` publishes no `command()` call, because a hook that changed the graph's shape would change what an action was compiled against, and the plugin definition has no other way to reach the graph. The workaround is an option that takes over the run, such as `--completion bash`, which is the wrong shape for an operation with its own inputs and subcommands.

## Decision

- **The attachment point.** A plugin definition may declare `commands`, a list of the same Command values an application builds with `new Command(name)`. At graph build, core attaches each installed plugin's Commands to the root, in plugin installation order and in list order within a plugin, before the application's own Commands.
- **An ordinary Command.** Once attached, a plugin Command is a child of the root like any other. Every Command rule applies unchanged: naming, aliases, collisions, the one-parent rule, the arguments-beside-children rule, hidden and deprecated, routing, validation, and the input-source stage. Help, `inspect()`, the manifest, and every lifecycle hook read it as they read any Command, and nothing in the graph records which plugin attached it. Its action receives what every action receives and runs only when its Command runs.
- **No rename or removal.** The application cannot rename or remove a plugin Command. An application that does not want it does not install the plugin, or forks it.
- **Collisions are build errors.** A plugin Command whose name or alias repeats another root child's, from the application or from another plugin, fails the build under the existing sibling rules. Nothing shadows silently.

## Considered options

- **A `command()` call on the attached Command a hook receives.** Rejected. ADR-0028 withholds every call that changes the graph's shape from a hook, and a hook runs once per Command, so a plugin would attach from code that branches on which Command it received where a plain declaration states the same fact.
- **Attachment anywhere in the tree, or under a plugin namespace.** Rejected. The root is the one point every application has, and a namespace such as `plugins completion` names the mechanism rather than the capability.
- **Plugin-specific handling in the projections, such as a separate help section or a lazy action loader.** Rejected. A plugin Command that behaves differently from an application's is a second kind of Command that every projection must learn. An action is already lazy: it runs only when its Command runs.
- **Letting the application rename or remove a plugin Command.** Deferred. The application's remedy is not to install the plugin, and a rename would let one application's help, manifest, and completion disagree with the plugin's documentation.

## Consequences

`PluginDefinition` gains `commands`, and the plugin build rules gain the two shape rules its other lists carry. An application whose root declares arguments cannot install a plugin that brings Commands, because the root would then hold arguments beside children; the existing build error names the root and the plugin Command. The list's type requires no globals, so a plugin builds its Commands in its own compilation, where no Application's `Register` augmentation adds them. Plugin Commands precede the application's Commands in authoring order, so they lead the root help page's command rows and the manifest's children. ADR-0013 lists Commands among the contribution kinds by a dated entry: a plugin Command composes by the collision rule, never first-in-wins.

## Status

Accepted 2026-09-25 with the implementation. Core reads each plugin's `commands` list at plugin build, rejects a value that is not an array and an entry that is not a Command, and attaches the Commands to the root ahead of the application's own, where every existing Command rule reads them. The private `@loom/doctor` plugin attaches `doctor` to jsonkit's root, and the acceptance in [Plugin Commands](../core.md#plugin-commands) passes under Node and Bun.

## Changelog

- 2026-09-25: Accepted with the implementation.
