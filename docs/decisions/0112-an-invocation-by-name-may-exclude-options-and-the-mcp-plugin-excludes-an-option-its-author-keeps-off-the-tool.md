---
type: adr
title: ADR-0112 - An invocation by name may exclude options, and the MCP plugin excludes an option its author keeps off the tool
description: invoke's options gain exclude, the declared names of options the call leaves out of its run. No tier supplies an excluded option, a key of options that names one is an unknown option, and the input-source stage reads no variable for it and never asks the configuration source for it, so it takes its declared default. mcpInput takes { exclude: true } in place of a description, which keeps an option off every tool it would join and passes it under exclude on every tool call, while help, the manifest, completion, and a command line still read it. A required local option that is excluded is a build fault.
status: proposed
created: 2026-10-27
modified: 2026-10-27
---

# ADR-0112 - An invocation by name may exclude options, and the MCP plugin excludes an option its author keeps off the tool

## Context

[ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) lists every argument and option of a tool's Command in its input schema, minus a hidden option and a control option. An author keeps an option off a tool only through `hidden`, which also drops it from help, the manifest, and completion, or through `control`, which states that the option controls the invocation rather than feeding the Command's work. Mimir's commands carry options an operator needs and an agent must not use: `scratch checkpoint --file` and `attach --file` read a path on the server's machine where an agent sends the text itself, and a shared `--ascii` changes only how a terminal renders. Its own MCP server lists none of them.

A tool call is an [invocation by name](0059-a-command-runs-by-name-through-invoke.md), which behaves as the argv that spells its values, so its [input-source stage](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) fills every unfilled option from the server's environment and its configuration file. An option kept off a tool would still read a variable or a configuration key bound to it, and no caller of `invoke` can stop the stage for one option.

## Decision

- **`invoke` may exclude options.** `InvokeOptions` gains `exclude`, the declared names of options the call leaves out of its run: any of the routed Command's local options and of every global option, a plugin's included. No tier supplies an excluded option. A key of `options` that names one is an `UnknownOptionError`, and the input-source stage reads no variable for it and never asks the configuration source for it, so a variable or a configuration key bound to it is a value no input reads. It takes its declared default as any omitted option does, and a required one is the missing-input problem. A name the routed Command's table does not hold is an `UnknownOptionError`, held after the unknown keys of `options` and ahead of those of `args`. The exclusion lasts for the one call: help, the manifest, completion, a command line, and the parent run still read the option.
- **`mcpInput` excludes an option from MCP.** `mcpInput` takes `{ description }` or `{ exclude: true }`, never both, because an excluded option has no property to describe. An excluded option is off every tool it would join, the routed Command's tool for a local option and every tool for a global option, as a hidden option is, and a call that names it is the takes-no-argument error. Every tool call passes the tool's excluded options under `exclude`, so the action reads the declared default whatever the server's environment and configuration hold. Help, the manifest, completion, and a command line show and read it. A hidden option keeps its current behavior.
- **Options alone.** `mcpArgument` is unchanged. Mimir's case is options.
- **A required option cannot be excluded.** A tool's local option that declares `required: true` or `required: 'non-interactive'`, or a content option whose `min` is positive, that is excluded is a build fault of the plugin's `onGraphBuilt` hook, `@loomcli/plugins/mcp/required-input-excluded`, because no call could supply it. A type cannot see an option's `required` key beside an extension value in its `extensions` list. A global option declares no `required` under [ADR-0044](0044-a-global-option-declares-no-presence-rule.md), so every global option may be excluded.

The rules are stated in [Invocation by name](../core/invocation.md#invocation-by-name), [Input sources](../core/input-sources.md), and the [MCP plugin](../plugins/mcp.md)'s **Excluded options**.

## Considered options

- **`hidden`.** Rejected. It keeps the option off help, the manifest, and completion, where an operator still needs it.
- **Excluding an option from the schema alone, while the server's sources still fill it.** Rejected. The owner's ruling: an excluded option is ignored "as if that option doesn't exist", and a variable or configuration value bound to it "is just some random ENV var or config value".
- **Letting an environment or configuration binding satisfy a required excluded option.** Rejected by the owner's ruling, "a required option cannot be excluded", which the rule above follows: an excluded option reads no source in a call.
- **`control`.** Rejected. It is a fact about the option that the manifest publishes, and `--file` feeds the Command's work, so marking it a control option would misstate it. A control option also still reads its environment and configuration in a call.
- **A list of option names on `mcpCommand`.** Rejected. The per-member extension already carries what MCP reads about one option, so the exclusion rides it, and a shared option such as Mimir's `--ascii` is excluded once in its declaration.
- **A new extension.** Rejected for the same reason.
- **A lint rule for the required case.** Not taken. A build fault catches every case the graph reveals, and a lint rule is a separate contract change.

## Consequences

An invocation by name is no longer always the argv that spells its values: a call with `exclude` reads fewer sources than any command line, which argv cannot spell. Every other clause of ADR-0059's equivalence stands.

An application that kept an option off a tool through `hidden` can move it to `mcpInput({ exclude: true })` and show it in help again; the tool call then stops reading that option's environment and configuration values. [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), [ADR-0059](0059-a-command-runs-by-name-through-invoke.md), and [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) carry dated entries.

## Status

Proposed. It moves to accepted with the release that ships `exclude` and `mcpInput({ exclude: true })`, once their in-process tests run under Node and Bun.
