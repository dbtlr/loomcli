---
description: The router into the core reference. One page per concept of @loomcli/core, each listed with the moment to open it.
---

# Core reference

The core reference states the contract of `@loomcli/core`: each page holds a concept's types, an example, and its rules. The [principles](../principles.md) rank above it, and a rule here that conflicts with one is reworked through a superseding decision record. The [glossary](../glossary.md) defines the terms these pages use.

Every `Invalid declaration: ` and `Internal error: ` line a page shows quotes the fault's `sentence`. `run()` renders the fault by build, as [Development builds](release-facts.md#development-builds) states, and never with either prefix.

## Declaring an application

- [Application declarations](application.md): open it when you declare an `Application`: its name, version, description, root Command, and plugins.
- [Commands and global options](commands.md): open it when you nest Commands, declare aliases or hidden members, add control or global options, or split the declaration.
- [Local options](options.md): open it when you declare a Command's string, Boolean, or counted options, short groups, aliases, groups, or passthrough.
- [Input sources](input-sources.md): open it when an input also reads an environment variable or a configuration source.
- [Standard Schema validation](validation.md): open it when you validate an input, read content from a file or stdin, or publish an input's JSON Schema. The validator catalog is in [validators](../libs/validators.md).
- [Declaration faults](declaration-faults.md): open it when you want to know when core rejects a declaration, how its Developer Diagnostic reads, and which defects core reports at run time.
- [Diagnostics reference](diagnostics.md): open it when a Developer Diagnostic names a rule identity and you want to know why the rule exists.

## Running

- [Invocation](invocation.md): open it when you follow one run from argv to exit, or call a Command by name with `invoke()`.
- [Graph inspection](graph-inspection.md): open it when a projection reads the built command graph, locates a word, or checks the declarations.
- [Host](host.md): open it when you read what core captures from the host: the working directory, the environment, and the streams.
- [Interaction](interaction.md): open it when a run decides whether it may ask the operator, or an input is required only when it cannot ask.
- [Color](color.md): open it when you need to know how the operator's color choice settles for a run.
- [Verbosity](verbosity.md): open it when you write debug or trace lines, or mark an option that raises or lowers the run's verbosity.
- [Background](background.md): open it when output adapts to the terminal's light or dark background.
- [Signals, cancellation, and shutdown](signals.md): open it when an action or a plugin reacts to Ctrl-C, a signal, cancellation, or a closed pipe, registers a handler that restores the terminal or a child process when a signal ends the process, or restores the terminal on suspend and resume.

## Output

- [Output](output.md): open it when you write to the lanes, draw on stderr, or open a live region with progress events.
- [Views](views.md): open it when you declare a view, override one, or read the view context.
- [Results](results.md): open it when a Command declares a result, emits rows, or names media types.
- [Styles and rendering policy](styles.md): open it when you style marked strings, pick colors and glyphs, or measure, pad, and wrap text.
- [Logging](logging.md): open it when you publish log events, or need to know what core logs.

## Failures

- [Failures](failures.md): open it when you throw a failure class, declare an exit code or failure code, translate an error, or write a message.
- [Failure views and encoders](failure-views.md): open it when you change how a failure renders for a person or encode it for a machine.

## Plugins

- [Plugin contract](plugin-contract.md): open it when you write a plugin: its identity, options, settings, Commands, activation, and environment preparation.
- [Middleware](middleware.md): open it when a plugin acts on an invocation through the middleware chain.
- [Lifecycle hooks](lifecycle-hooks.md): open it when a plugin observes the run through an `on<Event>` hook, judges the built graph, or adds failure hints.
- [Extensions](extensions.md): open it when a plugin attaches typed facts to Commands and inputs, or collects values from other plugins.

## Shipping

- [Release facts](release-facts.md): open it when a run reads how it was built: its version, its channel, or whether it is a development build.
- [Installation record](installation-record.md): open it when you read or write the record of an installed application and the files its install wrote.
