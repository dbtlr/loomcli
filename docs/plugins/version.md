---
description: "The version plugin: the --version option, the version line it prints, the extended output an application opts in to with the release facts, runtime, and platform below the line and as one JSON object, and the views an application overrides to restyle them."
---

# Version plugin

This page documents the version plugin, which declares the `--version` option, the line it prints, the extended output an author opts in to, and the views an author overrides to restyle them. An author installs it so an operator can ask which version is running, and opts in to the extended output so an operator or an agent can also learn how that copy was built, released, and installed.

```ts sketch
// @loomcli/plugins/version
export interface VersionSettings {
  readonly postfix?: string;
  readonly extended?: boolean;
}

export declare function version(settings?: VersionSettings): Plugin<VersionOptions>;

// @loomcli/plugins/version/views
import type { CommandGraph, DeclaredView, ReleaseFacts } from '@loomcli/core';

export interface VersionLine {
  readonly graph: CommandGraph;
  readonly postfix: string | undefined;
}

export declare const versionLine: DeclaredView<VersionLine>;

export interface VersionFacts {
  readonly channel: string | undefined;
  readonly build: ReleaseFacts['build'];
  readonly asset: string | undefined;
  readonly installationMethod: string | undefined;
  readonly runtime: string | undefined;
  readonly platform: string;
}

export declare const versionFacts: DeclaredView<VersionFacts>;
```

For an Application that declares `version: '0.2.0'`, `version()` prints the first line and `version({ postfix: '(Report schema v1)' })` the second:

```text
jsonkit v0.2.0
jsonkit v0.2.0 (Report schema v1)
```

