---
type: adr
title: ADR-0135 - A first-party plugin loads a costly built-in module on first use, through one module
description: One module in @loomcli/plugins loads a Node built-in module when a caller first needs it, through process.getBuiltinModule, so a synchronous call can defer a built-in that costs launch time. The module exports one function per built-in it loads and reads nothing else from the process. It joins ADR-0107's exceptions to the process global ban, and the installation module reads node:crypto through it.
status: accepted
created: 2026-11-03
modified: 2026-11-03
---

# ADR-0135 - A first-party plugin loads a costly built-in module on first use, through one module

## Context

ADR-0134 lets launch cost be cut by work that changes no contract, including what plugins evaluate at import. Loading `node:crypto` costs about 7 ms of a Node launch. The installation module imports it statically for two calls: the digest of a file's content and the random part of a staging file's name. Each call is synchronous, as the module states, and its callers rely on that.

The installation module loads at launch whenever a plugin that uses it is installed. The completion, manpage, and mcp plugins import their Commands' implementations statically, and those implementations import the installation module; deferring each implementation with `import()` removes that path. The self-update, service, and skills plugins import the installation module from their plugin modules. The self-update plugin's notice middleware loads on every run, and it imports the installation module to write its cache when the cache is stale. The installation module's file replacement names its staging file with `randomBytes`. An application that installs self-update therefore loads `node:crypto` on every run, though most runs write no cache and hash no file.

An `import()` defers a module, but it is asynchronous, so the calls that use it would become asynchronous. `process.getBuiltinModule` returns a built-in module synchronously and loads it on the first call. Node provides it from 22.3 and Bun provides it at Loom's minimum version, 1.4.4. [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) bans the `process` global in `@loomcli/plugins` and names each exception in the lint rule's configuration.

## Decision

- **One module loads a built-in on first use.** `packages/plugins/src/built-ins.ts` loads a Node built-in module the first time a caller asks for it, through `process.getBuiltinModule`. It exports one function for each built-in it loads, and the function names the module with a literal specifier, so the file shows every built-in that bypasses a static import. It reads nothing else from the process.
- **It joins ADR-0107's exceptions to the `process` global ban.** Its lint override turns off only the `process` global ban. The bans on the global `require`, on `node:os`'s home, user, and temporary-folder calls, and on `node:child_process` stay in force. The module loads none of those built-ins.
- **The installation module reads `node:crypto` through it.** Its digest and its staging names stay synchronous. A run that hashes no file and stages no file never loads `node:crypto`.
- **A static import stays the default.** A first-party module defers a built-in through this module only when the built-in costs measurable launch time and a synchronous caller needs it. A module that runs only when a Command runs imports its built-ins statically.

Loading a built-in module is neither a process fact nor a process effect under ADR-0107. The call returns the module a static import returns, it reads and changes nothing about the process, and no process handle, a mock's included, would answer it differently. ADR-0107's rule that a run's facts and effects go through its handle is unchanged.

## Considered options

- **An asynchronous `import()` in the installation module.** Rejected. The digest, the file replacement, and every call built on them would become asynchronous. That change reaches the completion, manpage, mcp, self-update, service, and skills plugins and the installation record.
- **Deferring the Commands' implementations alone.** Rejected as the whole answer. It keeps the installation module out of most launches, but self-update's notice middleware still reaches it on every run, so an application that installs self-update keeps paying for `node:crypto`.
- **`createRequire` from `node:module`.** Rejected. ADR-0107 bans it, because a `require` reaches `node:child_process` around the rule. It would also load `node:module` for a call that `process` already answers.
- **The Web Crypto global, `globalThis.crypto`.** Rejected. Its digest is asynchronous, so it changes the digest's callers as an `import()` would.
- **A general loader that takes any specifier.** Rejected. One function per built-in keeps the bypassed built-ins in view and keeps the return type of each exact without an assertion.

## Consequences

- An application that installs self-update loads `node:crypto` only on a run that hashes or stages a file, such as one that writes the stale notice cache or runs `self-update`.
- A new built-in deferred this way is a new function in `built-ins.ts`, reviewed against the default above.
- The lint override for `built-ins.ts` sits beside ADR-0107's other exceptions in `vite.config.ts`.

## Status

Accepted on merge. It changes the repository's lint configuration and the installation module, not a contract an author relies on.

## Changelog

- 2026-11-03: Recorded with the change that defers the first-party plugins' Command implementations and `node:crypto` (LM-451). It narrows ADR-0107's clause naming the exceptions to the `process` global ban, which gains this module. ADR-0107 carries a dated entry.
