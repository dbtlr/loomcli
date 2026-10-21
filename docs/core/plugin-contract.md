---
description: "The plugin contract: identity and installation, global options and settings from plugins, plugin Commands, activation, environment preparation, and views from plugins."
---

# Plugin contract

Core installs no plugins. Every capability beyond authoring, graph build, invocation, host capture, output, and failures is a plugin that an Application installs explicitly, and a first-party plugin uses the same public contract as a third-party one. A plugin is a frozen value that `plugin(identity, definition)` returns. It holds the options it contributes, one middleware with its activation and a loader, the extensions it defines, the views it declares and overrides, the [translators](failures.md#translators) and [failure encoders](failure-views.md#failure-encoders) it registers, one optional claim on the signals slot, one optional [configuration source](input-sources.md), the [Commands](#plugin-commands) it attaches to the root, and its [lifecycle hooks](lifecycle-hooks.md), the functions core calls at named points of an Application's life. Creating and installing the value runs none of its code: `onCommandAttach` and `onGraphBuilt` run at graph build, `onFailure` runs when `run()` renders a failure, `onLog` runs when a run logs an event, and the middleware runs inside an invocation. An installed plugin costs its entry module and the declarations that module imports on an invocation that never reaches it, plus one call of each hook it implements at every point core calls it: `onCommandAttach` once per Command and `onGraphBuilt` once per build, since the graph builds on every invocation, `onFailure` once per rendered failure, and `onLog` once per log event. Its middleware module loads only when the chain reaches it.

The optional [theme contribution](styles.md#plugindefinitiontheme-field) claims the single theme slot.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  theme?: Theme & ThemeConstraint<Theme>;
  options?: Options;
  middleware?: {
    activate: 'always' | readonly (keyof Options & string)[];
    load: () => Promise<{ default: Middleware<Plugin<Options>> }>;
  };
  onCommandAttach?: CommandAttachHook;
  onGraphBuilt?: GraphBuiltHook; // see Judging the built graph
  onFailure?: FailureHook;
  onLog?: LogHook; // see Observing log events
  onEnvironment?: EnvironmentHook; // see Environment preparation
  extensions?: readonly AnyExtension[];
  views?: readonly ViewContribution[];
  translators?: readonly Translation[];
  failureEncoders?: readonly FailureEncoding[]; // see Failure encoders
  signals?: readonly ('SIGINT' | 'SIGTERM')[];
  source?: {
    binding: AnyExtension & { readonly target: 'option' };
    load: () => Promise<{ default: SourceResolver<Plugin<Options>> }>;
  };
  commands?: readonly Command<unknown, unknown>[];
}
```

`Plugin<Options>` carries its options as a type parameter used in a read position alone and defaults to `Plugin<PluginOptions>`, so a `plugins` list holds plugins with different options the way `views` holds overrides for different keys. The parameter is therefore covariant, which is what lets `plugins`, `Middleware`, and `load` accept a narrower plugin; Command globals instead express a requirement on the receiving Application. `AnyExtension` is the descriptor supertype a plugin's `extensions` list uses: it publishes the identity, the target, and whether the extension collects, and erases both the schema and the factory call signature, because a schema-typed call signature relates only by schema identity and a list cannot name one schema per element. A descriptor is assignable to it; an extension value is not. A plugin that loads a middleware annotates its factory's return type, and exports its options type when it declares options. That annotation is the boundary that breaks the type cycle between the entry module, which names the middleware module in `load`, and the middleware module, which type-imports the plugin.

```ts
// src/help/plugin.ts, the entry module of the @loomcli/plugins/help subpath
import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';
import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpHint } from './hint.js';
import { helpPage } from './views.js';

