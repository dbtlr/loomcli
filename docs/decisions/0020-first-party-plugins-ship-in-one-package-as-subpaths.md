---
type: adr
title: ADR-0020 - First-party plugins ship in one package as separately installable subpaths
description: Every first-party plugin ships in @loomcli/plugins as its own subpath export with the identity <package>/<plugin>, installed one at a time through the ordinary plugins list. The package has no root export and installs nothing on import.
status: proposed
created: 2026-09-09
modified: 2026-09-10
---

# ADR-0020 - First-party plugins ship in one package as separately installable subpaths

## Context

ADR-0013 makes every first-party capability an ordinary plugin that an Application installs explicitly. The first two, help and version, raise the question of how first-party plugins are packaged and named on npm, which is the one part of a plugin that cannot change without breaking every consumer's imports.

One package, `@loomcli/plugins`, the plugin pack, ships every first-party plugin as its own subpath export: `@loomcli/plugins/help`, `@loomcli/plugins/version`, and the plugins that follow. Each subpath is a complete plugin under the public contract, with its entry module at the subpath, its declarations module at `<subpath>/extension` when it defines facts, and a middleware module loaded lazily. A plugin's identity is `<package>/<plugin>`, the convention the plugin contract already gives a package that ships several, so the identity and the import path read the same. A subpath imports nothing from a sibling, and the package has no root export, so an application that installs one plugin bundles one and importing the package installs nothing. The package is released at the synchronized version every first-party library shares under ADR-0012.

Each plugin stays separately installable so that ADR-0013's replacement rule holds: an application that wants version and its own help page omits `help()` and installs another plugin. No plugin in the package claims a slot for the purpose of being the only one of its kind, because that is not an invariant core has to hold: the same plugin installed twice fails on its identity, a second plugin that shares a spelling fails on the option table, and a second one with its own spellings installs beside it and takes its turn in installation order.

This record refines the identity convention ADR-0013 carries in its dated entry of 2026-09-08, "a first-party plugin identity is the package name by convention": that convention holds for a package that ships one plugin, and a first-party plugin, which ships in the pack, has the identity `<package>/<plugin>`. ADR-0013 carries a dated entry that binds with this record.

## Considered options

- **One package per plugin.** Rejected. Each npm package needs its own trusted publisher, its own release entry, and its own manifest for what is often one option and one module. The cost recurs on every plugin the roadmap adds, and consumers gain nothing from the separation because the plugins are released at one version anyway.
- **One plugin that bundles help and version.** Rejected. An application could not take one without the other, which contradicts replacement by omission, and a plugin has one middleware, so the bundle would arbitrate between its two behaviors in code where installation order already does it.
- **A root export that installs the whole set.** Rejected. A convenience list is a default set by another name, it grows on every release, and it hides installation order and therefore precedence from the application source.

## Consequences

`@loomcli/plugins` needs one npm trusted publisher before the release that first carries it, and none after. The package lives at `packages/plugins`, so it joins the synchronized release set the way every library under `packages/` does. A plugin added later is a subpath and an ordinary release under ADR-0012, not a new package. Moving a plugin out of the package later is a breaking change to its import path, so a plugin enters the package only when it is meant to stay first-party.

## Status

Proposed. It moves to accepted with the code that publishes `@loomcli/plugins` carrying the help and version plugins, installed by both example applications, and with the packed-consumer check ADR-0014 requires extended to the new package: a consumer installs the packed tarball, imports `@loomcli/plugins/help`, `@loomcli/plugins/help/extension`, and `@loomcli/plugins/version`, compiles against their emitted declarations, and runs under Node and Bun.

## Changelog

- 2026-09-10: The package landed at `packages/plugins` with `private: true`. The release plan discovers every non-private manifest under `packages/` and treats a library absent from the registry as a publication to make, so a public manifest would have made every push to `main` refuse publication until the next cut. The flag comes off in the release cut that first carries the package, once its npm trusted publisher exists, and that is when this record moves to accepted.
- 2026-09-10: The flag comes off ahead of the cut, in an ordinary pull request at the current synchronized version, instead of inside the cut commit. The release guard accepts only version changes in a cut and rejects a library that joins the participating set there, while the ordinary guard admits a library that joins at the current version. From that merge until the 0.2.0 cut merges, every push to `main` refuses publication, because the plan sees the pack absent from the registry at 0.1.1 and a participating tree changed since the 0.1.1 cut; nothing publishes. The record still moves to accepted with the release that publishes the package.
