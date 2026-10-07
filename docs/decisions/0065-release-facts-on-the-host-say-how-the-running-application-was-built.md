---
type: adr
title: ADR-0065 - Release facts on the host say how the running application was built
description: Core fills host.release for every run from one define, __LOOM_RELEASE__, that the build bakes into the artifact. The facts hold the build, source, development, or distributed, an optional release group with a lane core derives from the version, and an installation group whose source a later contract specifies. No baked facts reads as source. Authors import and pass nothing, and the packet, its option, its type, its file, and its writer are removed. This supersedes ADR-0050.
status: proposed
created: 2026-10-07
modified: 2026-10-07
---

# ADR-0065 - Release facts on the host say how the running application was built

## Context

[ADR-0050](0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md) made the build a fact the build decides: the entry imports `loom.packet.json`, which reads `development` in source, `packet()` answers that import with `distributed` while `Bun.build` bundles, and the entry passes the packet to the Application as an option. An Application given no packet is distributed.

That design asks every author to keep a file, import it, and wire it into the Application, and it ties the distributed build to one `Bun.build` plugin, which the `bun build` command line cannot load. It also carries one fact. An application that checks for updates, prints its version and lane, or names the release asset it came from needs more: the version it was built from, the repository it was released from, and later how it was installed.

A bundler `define` replaces an identifier with a value while it bundles. Verification against the toolchains Loom applications use established three facts. A define reaches code inside `node_modules`, so it reaches core's own modules. `Bun.build({ define })` and the `bun build` command line's `--define`, `--watch` included, both take one. esbuild, Rollup, and Vite each offer one. ADR-0050 rejected a define because running the source has no value for it; a `typeof` guard reads that absence as a fact of its own.

## Decision

- **The facts.** `Host` gains `release: ReleaseFacts`: `build`, which is `source`, `development`, or `distributed`; an optional `release` group of `version`, `lane`, `repository` as `owner/name`, and an optional `asset`; and an optional `installation` group of `method`, `path`, and `digest`.
- **`build`.** `source` when the source runs directly with nothing baked in. `development` for a development artifact, such as `loom build --watch` or `loom build --build development` writes. `distributed` for a distributed artifact. Core shows the Developer Diagnostic for `source` and `development` and the generic `<application>: Something went wrong.` for `distributed`: every rule ADR-0050 states for a development build holds for `source` and `development`, and every rule for a distributed build holds for `distributed`. The checks only development runs, the converter check and the undescribed check, run for `source` and `development`.
- **`release`.** Present only when the artifact was built with `--release`. Core derives `lane` from `version`: the first prerelease identifier, so `1.1.0-next.3` reads `next` and `1.0.0-beta.1` reads `beta`, and otherwise `stable`. A lane is a string, not a closed set. `asset` is present for a compiled binary alone.
- **`installation`.** Its shape is fixed here. Where the installation record lives and how core reads it belong to a later installation-record contract, so until that contract ships the group is always absent.
- **One define.** Build tooling bakes one identifier, `__LOOM_RELEASE__`, through a bundler `define`. Its value is JSON, `{ "build", "release"?: { "version", "repository", "asset"? } }`, with no lane. Core reads it behind a `typeof` guard, so a source run reads it as absent.
- **No baked facts is source.** An artifact built without the define reads `build: 'source'` and shows the author's detail. An application ships through `loom build`, and anything else counts as unbuilt.
- **Captured with the host.** Core fills `host.release` during host capture for `run()` and `app.invoke`, once per run, and freezes it. An action's `invoke` reads its run's facts. `run({ host: { release } })` and `app.invoke`'s `host` override replace the whole field, as every host override does, which is how a test supplies facts. `inspect()` takes no host and reads the baked facts to learn its build.
- **A malformed value.** Core validates the baked value. A malformed one is a defect under `@loomcli/core/invalid-release-facts`, reported before the graph builds. The build step that baked it is the author's, so core reports it to the author as its Developer Diagnostic in every build. Core ignores members it does not know, so a later toolchain can bake more facts.
- **Nothing to wire.** Authors never import a facts file and never pass anything. The Application's `packet` option, the `Packet` type, `loom.packet.json`, and `packet()` from `@loomcli/loom/build` are removed, and the word leaves the public vocabulary. The author-facing term is release facts. A JavaScript author who still passes `packet` meets the retired-option rule.

The contract, the type block, and the acceptance are in [Release facts](../core.md#release-facts), and the build that bakes the facts is in [loom build](../toolchain.md#loom-build).

## Considered options

- **An author-imported facts file, as the packet was.** Rejected. Every author imports a file that may not exist in a given checkout and wires it into the Application, and the build must answer the import through a plugin that only `Bun.build` loads.
- **Passing the facts through a plugin setting.** Rejected. The author still wires a value by hand, and the build fact would belong to whichever plugin carried it rather than to core, which renders by it.
- **No facts means distributed.** ADR-0050 chose it so an application that never opted in could not show an operator the author's detail. Rejected now. With the facts baked by the build itself, the build tool is the opt-in: an application ships through `loom build`, which bakes `distributed` by default, and a bundle built some other way without the facts is unbuilt. Reading it as source shows the author the detail they need while they assemble a custom build, and `loom build --define` gives that build the same facts.
- **Detecting the build from the entry's path or extension.** Rejected, as ADR-0050 rejected it. It is a guess, and it differs across Node, Bun, bundles, and compiled binaries.
- **A context member beside `host`.** Rejected. The facts describe the process an action runs in, as the host's other fields do, and one surface serves both an action and a test: `run({ host })` already overrides any host field.
- **A `target` member, `npm` or `binary`.** Rejected. How an application reached the machine is the installation group's question, and a build target does not answer it: one bundle may be installed from npm or copied by hand.

## Consequences

The example applications drop `loom.packet.json` and build with `loom build --target node`, and `pnpm check:packed` builds its fixture through the packed `loom` bin. `@loomcli/loom` exports no `./build` subpath. The implementation PR carries the breaking fragment for the removed option, type, file, and writer.

[ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md)'s host capture gains a field that core reads from the build rather than the process, and [ADR-0059](0059-a-command-runs-by-name-through-invoke.md)'s host override set for `app.invoke` gains `release`. [ADR-0051](0051-a-developer-diagnostic-teaches-the-author-what-broke-and-how-to-fix-it.md)'s development build reads against the facts, and one defect renders its Developer Diagnostic in both builds. [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md) and [ADR-0014](0014-acceptance-evidence-runs-against-the-packed-package.md) carry dated entries for the examples and the packed consumer.

## Status

Proposed 2026-10-07 with the contract in [Release facts](../core.md#release-facts). It moves to accepted inside the release PR of the release that ships the implementation: core fills `host.release` from the define, a run without the define reads `source`, the malformed-value defect, the packet removed, and the acceptance in that section, under Node and Bun. ADR-0050 moves to superseded in the same PR.

## Changelog

- 2026-10-07: Proposed with the release facts contract.
