---
type: adr
title: ADR-0005 - A plugin is a value any crate exports, and the first-party pack is one crate with a feature each
description: A plugin is a value built through loomcli-core's public plugin builder and returned by a factory function. Any crate that depends on loomcli-core can export one. The first-party plugins ship in loomcli-plugins, one module and one Cargo feature per plugin.
status: accepted
created: 2026-11-12
modified: 2026-11-12
---

# ADR-0005 - A plugin is a value any crate exports, and the first-party pack is one crate with a feature each

## Context

The reference's extensibility rests on three rules: core installs no plugin, a first-party plugin uses the same public contract as any other, and an application installs plugins through one ordered list where the order is the precedence. The port keeps all three.

A plugin is a value. A crate that depends on `loomcli-core` exports a factory function that returns one, such as `help()` or `version().postfix("...")`, and an application lists it:

```rust
Application::new("jsonkit")
    .description("Read and reshape one JSON document.")
    .version(env!("CARGO_PKG_VERSION"))
    .plugins((help().command(true), suggestions(), version(), format().short('o'), mcp()))
```

The list is a tuple because the settings builders (`Help`, `Format`) and plain plugins are different types, each converting into `AnyPlugin`; a tuple holds up to 32, and a longer list is a `Vec` of converted values.

A plugin contributes through the reference's capabilities and no others: global options, root commands, one middleware with declared activation, the `on_command_attach`, `on_graph_built`, `on_failure`, `on_log`, and `on_environment` hooks, extension descriptors, views and view overrides, translators, failure encoders, the configuration-source slot, and the theme slot. A plugin's identity is a package name, as in the reference, followed by `/<plugin>` when one package ships several: `@loom/explain` for the explain example crate, `@loomcli/plugins/help` for the pack's help plugin.

The reference loads a plugin's middleware module lazily, on first activation. Rust links everything ahead of time, so there is nothing to load. The activation declaration stays, because it decides whether the middleware joins the chain.

The first-party pack is one crate, `loomcli-plugins`, with one module and one Cargo feature per plugin and no default features. This is the reference's one package with a subpath per plugin: an application compiles the plugins it names, and depending on the crate installs nothing. A plugin's extension descriptors live in its `extension` module behind their own feature, so a plugin that supplies values to a sibling's collecting extension compiles the sibling's descriptors without the sibling.

## Considered options

- **One crate per first-party plugin.** Rejected. Twenty crates to version and publish in step, where features give the same compile-time selection.
- **A plugin trait that types implement.** Rejected. A plugin is a set of optional contributions, most plugins use a few, and a builder states only those. A trait with fifteen defaulted methods hides which ones a plugin uses and cannot check a definition at the point it is built.
- **Dynamic loading of plugin libraries at run time.** Rejected. It needs a stable ABI, and the reference's plugins are compiled into the application as well.

## Consequences

Two plugins from different crates compose without knowing each other, through installation order and collecting extensions. The examples keep the reference's two private plugin crates, `explain` and `doctor`, as the proof that a crate outside the pack uses the same contract.

## Status

Accepted on 2026-11-12. The code that enforces this record has landed: `Plugin::new` is the one plugin builder, `loomcli-plugins` ships every first-party plugin as a module and a feature with no default features, and the `explain` and `doctor` example crates build plugins outside the pack against the same contract.
