---
type: adr
title: ADR-0063 - The MCP plugin serves opted-in Commands as tools
description: '@loomcli/plugins/mcp installs a plugin Command, app mcp, whose action serves every Command that carries an mcpCommand value as one MCP tool over stdio, each call run through invoke. Tool names flatten the path, annotations are hints the author owns and Loom never infers, and the protocol is written in a private workspace package pinned to revision 2026-07-28 and compiled into the plugin pack.'
status: proposed
created: 2026-10-05
modified: 2026-10-05
---

# ADR-0063 - The MCP plugin serves opted-in Commands as tools

## Context

An agent that drives a Loom application through the Model Context Protocol reads a list of tools, each with a name, a description, and an input schema, and calls one with a JSON object of arguments. A Loom graph already holds what that list needs: descriptions, input schemas under [ADR-0030](0030-an-input-carries-its-json-schema-as-a-core-graph-fact.md), and with [ADR-0059](0059-a-command-runs-by-name-through-invoke.md) a way to run a Command by name with a structured outcome. What remains is the server, the opt-in, the naming, and the protocol itself.

Under [ADR-0019](0019-plugin-facts-are-descriptor-keyed-extension-values-and-core-owns-the-universal-facts.md), a core fact is one every projection reads with nothing installed. Whether a Command is a tool, an agent-facing wording, and safety hints are read by MCP alone, so they are MCP's extension facts. Media types under [ADR-0061](0061-a-view-declares-its-media-type-and-a-result-publishes-it-by-view-name.md) and control options under [ADR-0062](0062-a-control-option-is-marked-by-the-plugin-that-declares-it-and-core-never-reads-the-fact.md) are core facts this plugin is the first to read.

The protocol's current revision is `2026-07-28`. It removes the `initialize` handshake and `ping`, requires `server/discover`, carries the protocol version and client capabilities in every request's `_meta`, requires `resultType` on every result and `ttlMs` and `cacheScope` on `server/discover` and `tools/list`, and lets `structuredContent` hold any JSON value. The clients agents use today are dual-era: they probe with `server/discover` and send the per-request `_meta` envelope, so a server that speaks `2026-07-28` alone serves them.

## Decision

- **A plugin Command serves MCP.** `mcp()` attaches the visible Command `mcp`, whose action runs a stdio server until stdin ends or the run's signal aborts. Its action reads the graph and calls `invoke` for each tool call, so the server needs no second home for the adapter. An application whose root declares arguments cannot install it, the limit completion has under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md).
- **Opt-in through an extension.** A Command is a tool when it carries an `mcpCommand` value. `mcpCommand` takes an optional `description` and `annotations`, and `mcpInput` and `mcpArgument` override one input's description. An explicit opt-in on a hidden Command wins, an alias is never a tool, and a Command with no action cannot opt in.
- **Tool names flatten the path.** The path joins with `_`, and each `-` becomes `_`, so `scratch create` is `scratch_create`, and the root's tool is the application name written the same way. No override exists. The plugin's `onGraphBuilt` hook, under [ADR-0060](0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md), rejects two opted-in Commands that give one name, an opted-in group, and a tool that would list an argument and an option under one name, in both builds.
- **The input schema is the graph's.** A tool lists every argument and option of its Command, the global options included, keyed by declared name, minus hidden and control options, each carrying its ADR-0030 schema or one derived from its kind. Passthrough is never exposed.
- **A call is an invocation by name.** The plugin splits the arguments into `args` and `options`, selects the first view whose media type is `application/json`, and calls `invoke`. A completed call returns the output and messages as text, and the parsed output as `structuredContent` when the view declares `application/json`. A failed call returns `isError: true` with the failure's own report as text, and `structuredContent` built from the failure's stable identity and exit code. An unknown tool and arguments that are not an object are JSON-RPC errors `-32602`. A cancelled call answers nothing.
- **Annotations are hints the author owns.** `annotations` projects `readOnly`, `destructive`, `idempotent`, and `openWorld` onto the protocol's `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Loom infers none, an unset hint stays unset so the protocol's cautious defaults apply, and nothing but this plugin reads them.
- **The protocol is written in-house, in a private package.** `@loom/mcp` at `packages/mcp` holds JSON-RPC framing, the stdio transport, `server/discover`, per-request version checks, `tools/list`, `tools/call`, `subscriptions/listen`, and cancellation. It knows nothing of Loom, and the plugin speaks MCP only through it. It is never published: the plugin pack's build bundles it into the `mcp` subpath's files, so the published pack carries no dependency on it.
- **One pinned revision.** The package holds one revision constant, `2026-07-28`. A request for another version is answered with `UnsupportedProtocolVersionError`, `-32022`, and a legacy `initialize` with the same error and a message that names `2026-07-28`. Moving to a later revision is a deliberate change to this package.

## Considered options

- **A takeover option, `--mcp`.** Rejected. It would put `invoke` on the middleware context and run the server inside whatever Command the option routed to. A plugin Command gets the action context and runs the server where a reader looks for it.
- **Every Command a tool by default.** Rejected. A tool is a promise to an agent that a Command is safe to call without a human reading its help page, and that choice is the author's. Hidden and plugin Commands such as `completion __complete` would join the list unasked.
- **An exclusion list or a name override at installation.** Rejected. Every application would repeat it, and a second name is one more thing an agent and an operator must reconcile.
- **No safety hints at all.** Rejected, although an effect claim cannot be verified, drifts toward false as code changes, and becomes the input to a client's auto-approval. A client still asks, and the protocol tells it to treat a server's annotations as untrusted unless it trusts the server. An author who knows a Command only reads has no other way to say so, and a hint left unset keeps the cautious default. What Loom keeps from the case against them is that it ships no safety vocabulary of its own, infers nothing from the graph, and projects the hints nowhere but MCP's protocol fields. A false claim is a defect in the author's application, under the rule that Loom does not guard an author's own declarations.
- **The official MCP SDK.** Rejected. It tracks every revision and both eras, depends on a schema library, and is a larger surface to audit than the four methods this server serves. A focused package pinned to one revision is the surface Loom tracks and updates as one deliberate change.
- **Pinning `2025-11-25`, the last handshake-based revision.** Rejected. The clients agents use are dual-era, so the current revision serves them, and starting on the revision the protocol is moving away from would make the first upgrade a migration.
- **Serving both eras.** Rejected. A dual-era server doubles the protocol surface for clients that no longer need it. A legacy client receives an error that names the revision it needs.

## Consequences

An application exposes a Command to agents by adding one extension value, and every rule of the Command, its validation, failures, and exit codes, holds for the call because the call is the Command's own run. A collision or a misplaced opt-in fails every build of the application, not only `app mcp`, so the author meets it at once.

The protocol asks a server to rate limit tool invocations. A stdio server serves the one client that launched it, and Loom adds no limit to an author's work, so an application that needs one applies it in its own actions.

The failed-call structure depends on a stable failure identity defined by its own contract, which lands before this plugin. A later protocol revision is a change to `@loom/mcp` and the plugin's conformance tests, and its effect on clients is stated in that change's fragment.

## Status

Proposed 2026-10-05 with the contract in [MCP](../core.md#mcp). It moves to accepted inside the release PR of the release that ships the implementation: jsonkit serving its opted-in Commands in real MCP sessions over stdio under Node and Bun, the protocol package's conformance tests passing, and `check:packed` serving a session from the packed pack.

## Changelog

- 2026-10-05: Proposed with the contract.
