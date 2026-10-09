---
type: adr
title: ADR-0050 - A packet built into the application says whether it is in development
description: Whether an application is in development is a build fact, never a run-time switch. A Packet file, loom.packet.json, reads development in the source tree, the build writes distributed into the artifact through the packet() Bun.build plugin from @loomcli/loom/build, and the entry hands it to the Application as data. An Application given no packet is distributed. Defects and declaration faults core reports read the build; operator failures print the same text in both builds.
status: superseded
superseded_by: ADR-0065
created: 2026-09-29
modified: 2026-10-09
---

# ADR-0050 - A packet built into the application says whether it is in development

## Context

Two records wait on one question: how a run tells an application in development from a distributed one. [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) shows the operator one generic message for a defect and leaves the author's detail to a later record. [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md) holds its converter-failure diagnostic, which belongs to development and must stay out of a distributed application, until the same question is answered.

A command-line application is installed, not deployed. Its operator runs whatever arrived through npm, a Homebrew formula, or a copied binary, and sets nothing on its behalf. `NODE_ENV` does not fit: operators do not set it, so an application that read it would treat every distributed install as development. The same holds for any variable Loom could name: the default is whatever the operator's shell happens to hold.

Loom applications are built with Bun. `bun build` bundles the entry and every module it imports, a JSON module included, into one artifact, and `bun build --compile` bakes the bundle into a single binary. The author's development loop runs the source directly, `bun src/main.ts`, with no build step.

Core is host-independent under [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md). `Host` holds no file access, so core cannot open a file of its own accord.

## Decision

- **A build fact.** Whether an application is in development is a fact the build decides, never a run-time switch. Core reads no environment variable, no `run()` option, and no property of the process for it.
- **The Packet.** A packet is a JSON file, `loom.packet.json`, at the package root beside `package.json`. It holds one field, `build`, which is `development` or `distributed`. Its type is `Packet`, exported by core.
- **Handed to the Application.** The entry imports the packet as a JSON module and passes it as `packet` in the Application options. Core receives the fact as data and never reads the disk. The Application reads it at construction, so the build is known from that moment, and a packet whose shape is wrong is a `DeclarationError` from the constructor.
- **No packet is distributed.** An Application given no packet behaves as a distributed one. An application that never opted in cannot show an operator the author's detail.
- **Development in source, distributed in the artifact.** The packet in the source tree reads `development`, so running the source shows the author's detail with no extra step. The build writes `distributed` into the artifact.
- **The writer.** `packet()`, exported by `@loomcli/loom/build`, is a `Bun.build` plugin that answers the packet's import with `distributed` while it bundles. The source file is never rewritten. A compiled binary is built through the same plugin. `@loomcli/loom` is the public Loom toolchain, installed as a development dependency, so the writer never ships inside an application. Core keeps the `Packet` type and its reader.
- **What the build changes.** A defect or a declaration fault that core reports from `run()` renders the Developer Diagnostic of [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md) in a development build, and `<application>: Something went wrong.` in a distributed one. An operator failure, a usage error, a `FatalError`, or an author's own class, prints the same text in both builds, so what an author tests in development is what the operator sees.
- **Checks that exist only in development.** A development build may report an author mistake that a distributed build tolerates. The first is ADR-0030's converter failure: a converter that throws or returns a non-object is a declaration fault in a development build and reads `null` in a distributed one.

