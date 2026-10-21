---
description: The map of Loom's documentation. Who each part is for and where to start.
---

# Loom documentation

Loom is a toolkit for TypeScript command-line applications: the author ships the application, and Loom ships the typed lanes it is built from. These pages are organized by what you are doing, and each directory opens with a router that lists its pages and when to open each one.

## Start here

- [Principles](principles.md) state what Loom is for and how deep a solution goes. They rank above every other page.
- [Glossary](glossary.md) defines the domain terms every page uses.
- [Decision records](decisions/README.md) record why the contract is what it is. An accepted record constrains later work.

## Building an application

- [Core reference](core/README.md) is the contract of `@loomcli/core`: declaring an application, running it, output, failures, the plugin contract, and the facts a shipped application reads. One page per concept.
- [First-party plugins](plugins/README.md) document each plugin in `@loomcli/plugins`, such as help, completion, configuration, and MCP, plus the pack views.
- [Libraries](libs/) document the packages an application uses beside core:
  - [Validators](libs/validators.md): the `@loomcli/validators` catalog of Standard Schema validators.
  - [Prompts](libs/prompts.md): asking the operator questions and showing progress with `@loomcli/prompts`.
  - [Testing](libs/testing.md): the assembly check from `@loomcli/testing`.
  - [ESLint plugin](libs/eslint-plugin.md): the lint rules that guide an author in the editor and in CI.
- [Diagnostics reference](core/diagnostics.md) lists every Developer Diagnostic rule by identity, with why it exists.

## Shipping an application

- [Toolchain reference](toolchain/README.md) documents the `loom` bin from `@loomcli/loom`: building, the package changelog, scaffolding with `loom init`, and the installer script.

## Maintaining Loom

These pages are for maintainers of this repository, not for application authors.

- [Release workflow](maintaining/release-workflow.md): how a merged release PR publishes the packages.
- [PR guards](maintaining/pr-guards.md): the checks a release PR passes before it merges.
- [Changelog compiler](maintaining/changelog-compiler.md): the synchronized release cut and its dry run.
- [Marked-string wire contract](maintaining/style-wire.md): the internal wire form of marked strings.
- [Glyph reference](maintaining/glyphs.md): the generated glyph catalog.
