---
type: adr
title: ADR-0108 - An action receives provided values from the providers its Command opts in to
description: A provider is a value of its own that hands an action a typed value. A Command opts in through uses, and its action reads each value under provided. No plugin or Application installs a provider. An ephemeral value lasts one run and a persistent one the outermost run, shared by nested invoke. A provider reads global options alone. Core builds what the routed Command opted in to at the dispatch boundary and closes it when the action settles, through close or the disposal protocol. Middleware is unchanged.
status: accepted
created: 2026-10-25
modified: 2026-10-27
---

# ADR-0108 - An action receives provided values from the providers its Command opts in to

## Context

An action reaches a plugin only through the plugin's global option values and the extension values on the graph. A plugin package cannot hand application code a typed value, such as a database pool, an authenticated session, or data derived from validated global options, and an author has no place to write a setup once beside its cleanup. [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) deferred a typed context contribution and a lazily acquired resource with core-owned disposal, and [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) deferred typed context contributions from middleware into the action.

The design recorded for those deferrals carried a contribution through middleware: a middleware passed a typed value to `next()`, and core merged it into the context of every later middleware and the action. That loads a second job onto the chain, which only wraps a run, and types every action through the installed plugin tuple, which leaves a library Command or a plugin Command untyped. The case for a lazy resource has also moved: validation now runs ahead of middleware, so no value is opened for a run that then fails validation. What remains is a run whose action never reads the value.

Crust reached a related design: a Context is a named capability with dependencies, a Command lists the Contexts it requires, checked when it is added under a parent, a Command above it provides them to its descendants through `.provide()`, only the closure the resolved Command requires is constructed, and values that implement `Symbol.dispose` or `Symbol.asyncDispose` are cleaned up in reverse order.

## Decision

- **A provider gives; a middleware wraps.** A provider is a frozen value `provider(name, definition)` returns. It has a name, a lifetime, the providers it `uses`, a `load` that imports its opener's module, and an optional `close(value)`. Middleware is unchanged: `next()` takes no argument, and a middleware never sees a provided value.
- **Opting in is the connection.** A Command lists the providers it reads in `uses` in its options object, and the Application lists them for its root's own action in its constructor's options. A provider lists the providers it reads the same way. No plugin or Application installs a provider, so a package exports providers beside its plugin and a Command builds only what it reads.
- **`provided` on the action context.** The action reads each opted-in value under `provided`, keyed by its provider's name, never as a top-level context key. A provider a listed provider uses is built and not provided.
- **The declaration states the types.** The provider's declaration annotates its type, `Provider<Name, Value, Globals, Lifetime, Uses>`, and `provider()` checks the definition against it. The opener module's default export types itself from the declaration, `Opener<typeof pool>`, through a type-only import, as a middleware module types itself from its plugin. The annotation breaks the type cycle.
- **A provider reads global options alone.** Its opener receives the validated global options it states in its type, `provided` with the values of the providers it uses, the host, `log`, the signal, and `onShutdown`. It receives no `out`, no prompts, and no request, and never a Command's local inputs. Opting in adds the globals of every provider a list reaches to the Command's global requirements, and `command()` passes a child's requirements up to its parent, so `command()`'s existing attach constraint rejects an Application that lacks them wherever the Command sits. The root's own opt-ins are checked at its `action()` call, and a plugin's Commands may require only that plugin's options, checked at `plugin()`.
- **Two lifetimes.** An ephemeral value, the default, is built at its run's dispatch boundary and lasts that run, so a nested `invoke` builds its own. A persistent value is built the first time a run inside the outermost run needs it, is shared by every nested `invoke` in that outermost run, and lasts the outermost run. Two first uses at once share one build. An ephemeral provider may use a persistent one, and the types reject the reverse.
- **Built at the dispatch boundary.** After the chain's last middleware continues and core has raised no held fault and found the view selection good, core builds the routed Command's closure, one value at a time, dependencies first. A takeover, a held fault, and a run cancelled before the boundary build nothing.
- **Closed when the action settles.** Core closes each value through the provider's `close` when it declares one, else `Symbol.asyncDispose`, else `Symbol.dispose`. After the action settles and its open regions close, the run's ephemeral values close, then, on the outermost run, its persistent values, each lifetime in reverse build order and each close awaited, before the chain unwinds. On a shutdown the closes run inside [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md)'s budget.
- **Failures are ordinary.** An opener or `load` that throws takes the ordinary failure path after core closes what it built. A throwing close fails a run that had otherwise succeeded, and on a run that already failed or was cancelled it is an `error` log event, as a failing `onShutdown` handler is.
- **Types reject the author's mistakes.** `provider()` checks its definition against the declaration's annotation, an omitted `lifetime` or `uses` included. Two different providers with one name in a closure are a type error at the opt-in. Two providers with one name and one type, which the types cannot tell apart, are a declaration fault where the list is declared. A child does not inherit its parent's opt-ins.
- **Not a graph fact.** An opt-in is not part of the graph [ADR-0010](0010-one-graph-serves-runtime-and-projections.md) builds, and the globals a provider reads are already ordinary global options.
- **Tests mock modules.** A test substitutes a provider through its test runner's module mocking of the opener's module. Core adds no member that supplies a value to `run()` or `invoke`.

