---
type: adr
title: ADR-0021 - Every rendered byte passes through one registry of replaceable views
description: Core keeps one identity-keyed registry of views, where a view is an identity, the data shape it presents, its cardinality, and its default renderer. Core, plugins, and applications register views, and one Application option replaces the renderer of any view by identity or by failure class, retiring the separate failures option.
status: proposed
created: 2026-09-11
modified: 2026-09-11
---

# ADR-0021 - Every rendered byte passes through one registry of replaceable views

## Context

Five kinds of text reach a terminal from a Loom application: a failure diagnostic, a semantic lane message, a help page, a version line, and a result. Each is presentation an application wants to brand, and today only one of them has an override path. ADR-0007 gives failures the `failures` option, which pairs a failure class with a renderer on the Application. ADR-0008 gives a value its presentation at the call site, inside the action. Nothing gives an application a way to restyle the help page a plugin prints, short of omitting the plugin and writing another one.

Core keeps one identity-keyed registry of views instead. A view is an identity, the data shape it presents, its cardinality, one document or one item, and its default renderer. Core registers the views for its own output: one per failure class, one per semantic lane, `print`, `info`, `success`, `warn`, and `error`, and the missing-result and double-result diagnostics. Plugins register theirs, the help page and the version line among the first. An application registers views for its Commands' results.

An application replaces the renderer of any view through one Application option, which replaces `failures`. An override names either a view identity or a failure class and pairs it with a renderer. Resolution for a failure is unchanged in substance: it walks the thrown failure's prototype chain, most derived first, through the application's overrides, then each installed plugin in installation order, then core's default text, so one registration for `UsageError` still brands every exit-2 diagnostic. ADR-0007's class-keyed renderer registration therefore becomes one kind of view override rather than its own surface, and ADR-0007 takes a dated entry recording that when this record is accepted.

## Considered options

- **Keep `failures` and add a parallel registry for everything else.** Rejected. The `failures` option is this decision in an earlier and narrower form, and keeping it would leave two override surfaces for one job, with a failure class the only renderable thing an application can reach by a documented name. Two surfaces also means two resolution orders to specify and two places for a plugin's contribution to land.
- **A view registry with identity keys alone, and failure classes outside it.** Rejected for the same reason. A failure class is an identity the type system already supplies, and resolving it means walking a prototype chain rather than comparing strings, which is a resolution rule inside one registry rather than a second registry.

## Consequences

`failures` is 0.2.0 public surface. It changes with a change fragment and no shim, as does the call-site renderer of `out.render`. An application restyles a plugin's help page or version line by identity, so branding no longer requires replacing the plugin that produces the page.

The lane views are the seam the glyph gutter attaches to, so semantic output gains a consistent left margin without every call site spelling it. A view's cardinality is what lets a later record check a view against a Command's declared result: a document view renders a whole value, an item view renders one item as it arrives.

The exact surface is deferred to the phase contract: the Application option's name, the spelling of an override, and the one resolution that serves identity keys and class keys together.

## Status

Proposed. It moves to accepted with the phase implementation that replaces `failures` with the registry and proves it through the example applications: jsonkit's two failure renderers become view overrides that produce byte-identical diagnostics, and an override of the help page's view identity changes `jsonkit --help` without replacing the help plugin. ADR-0007 takes a dated entry at that point recording that its class-keyed registration is a view override.
