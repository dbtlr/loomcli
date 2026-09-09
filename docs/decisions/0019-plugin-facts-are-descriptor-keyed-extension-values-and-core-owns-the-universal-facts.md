---
type: adr
title: ADR-0019 - Plugin facts are descriptor-keyed extension values, and core owns the universal facts
description: A plugin attaches typed facts to a Command, option, or argument as branded values from a descriptor it defines, listed under extensions on the config object and keyed by the extension's identity. Core owns description and version as graph facts so every projection is minimally useful with no plugin installed.
status: proposed
created: 2026-09-08
modified: 2026-09-08
---

# ADR-0019 - Plugin facts are descriptor-keyed extension values, and core owns the universal facts

## Context

A help plugin needs prose on Commands and inputs, a manifest plugin needs the same prose and more, and neither may import the other. The facts have to live on the graph so that every projection reads one immutable structure, which ADR-0010 requires.

The obvious spelling is a named field on the config object, `help: { ... }`, typed by a module augmentation of a core catalog. That spelling cannot be renamed at installation, because the field name lives in a declaration file, and two plugins that augment one name collide in the type checker before either is installed. It also needs a reserved list of core keys that grows with core.

An extension instead is a descriptor that is also a factory. Calling it returns a branded value carrying the extension's identity, its target, and the input the author supplied, and a declaration lists those values under one `extensions` key. There is no field name to reserve or collide on, the call is typed from the descriptor's schema, a value on the wrong target fails to compile, and an unresolved descriptor fails to compile rather than dropping a fact. Build validates the input once, synchronously, and stores the output on the graph node under the identity, which `inspect()` exposes and a typed read returns. The output is plain data so the node can freeze it and every projection reads one neutral form. One identity means one descriptor: two distinct descriptors sharing an identity fail at build, which also surfaces a duplicated package copy.

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

Proposed. The record moves to accepted with the code that validates and stores extension values, exposes them through `inspect()`, and carries `description` and `version` as graph facts.
