---
description: "The version plugin: the --version option, the version line it prints, and the view an application overrides to restyle it."
---

# Version plugin

```ts
// @loomcli/plugins/version
export interface VersionSettings {
  readonly postfix?: string;
}

export declare function version(settings?: VersionSettings): Plugin<VersionOptions>;

// @loomcli/plugins/version/views
import type { CommandGraph, DeclaredView } from '@loomcli/core';

export interface VersionLine {
  readonly graph: CommandGraph;
  readonly postfix: string | undefined;
}

export declare const versionLine: DeclaredView<VersionLine>;
```

For an Application that declares `version: '0.2.0'`, `version()` prints the first line and `version({ postfix: '(Report schema v1)' })` the second:

```text
jsonkit v0.2.0
jsonkit v0.2.0 (Report schema v1)
```

- **Style.** The application name uses `style.highlight.bold`, and the version, including its `v`, uses `style.primary`. One unstyled space separates them. A postfix follows the version after one more unstyled space and uses `style.dim`. Each graph string and the postfix are escaped before styling. The line ends with exactly one newline and adds no logo, branding glyph, or label.
- **Postfix.** `postfix` is text the application prints after the version, such as the schema a binary speaks. It is one line of prose under the rule `isProseLine` states, judged at the `version()` call: a value that is not a string, is blank, or holds a line terminator throws a `DeclarationError` from `version()` under [`@loomcli/plugins/version/postfix`](../core/diagnostics.md#loomclipluginsversionpostfix). The finding rebuilds the `version()` call and marks `postfix`. The postfix is a setting of the plugin, not a graph fact, so `graph.version`, the manifest, and every other projection are unchanged by it.
- **Policy.** Core resolves these semantic styles under the existing [rendering policy](../core/styles.md). Installing `loomTheme()` supplies copper for highlight. The version plugin requires no theme, chooses no color, and reads no host capability.

`version()` declares one Boolean option, `version`, with the short spelling `V`, the description `Print the version.`, and `control: true`, because it asks for the version and feeds no Command's work under [Control options](../core/commands.md#control-options), so an invocation spells it `-V` or `--version`, and a middleware activated by it. The middleware renders one line to stdout through the plugin's declared view, `versionLine`, a `DeclaredView<VersionLine>` exported from `@loomcli/plugins/version/views` and listed in the plugin's `views`. Its data is the graph and the postfix the `version()` call took, `undefined` when it took none. Its default function returns the text `<name> v<version>\n` from `graph.name` and `graph.version`, or `<name> v<version> <postfix>\n` with a postfix, with the styling above, and the middleware calls `out.render({ graph, postfix }, versionLine)` and returns without calling `next()`, so the exit code is 0, nothing later in the chain runs, the action never dispatches, and a fault core held from parsing or validation is never raised. An application overrides `versionLine` to restyle the line while `version()` stays installed; the replacement reads `graph` and `postfix`, and it can call `versionLine.render(line, context)` to build on the default line. An application whose manifest reads `0.2.0` prints `jsonkit v0.2.0`. When the declared version already starts with a lowercase `v`, the line carries that `v` once, so a declared `v0.2.0` prints `jsonkit v0.2.0` too; an uppercase `V` or any other first character is printed after the added `v` as declared. The rule is rendering alone, and `graph.version` holds the declared string. The middleware reads no host fact, no extension, and no option beyond its own, and the routed Command does not change the line: `jsonkit get --version` prints the same line, because the version is a fact of the Application.

`version` is never absent on the graph. An Application that omits it declares `0.0.0`, which means unversioned, so `CommandGraph.version` is a `string` and no projection branches on its absence. An explicit `0.0.0` reads the same, and core keeps no record of which one the author wrote. A declared version follows the one-line rule every core fact string follows, so the line the plugin prints is one line; core otherwise neither validates nor normalizes it.

## When author code fails

An application's override of `versionLine` is author code. A replacement that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The version line has no other outcome of its own.
