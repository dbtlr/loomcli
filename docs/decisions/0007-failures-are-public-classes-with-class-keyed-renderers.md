---
type: adr
title: ADR-0007 - Failures are public classes with typed facts, rendered by class-keyed renderers registered on the Application
description: Every failure run() reports is an instance of a public class carrying the facts its sentence interpolates and its exit code. Renderers are registered per class on the constructor, resolved along the prototype chain. A working renderer cannot change the exit code, and a broken one is an internal failure that never escapes.
status: accepted
created: 2026-09-07
modified: 2026-09-07
---

# ADR-0007 - Failures are public classes with typed facts, rendered by class-keyed renderers registered on the Application

## Context

An application brands its diagnostics, and an agent consumer reads them. Both need the facts of a failure, not a sentence to parse.

Every failure `run()` reports is an instance of a public class. `LoomError` carries the exit code; `UsageError` groups every exit-2 failure; flat subclasses such as `UnknownCommandError` and `InputError` carry the facts their sentences interpolate. `message` is the sentence without its category prefix. An omitted required argument and an omitted required option are both `missing` problems on `InputError`, so omission has one class whichever input it names.

An application registers renderers through the constructor's `failures` option as `renderFailure(Class, renderer)` entries. Resolution walks the thrown failure's prototype chain, most derived first, then falls to core's default text, so one registration for `UsageError` brands every exit-2 failure. A working renderer owns every byte core writes, cannot change the exit code, and never escapes. A renderer that throws produces the original failure's default text plus one internal-error line through a plain fallback path that runs no application code, and the invocation returns 1 whichever code the original failure carried. Two registrations for one class are a build-time declaration error.

## Considered options

- **Prose-only `InputError` for parser faults.** Rejected. A renderer would parse sentences to find the option or token, and any wording change would break it.
- **Ad hoc per-failure hooks, or decorator-style renderers.** Rejected. Renderers configure the application the way Commands do: as values in the constructor.
- **A positional `new Application(name, globals)` form.** Retired. The options object holds `globals` and `failures` together, and `renderFailure` is the typed path for a class-keyed list, because an array literal cannot carry a different type parameter per element without an assertion.
- **Letting a renderer change the exit code, or aborting the destination on a renderer fault.** Rejected. The exit code is a fact of the class, and a broken renderer must not turn a usage error into silence.

## Consequences

`DeclarationError` and `InternalError` reach registered renderers too, because an author-facing diagnostic is still output the application owns. A `FatalError` subclass can carry its own renderer, which is how one fatal type implies one diagnostic.
