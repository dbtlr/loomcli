---
description: "The MCP plugin: serving an application's opted-in Commands as MCP tools over stdio, and the private protocol package behind it."
---

# MCP plugin

This page documents the MCP plugin, which serves an application's opted-in Commands as tools of a Model Context Protocol server over stdio, and the private protocol package behind it. An author installs it so an agent client can call those Commands as tools.

```ts
// @loomcli/plugins/mcp
import type { Plugin } from '@loomcli/core';

export declare function mcp(): Plugin;
```

```ts
// @loomcli/plugins/mcp/extension, declarations alone
import type { Extension, StandardSchemaV1 } from '@loomcli/core';

// The value an author gives mcpCommand.
// The package exports no name for this shape.
interface McpCommandInput {
  readonly description?: string; // the tool's description, in place of the Command's
  readonly annotations?: {
    readonly readOnly?: boolean; // projected as readOnlyHint
    readonly destructive?: boolean; // projected as destructiveHint
    readonly idempotent?: boolean; // projected as idempotentHint
    readonly openWorld?: boolean; // projected as openWorldHint
  };
}
export declare const mcpCommand: Extension<'command', StandardSchemaV1<McpCommandInput>>;
export declare const mcpInput: Extension<'option', StandardSchemaV1<{ readonly description: string }>>;
export declare const mcpArgument: Extension<'argument', StandardSchemaV1<{ readonly description: string }>>;
```

```ts
import { Application, Command } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpArgument, mcpCommand } from '@loomcli/plugins/mcp/extension';

import { getValue } from './actions/get-value.js';

export const get = new Command('get', {
  description: 'Read one value at a path.',
  extensions: [mcpCommand({ annotations: { openWorld: false, readOnly: true } })],
})
  .argument('path', {
    description: 'Dot path to read.',
    extensions: [mcpArgument({ description: 'A dot-separated path from the document root, such as user.name.' })],
    required: true,
  })
  .option('file', {
    description: 'The document to read.',
    required: true,
    short: 'f',
    stdin: true,
    type: 'content',
  })
  .action(getValue);

export const jsonkit = new Application('jsonkit', { plugins: [mcp()] }).command(get);
```

An MCP client launches `jsonkit mcp` and speaks one JSON-RPC message per line over its stdin and stdout. Against jsonkit itself, whose `get` declares a local native content `--file` and whose Application declares its version and description, the first line below is the client's request and the second is the server's answer:

```text
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"name":"get","arguments":{"path":"user.name","file":"doc.json"}}}
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"\"Ada\"\n"}],"isError":false,"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"jsonkit","version":"0.9.0","description":"Read and reshape one JSON document."}}}}
```

