---
type: adr
title: ADR-0121 - The configuration source publishes its file's JSON Schema as a core graph fact
description: The configuration source slot takes an optional Standard Schema for the file it reads. Core derives its input-side JSON Schema at graph build through the Standard JSON Schema channel, as it derives an input's, and the graph carries it as configuration { schema }, null when no plugin claims the slot. The manifest prints it in its envelope. The configuration plugin passes its schema with a $schema string property added to the published JSON Schema, and removes a top-level $schema key from the file before validating, so a file may point at a hosted schema. Loom writes no schema file; hosting is the author's choice, and the author's own code writes the pointer into a file it creates.
status: proposed
created: 2026-10-29
modified: 2026-10-29
---

# ADR-0121 - The configuration source publishes its file's JSON Schema as a core graph fact

## Context

An editor validates and completes a configuration file as the operator types when it knows the file's JSON Schema, and an agent writes a correct file when it can read that JSON Schema first. Biome, Deno, and Turborepo publish a schema for their own configuration files, and Taplo, `yaml-language-server`, and VS Code's JSON support read one. `configuration({ schema })` under [ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) already holds that schema, but no projection can see it: a plugin's value is opaque, the graph names no plugin, and the plugin converts the schema only inside its link check.

The owner set the bar: the schema has to be available just by installing the plugin, through a lane core provides. A `loom` command that writes a schema file, a Command the plugin adds to the application, and a file written under the operator's configuration folder each ask someone to do work nobody does. "If the author wants to have a json schema published, they need to host it somewhere," and whatever writes a configuration file for the operator writes the pointer to it. For now that writer is the author's own code, such as an application's `init` Command.

Core already has the lane: [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md) derives each validated input's JSON Schema at graph build and publishes it on the node, and the manifest, MCP, and completion read it with no plugin wiring. The configuration source slot is core's too: [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) gives it to one plugin.

## Decision

- **The slot takes a schema.** A plugin's `source` gains an optional `schema`, a Standard Schema for the whole file the source reads. Core never validates with it; it is published alone.
- **Core derives the fact.** At graph build core calls the schema's Standard JSON Schema converter for the input side with `{ target: 'draft-2020-12' }`, exactly as it does for an input under ADR-0030, and stores the plain object it returns. The graph gains `configuration`: `null` when no installed plugin claims the source slot, and otherwise `{ schema }`, where `schema` is that object, or `null` when the source declares no schema or its schema publishes no converter.
- **A converter that fails publishes `null`.** A converter that throws or returns anything but a plain object publishes `null` in every build, with no fault, unlike an input's converter under ADR-0030. The author installed the source to read a configuration, and zod's converter throws for `z.bigint()`, `z.date()`, and `z.coerce.date()`, which a configuration schema plausibly holds: a TOML integer beyond 2^53 reads as a `bigint`. A fault would fail every development run of an application that did nothing wrong. The owner chose `null` over a library-specific fallback.
- **The manifest prints it.** The manifest envelope carries `configuration` after `globals`, copied from the graph, so an agent reads the configuration's JSON Schema with the invocation's. The envelope's token statement scopes its schema clause to an input's schema and adds that the configuration schema describes the configuration, not a token. A configuration schema that is not plain JSON data fails the write, as an input's does.
- **The plugin passes its schema.** `configuration({ schema })` passes a wrapper of the author's schema to the slot, whose converter adds a `$schema` string property to a copy of the top-level object's `properties`, following a top-level `$ref` into `$defs` and creating `properties` for a record, and keeps a `$schema` property the author declared, so an editor accepts the pointer. The plugin removes a top-level `$schema` key from the parsed file before it validates, in every format, so the pointer never reaches `provided.config`, never meets a strict schema, and is never a dropped value. The link check reads the graph's `configuration.schema` and no longer converts the schema itself.
- **Hosting and pointers are the author's.** Loom writes no schema file and hosts nothing. An author who publishes the schema hosts the manifest's `configuration.schema`, and the author's code that writes a configuration file writes the pointer: a top-level `"$schema": "<url>"` in JSON, a `#:schema <url>` first line in TOML for Taplo, and a `# yaml-language-server: $schema=<url>` first line in YAML.

## Considered options

- **A `loom` command that writes the schema to a file the author ships.** Rejected by the owner: it asks the author for a step nobody takes.
- **A Command the plugin adds to every application, such as `app config schema`.** Rejected: it asks the operator for a step nobody takes, and adds a Command to every application.
- **A schema file written under the operator's configuration folder at install or at run.** Rejected: "No user is going to do this. Ever." An editor still needs a pointer, which only a hosted URL makes portable.
- **The plugin hangs the schema on the root as an extension value, and the manifest reads it.** Rejected: the manifest would read one plugin's fact, a coupling between two plugins where core already provides the lane.
- **Option descriptions merged into the published JSON Schema for linked keys.** Not taken. Core holds no path grammar for the configuration, so it cannot match a link to a key, and the author's schema carries its own descriptions.

## Consequences

Every run of an application that installs the configuration plugin converts its schema once at graph build, as every validated input's schema is converted, and the link check stops converting on its own, so an application with links pays no more than before. A converter that fails publishes `null`, as the link check already read it, so the check skips the links as before. The graph and the manifest document grow one field, an addition to objects core and the manifest build, and the manifest's fixed token statement changes its words. [Graph inspection](../core/graph-inspection.md), [Plugins](../core/plugin-contract.md), [Input sources](../core/input-sources.md), [Lifecycle hooks](../core/lifecycle-hooks.md), [Manifest plugin](../plugins/manifest.md), and [Configuration plugin](../plugins/config.md) carry the contract. LM-377 carries the work.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-29: Proposed with the contract (LM-377). It extends ADR-0030's schema fact to the configuration source's file, adds `schema` to ADR-0032's source slot, adds a field to ADR-0010's graph that names no plugin, and narrows ADR-0118's link check, which reads the graph's fact in place of its own conversion. ADR-0010, ADR-0030, ADR-0032, and ADR-0118 carry dated entries.
- 2026-10-29: A converter that fails publishes `null` with no fault in every build, by owner ruling after the code review found that zod's converter throws for `z.bigint()` and dates; the development fault the contract first gave it is withdrawn.
