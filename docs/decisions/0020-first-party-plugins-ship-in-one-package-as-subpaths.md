---
type: adr
title: ADR-0020 - First-party plugins ship in one package as separately installable subpaths
description: Every first-party plugin ships in @loomcli/plugins as its own subpath export with the identity <package>/<plugin>, installed one at a time through the ordinary plugins list. The package has no root export and installs nothing on import.
status: proposed
created: 2026-09-09
modified: 2026-09-09
---

# ADR-0020 - First-party plugins ship in one package as separately installable subpaths

## Context

ADR-0013 makes every first-party capability an ordinary plugin that an Application installs explicitly. The first two, help and version, raise the question of how first-party plugins are packaged and named on npm, which is the one part of a plugin that cannot change without breaking every consumer's imports.

One package, `@loomcli/plugins`, ships every first-party plugin as its own subpath export: `@loomcli/plugins/help`, `@loomcli/plugins/version`, and the plugins that follow. Each subpath is a complete plugin under the public contract, with its entry module at the subpath, its declarations module at `<subpath>/extension` when it defines facts, and a middleware module loaded lazily. A plugin's identity is `<package>/<plugin>`, the convention the plugin contract already gives a package that ships several, so the identity and the import path read the same. A subpath imports nothing from a sibling, and the package has no root export, so an application that installs one plugin bundles one and importing the package installs nothing. The package is released at the synchronized version every first-party library shares under ADR-0012.

Each plugin stays separately installable so that ADR-0013's replacement rule holds: an application that wants version and its own help page omits `help()` and installs another plugin. Two plugins that act through an option, like two help plugins, already collide on the option table at build, so no plugin in the package claims a slot for the purpose of being the only one of its kind.

## Considered options

- **One package per plugin.** Rejected. Each npm package needs its own trusted publisher, its own release entry, and its own manifest for what is often one option and one module. The cost recurs on every plugin the roadmap adds, and consumers gain nothing from the separation because the plugins are released at one version anyway.
- **One plugin that bundles help and version.** Rejected. An application could not take one without the other, which contradicts replacement by omission, and a plugin has one middleware, so the bundle would arbitrate between its two behaviors in code where installation order already does it.
- **A root export that installs the whole set.** Rejected. A convenience list is a default set by another name, it grows on every release, and it hides installation order and therefore precedence from the application source.

## Consequences

`@loomcli/plugins` needs one npm trusted publisher before the release that first carries it, and none after. A plugin added later is a subpath and a minor release, not a new package. Moving a plugin out of the package later is a breaking change to its import path, so a plugin enters the package only when it is meant to stay first-party.

## Status

Proposed. It moves to accepted with the code that publishes `@loomcli/plugins` carrying the help and version plugins, installed by both example applications.