`mcp()` is the MCP plugin. It serves every Command that opts in as one tool of a [Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28) server over stdio, and it runs each tool call through [`invoke`](../core/invocation.md#invocation-by-name), so a call is the Command's own run with the same validation, failures, and exit codes. MCP is a projection: a tool listing is the graph's facts for the Commands that opted in, and nothing in core knows the protocol. The protocol itself lives in a private package the plugin pack compiles into its own files. [ADR-0063](../decisions/0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) records the decision.

- **The plugin.** Its identity is `@loomcli/plugins/mcp`. `mcp()` takes no settings and declares no option, no middleware, and no view, and it claims no slot. It contributes one [plugin Command](../core/plugin-contract.md#plugin-commands), the three extensions above, and an [`onGraphBuilt`](../core/lifecycle-hooks.md#judging-the-built-graph) hook. The Command is `mcp`, visible, with the description `Serve this application's tools to an MCP client over stdin and stdout.`, no arguments, no options, and no result. A root that declares arguments cannot hold children, so such an application cannot install the plugin, the limit [completion](completion.md) has under [ADR-0033](../decisions/0033-a-plugin-attaches-ordinary-commands-to-the-root.md).
- **Opt-in.** A Command is a tool when it carries an `mcpCommand` value, and only then. The root opts in through the Application's `extensions`. An explicit opt-in wins over `hidden`, so a hidden Command that carries the value is a tool, and the listing in help, the manifest, and completion still omits it. A deprecated Command that opts in is a tool whose description opens with its migration message. An alias is never a tool and never a second name. A Command with no action cannot serve a call, so `mcpCommand` on a group is a build fault.
- **Tool names.** A tool's name is the Command's path joined by `_`, with each `-` written as `_`, so `scratch create` is `scratch_create` and `cache clear-all` is `cache_clear_all`. The root's tool is the application name written the same way, so `git-lfs` serves `git_lfs`. A [portable name](../glossary.md#names-and-routing) holds nothing else the protocol's tool-name characters exclude, and `.` stays. There is no name override. Two opted-in Commands that give one name, such as the root and a child named like the application, are a build fault that names both.
- **The description.** A tool's description is the `mcpCommand` value's `description`, or else the Command's core `description`, the Application's at the root. With neither, the tool carries no description. A deprecated Command's description opens with `Deprecated: ` and its migration message, then a line break and the rest. The `mcpCommand` value's `description` is prose under the pack's prose rule: every line holds a character other than whitespace, and line breaks are kept. A core description and a migration message are one line each, so each line break the author wrote in one, CRLF or a single terminator, reads as one space; an input's core description and the server identity's description read the same way.
- **Annotations.** `annotations` projects onto the protocol's tool annotations, `readOnly` as `readOnlyHint`, `destructive` as `destructiveHint`, `idempotent` as `idempotentHint`, and `openWorld` as `openWorldHint`. An unset hint is omitted, so the protocol's own defaults apply, and a tool with none set carries no `annotations`. They are hints the author owns and Loom never verifies: Loom infers none from the graph, and nothing but this plugin reads them, neither core nor help nor the manifest. A false claim is a defect in the author's application, and the protocol tells a client to treat annotations from a server it does not trust as untrusted.
- **The input schema.** A tool's `inputSchema` is `{ type: 'object', properties, required, additionalProperties: false }`, with `required` left out when it is empty. `properties` holds every argument of the routed Command in declaration order, then its local options in authoring order, then every global option in graph order, keyed by declared name, minus a [hidden](../core/commands.md#hidden-and-deprecated-members) option and a [control option](../core/commands.md#control-options). Passthrough is never exposed.
  - Each property is the input's [input schema](../core/validation.md#input-schema) without its top-level `$schema` key, because the property lives inside a schema whose dialect is the protocol's default, JSON Schema 2020-12, the target the converter answers. Where the graph holds `null`, the property is derived from the node: `{ type: 'string' }` for a string option or an argument, `{ type: 'boolean' }` for a Boolean option, and `{ type: 'integer', minimum: 0 }` for a counted option. A multiple option or a variadic argument wraps its value's schema as `{ type: 'array', items: <schema> }`.
  - The plugin sets `description` from the input's `mcpInput` or `mcpArgument` value, or else its core description, and a deprecated option's opens with `Deprecated: ` and its message, as a tool's does. It sets `default` from a declared default that is plain JSON data and leaves it out otherwise. Either key replaces one the converter wrote.
  - `required` lists each required argument and each required local option, in property order, a local option that declares `required: 'non-interactive'` included, because a tool call is never [interactive](../core/interaction.md). A global option is never required.
  - A Command whose tool would list an argument and an option under one name, a global option included, is a build fault, because a tool's arguments are one object. An author's argument and option may share a name everywhere else.
- **A call.** `tools/call` names a tool and passes `arguments`, an object or nothing. The plugin checks each key against the tool's `properties`: a key outside them, a hidden or control option's name included, is a tool execution error whose text is `Tool "get" takes no argument "x". Use a property its input schema lists.`, as the one text item with `isError: true` and no `structuredContent`, and no run starts. Otherwise the plugin splits the object, a key that names an argument going under `args` and every other key under `options`, and calls `invoke(path, { args, options }, { failure, signal, view })`. `view` is the first view, in record order, whose [media type](../core/results.md#media-types) is `application/json`, and it is omitted when the Command declares no result or no such view. `signal` is the call's own, which `notifications/cancelled` aborts. Values are not checked against the schema: [lowering](../core/invocation.md#invocation-by-name), the validators, and the run's own faults judge them and report by name.
- **A completed call.** `isError` is `false`, and `content` holds `output` as one text item and then `messages` as another, each only when it is not empty, or one empty text item when both are. When the view the plugin selected declares `application/json`, `structuredContent` is `output` parsed as JSON, any JSON value; when `output` does not parse, because a view's media type is a promise core never checks, the result carries the text alone. A `jsonl` view's output stays text. No content item carries annotations.
- **A failed call.** `isError` is `true`, and `content` holds `messages`, then any partial `output`, each only when it is not empty. The text is the failure's own report, by build, with no command-line hint, so a model reads what went wrong and what to do instead, and a defect in a distributed build reads the generic defect message. `structuredContent` is what the plugin's failure handler returns, `{ exitCode, failure }`: the outcome's exit code and the handler context's [failure form](../core/failures.md#the-failure-form), `{ code, exitCode, message, hints }`. The form follows the build, so a defect in a distributed build reads `internal` and `Something went wrong.`, and its hints are the by-name hints, with no command-line hint. The handler exposes no cause and no stack. With both `messages` and `output` empty, as under an override view that renders nothing, `content` holds one empty text item, as a completed call's does.
- **Progress.** When a `tools/call` request carries `params._meta.progressToken`, a string or a number, the plugin passes `onProgress` to that call's `invoke`, and each [progress event](../core/output.md#progress-events) of the call becomes one `notifications/progress` on the token. `progress` is always a per-call counter, the number of events the call has delivered, this one included, so every event is sent and `progress` always increases. The notification carries no `total`. `message` carries the event's label, its counts, and its state, joined by single spaces: the label when it is not empty, then the counts when the event carries `completed`, `completed/total` with a total and `completed` alone without one, and no counts for an event that carries `total` without `completed`, each number written as JavaScript's `String` writes it, then the state in parentheses, such as `Fetching packages 3/8 (updated)`, `Fetching packages 8/8 (ended)`, `Building the index (started)`, or `(started)` for an event with no label and no counts. Progress lines that run at once in one call share its token and its counter. A call without a token passes no observer and receives no notification. The [protocol package](#the-protocol-package) sends none after the call's response or its cancellation, so a cancelled call's `cancelled` event sends nothing. The progress line's start and end lines still land in `messages`, which the result carries as text.
- **A cancelled call.** The server sends no response for it, as the protocol asks.
- **Protocol errors.** The plugin answers these as JSON-RPC errors rather than tool results, because no run started:

  | Request                                                | Error                                                                                       |
  | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
  | `tools/call` naming no tool the server lists           | `-32602`, `Unknown tool "gte". Call tools/list for the tool names.`                         |
  | `tools/call` whose `arguments` is not an object        | `-32602`, `Tool "get" arguments must be an object. Supply a JSON object of named inputs.` |
  | `tools/list` with a `cursor`                           | `-32602`, `The cursor is not one this server issued. Call tools/list without a cursor.`     |
  | Every protocol rule of the private package             | The codes [The protocol package](#the-protocol-package) states                              |

- **Discovery.** `server/discover` answers `supportedVersions: ['2026-07-28']`, `capabilities: { tools: {} }`, with no `listChanged` because the tool list never changes while the process runs, and no `logging`, `prompts`, `resources`, or `completions` capability. The application's identity is the server's: every result's `_meta` carries `io.modelcontextprotocol/serverInfo` as `{ name, version, description }`, the graph's `name` and `version` and the Application's description, which is left out when it declares none. The result carries no `instructions`, because Loom holds no fact that guides a model beyond the descriptions.
- **The listing.** `tools/list` answers every tool in one page, in graph order: the root first, then each Command depth first in authoring order. It carries no `nextCursor`. `server/discover` and `tools/list` each carry `ttlMs: 0` and `cacheScope: 'private'`, so a client caches neither: a client may outlive the server process, and the next process may serve a newer application whose tools differ.
- **Concurrency.** Calls may overlap. Each runs through its own `invoke`, and the server writes each response when its call settles. Loom adds no queue, limit, or timer, so an application whose actions cannot overlap serializes its own work.
- **The server's life.** The `mcp` action reads `host.stdin` and writes `host.stdout`, and stdout carries protocol messages alone, each written whole. The server writes no log of its own, and stderr carries dotenv warnings when that plugin is installed, a fault the `mcp` run itself reports and what an installed [`onLog`](../core/lifecycle-hooks.md#observing-log-events) hook writes to its destination's stderr, such as the [logging plugin](logging.md)'s console records. When stdin ends, the server aborts every call in flight and answers none of them, waits for each to settle, ends each open subscription with its closing response, and returns, so the run exits 0. When the run's signal aborts, through a caller or a [signals owner](../core/signals.md), every call's signal aborts with it, the server answers nothing more, and the run resolves its cancellation code. A plugin that writes to stdout on a run it does not own breaks the stream, as it breaks [completion](completion.md)'s answer.
- **Names.** `mcp` is exported from `@loomcli/plugins/mcp`, and `mcpCommand`, `mcpInput`, and `mcpArgument` from `@loomcli/plugins/mcp/extension`, whose identities are `@loomcli/plugins/mcp/command`, `@loomcli/plugins/mcp/input`, and `@loomcli/plugins/mcp/argument`. `mcpCommand` is an ordinary extension, so a later value replaces an earlier one. The pack's public declarations name no protocol type.

## MCP build faults

The plugin's `onGraphBuilt` hook judges the opted-in Commands on every build, a run that never serves a tool included, and throws a `DeclarationError` under a rule of its own, which reports as itself under [Judging the built graph](../core/lifecycle-hooks.md#judging-the-built-graph).

- **Tool name taken.** Two opted-in Commands never give one tool name, such as the Command `scratch create` and a Command named `scratch_create`: [`@loomcli/plugins/mcp/tool-name-taken`](../core/diagnostics.md#loomclipluginsmcptool-name-taken).
- **Tool without action.** `mcpCommand` is never on a Command with no action, such as a group: [`@loomcli/plugins/mcp/tool-without-action`](../core/diagnostics.md#loomclipluginsmcptool-without-action).
- **Property name taken.** A tool never lists an argument and an option under one name, a global option included: [`@loomcli/plugins/mcp/property-name-taken`](../core/diagnostics.md#loomclipluginsmcpproperty-name-taken).

## When author code fails

An action that throws or rejects during a tool call takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an action's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The call answers as the failed call above does: `isError` is `true`, the text is the failure's own report, and `structuredContent` is `{ exitCode, failure }` with its failure form under `failure`, so a defect in a distributed build reads `internal` and `Something went wrong.` A throw while the protocol package handles a request is answered with `-32603`, and the server keeps serving.

## The protocol package

The protocol is written in this repository, in the private workspace package `@loom/mcp` at `packages/mcp`, which is never published. It knows MCP and nothing of Loom, and the plugin speaks MCP only through it.

- **One revision.** The package holds one named constant, the protocol revision `2026-07-28`, and the protocol types of that revision alone. Moving to a later revision is a deliberate change to this package and the plugin's tests, never a dependency update.
- **Framing.** The stdio transport reads newline-delimited JSON-RPC 2.0 messages and writes each message as one line of `JSON.stringify` output with no indentation, followed by a line feed, so no message holds an embedded line break. A blank line, one that holds nothing but spaces, tabs, and carriage returns, is ignored. Any other line that is not JSON is answered with `-32700`, and a message that is not a JSON-RPC request or notification, a batch included, with `-32600`. A response from the client is ignored. A last line that ends without a line feed when stdin ends is read as one message.
- **Request ids.** A request whose id matches a call or a subscription still in flight is answered, before every other check, with `-32600` and a message naming the id in use, such as `The request id 7 is in use by a request still in flight. Send each request with an id no request in flight holds.` The request in flight keeps the id and runs untouched, so its answer stays the only one under that id and shutdown still waits for it. An id is free again once its request settles or the client cancels it.
- **Per-request checks.** Every request carries `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` in its `params._meta`, and the server relies on no earlier request. A request missing either is answered with `-32602`. A request for any version other than `2026-07-28` is answered with `UnsupportedProtocolVersionError`, `-32022`, whose `data` is `{ supported: ['2026-07-28'], requested }`.
- **A legacy client.** An `initialize` request is answered, before the checks above, with `-32022` and `data` `{ supported: ['2026-07-28'], requested }`, where `requested` is the request's own `protocolVersion` when it holds a string and `""` otherwise, because the protocol requires the field, and with the message `Unsupported protocol version. This server speaks MCP 2026-07-28, which has no initialize request; use a client that supports protocol version 2026-07-28.` A client that speaks both eras probes with `server/discover` and never sends it.
- **Methods.** The package serves `server/discover`, `tools/list`, `tools/call`, and `subscriptions/listen`, answers every other method, `ping` included, with `-32601` before the per-request checks, so a `ping` without `_meta` answers `-32601`, and stamps `resultType: 'complete'` and the server's identity in `_meta` on every result. `subscriptions/listen` is acknowledged by `notifications/subscriptions/acknowledged`, its first message, with an empty `notifications` filter and `_meta['io.modelcontextprotocol/subscriptionId']` set to the request's id, and the server sends no other notification on it, because it offers no notification type. It stays open until the client cancels it or the server shuts down. A `tools/call` whose `params.name` is not a string is answered with `-32602`. A throw while the server handles a request is answered with `-32603`, and the server keeps serving.
- **Cancellation.** `notifications/cancelled` aborts the request it names and suppresses its response. A notification for an unknown or settled request is ignored. Every other notification is ignored.
- **Progress.** A `tools/call` handler receives a function that sends progress when the request's `params._meta` carries a `progressToken`, a string or a number, and no function otherwise. Each call of it writes one `notifications/progress` whose params hold the token as `progressToken`, the given `progress`, and the given `total` and `message` when present, and the package passes each one on as given, because its caller keeps `progress` increasing as the protocol requires. It writes none once the call is answered, cancelled by the client, or aborted by shutdown or the run's signal.
- **Shutdown.** When stdin ends, the package stops reading, aborts every call in flight, waits for each to settle, sends `notifications/cancelled` naming each open subscription, answers it with its closing result, whose `_meta` carries `io.modelcontextprotocol/subscriptionId` beside the server's identity, and resolves, so the caller returns. A call shutdown aborts answers nothing, as a call the client cancels answers nothing, while a `server/discover` or `tools/list` still pending is answered. A write the client can no longer read, such as one after it closed its end of the pipe, is dropped, and the run still resolves.
- **The run's signal.** `run(input, output, { signal })` takes an optional `AbortSignal`, through which the caller ends the run early. When it aborts, before or after stdin ends, the package stops reading, aborts every call, answers nothing more, an open subscription's closing result included, and resolves once each call has settled. A signal already aborted when the run starts ends it before it reads anything.
- **Bundled into the pack.** `@loomcli/plugins` lists `@loom/mcp` as a development dependency alone. The pack keeps `tsc` for every subpath, and its build then bundles the `mcp` subpath's emitted entry with Rolldown, inlining `@loom/mcp` and leaving `@loomcli/core` and the pack's own modules external, so the packed tarball names no dependency on the private package.