const options = {
  help: { control: true, description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;
export type HelpOptions = typeof options;

export function help(): Plugin<HelpOptions> {
  return plugin(`${packageName}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    onFailure: helpHint,
    options,
    views: [helpPage],
  });
}
```

A plugin package written outside this repository declares its package name once as a constant, as the pack does in `src/constants.ts`, and a test pins the constant to the `name` in its `package.json`. A published plugin is compiler output, one module per source file, so a module that imports `package.json` through `resolveJsonModule` makes the compiler copy the whole manifest into the output directory, and the tarball ships a second manifest that holds unpublished workspace specs and an `exports` map that some bundlers read. An application is different: `loom build` bundles it, so the bundler inlines what the application reads from its manifest, and the application examples in this document import `package.json` for their version. A module inside the output must not import its own package by name. Core takes every identity as a `string`, so nothing keys on an identity at the type level. A package that ships one plugin uses `packageName` alone as the identity; the example above ships several, so it appends the plugin's own name, as [First-party plugins](../plugins/README.md) describes.

## Identity and installation

A plugin's, an extension's, and a view's identity is a string core compares by equality. By convention it is an npm package name, scoped or unscoped, of lowercase letters, digits, `-`, `.`, and `_`, then zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens, such as `help`, `@acme/config`, `@loomcli/plugins/help`, and `@loomcli/core/lanes/stdout`. The package part is the package part of a [rule identity](declaration-faults.md#developer-diagnostics), which adds a mandatory rule name and which `diagnosticRule()` checks, so a package that declares diagnostic rules keeps its identity in the convention. `plugin()`, `extension()`, and `view()` do not check the convention. An identity installed twice, and two distinct descriptors or declared views that share an identity, stay declaration faults. [ADR-0096](../decisions/0096-the-identity-grammar-is-a-naming-convention.md) records the decision, which replaces the grammar check of [ADR-0052](../decisions/0052-a-plugin-extension-and-view-identity-follows-one-grammar.md).

For a plugin, the convention is the package name for a package that ships one plugin, and `<package name>/<plugin>` for a package that ships several, both built from the package-name constant, which a test keeps equal to the `name` in `package.json`, so the identity and the package stay in sync. An application-local plugin names itself the same way, under the application's own name. Identity is fixed where the plugin is defined and never changes at installation, because the extensions a plugin defines carry that identity in modules the plugin's consumers import statically.

An Application installs plugins through `plugins` in its options object. Installation order is the order every plugin contribution composes in, so the application source shows the precedence. The list is the only way in: there is no install call on the fluent chain, no default set, and no removal. Replacing a first-party behavior means omitting one plugin and installing another. The constructor rejects a plugin another installed copy of `@loomcli/core` built and an identity installed twice.

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

import Package from '../package.json' with { type: 'json' };

export const jsonkit = new Application('jsonkit', {
  plugins: [help()],
  version: Package.version,
});
```

## Global options from plugins

```ts
type GlobalOptionConfig = OptionConfig & { readonly required?: never; readonly validateOmitted?: never };
type PluginOptions = Readonly<Record<string, GlobalOptionConfig>>;
type PluginOptionValues<Options extends PluginOptions> = {
  readonly [Name in keyof Options & string]: OptionValue<Options[Name]>;
};
```

```ts
// src/plugin.ts, the entry module of a package that ships one plugin
import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { packageName } from './constants.js';

const options = {
  level: { description: 'Set the log level.', env: 'ACME_LOG', type: 'string', validate: oneOf(['debug', 'info', 'warn']) },
} satisfies PluginOptions;
export type LogOptions = typeof options;

export function log(): Plugin<LogOptions> {
  return plugin(packageName, { middleware: { activate: 'always', load: () => import('./middleware.js') }, options });
}

// Any action of an application that installs log() reads it typed:
//   const level: 'debug' | 'info' | 'warn' | undefined = options.level;
```

A plugin declares global options under `options`, keyed by name. They are global options with no difference from the ones `globalOption()` declares, under [ADR-0055](../decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

- **One configuration.** An entry takes `GlobalOptionConfig`, the configuration `globalOption()` takes: everything `option()` takes except the presence rules, which [ADR-0044](../decisions/0044-a-global-option-declares-no-presence-rule.md) forbids on a global option. Every option kind, a [counted option](options.md#counted-options) included, a validator, a default, an [implied value](options.md#implied-values), `multiple`, an [environment binding](input-sources.md), the core facts, and `extensions` all apply, under the rules of [Local options](options.md). `plugin()` applies every rule an option declaration meets at its call. `satisfies PluginOptions` checks each entry's keys, but not a default against its type or its validator's input, which `option()` checks at compile time, so a default its validator rejects meets `@loomcli/core/invalid-default` from `run()`.
- **One parse.** Routing reads a plugin's option like every global option, and every Command's table holds it, so it shares short groups with the routed Command's local options: `textstat -ht` sets help's `help` and the root's `total`. A structural fault on it is the fault any option produces, held under [Global consumption and routing](commands.md#global-consumption-and-routing).
- **One validation.** Its value validates with the other global options, in authoring order after the application's own and then in plugin installation order, and a rejected value is an ordinary input problem with exit code 2.
- **Every reader.** Its validated value reaches every action and every middleware's `options`. An action's type names it through the installed plugin tuple: the Application's own action reads it from the constructor's `plugins`, and a Command built where the Application's `Register` augmentation is visible reads it through `EnvironmentOf`, under [Modular authoring](commands.md#modular-authoring). A [plugin Command](#plugin-commands) receives it at run time, and its types name no global option, because it compiles without the Application. A plugin typed as the wide `Plugin`, or a list widened to `Plugin[]`, names no option in an action's type; the value still reaches the action at run time.
- **Its own plugin keeps three things.** [Activation](#activation) lists the plugin's own option names, [`spellings`](middleware.md) records how its own options were typed, and [`ownOptions`](middleware.md) holds its own options' validated values under a held fault. None reaches another plugin's options or the application's.
- **Collisions.** Every collision is a declaration error, by key, by spelling, or by variable, against an application global option, a local option on any Command, or another plugin's option, under [Plugin declaration errors](#plugin-declaration-errors).
- **Types.** `GlobalOptionConfig`, `PluginOptions`, and `PluginOptionValues<Options>` are exported, as `OptionsOf` is. `PluginOptionValues` maps each declaration through the same `OptionValue` an action's options use, so a validated option reads as its validator's output.

## Plugin settings

A plugin factory that lets an application choose a spelling takes one optional settings object, and a chosen short spelling is its `short` key, one ASCII letter, so `format({ short: 'f' })` gives `--format` the spelling `-f`. Every first-party plugin that offers a short spelling takes it this way, and none of them renames its long spelling. A factory with no settings, or settings without `short`, declares its option with the short spelling it ships with, which may be none.

```ts
function isProseLine(value: unknown): value is string;
```

A factory judges its own settings: it fills each omitted setting with its default and judges only a real conflict between settings. Core exports no settings check: each factory's typed settings reject a settings value of the wrong shape at compile time, and core adds no rule for a value that bypasses them, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A `short` setting reaches core as the option's short spelling, whose ownership is judged at the earliest point that knows both owners: construction or an option or Command attachment for globals, and graph build for a hook-declared option.

`isProseLine(value)` answers whether a value is one line of prose: a string that holds a character other than whitespace and no line terminator, the rule a configuration source's label follows. A plugin whose setting prints inside one line judges it against core's rule instead of a copy, as `version()` judges its postfix, and throws its own rule's `DeclarationError`. `isProseLine` is exported from `@loomcli/core`.

### First-party and example short spellings

Help, version, and verbose have fixed short spellings. Configuration, the formatter, and the manifest let the application choose theirs through `short` and have none by default. The example applications choose these spellings without collisions:

| Declaration | Long spelling | Short spelling | Rule |
| ----------- | ------------- | -------------- | ---- |
| Help | `--help` | `-h` | Fixed; selects compact help. |
| Version | `--version` | `-V` | Fixed; leaves lowercase `-v` available. |
| Configuration | `--config` | None by default; textstat chooses `-c`. | `config({ short: 'c' })`. |
| Formatter | `--format` | None by default; textstat chooses `-f`, jsonkit chooses `-o`. | Keeps jsonkit's `-f` for its document. |
| Manifest | `--manifest` | None by default; both examples choose `-M`. | Keeps textstat's `-m` for its metric. |
| Private example plugin | `--explain` | `-e` | Fixed in the example plugin. |
| Verbose | `--verbose` | `-v` | Fixed; jsonkit installs it. |
| Verbose | `--quiet` | `-q` | Fixed; jsonkit installs it. |
| textstat | `--metric` | `-m` | Selects bytes, words, or lines. |
| textstat | `--min-bytes` | `-b` | Selects the byte threshold; `--minimum` remains an unadvertised alias. |
| textstat | `--total` | `-t` | Adds the total row. |
| textstat | `--timing` | None | Hidden diagnostic option, kept long-only. |
| jsonkit | `--file` | `-f` | Global document option. |
| jsonkit select | `--field` | `-F` | Local multiple option; lowercase `-f` belongs to the document. |

## Plugin Commands

A plugin attaches Commands to the root through `commands`, a list of the same Command values an application builds with `new Command(name)`. Once attached, a plugin Command is an ordinary child of the root.

```ts
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  commands?: readonly Command<unknown, unknown>[];
  // ...
}
```

```ts
// src/plugin.ts, the entry module of a package that ships one plugin
import { Command, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import { box } from '@loomcli/plugins/box';
import { heading } from '@loomcli/plugins/heading';
import { list } from '@loomcli/plugins/list';
import { rule } from '@loomcli/plugins/rule';

import { packageName } from './constants.js';

const doctorCommand = new Command('doctor', { description: 'Check the host this application runs on.' }).action(
  async ({ host, out }) => {
    const output = host.terminal.stdout.isTTY ? 'a terminal' : 'not a terminal';
    await out.render('Host checks', heading());
    await out.render([`Platform: ${host.platform}`, `Output: ${output}`], list<string>());
    await out.render('', rule());
    await out.render('All checks passed.', box({ title: 'Result' }));
  },
);

export function doctor(): Plugin {
  return plugin(packageName, { commands: [doctorCommand] });
}
```

- **Where and when.** When the Application is constructed, core attaches each installed plugin's Commands to the root, in plugin installation order and in list order within one plugin, ahead of the application's own Commands, which attach later through `command()`. The root's authoring order is therefore the plugins' Commands first, and help's command rows, `inspect()`, and the manifest list them in that order.
- **An ordinary Command.** Every Command rule applies to a plugin Command unchanged, at every depth of its subtree: naming, [aliases](commands.md#aliases), hidden and deprecated, routing, parsing, the [input-source stage](input-sources.md), validation, and every row under [Command declaration errors](commands.md#command-declaration-errors). Every installed plugin's [lifecycle hooks](lifecycle-hooks.md) run on it, its own plugin's included, in the root-first, depth-first walk. Nothing in the graph records which plugin attached it. Its action receives what every action receives, every global option's value included, and runs only when routing selects its Command. The plugin Commands attach before any call on the root, so the closures `action()` applies never meet them.
- **Globals.** The list is typed `Command<unknown, unknown>`, whose globals are empty, so a plugin Command requires no global option: a plugin cannot know the Application it is installed in. A plugin therefore builds its Commands in its own compilation, where no Application registers globals. A Command built where an Application's `Register` augmentation is visible carries that Application's globals and does not compile into the list, whether or not its action reads them.
- **No rename or removal.** The application cannot rename or remove a plugin Command. An application that does not want it does not install the plugin.
- **Collisions.** A plugin Command whose name or alias repeats another root child's, from the application or from another plugin, is a declaration error under [`@loomcli/core/sibling-name-taken`](diagnostics.md#loomclicoresibling-name-taken). The constructor throws it when two installed plugins attach one name, and the application's own `command()` call throws it otherwise. An application that also attaches the plugin's Command value to the root fails the same way, and one that attaches it under another Command fails under [`@loomcli/core/command-attached-twice`](diagnostics.md#loomclicorecommand-attached-twice).
- **A root with arguments.** A root that declares arguments cannot also hold children, so an application whose root declares arguments cannot install a plugin that brings Commands. The root's `argument()` call throws [`@loomcli/core/arguments-beside-children`](diagnostics.md#loomclicorearguments-beside-children).
- **Cost.** A plugin's Commands are declarations its entry module imports, so they load with that module like any Command, and each action is lazy as every action is.

## Activation

A middleware declares what activates it, and there is no default. `activate` is a list of the plugin's own option names, or `'always'`. With a list, the middleware runs when any listed option is present in the invocation; present means supplied as a token, in any spelling including a negative Boolean form, or filled by the environment or the configuration source under [Input sources](input-sources.md), whatever value the fill holds, so a declared default never activates anything. With `'always'`, the middleware runs on every invocation that reaches the chain.

Activation is evaluated after the input-source stage, from which tier supplied each option: a token or a fill activates whatever value it holds, and a declared default never does. It is evaluated before any middleware module loads. Core calls `load` only for a middleware whose activation matched and only when the chain reaches it, so an invocation of `jsonkit get -f doc.json` with help, version, and manifest plugins installed imports none of their middleware modules. Each plugin's entry module and the declarations it imports, its declared views included, load at install whatever the invocation. A plugin whose middleware must observe every invocation, such as a logging or color policy, declares `'always'` and pays for its module on every run that reaches it; a plugin that only acts on a request declares the options that make the request. The plugin author chooses, and the choice is visible in the descriptor.

An activation name that is not one of the plugin's declared options is a compile error when the plugin declares options, because the list is typed from the declaration. Core checks no activation at `plugin()`: a name the plugin does not declare, and an empty list, never wake the middleware. A local option a plugin's `onCommandAttach` hook declared is not one of the plugin's options and cannot activate it: a middleware that reads such an option declares `'always'`, as the [formatter](../plugins/format.md) does. A `load` that throws, rejects, or resolves to a module with no default middleware function, is an internal error with code 1.

## Environment preparation

A plugin's `onEnvironment` hook returns additions before any declared value or input validates.
Core calls hooks in installation order after graph build, only for a new outer run.
`inspect()` and `check()` call none. An action's `invoke()` inherits preparation.

```ts
import type { Host, Log, Out } from '@loomcli/core';

type EnvironmentHook = (context: EnvironmentContext) =>
	Readonly<Record<string, string>> | void | Promise<Readonly<Record<string, string>> | void>;

interface EnvironmentContext {
	readonly host: { readonly cwd: Host['cwd']; readonly env: Readonly<Host['env']> };
	readonly out: Pick<Out, 'warn'>;
	readonly log: Log;
}
```

Each hook sees a read-only environment snapshot containing earlier additions.
Core merges the returned record as it is. A record whose names or values the hook's type rejects gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
Defined variables, including empty strings, win. The first hook that fills a missing variable wins.
The report host and log destination share the merged map, even if logging was initialized earlier.
Each accepted answer merges and, where allowed, copies to the process before the next hook runs.
Later failures do not roll back additions. [Dotenv](../plugins/dotenv.md) specifies the process-write boundary.

Core checks cancellation before each hook and after awaiting its answer, before applying additions.
An abort starts no later hook and discards an answer still in flight. Core awaits started work without imposing a timeout.
A nonfunction hook fails at declaration. A hook's throw takes the ordinary failure path: a failure class keeps its class, exit code, and message, and any other throw is a foreign throw, an `InternalError` with exit 1 under `@loomcli/core/foreign-throw`.
Application translators do not see the throw, and a middleware takeover cannot suppress it.

Host capture precedes preparation. Release facts, declared rendering policy overrides, program words, and `host.timeZone` retain their captured values.
Output capability detection reads the current environment on each emission. Imported `NO_COLOR`, `FORCE_COLOR`, and `TERM`, and the depth hints `COLORTERM`, `TERM_PROGRAM`, and `TERM_PROGRAM_VERSION`, affect subsequent output.
When the operator's [color choice](color.md) set the `color` field, an imported `NO_COLOR`, `FORCE_COLOR`, or `TERM` no longer turns color on or off, and `FORCE_COLOR` and `TERM` still affect automatic modifiers.
The run's [background](background.md) settles before preparation from the captured environment, so an imported `COLORFGBG`, `TERM`, `STY`, or `INSIDE_EMACS` changes no background, and an imported `NO_COLOR` or `FORCE_COLOR` that turns color on or off leaves the background as settled.
Warnings during a hook use the environment before that hook returns its additions.
Importing `TZ` may change the process time zone while validators retain `host.timeZone`.
The hook exposes no parsed options, routing, cleanup, or general lifecycle participation.

## Views from plugins

A plugin's `views` list holds the views it declares and the overrides it makes, in one list, the way `extensions` holds descriptors on a plugin and values on a declaration. A declared view is the value `view(identity, definition)` returned, its identity named under the [identity convention](#identity-and-installation), and listing it is what puts its identity on the graph for the duplicate rule; an override is the value `override(key, view)` returned, and it enters the resolution [Views](views.md) describes: the application's overrides first, then each plugin's in installation order, then the declaring contributor's default. A plugin can override a view another plugin declares. A plugin can list an override for its own declared view, and it resolves like any other, but the declared default is the place for that function. Two overrides for one key inside one contributor resolve to the first, as the same key overridden by the application and by a plugin, or by two plugins, resolves first-in-wins.

Overriding a plugin's view replaces its function alone: the plugin stays installed and its middleware, options, and facts are unchanged. Replacing the capability itself still means omitting the plugin and installing another, the rule the [first-party plugins](../plugins/README.md) follow.

```ts
// src/help/plugin.ts
import { plugin } from '@loomcli/core';

import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpHint } from './hint.js';
import { helpPage } from './views.js';

export function help(): Plugin<HelpOptions> {
  return plugin(`${packageName}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: { activate: ['help'], load: () => import('./middleware.js') },
    onCommandAttach: attachHelp,
    onFailure: helpHint,
    options,
    views: [helpPage],
  });
}
```

## Plugin declaration errors

Each rule below is a `DeclarationError` with code 1 that throws at the moment [Declaration faults](declaration-faults.md) assigns it. Each is a plausible fault the types cannot express: two plugins or two declarations that collide in the assembled Application, a value another installed copy of `@loomcli/core` built, an extension value its schema rejects, or a lifecycle hook's contribution. The types reject the shape of every slot, list, hook, loader, signal, translation key, encoder, and middleware activation at the call, and core adds no rule for a value that bypasses them, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A repeated declaration adds nothing: a signal claimed twice is claimed once, a second value of one extension in one layer replaces the first whole, and one key overridden twice in one contributor resolves to the first override, as two contributors resolve first-in-wins. Identities are not checked, under [Identity and installation](#identity-and-installation).

- **Another copy of core.** An Application holds no plugin that another installed copy of `@loomcli/core` built, and a plugin holds no extension value, declared view or override, translation, or failure encoding that another copy built: [`@loomcli/core/foreign-value`](diagnostics.md#loomclicoreforeign-value).
- **Installed once.** An identity is installed once: [`@loomcli/core/plugin-installed-twice`](diagnostics.md#loomclicoreplugin-installed-twice).
- **Option keys.** A plugin's option repeats neither a global option's key, a local option's key on any Command, nor another plugin's option key: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice). A local option a plugin's hook declared reports through the hook-collision rule below instead.
- **Option spellings.** A plugin's option spelling is used by no other option: [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
- **One owner of the signals slot.** A second claim on the signals slot is a declaration error: [`@loomcli/core/slot-taken`](diagnostics.md#loomclicoreslot-taken).
- **One failure encoder per media type.** Two failure encoders for one media type are a declaration error, which `plugin()` throws for two in one plugin and the Application constructor throws for two plugins, with a finding for each entry: [`@loomcli/core/failure-encoder-taken`](diagnostics.md#loomclicorefailure-encoder-taken).
- **Diagnostic rule identities.** A `diagnosticRule()` identity names a package part, optional subpath segments, and a kebab-case rule name. An empty segment, an uppercase letter in any segment, and a trailing `/` fall outside it: [`@loomcli/core/rule-identity`](diagnostics.md#loomclicorerule-identity).
- **One descriptor per identity.** Two descriptors that share an identity, and two distinct objects that share a view identity, a plugin's override key from a second copy of a package included, are a declaration error: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).
- **Extension values.** An extension value its schema rejects is a declaration error, as is one whose schema does not answer synchronously: [`@loomcli/core/invalid-extension-value`](diagnostics.md#loomclicoreinvalid-extension-value).
- **Extension output.** An extension's output is plain data: strings, numbers, booleans, null, arrays, and plain objects: [`@loomcli/core/extension-output`](diagnostics.md#loomclicoreextension-output).
- **Hook-declared input.** An option or an argument that a plugin's `onCommandAttach` hook declares collides with a local option, a global option, an option or an argument another plugin's hook declared, or an argument. A collision carries a finding for the hook's input and one for the declaration that already holds the name or spelling, and reports under the rule the application's own collision of that pair breaks: two options under one key under [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice), two arguments under one name under [`@loomcli/core/argument-declared-twice`](diagnostics.md#loomclicoreargument-declared-twice), and a spelling under [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken). An argument and an option under one name report under [`@loomcli/core/name-shared-across-kinds`](diagnostics.md#loomclicorename-shared-across-kinds), which only a hook reaches, because an author's argument and option may share a name.

A value an `onCommandAttach` hook returns that core did not build throws a `TypeError`, and a value an `onGraphBuilt` hook returns is ignored; the hook types reject both, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).

An `extensions` fault on the Application names the root Command, the declaration that carries the value, so it reads `The root Command holds ...`. A schema that throws where it is called rejected the value the only way it could, so it reports through the invalid-value row with the thrown reason as its message.

## When author code fails

Author code in a plugin that throws or rejects, a middleware, a translator, a source resolver, a failure view or encoder, or a lifecycle hook, takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The faults below differ, because core raises them for the plugin contract itself. The invocation-time faults are defects with code 1, which `run()` renders by build under [Development builds](release-facts.md#development-builds).

- **A graph hook that throws.** An `onGraphBuilt` hook that throws is a declaration error under [`@loomcli/core/broken-graph-hook`](diagnostics.md#loomclicorebroken-graph-hook), and an `onCommandAttach` hook that throws is one under [`@loomcli/core/broken-attach-hook`](diagnostics.md#loomclicorebroken-attach-hook). The reason is the thrown value's, escaped, with a full stop added when it carries none, and the thrown value is the fault's `cause`. A thrown `DeclarationError` reports as itself instead.
- **A loader that fails.** A `load` that throws or rejects, and one that resolves to a module that exports no default middleware function, is a defect under [`@loomcli/core/plugin-loader-failed`](diagnostics.md#loomclicoreplugin-loader-failed).
- **A misused `next()`.** A middleware that calls `next()` twice, or after its middleware returned, raises a defect under [`@loomcli/core/next-misuse`](diagnostics.md#loomclicorenext-misuse).
- **A bad view selection.** A middleware that assigns `view` a name the routed Command's record does not hold, a value that is not a string, or any name on a Command that declares no result raises a defect under [`@loomcli/core/view-selection`](diagnostics.md#loomclicoreview-selection). The no-result fault wins when both apply. A starting selection [`invoke()`](invocation.md#invocation-by-name) made that no middleware replaced reports the same three faults, naming `invoke()` in place of the plugin. The faults are raised at the dispatch boundary, and a takeover or a cancellation that never lets the chain reach it leaves a bad assignment unobserved.
- **A read through the wrong descriptor.** A typed read through a descriptor that did not produce the stored value throws a `DeclarationError`, which the failure path reports with code 1 when it happens inside a run.
- **A configuration source.** A source has its own invocation-time faults, listed under [Input source declaration errors](input-sources.md#input-source-declaration-errors).
- **An `onFailure` hook that throws.** It reports under [Failure hints](lifecycle-hooks.md#failure-hints).
