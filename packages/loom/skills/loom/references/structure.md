# Structure

This reference covers how to lay out a Loom application across files: the application module and the entry, the Command modules, and where plugins, shared options, views, and failure classes go.

## The application module and the entry

The application module (`src/application.ts`) declares the Application and exports it. The entry (`src/main.ts`) imports it and calls `run()`, and holds nothing else. `loom init` writes both in this shape.

- **Never call `run()` in the application module.** Every tool that loads the module expects it to declare and not run: the [assembly check](../../../../../docs/libs/testing.md#assertassembles) in a test, `loom init` when it writes the entry and the test, and `loom build`, which bundles the module as a second entry point beside the entry and loads it under Bun to read the [skills folder](../../../../../docs/toolchain/build.md#the-skills-folder).
- **Never import the entry**, from a test or from any other module. Importing it runs the application. A `run()` given no process handle binds the real process, so it reads the test runner's own argv and writes to its stdout.
- **Export exactly one Application.** `loom init` counts every exported value that is an Application, and for a module that exports two it writes no entry and no test. An Application stays an Application in every authoring state, so keep intermediate values, such as the `configured` value below, unexported.
- **Build the Application when the module loads.** Do not hide it in a function that the entry calls. `loom build` reads `skills()` only from what runs while the module loads.
- **A test imports the application module.** It passes the Application to `assertAssembles` and runs it on a `mockProcess` handle, never on the real process. Keep the assembly test `loom init` writes at `src/application.test.ts`: it is the one check that fails CI for a fault that only the assembled application reveals. [Testing](testing.md) covers the rest.

## The application module's contents

Write the application module in this order, because each step types the next:

1. `const configured = new Application(name, { ... })` with every plugin, view override, translator, and Application-level extension value.
2. Each `globalOption()` call, then any root-local `option()`.
3. When the root has children, the [Application registration](../../../../../docs/core/commands.md#modular-authoring): `declare module '@loomcli/core'` with `Register.environment` set to `EnvironmentOf<typeof configured>`. Register this configured value, never the finished Application, because the finished one imports the Commands that read the registered types.
4. The exported Application: `configured.command(...)` for each child, then `rows()` or `result()` and `action()` for a root that runs.

Keep one registration per TypeScript project. A second application, an example, or a test with its own registration needs its own `tsconfig.json`.

[`configuration()`](../../../../../docs/plugins/config.md#the-plugin-and-its-values) returns the plugin and a provider, `{ plugin, values }`. When a Command opts in to `values`, call `configuration()` in a module of its own, such as `src/config.ts`, so the application module imports the plugin and the Command imports the provider, and no Command imports the application module.

## Commands and files

Start from the scaffold: one application module with an inline root action. Split files when a second Command arrives or when an action grows.

- **One module per Command.** Put each Command in `src/commands/<name>.ts`, which exports the Command value, as jsonkit does. A Command module imports `@loomcli/core`, its own action, extension values from plugin subpaths such as `@loomcli/plugins/help/extension`, and shared declarations. It never imports the Application. Its global option types come from the registration.
- **A group imports its children.** A group's module imports each child and attaches it with `command()`. Mirror a deep path in folders, such as `src/commands/cache/clear.ts` for `cache clear`. A small subtree whose Commands exist only under one parent can stay in one module, as jsonkit's `stats.ts` holds `stats`, `depth`, and `max`. Nothing in Loom reads the file layout: the graph is the `command()` calls, and their order is the order every listing shows.
- **One placement per Command value.** A Command value attaches at one point in the graph. A Command that belongs under two parents comes from a function that returns a new value for each placement.
- **Extract an action to test it.** Put an extracted action in its own module, such as jsonkit's `src/actions/get-value.ts`, typed `ActionHandler<typeof get>` through `import type` of its Command. Keep the Command's initializer ending in `.action(getValue)`, and derive an `extend()` value from the finished Command instead, under [Modular authoring](../../../../../docs/core/commands.md#modular-authoring). A unit test calls the extracted action with [`actionContext`](../../../../../docs/libs/testing.md#actioncontext). An inline action has no public path to a unit test.
- **A one-Command application.** When the root itself takes arguments, as textstat's does, the root cannot hold children. It then also cannot install a plugin that brings Commands, such as `help({ command: true })`, `completion()`, or `mcp()`. Choose a root with children before you install one.
- **Share steps as functions.** A step that several actions repeat, such as jsonkit's `readJson`, is a plain function in its own module. Type its parameter as the part of the action context it reads, such as `Pick<Out, 'debug'>`, so a test passes only that part.

## Plugins

Install every plugin in the `plugins` list of the Application constructor. The list order is the [installation order](../../../../../docs/core/plugin-contract.md#identity-and-installation), and it decides several things at once:

- The middleware chain runs in list order, so the plugin listed first wins a tie. Both examples list `help()` before `version()`, so `--help --version` prints help.
- A plugin's view overrides resolve after the Application's own and before later plugins'.
- Plugin Commands attach to the root ahead of the application's own Commands, and listings show them first.

An application that needs its own middleware or lifecycle hook writes a plugin of its own. Give it a folder, such as `src/plugins/<name>/`, with an entry module that exports the factory with an annotated return type and a middleware module that the entry loads with `import()`, as `examples/explain` does. Name its identity under the application's name, such as `notes/timing`. [Middleware and actions](middleware-and-actions.md) says when a plugin of your own is the right choice.

## Options shared across Commands

- **A value every action reads** is a global option: `globalOption()` on the Application before its first `command()` or `action()`. A global option has no presence rule and cannot be a content option, under [Global options](../../../../../docs/core/commands.md#global-options).
- **An input several Commands declare,** especially a required one or a content input, is one configuration constant declared locally on each Command. jsonkit's `src/document-input.ts` exports `documentInput`, typed with `satisfies ContentOption`, and each document Command calls `.option('file', documentInput)`. A Command that reads no document declares no `--file`.
- **A typed value derived from global options,** such as a database pool or a session, is a [provider](../../../../../docs/core/providers.md). Commands that share providers share one `uses` constant, because a child inherits nothing from its parent.

## Views and failures

- **Views.** Keep `View` values in `src/views.ts`. A result's views belong in its Command's `result()` or `rows()` record, and a pack view there is replaced by name through `views()`. A replacement for a declared view or a failure class's view goes in the Application's `views` list as `override(key, view)`, as both examples override `FatalError`.
- **Failure classes.** Declare an application's own failure class, a `FatalError` subclass, with a static `code` and `exitCode` when it needs them, in the module of the code that throws it, as jsonkit's `PathNotFoundError` sits in `resolve-path.ts`. Keep a translator beside the class it produces, as `translators.ts` holds `InvalidJsonError` and `invalidJson`, and list the translator in the Application's `translators`. [Failures](../../../../../docs/core/failures.md) states the class contract.
- **Lists that several Commands repeat,** such as jsonkit's manifest failure lists in `failures.ts`, are shared constants, because a Command's [manifest failure list](../../../../../docs/plugins/manifest.md#manifest-failures) inherits nothing from its parent.

## The toolchain configuration file

A package that keeps the conventions needs no `loom.config.json`. Add one beside `package.json` only to move a path, under [The configuration file](../../../../../docs/toolchain/build.md#the-configuration-file).

- `paths.application` and `paths.entry` follow `paths.source` unless they are set themselves, and every path resolves against the package directory.
- The application module and the entry need different base names. A `node` or `bun` bundle names each output file for its module alone, so an entry at `src/cli/application.ts` beside an application module at `src/application.ts` fails the build.
- `loom init` reads the configured paths when it writes the scaffold files, but it writes each scaffold file once and never updates it. When you move `paths.source` later, update `tsconfig.json`'s `include`, the linter's file globs, and the `check` script's lint target yourself.
- The agent skills stay at `.agents/skills/`, and `package.json`, `tsconfig.json`, and the linter's file stay at the package root, whatever the file holds.
