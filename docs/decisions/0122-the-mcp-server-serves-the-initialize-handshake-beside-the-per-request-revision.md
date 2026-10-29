---
type: adr
title: ADR-0122 - The MCP server serves the initialize handshake beside the per-request revision
description: '@loom/mcp serves MCP 2026-07-28 per request and, for a client that opens with initialize, the initialize-era revisions 2025-11-25 and 2025-06-18 on the same connection. A request whose params._meta names a protocol version is served on 2026-07-28; any other is served on the revision initialize negotiated, in that revision''s shape. This narrows ADR-0063''s one pinned revision and withdraws its rejection of serving both eras.'
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0122 - The MCP server serves the initialize handshake beside the per-request revision

## Context

[ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) pinned `@loom/mcp` to revision `2026-07-28` and rejected serving both eras because "the clients agents use today are dual-era: they probe with `server/discover`". Codex CLI is not. It opens with `initialize` on `2025-06-18`, the server answers `-32022`, and Codex reports the tool unavailable, while `mcp install` registers the server with Codex by default under [ADR-0111](0111-the-mcp-plugin-registers-its-server-with-claude-code-and-codex-through-each-agents-cli.md). So every application that installs the plugin gets a Codex registration that can never serve. The owner ruled that the server serves the handshake era, rather than `mcp install` skipping Codex.

The protocol allows this. Revision `2026-07-28` says a server that supports both legacy and modern clients "MAY implement both behaviors", that it "selects its behavior from how the client opens", with an `initialize` request selecting legacy semantics scoped to the stdio process, and that it "MAY serve both eras concurrently on the same endpoint or process". The initialize-era lifecycle requires a server that does not support the version a client asks for to answer with another version it supports, the latest.

## Decision

- **Two eras, one server.** `@loom/mcp` serves `2026-07-28` per request and the initialize-era revisions `2025-11-25` and `2025-06-18`. For a server that serves tools alone the two initialize-era revisions answer alike, except that `2025-06-18`'s implementation info has no description. `2025-03-26` and `2024-11-05` are not served: a client that asks for one is answered with `2025-11-25`, and disconnects if it cannot speak it.
- **The request picks the era.** A request whose `params._meta` names `io.modelcontextprotocol/protocolVersion` is served on `2026-07-28` with ADR-0063's per-request checks and shapes, whether or not the connection was initialized. Any other request is served on the revision the connection's `initialize` negotiated.
- **`initialize` negotiates once.** It answers the version the client asked for when the server serves it, and otherwise `2025-11-25`, with the `tools` capability and the server's identity. A request with no version string or no capabilities object answers `-32602`, and a second `initialize` answers `-32600`.
- **The initialize era serves its own methods.** An initialized connection serves `ping`, `tools/list`, and `tools/call`, and answers any other method without per-request `_meta` with `-32601`. `ping` answers at any time, before `initialize` too. Before `initialize`, a tool request without per-request `_meta` answers `-32602`, naming both ways to open the connection.
- **Results take the shape of their revision.** An initialize-era result carries no `resultType` and no server identity in `_meta`, and `tools/list` carries no `ttlMs` or `cacheScope`. Those revisions hold `structuredContent` as a JSON object alone, so a tool result whose structured content is any other value leaves it out, and the text content, which already carries the same JSON, stands alone. Progress and cancellation work the same in both eras.
- **Every answer that lists versions lists all three.** `server/discover`'s `supportedVersions` and the data of `-32022` list `2026-07-28`, `2025-11-25`, and `2025-06-18`, as the protocol's own `-32022` example lists an initialize-era revision beside the current one.

## Considered options

- **`mcp install` skips Codex and says why.** Rejected by the owner's ruling of 2026-10-28, which chose serving the handshake era instead.
- **Every revision since `2024-11-05`.** Rejected. `2025-03-26` has no structured content or tool titles, and `2024-11-05` no tool annotations or progress messages, so each adds result shapes, while version negotiation already answers their clients with a revision they can refuse.
- **Wrap structured content that is not an object, such as `{ result: [...] }`.** Rejected. The wrapper is a shape Loom would invent, which no output schema describes, and the text content already carries the value.

## Consequences

The protocol package doubles part of its surface, the trade ADR-0063 rejected, because one of the two agents ADR-0111 registers with needs it. The handshake era is a change to `@loom/mcp` and its conformance tests alone: the plugin's handler still receives one tool call and answers one result, whatever the era. When the protocol retires the initialize era and Codex adopts `2026-07-28`, dropping it is a change to the same package. [MCP plugin](../plugins/mcp.md#the-protocol-package) carries the contract. LM-425 carries the work.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-30: Proposed with the fix (LM-425). It narrows ADR-0063's "One pinned revision" to the per-request revision and withdraws ADR-0063's rejection of serving both eras, whose premise Codex falsifies. ADR-0063 carries a dated entry.
