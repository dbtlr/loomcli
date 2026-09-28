---
type: adr
title: ADR-0045 - A failure class declares its exit code
description: A failure class states its exit code as a static field, read from the nearest ancestor that declares one, so one class exits with one code wherever it is raised. The declarable codes are 1 through 125, a reserved code throws a DeclarationError at construction, and core exports the sysexits names. A configuration source's LoomError reports with its class's code.
status: accepted
created: 2026-09-27
modified: 2026-09-28
---

# ADR-0045 - A failure class declares its exit code

## Context

[ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md) makes the exit code a fact of the failure class. `LoomError` receives it as a constructor argument typed `1 | 2`, and each core class passes its own. An application's own failure extends `FatalError` and exits 1, so a script that runs `jsonkit get missing` cannot tell a path absent from the document from a broken pipe or a bug. BSD's `sysexits.h` names codes 64 through 78 for failures of this kind.

A code passed to the constructor exists only on an instance. A projection such as the [manifest](../core.md#manifest) describes failures an agent should expect without raising one, so it cannot read a code that only a constructed failure holds. A constructor argument also lets two throws of one class exit with two codes, so a view and a script can no longer rely on the class.

A failure is raised from three places: an action, a middleware, and a configuration source. The first two report any `LoomError` with its class's code. [ADR-0038](0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md) lets only an `InputError` through from a source and wraps every other throw as a plugin fault with code 1, so an application's own class raised from a source loses its code.

## Decision

- **A static declaration.** A failure class states its exit code as a static field, `static override readonly exitCode = EX_UNAVAILABLE;`. Core reads the code from the failure's class at the class's first construction, walking to the nearest ancestor that declares one, and keeps it. The instance's `exitCode` is a read-only accessor that reports the class's value, so a view keeps reading `failure.exitCode`, and a projection reads the class's code without an instance. One class never exits with two codes.
- **The declarable range.** A class declares 1, 2, or a code from 3 through 125. 1 and 2 keep core's meanings: an application failure and invalid input. 0 and every code from 126 up are reserved: 0 is success, 126 and 127 belong to the shell, and 128 plus a signal number reports a signal, which covers 130 and 143. The exported `FailureExitCode` type is the union of the declarable codes, and `ExitCode`, which `run()` resolves, widens to `0 | FailureExitCode | 130 | 143`.
- **Two checks.** `LoomError` types its static as `FailureExitCode`, so TypeScript rejects a literal outside the range and a plain `number` on the class line, as a class static side that incorrectly extends its base (TS2417). At run time `LoomError`'s constructor reads the class's code and, when it is not declarable, throws a `DeclarationError` that names the class, the code, and the range: `Failure class "PathNotFoundError" declares exit code 130. Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.` The class is named by its constructor's `name`, `new.target.name`, because the subclass has not yet set the instance's `name`. A value that is not a finite number reads `declares an exit code that is not a finite number.` in place of `declares exit code 130.` Core never clamps a code. Inside a run the fault reports as `Invalid declaration:` with code 1.
- **Wherever it is raised.** The code holds when the failure is raised from an action, from a middleware, and from a configuration source. The source carve-out of ADR-0038 widens from `InputError` to any `LoomError` the resolver throws or rejects with, which reports with its class's code. A plain `Error`, and any throw while core reads the source's answers, stays a plugin fault with code 1. Cancellation still outranks every failure code, and a broken failure view or destination still returns 1.
- **The sysexits names.** `@loomcli/core` exports fifteen flat constants with literal number types: `EX_USAGE` 64, `EX_DATAERR` 65, `EX_NOINPUT` 66, `EX_NOUSER` 67, `EX_NOHOST` 68, `EX_UNAVAILABLE` 69, `EX_SOFTWARE` 70, `EX_OSERR` 71, `EX_OSFILE` 72, `EX_CANTCREAT` 73, `EX_IOERR` 74, `EX_TEMPFAIL` 75, `EX_PROTOCOL` 76, `EX_NOPERM` 77, and `EX_CONFIG` 78. `EX_OK` is not exported, because no failure declares 0. `EX_USAGE` is exported for an author's own classes; core raises invalid input as 2 and never raises 64.
- **Core's own classes.** `LoomError` declares 1 and `UsageError` declares 2, and every other core class keeps its current code by inheritance. `LoomError`'s constructor drops its code parameter and becomes `constructor(message: string)`. Invalid input that core raises stays 2, and no application setting changes it.

## Considered options

- **A constructor argument.** Rejected. A projection cannot read the code without an instance, and the argument lets one class exit with a different code on each throw.
- **A static declaration and a per-throw argument together.** Rejected. It keeps the per-throw ambiguity and adds a second way to state one fact.
- **An application setting that maps invalid input to 64.** Rejected. 2 is the accepted standard for a usage error in POSIX utilities, `getopt`, Python's `argparse`, and Rust's `clap`, and a per-application mapping makes the code a script reads depend on which application it runs.
- **Clamping or replacing a code outside the range.** Rejected. A silent change hides the author's mistake and reports a code nobody declared, and an operator's script would read a signal or a shell status that did not happen.
- **A frozen `sysexits` object instead of flat names.** Rejected. Flat constants tree-shake and read the same as the C header.

## Consequences

An application gives each failure a code a script can branch on, and states it once on the class. jsonkit's `Path not found` failure becomes a `FatalError` subclass that declares `EX_DATAERR`, 65, because the document was read and holds no value at the path, which is incorrect input data rather than a missing input file. Its text is unchanged.

A subclass that called `super(message, code)` on `LoomError` drops the second argument and declares the code as a static field. A consumer that switches exhaustively on `ExitCode` handles the declarable range. An author class that declares 2 without extending `UsageError` exits 2 but takes no `Invalid input:` prefix and no `UsageError` override, so `UsageError` groups every exit-2 failure core raises rather than every exit-2 failure.

A configuration source that calls `out.fatal()` now reports the `FatalError` with its own message and code 1, and a `DeclarationError` a source raises reports as `Invalid declaration:`, where both were wrapped as a plugin fault. The code is 1 either way.

The manifest's `exitCodes` keeps the five codes core resolves itself. A declared code is a fact of the class, so a later projection can publish an application's failure codes without constructing a failure.

## Status

Accepted 2026-09-27 with the implementation. `LoomError` declares 1 and `UsageError` 2 as static fields, and every other core class inherits its code. A reserved code throws the diagnostic above at construction. `@loomcli/core` exports the fifteen constants and `FailureExitCode`. A failure class raised from an action, a middleware, and a configuration source keeps its code, and `jsonkit get missing -f doc.json` and `jsonkit keys missing -f doc.json` exit 65 under Node and Bun.

## Changelog

- 2026-09-27: Proposed with the declared exit code contract.
- 2026-09-27: Accepted with the implementation.
- 2026-09-27: Core captures each class's code once, at the class's first construction, and captures its own classes when the package loads, so a static written or answered differently later gives no class a second code. The instance's `exitCode` is a read-only accessor, so a TypeScript subclass cannot override it, and no subclass property or assignment changes the code `run()` resolves. A value that inherits from a failure class without being constructed by one reports as an internal error with code 1, so `run()` never passes an undeclarable code to the process.
- 2026-09-28: Accepted [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) replaces the `Invalid input:` prefix the Consequences name: core's default text opens every `UsageError` with the application name and a colon. An author class that declares 2 without extending `UsageError` still takes neither that prefix nor a `UsageError` override.
