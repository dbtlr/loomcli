---
type: adr
title: ADR-0003 - A run is asynchronous on tokio, and an action is an async closure
description: Actions, middleware, provider openers, and environment hooks are async. Core depends on tokio for signals, child programs, timers, and cancellation. Application::main builds a runtime for an author who has none.
status: accepted
created: 2026-11-12
modified: 2026-11-12
---

# ADR-0003 - A run is asynchronous on tokio, and an action is an async closure

## Context

The reference is asynchronous throughout: an action awaits, a middleware awaits `next()`, a provider opens and closes around the action, the MCP server runs overlapping tool calls and cancels one on request, a signal starts a shutdown bounded by a deadline, and a live region redraws while work proceeds. Each of these has a direct tokio counterpart: `CancellationToken` for the run signal, `tokio::process` for `host.spawn`, `tokio::time` for the shutdown budget, and tasks for overlapping calls. Process signals are the exception: `tokio::signal` never removes a handler it installed, so a re-raised `SIGINT` could not end the process and a raised `SIGTSTP` could not stop it. The real process handle registers signals through `signal-hook`, whose default-action emulation ends or stops the process when a signal arrives that nothing listens for, as the reference's re-raise does.

A run is asynchronous, and core depends on tokio. An action is an async closure, `async |ctx| { ... }`, and synchronous work is written inside it unchanged, so there is one way to declare an action. `Application::run` is a future the author's runtime drives. `Application::main` builds a current-thread runtime and returns `std::process::ExitCode`, for an application with no runtime of its own.

Handlers and the futures they return are `Send + 'static`, the bound the ecosystem's async frameworks use, so a plugin may run invocations on tasks. Stable Rust cannot yet bound an `AsyncFn` closure's future by `Send`, so the bound is `Fn(Context) -> Fut` with `Fut: Future + Send`. An `async fn` item and a closure that captures nothing fit it directly; a handler that captures state clones it into the future it returns, `move |ctx| { let shared = shared.clone(); async move { ... } }`.

Core never calls `std::process::exit`. A run resolves an exit code and returns it, as the reference does.

## Considered options

- **A synchronous core with threads.** Rejected. Cancellation, bounded shutdown, overlapping MCP calls, and provider lifetimes would each need a hand-built mechanism, and an application that performs network I/O, which most agent-facing tools do, would bridge to a runtime inside every action.
- **A runtime-agnostic asynchronous core.** Rejected. Signals, child programs, and timers have no portable interface, so core would carry its own reactor shims. tokio is the standard the principle "standards before inventions" points to.
- **Separate methods for sync and async actions.** Rejected as two mechanisms for one concept.

## Consequences

Every Loom application links tokio. The cost is compile time and binary size, accepted for a framework whose applications serve MCP and manage child programs. Validators stay synchronous, a recorded deviation: a validator judges one string, and the reference's asynchronous validators have no first-party user.

## Status

Accepted on 2026-11-12. The code that enforces this record has landed: a run is a future on tokio, `Application::main` builds a current-thread runtime, `Application::main_async` runs inside the author's, and the real process handle reaches signals through `signal-hook`.
