---
type: adr
title: ADR-0019 - Plugin facts are descriptor-keyed extension values, and core owns the universal facts
description: A plugin attaches typed facts to a Command, option, or argument as branded values from a descriptor it defines, listed under extensions on the config object and keyed by the extension's identity. Core owns description and version as graph facts so every projection is minimally useful with no plugin installed.
status: accepted
created: 2026-09-08
modified: 2026-09-09
---

# ADR-0019 - Plugin facts are descriptor-keyed extension values, and core owns the universal facts

## Context

A help plugin needs prose on Commands and inputs, a manifest plugin needs the same prose and more, and neither may import the other. The facts have to live on the graph so that every projection reads one immutable structure, which ADR-0010 requires.

The obvious spelling is a named field on the config object, `help: { ... }`, typed by a module augmentation of a core catalog. That spelling cannot be renamed at installation, because the field name lives in a declaration file, and two plugins that augment one name collide in the type checker before either is installed. It also needs a reserved list of core keys that grows with core.

An extension instead is a descriptor that is also a factory. Calling it returns a branded value carrying the extension's identity, its target, the input the author supplied, and a private reference to the descriptor itself, and a declaration lists those values under one `extensions` key whose element type is fixed to the declaration's target. There is no field name to reserve or collide on, the call is typed from the descriptor's schema, a value on the wrong target fails to compile, and an unresolved descriptor fails to compile rather than dropping a fact. Build validates the input once, synchronously, and stores a frozen copy of the output on the graph node under the identity, which `inspect()` exposes and a typed read returns. The output is plain data, JSON-shaped, so the node can freeze it and every projection reads one neutral form. One identity means one descriptor: descriptors are compared by reference, two distinct descriptors sharing an identity fail at build, and a typed read through a descriptor other than the one that produced the value throws, which together surface a duplicated package copy wherever it appears.

A fact whose plugin is not installed is inert data on the graph, not an error, so a Command library ships facts into an application that installs no help plugin or a different one.

Core owns the facts every projection needs and no plugin should have to be installed to supply: a one-line `description` on the Application, Commands, options, and arguments, and `version` on the Application. Further facts of the same kind follow the same rule when they are specified. A help page, a manifest, or a completion script is therefore minimally useful with no extension present, and an extension enriches it. The taught convention reads `version` from the package manifest so the graph and the published version stay in sync.

## Considered options

- **Named fields typed by module augmentation.** Rejected. No rename at installation, type-level collisions between packages, and a reserved key list.
- **Symbol-keyed side data by convention.** Rejected. The comparable frameworks do this. A unique symbol cannot collide, but the data is untyped, unfrozen, invisible to inspection, and unreadable by a projection that did not create the symbol.
- **Plugin-named fluent methods or a generic extend call.** Rejected. Two ways to say one thing, and the fluent chain is the typed authoring order that ADR-0001 governs.
- **A build error for a fact with no installed provider.** Rejected. The fact is inert data every projection may read; a Command library must not depend on which plugins its host installs.
- **Core reserving no prose at all.** Rejected. A one-line description is data every projection reads, not a capability, and making the most common line in a CLI an extension call is the wrong trade.
- **Contribution queues for help-to-manifest data.** Rejected for now. Once prose is a graph fact, a projection reads it from the graph through the other plugin's descriptor module, which is declarations alone and never imports that plugin's middleware. Queues return only if a plugin needs request-time data from another plugin.

## Consequences

A Command takes an options object like the Application, and the positional globals form retires with a build diagnostic. Plugin identity is fixed where the plugin is defined, because the descriptors a consumer imports carry it statically, so a fork chooses its own identity rather than renaming at installation.

## Status

Accepted 2026-09-09 with the code that validates and stores extension values, exposed them through `inspect()`, and carried `description` and `version` as graph facts.

## Changelog

- 2026-09-09: Accepted. PR 35 (`8585389`, on `main`) carries `description` and `version` as core graph facts, reported by `inspect()`, so a projection is minimally useful with no plugin installed. PR 36 (branch `feat/lm-60-plugins`) adds the `extension(identity, config)` descriptor factory, the branded extension values a declaration lists under `extensions`, and `readExtension` for a typed read keyed by the descriptor's own identity. The third pull request of LM-60, whose number is not yet assigned, exercises the pair through the shared example plugin that both example applications install: it defines one descriptor, and each application attaches a value of it to a Command that the plugin's middleware reads back.
- 2026-09-09: Two addenda from shaping the first-party help and version plugins, recorded in `docs/core.md` and binding with this record. First, `version` is never absent on the graph: an Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string`, an explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A version projection therefore never branches on absence. A declared version follows the one-line, non-whitespace rule every core fact string follows, so the line a version projection prints is one line, and core otherwise neither validates nor normalizes the string. Second, `hidden` and `deprecated` join `description` as core facts on a Command and on an option, under the rule above that a fact every projection reads is core rather than an extension. `hidden` is a Boolean that keeps the member off every listing while it still routes, parses, and runs. `deprecated` is a required one-line migration message under the description rule, and a bare `true` is rejected because a deprecation with no migration path leaves an operator or an agent with nothing to do. Neither applies to an argument or to the root, and routing and parsing read neither. The help plugin is the first projection to honor both.
