# @loomcli/plugins

The Loom plugin pack. Each first-party plugin and pack view is its own subpath export, `@loomcli/plugins/<name>`, so an application bundles only the plugins it imports. The package has no root export, and core installs no plugin by itself: an application lists the plugins it wants in its declaration.

## Install

```sh
pnpm add @loomcli/core @loomcli/plugins
```

## Use

```ts
import { Application } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

export const jsonkit = new Application('jsonkit', {
  plugins: [help(), version(), completion()],
  version: '1.0.0',
});
```

With `completion()` installed, `jsonkit completion install` sets up tab completion in the operator's shell, and `jsonkit completion zsh` prints the script for an operator who loads it another way.

## Plugins

Each entry links to its reference page.

### Help and version

- `@loomcli/plugins/help`: `--help` and the help page. [Help](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/help.md)
- `@loomcli/plugins/version`: `--version`. [Version](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/version.md)

### Output

- `@loomcli/plugins/format`: `--format`, so an operator picks a result's format, such as JSON. [Formatter](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/format.md)
- `@loomcli/plugins/theme`: the Loom theme, and `theme(mapping)` for an application's own palette. [Loom theme](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/theme.md)
- `@loomcli/plugins/color`: `--color`, so an operator turns color on or off. [Color](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/color.md)
- `@loomcli/plugins/verbose`: `-v` and `-q`, which raise and lower the run's verbosity. [Verbose](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/verbose.md)
- `@loomcli/plugins/background`: an option that states the terminal's background. [Background](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/background.md)

### Inputs

- `@loomcli/plugins/interaction`: an option that turns off questions for a run. [Interaction](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/interaction.md)
- `@loomcli/plugins/dotenv`: variables read from `.env` files. [Dotenv](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/dotenv.md)
- `@loomcli/plugins/config`: configuration and option values read from configuration files. [Configuration](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/config.md)
- `@loomcli/plugins/suggestions`: the closest name for an unknown Command or option. [Suggestions](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/suggestions.md)

### Projections

- `@loomcli/plugins/manifest`: a machine-readable description of the application, for agents and tools. [Manifest](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/manifest.md)
- `@loomcli/plugins/mcp`: the application's Commands served as MCP tools. [MCP](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/mcp.md)
- `@loomcli/plugins/completion`: shell completion for Bash, Zsh, Fish, and PowerShell, and `completion install` to set it up. [Completion](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/completion.md)
- `@loomcli/plugins/manpage`: man pages, written or installed. [Man pages](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/manpage.md)
- `@loomcli/plugins/skills`: the application's agent skills, installed. [Skills](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md)

### Lifecycle

- `@loomcli/plugins/logging`: log events written to a JSONL file or to stderr. [Logging](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/logging.md)
- `@loomcli/plugins/self-update`: an installed application that updates itself and notices new releases. [Self-update](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/self-update.md)
- `@loomcli/plugins/service`: the application run as a user service. [Service](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/service.md)

### Pack views

An action renders these views through its output. [Pack views](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/pack-views.md)

- `@loomcli/plugins/table`: rows under a header, fitted to the terminal width.
- `@loomcli/plugins/records`: one record at a time, as its source yields it, each set apart by the field that identifies it.
- `@loomcli/plugins/list`: a bulleted or numbered list.
- `@loomcli/plugins/heading`, `@loomcli/plugins/rule`, `@loomcli/plugins/prose`, and `@loomcli/plugins/box`: views over a string.

## Documentation

The [plugins reference](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/README.md) documents every plugin, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
