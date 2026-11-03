---
type: adr
title: ADR-0135 - The plugins package loads a costly built-in module on first use, through one module
description: One module in @loomcli/plugins loads a Node built-in module when a caller first needs it, through process.getBuiltinModule, so a synchronous call can defer a built-in that costs launch time. The module exports one function per built-in, each naming its module with a literal specifier, and reads nothing else from the process; a test pins the specifiers it may name. It joins ADR-0107's exceptions to the process global ban, and the installed-files module reads node:crypto through it.
status: accepted
created: 2026-11-03
modified: 2026-11-03
---

# ADR-0135 - The plugins package loads a costly built-in module on first use, through one module

## Context

ADR-0134 lets launch cost be cut by work that changes no contract, including what plugins evaluate at import. Loading `node:crypto` costs a fresh process a few milliseconds, measured on Node 24 and Bun 1.4.4 as the wall-clock difference between a module that imports it and one that does not. The installed-files module imports it statically for two calls: the digest of a file's content and the random part of a staging file's name. Each call is synchronous, as the module states, and its callers rely on that.

The installed-files module loads at launch whenever a plugin that uses it is installed. The completion, manpage, and mcp plugins import their Commands' implementations statically, and those implementations import the installed-files module. The completion plugin's declaration also reads its shell names from a module that imports it. The self-update plugin's module imports it directly. The service and skills plugins reach it through their Commands' implementations too. The self-update plugin's notice middleware loads on every run, and it imports the installed-files module to write its cache when the cache is stale. The installed-files module's file replacement names its staging file with `randomBytes`. An application that installs self-update therefore loads `node:crypto` on every run, though most runs write no cache and hash no file.

An `import()` defers a module, but it is asynchronous, so the calls that use it would become asynchronous. `process.getBuiltinModule` returns a built-in module synchronously and loads it on the first call. Node provides it from 22.3, and Bun provides it at Loom's minimum version, 1.4.4. [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) bans the `process` global in `@loomcli/plugins`, and the lint rule's configuration names each exception. The same configuration bans the global `require` and `createRequire` from `node:module`, because a `require` loads `node:child_process` around the ban on importing it.

## Decision

- **One module loads a built-in on first use.** `packages/plugins/src/built-ins.ts` loads a Node built-in module the first time a caller asks for it, through `process.getBuiltinModule`. It exports one function for each built-in it loads, and each function names its module with a literal specifier. It reads nothing else from the process.
- **A test pins the specifiers.** `getBuiltinModule` reaches any built-in, the ones the lint rule bans included, so a test reads the module's source and pins the exact set of specifiers it names. The set never includes `node:child_process`, `node:os`, `node:module`, or `node:process`, under either specifier form. Adding a built-in changes that test.
- **It joins ADR-0107's exceptions to the `process` global ban.** Its lint override turns off only the `process` global ban. The bans on the global `require`, on `node:os`'s home, user, and temporary-folder calls, and on `node:child_process` and `createRequire` imports stay in force.
- **The installed-files module reads `node:crypto` through it.** Its digest and its staging names stay synchronous. A run that hashes no file and stages no file never loads `node:crypto`.
- **A static import stays the default.** A first-party module defers a built-in through this module only when the built-in costs measurable launch time and a synchronous caller needs it. A module that runs only when a Command runs imports its built-ins statically.

Loading a built-in module is neither a process fact nor a process effect under ADR-0107. The call returns the module a static import returns, it reads and changes nothing about the process, and no process handle, a mock's included, would answer it differently. ADR-0107's rule that a run's facts and effects go through its handle is unchanged.

Deferring a plugin Command's implementation with `import()`, as a plugin's middleware is already loaded, is launch work under ADR-0134's rule, and this record does not govern it.

## Considered options

- **An asynchronous `import()` in the installed-files module.** Rejected. The digest, the file replacement, and every call built on them would become asynchronous. That change reaches the completion, manpage, mcp, self-update, service, and skills plugins and the installation record.
- **Deferring the Commands' implementations alone.** Rejected as the whole answer. It keeps the installed-files module out of most launches, but self-update's notice middleware still reaches it on every run, so an application that installs self-update keeps paying for `node:crypto`.
- **`createRequire` from `node:module`.** Rejected. The lint configuration bans it, because a `require` loads `node:child_process` around the rule.
- **The Web Crypto global, `globalThis.crypto`.** Rejected. Its digest is asynchronous, so it changes the digest's callers as an `import()` would.
- **A general loader that takes any specifier.** Rejected. One function per built-in keeps each return type exact without an assertion and lets the test pin each specifier.

## Consequences

- An application that installs self-update loads `node:crypto` only on a run that hashes or stages a file, such as one that writes the stale notice cache or runs `self-update`.
- A new built-in deferred this way is a new function in `built-ins.ts` and a change to the test that pins its specifiers, reviewed against the default above.
- The lint override for `built-ins.ts` sits beside ADR-0107's other exceptions in `vite.config.ts`.

## Status

Accepted on merge. It changes no contract an author or operator reads, so it binds from the merge rather than from a release cut.

## Changelog

- 2026-11-03: Recorded with the change that defers the first-party plugins' Command implementations and `node:crypto` (LM-451). It narrows ADR-0107's clause naming the exceptions to the `process` global ban, which gains this module. ADR-0107 carries a dated entry.