- **Style.** The application name uses `style.highlight.bold`, and the version, including its `v`, uses `style.primary`. One unstyled space separates them. A postfix follows the version after one more unstyled space and uses `style.dim`. Each graph string and the postfix are escaped before styling. The line ends with exactly one newline and adds no logo, branding glyph, or label.
- **Postfix.** `postfix` is text the application prints after the version, such as the schema a binary speaks. It is one line of prose under the rule `isProseLine` states, judged at the `version()` call: a value that is not a string, is blank, or holds a line terminator throws a `DeclarationError` from `version()` under [`@loomcli/plugins/version/postfix`](../core/diagnostics.md#loomclipluginsversionpostfix). The finding rebuilds the `version()` call and marks `postfix`. The postfix is a setting of the plugin, not a graph fact, so `graph.version`, the manifest, and every other projection are unchanged by it.
- **Policy.** Core resolves these semantic styles under the existing [rendering policy](../core/styles.md). Installing `loomTheme()` supplies copper for highlight. The version plugin requires no theme, chooses no color, and reads no host capability.

`version()` declares one Boolean option, `version`, with the short spelling `V`, the description `Print the version.`, and `control: true`, because it asks for the version and feeds no Command's work under [Control options](../core/commands.md#control-options), so an invocation spells it `-V` or `--version`, and a middleware activated by it. The middleware renders one line to stdout through the plugin's declared view, `versionLine`, a `DeclaredView<VersionLine>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views`. Its data is the graph and the postfix the `version()` call took, `undefined` when it took none. Its default function returns the text `<name> v<version>\n` from `graph.name` and `graph.version`, or `<name> v<version> <postfix>\n` with a postfix, with the styling above, and the middleware calls `out.render({ graph, postfix }, versionLine)` and returns without calling `next()`, so the exit code is 0, nothing later in the chain runs, the action never dispatches, and a fault core held from parsing or validation is never raised. An application overrides `versionLine` to restyle the line while `version()` stays installed; the replacement reads `graph` and `postfix`, and it can call `versionLine.render(line, context)` to build on the default line. An application whose manifest reads `0.2.0` prints `jsonkit v0.2.0`. When the declared version already starts with a lowercase `v`, the line carries that `v` once, so a declared `v0.2.0` prints `jsonkit v0.2.0` too; an uppercase `V` or any other first character is printed after the added `v` as declared. The rule is rendering alone, and `graph.version` holds the declared string. Without `extended: true`, the middleware reads no host fact, no extension, no selected view or media type, and no option beyond its own, and the routed Command does not change the line: `jsonkit get --version` prints the same line, because the version is a fact of the Application.

`version` is never absent on the graph. An Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string` and no projection branches on its absence. An explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A declared version follows the one-line rule every core fact string follows, so the line the plugin prints is one line; core otherwise neither validates nor normalizes it.

## Extended output

An application opts in to the extended output with `version({ extended: true })`. Then `-V` and `--version` both print the version line and, below it, the run's [release facts](../core/release-facts.md), runtime, and platform. They stay one option with one meaning: the operator gets no second spelling and no switch between the two outputs, and the author's setting decides which one the application prints. `extended` is `false` when omitted, and only `true` turns the extended output on. Without it, the plugin prints the version line alone, byte for byte as the sections above state, and reads no media type.

```ts
// src/application.ts
import { Application, Command } from '@loomcli/core';
import { format, json } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import Package from '../package.json' with { type: 'json' };
const add = new Command('add')
  .command(new Command('add').stdin({ required: true }).action(async ({ stdin, out }) => out.print(await stdin.text())))
  .command(new Command('list').action(({ out }) => out.print('Write the reference.')));
const list = new Command('list')
  .rows<string>({ views: { json: json() } })
  .action(({ out }) => out.results(['Write the reference.']));

// The root registers no action, so it is a group; `list` declares a result.
export const notes = new Application('notes', {
  plugins: [help(), format(), version({ extended: true })],
  version: Package.version,
})
  .command(add)
  .command(list);

// package.json
{ "name": "notes", "version": "1.1.0-next.3", "type": "module" }
```

A compiled binary built with `loom build --target bun-linux-x64 --release` at version `1.1.0-next.3`, installed by the installer script and run on Bun 1.3.2, prints this with color and modifiers disabled:

```text
$ notes --version
notes v1.1.0-next.3
channel              next
build                distributed
asset                notes-linux-x64
installation method  script
runtime              bun 1.3.2
platform             linux-x64
```

The source run of the same application, `bun src/main.ts --version`, has no release group and no installation, so three facts are absent:

```text
notes v1.1.0-next.3
channel
build                source
asset
installation method
runtime              bun 1.3.2
platform             linux-x64
```

- **The version line first.** The first line is the version line: the middleware renders it through `versionLine` exactly as without `extended`, the postfix and an application's override of `versionLine` included, so the extended output's first line is the line the plain output prints, and a script that reads the first line of `--version` reads the same text either way.
- **The facts block.** Below the line, with no blank line between them, the middleware renders the facts through the plugin's second declared view, `versionFacts`, a `DeclaredView<VersionFacts>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views` after `versionLine`. The plugin lists it whether or not `extended` is set, so an override of it installs in both modes, and renders through it only with `extended`. Its default function returns six rows, always in this order and always all six: `channel`, `build`, `asset`, `installation method`, `runtime`, and `platform`. The block is the [records layout](pack-views.md#records) for one record whose labels are those six names: each label is styled `dim` and padded with core's `pad` to the widest of the six, `installation method`, then a two-space gap, then the value, escaped through `style.escape` and styled `primary`. Each line ends with one newline, and the block ends with the last row's newline, with no blank line or summary after it. On a terminal a value wraps and expands its tabs under the records layout's rules. The examples show the bytes on a terminal; off a terminal each value is one unit, as the records layout writes it.
- **An absent fact.** A fact the run does not hold prints an empty value, and the records layout decides how that line ends. On a terminal the line ends at the label, with no padding and no gap after it, as the examples show. Off a terminal, such as a pipe or an agent's subprocess, the label keeps its padding and the two-space gap, as [Pack views](pack-views.md#records) states for any empty value, so the line ends in spaces; a script that needs a value it can test reads the JSON form, which reads `null`. The plugin prints no placeholder such as `none` or `unknown`, so no absent fact reads as a value.
- **Where each value comes from.** Each value is read from the run's [host](../core/host.md#host-facts) when the middleware runs, so a test supplies each one through `mockProcess`:

  | Label | `VersionFacts` member | Value | Absent when |
  | --- | --- | --- | --- |
  | `channel` | `channel` | `host.release.release.channel`, the [release channel](../core/release-facts.md) core derives from the release version | the run has no release group |
  | `build` | `build` | `host.release.build`: `source`, `development`, or `distributed` | never |
  | `asset` | `asset` | `host.release.release.asset`, the release asset's name | the run has no release group, or its release group has no asset, as a JavaScript bundle's has none |
  | `installation method` | `installationMethod` | `host.release.installation.method`, as the [installation record](../core/installation-record.md) holds it, such as `script` | the run has no installation |
  | `runtime` | `runtime` | `host.runtime`'s `name`, one space, and its `version`, such as `bun 1.3.2` or `node 24.11.0` | the run's process handle holds no runtime: a hand-built handle that omits it, or `processHandle` or `mockProcess` given `runtime: undefined` |
  | `platform` | `platform` | `host.platform`, a hyphen, and `host.arch`, such as `linux-x64` or `darwin-arm64` | never |

  The plugin derives none of them itself: a run with no release group prints no channel, even when the declared version carries a prerelease identifier, because core alone derives the channel and only from a release. The version is not a row, because the line above the block prints it: `graph.version`, the Application's declared version, which the release group's `version` matches for an application built from its package with `loom build --release`. `platform` holds no C library, which a compiled binary's asset name already carries, as `notes-linux-x64-musl` does.
- **Overriding the block.** An application overrides `versionFacts` to restyle the block while `version({ extended: true })` stays installed; the replacement reads the six members of `VersionFacts`, each `undefined` when absent, and it can call `versionFacts.render(facts, context)` to build on the default block. Overriding `versionLine` restyles the first line alone, and overriding `versionFacts` the block alone.
- **The routed Command.** The facts are the Application's and the run's, so every Command prints the same facts: `notes list --version` prints the bytes `notes --version` prints, unless the run's media type asks for JSON, under the next section.

### The JSON form

When the run's [media type](../core/middleware.md) is `application/json` or `application/jsonl`, the extended output prints the same facts as one JSON object in place of the line and the block, so an agent reads them as data. With the [formatter](format.md) installed ahead of the version plugin, `--format json` and `--format jsonl` ask for it at the root of a group application and on every Command that declares a result:

```text
$ notes --version --format json
{
  "name": "notes",
  "version": "1.1.0-next.3",
  "channel": "next",
  "build": "distributed",
  "asset": "notes-linux-x64",
  "installationMethod": "script",
  "runtime": "bun 1.3.2",
  "platform": "linux-x64"
}
$ notes --format jsonl -V
{"name":"notes","version":"1.1.0-next.3","channel":"next","build":"distributed","asset":"notes-linux-x64","installationMethod":"script","runtime":"bun 1.3.2","platform":"linux-x64"}
```

`notes list --format json --version` and `notes list --format jsonl -V` print the same two documents.

- **Keys and their order.** The object holds eight keys, always all eight and always in this order: `name`, `version`, `channel`, `build`, `asset`, `installationMethod`, `runtime`, and `platform`. `name` is `graph.name`. `version` is `graph.version` as declared, with no `v` added, so a declared `v0.2.0` reads `"v0.2.0"` and an unversioned Application reads `"0.0.0"`. The other six are the block's values, the same strings unstyled and unescaped. An absent fact reads `null`, as an absent scalar does in the [manifest](manifest.md), so the source run above reads `"channel": null`, `"asset": null`, and `"installationMethod": null`.
- **What it leaves out.** The object holds no postfix, because the postfix is prose for the operator and a setting of the plugin, not a fact, and the `--version` line's styling and `v` are rendering. It holds no repository, installation path, or digest, which the release facts carry and the text does not print.
- **Bytes.** Under `application/json` the object is `JSON.stringify(object, null, 2)` and one newline, and under `application/jsonl` it is `JSON.stringify(object)` and one newline, one line: the bytes the formatter's [`json()` and `jsonl()` views](format.md) write for that object. The text is escaped as those views escape it, through `style.escape` and with every character from U+007F to U+009F replaced by its `\uXXXX` escape in four lowercase hex digits, and no style applies, so the bytes are the same under every capability. It is written to stdout through a bare view the plugin does not declare, so no override reaches it, `versionLine` and `versionFacts` included: the object is data, as the manifest's document is.
- **How the media type is read.** The middleware reads `mediaType` on its [context](../core/middleware.md) when it runs, and compares it with the two strings exactly. Any other value and `undefined` print the line and the block. The plugin reads no view name, no `ResultNode.mediaTypes`, and no other plugin's option: core and the plugin that states the media type decide what `mediaType` reads.
  - On a Command that declares a result, `mediaType` is the media type the selected view declares, so the formatter's `--format json` selects the JSON form through its `json()` view, an author's own view that declares `application/json` selects it as the formatter's does, with or without the formatter installed, and a Command whose default view declares `application/json` prints the JSON form for a bare `--version`. A view that declares no media type prints the line and the block.
  - On a Command that declares no result, the root of a group application included, `mediaType` is the media type a middleware assigned before the version middleware ran, else `undefined`. The formatter assigns one on every group from its hidden `--format`, so `notes --version --format json` prints the object at the root, and a nested group, such as a `cache` group's `notes cache --version --format jsonl`, prints it the same way. A Command that registers an action and declares no result gets no `--format`, so it prints the line and the block unless another plugin assigned a media type.
- **Installation order.** The chain runs in installation order and the version middleware takes over, so it reads a media type the formatter states only when the formatter's middleware ran before it. Install `format()` ahead of `version({ extended: true })`, as the example does. With `version()` first, `notes --version --format json` prints the line and the block, because the formatter's middleware never runs.
- **A format the formatter does not know.** A `--format` its validator rejected states nothing, under [Formatter](format.md). `notes --version --format yaml` at the root prints the line and the block and exits 0: the formatter assigns no media type, and the version middleware takes over, so the held fault is never raised, as a takeover never raises one. `notes list --format yaml --version` does the same when the default view of `list` declares neither media type, and `notes --format yaml --help` prints the help page by the same rule. Without `--version` or another takeover, `notes --format yaml` fails with the missing subcommand, exit 2, and `notes list --format yaml` with the validator's issue, exit 2.
- **Without the formatter.** No plugin states a media type at a group, and `--format` is an unknown option, as it always was. `notes --version --format json` prints the line and the block and exits 0, because the version middleware takes over and the unknown option stays held, and `notes --format json` fails with the unknown option, exit 2. On a Command that declares a result, an author's own view that declares `application/json` still selects the JSON form.
- **Without `extended`.** The plain version line reads no media type: `notes --version --format json` and `notes list --format json --version` under `version()` print `notes v1.1.0-next.3`, as they always have.

### What stays the same

`extended` changes what the middleware prints and nothing else. The option, its spellings, its description `Print the version.`, its `control` mark, the help row, the manifest's entry for `--version`, and every other projection are the same in both modes. The middleware still returns without calling `next()`, so the exit code is 0, nothing later in the chain runs, the action never dispatches, and a fault core held is never raised. It reads the host facts in the table and the run's media type, and no extension and no option beyond its own.

## When author code fails

An application's override of `versionLine` or `versionFacts` is author code. A replacement that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). When the `versionLine` override fails in the extended output, the block is not rendered. The version line and the facts block have no other outcome of their own, and the JSON form, whose values are strings and `null`, has none.

[ADR-0150](../decisions/0150-an-application-opts-in-to-an-extended-version-that-prints-the-release-facts-runtime-and-platform.md) records the extended output and the host's runtime fact.