## Considered options

- **A typed contribution through `next()`.** Rejected. It complicates middleware with a second job, and typing actions through the plugin tuple carries every installed plugin's contribution into every action's type and leaves library and plugin Commands untyped.
- **Installing a provider through a plugin or the Application.** Rejected. A provider is used only by the Commands that opt in, so installation adds a step that connects nothing.
- **One lifetime per action.** Rejected. An MCP server's tool calls are nested invocations, and rebuilding a pool on every call is waste while sharing a session across calls serves stale data.
- **A process lifetime.** Rejected. No point after the outermost run can await a close: `onShutdown` handlers are synchronous, and an unclosed pool keeps the event loop alive after `run()` resolves.
- **Building on first access inside the action, or before the chain.** Rejected. A getter cannot await an asynchronous open, and a build before the chain opens values for a takeover and invites middleware to depend on them.
- **Inferring the provider's types from the opener's module.** Rejected. Every other lazily loaded module in Loom types itself from its declaration, so a second direction would be drift.
- **Disposal through the protocol alone, or through `close` alone.** Rejected. The protocol alone forces a wrapper on every value that lacks it, so the action reads the wrapper. `close` alone ignores a protocol the value already carries. A disposal stack handed to the opener was rejected because Node 22, which core supports, has none.
- **A `supply(provider, value)` member on `run()` and `invoke`.** Rejected. Module mocking already substitutes a provider's opener.
- **Closing persistent values after the chain unwinds.** Rejected. Middleware cannot reach a provided value, so nothing gains, and a failing close would arrive after `next()` had resolved.

## Consequences

A plugin package hands application code a typed value through a provider it exports, and a library or plugin Command is typed by its own opt-ins without registration. The provider annotation is the first place a library states a global requirement, so a Command now passes its children's requirements up to its parent, and a plugin's `commands` accepts a Command whose requirements its own options meet. Core gains a provider value kind, `uses` on Command and Application options, `provided` on the action context, a build step at the dispatch boundary, and two lifetime scopes. Adding `provided` to the action context and `uses` to the options is an addition to core-built objects, not a breaking change. Editor latency grows with the action context type, which the implementation measures. The first consumer is the configuration plugin's structured values.

## Status

Accepted in 0.16.0.

## Changelog

- 2026-10-25: Proposed. Closes ADR-0017's deferred typed context contribution and lazily acquired resource, and ADR-0028's deferred typed context contributions from middleware into the action. Both carry dated entries.
- 2026-10-27: Two different providers with one name and one type, such as two values one generic factory returns, pass the types, so core rejects them at the declaration (LM-412).
