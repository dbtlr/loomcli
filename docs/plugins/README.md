---
description: The router into @loomcli/plugins. The shape every first-party plugin shares, then one page per plugin, each listed with the moment to open it.
---

# First-party plugins

`@loomcli/plugins` is the plugin pack: the one first-party package that ships every first-party plugin as its own subpath export, `@loomcli/plugins/<plugin>`. Each one is an ordinary plugin under the [plugin contract](../core/plugin-contract.md): an entry module with the annotated factory at the subpath and the exported options type when it declares options, an extension module of declarations alone at `<subpath>/extension` when the plugin defines facts, a views module at `<subpath>/views` when it declares views, a middleware module the entry loads lazily when the plugin acts on an invocation, and a source module the entry loads lazily through `source.load` when the plugin declares a configuration source. A plugin's identity is `${packageName}/<plugin>`, the convention for a package that ships several, so the help plugin is `@loomcli/plugins/help` and its descriptors are `@loomcli/plugins/help/command` and `@loomcli/plugins/help/input`. A subpath imports nothing from a sibling subpath except the sibling's declarations module at `<subpath>/extension`, which it imports to supply values to a [collecting extension](../core/extensions.md#collecting-extensions) the sibling declares; it never imports a sibling's entry, middleware, or views module. The package has no root export, so an application that installs one plugin bundles one, plus the declarations of any collecting extension that plugin supplies, and importing the package installs nothing. The package lives at `packages/plugins` and is released at the one synchronized version every first-party library shares. The pack ships help, version, the formatter, the [manifest](manifest.md), the [configuration plugin](config.md), [dotenv](dotenv.md), [completion](completion.md), [man pages](manpage.md), [suggestions](suggestions.md), [MCP](mcp.md), the [logging plugin](logging.md), [self-update](self-update.md), the [service plugin](service.md), the [skills plugin](skills.md), the [interaction plugin](interaction.md), the [color plugin](color.md), the [background plugin](background.md), the bare `theme(mapping)` factory of [Theme plugins and typed names](../core/styles.md#theme-plugins-and-typed-names), and the `table`, `records`, `list`, `heading`, `rule`, `prose`, and `box` pack views of [Table](pack-views.md#table), [Records](pack-views.md#records), [List](pack-views.md#list), and [Views over a string](pack-views.md#views-over-a-string).

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import Package from '../package.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', {
  description: 'Read and reshape one JSON document.',
  plugins: [help(), version()],
  version: Package.version,
});
```

The help factory takes no parameters, so an application installs help as it is, and the version factory takes an optional `postfix` under [Version](version.md). A spelling a plugin reserves is a declaration error for an application option that uses it, under [Global options from plugins](../core/plugin-contract.md#global-options-from-plugins), and the application renames its own option. No first-party plugin claims the signals slot; the theme factory claims the theme slot, which is its whole contribution. Help needs no slot of its own, because being the only help plugin is not an invariant core has to hold: the same plugin installed twice fails on its identity, a second help plugin that shares a spelling fails on the option table, and a second one with its own spellings installs beside it and takes its turn in installation order. Replacing help means omitting `help()` and installing the other plugin; restyling its page means overriding `helpPage` under [Views](../core/views.md) while `help()` stays installed. Help's page reads the graph and its plugin's own option alone, so it is a projection in the sense [Graph inspection](../core/graph-inspection.md) gives the word: it adds nothing the graph does not hold. The version line is that projection of the graph's name and version, plus the postfix, which is its plugin's own setting and no graph fact. Help's hook restates help's own facts under the manifest's collecting extension, as [Help in the manifest](help.md#help-in-the-manifest) states, so it adds no fact the graph did not already hold. The formatter is not one: its hook adds an option and two views to the graph, and its middleware reads the request, as [Formatter](format.md) states.

## Plugins

- [Help](help.md): open it when an application installs help, or a plugin adds sections, variants, or accepted values to it.
- [The help page](help-page.md): open it when you need the help page's layout, its markdown details, or how it wraps.
- [Version](version.md): open it when an application prints its version with `--version`.
- [Formatter](format.md): open it when an operator chooses a result's format with `--format`.
- [Pack views](pack-views.md): open it when an action renders a table, records, a list, a heading, a rule, prose, or a box.
- [Loom theme](theme.md): open it when an application installs the named Loom theme.
- [Color](color.md): open it when an operator turns color on or off with `--color`.
- [Verbose](verbose.md): open it when an operator raises or lowers the run's verbosity with `-v` and `-q`.
- [Background](background.md): open it when an operator states the terminal's background.
- [Interaction](interaction.md): open it when an operator turns off questions for a run.
- [Suggestions](suggestions.md): open it when an unknown Command or option should suggest the closest name.
- [Dotenv](dotenv.md): open it when a run reads variables from a `.env` file.
- [Configuration](config.md): open it when a run reads option values from a configuration file.
- [Logging](logging.md): open it when an application writes its log events to a JSONL file or to stderr.
- [Manifest](manifest.md): open it when an agent or a tool reads an application's machine-readable description.
- [MCP](mcp.md): open it when an application serves its Commands as MCP tools.
- [Completion](completion.md): open it when an application offers shell completion, or installs it.
- [Man pages](manpage.md): open it when an application writes or installs man pages.
- [Skills](skills.md): open it when an application installs its agent skills.
- [Self-update](self-update.md): open it when an installed application updates itself or notices a new release.
- [Service](service.md): open it when an application runs as a user service.