The contract, the type block, and the acceptance are in [Development builds](../core.md#development-builds).

## Considered options

- **A Loom-owned environment variable, or `NODE_ENV`.** Rejected. A command-line application is not a web service with a deploy environment. Its operators set neither, so the variable would decide nothing, and a development default would show every operator the author's detail.
- **A `run()` option.** Rejected. Every author would wire a trigger of their own, and each application would get a different switch.
- **A constant substituted by a bundler define.** Rejected. Running the source has no value for the constant, and the fact would no longer be a file that a later channel can extend.
- **Detecting the source run from the entry's path or extension.** Rejected. It is a guess, and it differs across Node, Bun, bundles, and compiled binaries.
- **No packet means development.** Rejected. It fails unsafe: every application built before this record, and every author who forgets the writer, would show operators the author's detail.
- **A required packet.** Rejected. It forces a change on every existing application to restate the safe default.
- **A script that rewrites the packet around `bun build`.** Rejected. It mutates the source tree, and a failed build can leave `distributed` behind in the source, which silently turns off the author's detail.
- **The writer in core.** Rejected. It would ship build tooling inside the runtime dependency of every installed application.

## Consequences

The example applications move from `tsc` to `Bun.build` with `packet()`, each with its own `loom.packet.json`, so the examples teach the build Loom applications use. Their acceptance runs the bundle under Node and Bun and runs the source under Bun for the development case. The published packages keep `tsc`, because they ship type declarations.

`@loomcli/loom` joins the published packages with `@loomcli/loom/build` as its first documented surface. Its release commands, written for this repository, stay hidden from its help until they serve any application.

An application bundled with plain `bun build` and no `packet()` ships the source packet, `development`, because the author wired a packet and skipped its writer. A later `loom build` command closes that gap by writing the packet itself, a later `loom init` creates the development packet for a new application, and a later `loom check` can report declaration faults before anything runs. A packet may later carry more build facts, such as the channel an application was installed through, when a capability needs one.

## Status

Accepted. It moved to accepted with the implementation that reads the packet, renders by build under ADR-0051, ships `packet()` in `@loomcli/loom/build`, and builds the example applications with it, and with the acceptance in [Development builds](../core.md#development-builds).

## Changelog

- 2026-09-29: Proposed with the development build contract.
- 2026-09-29: The implementation reads the packet, renders defects and declaration faults by build under ADR-0051, ships `packet()` in `@loomcli/loom/build`, and builds both example applications with it. Three facts the implementation settles. `packet()` is typed by its own `PacketPlugin`, a Bun plugin by shape that `Bun.build` accepts, and `@loomcli/loom` takes no `@types/bun` dependency, because `@types/bun` 1.4 requires newer Node declarations than the Node 22 ones core ships, so a consumer that checks library declarations would meet the conflict. `packet()` also inlines the data files core's Unicode tables read beside their own modules at run time, because no bundle and no compiled binary can start without them. The examples bundle through a `build:examples` script, with the application module as a second entry the tests import and with splitting, so each plugin's middleware stays a chunk that loads only when the chain reaches it. The record stays proposed until the development-only converter check and the packed `@loomcli/loom` consumer land.
- 2026-09-29: Two corrections from review. The `bun build` command line takes no plugin, so a bundle and a compiled binary are built through `Bun.build`, the binary with its `compile` option and `packet()`. An application bundled without `packet()` does not ship the source packet's `development`, as Consequences states: it cannot start, because core's Unicode tables read their data files beside their own modules and only `packet()` carries them into the bundle. `packet()` fails the build, naming the module, when it cannot find that read in a table module.
- 2026-09-29: The development-only converter check lands under `@loomcli/core/schema-converter-failed`, as [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md) records. The record stays proposed until the packed `@loomcli/loom` consumer lands.
- 2026-09-30: The packed `@loomcli/loom` consumer lands. `@loomcli/loom` moves to `packages/loom` and joins the published release set at the synchronized version, with `@loomcli/loom/build` as its only export and its `changelog`, `pr`, and `release` commands hidden. `pnpm check:packed` installs its tarball beside the libraries, compiles against its declarations with `skipLibCheck` off, bundles a fixture with `packet()` under Bun, and reads `distributed` from the bundle under Node and Bun while the source reads `development`. Accepted. The maintainer published the `0.0.0` placeholder of `@loomcli/loom` and bound its trusted publisher. Release runs on `main` fail their plan until the 0.6.0 cut, because 0.5.0 of `@loomcli/loom` is absent from the registry, and the cut's run publishes it.
- 2026-10-03: Core carries its Unicode tables as a generated JavaScript module and reads no file at run time, so any bundler can bundle a Loom application; a distributed build still needs `packet()`. `packet()` answers the packet alone and no longer inlines data files. The 2026-09-29 entries no longer hold on that point: an application bundled without `packet()` starts and ships the source packet's `development`, as Consequences states. `pnpm check:packed` bundles the packed fixture without `packet()` through `Bun.build` and through Rolldown and reads `development` under Node and Bun. The decision is unchanged.
- 2026-10-06: Two contracts read the build. [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), proposed, gives every failure a failure form whose `message` follows the build: a distributed defect or declaration fault reads `Something went wrong.` and a development one its sentence, while its code reads `internal` in both; a development build still writes a defect's Developer Diagnostic ahead of a failure encoder's line. And a development build gains a check a distributed build skips: every `run()` and `app.invoke()` fails a graph that holds a Command, the root included, an option, or an argument without a description, with one Developer Diagnostic under `@loomcli/core/undescribed` that lists each gap as a finding by path, hidden and plugin-declared members included, under [Undescribed declarations](../core.md#undescribed-declarations). A non-fatal warning was rejected for it: it would open a new channel, print on every completion request, and land in `invoke`'s messages.
- 2026-10-07: [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), proposed, supersedes this record when it is accepted. The build fact moves from the packet to the release facts on `host.release`, which the build bakes through one define, `__LOOM_RELEASE__`, and which read `source`, `development`, or `distributed`. Every rule above for a development build holds for `source` and `development`, and every rule for a distributed build holds for `distributed`. The Application's `packet` option, the `Packet` type, `loom.packet.json`, and `packet()` from `@loomcli/loom/build` are removed. The rule that no packet is distributed is reversed: an artifact with no baked facts reads `source`, because an application ships through `loom build` and anything else counts as unbuilt. This record binds as written until then, and its status moves to superseded in the release PR that accepts ADR-0065.
- 2026-10-09: Superseded by [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md), which 0.10.0 ships and accepts. The supersession lands in the PR before the release cut rather than in the release PR, because the release guard admits only a proposed record's acceptance in a release PR. The release that removes the packet carries both status changes.
