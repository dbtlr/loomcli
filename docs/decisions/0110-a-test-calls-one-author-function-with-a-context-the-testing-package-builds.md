---
type: adr
title: ADR-0110 - A test calls one author function with a context the testing package builds
description: '@loomcli/testing exports actionContext, middlewareContext, failureHookContext, providerContext, and viewContext. Each is typed from the function''s context parameter and returns its concrete core context with no type assertion. The test states the function''s input records whole, typed as the context types them. Every other member is optional: a function that returns nothing does nothing, out.draw, out.region, and signal give inert answers, out.fatal throws FatalError, and next, invoke, a view''s measures, and every other member throw or reject with a sentence telling the test to state them. A built context carries nothing from core.'
status: proposed
created: 2026-10-26
modified: 2026-10-26
---

# ADR-0110 - A test calls one author function with a context the testing package builds

## Context

[ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) and [ADR-0109](0109-a-test-scripts-keys-on-the-mocks-keyboard-and-measures-and-validates-with-cores-own-functions.md) let a test run an Application in its own process on a mock, and that is the only public way to exercise an author function. A test of one action handler assembles an Application, routes an invocation to the handler's Command, runs its defaults and validators, builds its providers, and settles its output, then reads the outcome from the mock. Every stage the test did not mean to cover is in its scope, and a failure in any of them reads as a failure of the handler.

A unit test works well only when it isolates its scope. An action is a function, and its unit test calls it with an input. `ActionContext`, `MiddlewareContext`, `FailureHookContext`, `ProviderContext`, and `ViewContext` are public types, but only core's run machinery builds them. A hand-built action context needs some twenty members, so a test either writes them all or asserts a partial object into the type, which the repository's assertion rule exists to prevent.

ADR-0109 rejected a builder for a Command's whole input stage and left building contexts outside a run to the scopes that test one function.

## Decision

- **Five builders.** `@loomcli/testing` exports `actionContext(handler, values)`, `middlewareContext(middleware, values)`, `failureHookContext(hook, values)`, `providerContext(opener, values)`, and `viewContext(view, values)`. Each infers its type parameters from the function's context parameter, such as `Action<Args, Options, Result, Stdin, Provided>` for an extracted handler typed `ActionHandler<typeof get>`, so TypeScript checks that the values hold everything that context needs. Each returns the concrete core context type the function reads. An `onFailure` hook takes `(failure, context)`, so `failureHookContext` returns the second argument and the test calls `hook(failure, context)`. `viewContext` serves a view and a row view.
- **The inputs are stated whole.** The test states each of the function's input records whole, typed exactly as the context types it: an action's `args`, `options`, and `provided`, and `stdin` as its context types it; a middleware's `options`, `ownOptions`, `spellings`, `request`, and `view`; an `onFailure` hook's `application`, `path`, `invokedBy`, `view`, and `mediaType`; and an opener's `options` and `provided`. The builder fills no record and no key: a key typed with `undefined` is written out, and an empty record is written `{}`, so an action's `options` include every registered global option. No default, validator, or input source runs. Because every input is the test's own value of the context's own type, each builder returns its context with no type assertion.
- **Every other member is optional.** A stated member replaces the builder's whole, except `out` and `log`, which are stated member by member. An unstated member:
  - does nothing when it is a function that returns nothing: `out`'s semantic lanes, `out.render`, and `out.results` resolve, `log`'s levels and `cancel` do nothing, and `onShutdown`, `onSuspend`, and `onResume` return a remover that does nothing;
  - gives an inert answer where the type has one: `out.draw` resolves `0`, `out.region()` returns a region that is not live, whose methods do nothing, whose `closedBy` stays `undefined`, and whose `signal` never aborts, and the context's `signal` never aborts;
  - throws core's `FatalError` with the message for `out.fatal`, because its type is `never`;
  - throws, when called, a sentence telling the test to state its own when the function reads its answer: `next` and `invoke` reject with it, and a view context's `width`, `plain`, `wrap`, and `expandTabs` throw it. `next`'s reads `middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.`;
  - throws, when read, a sentence telling the test to state it, for every other member: `host`, `style`, `graph`, `command`, `interactive`, `supplied`, `passthrough`, `columns`, and `background`. Its form is `actionContext has no host. Add host to its values.`
  
  Each sentence opens with the builder that built the context and names the member.
- **Nothing from core.** A built context carries nothing from core: no Application, Command, or plugin is a builder's subject, and a builder takes no default, style, or measure from core and reads no view registry, theme, or settle step.
- **Functions with no builder.** An inline `.action()` handler has no public way to reach it, and the reference tells an author to extract a handler, the modular authoring pattern, to unit-test it. A failure view's `FailureViewContext` and a configuration source's `SourceContext` have no builder. `onCommandAttach` and `onGraphBuilt` read a built graph, so a test installs the plugin on a small Application and reads `application.inspect()`. The arguments of `onLog` and `onEnvironment` are plain values and functions a test writes by hand.

The rules are stated in [Testing one function alone](../libs/testing.md#testing-one-function-alone).

## Considered options

- **Core runs and settles the action alone.** Rejected. An entry that runs one action and settles its output is a run with fewer stages: it still builds the output channel, the providers, and the settle step, so the test reaches core's machinery rather than the function.
- **Core's real members over a mock.** A context whose `out`, `log`, and signals are core's own, writing to a `mockProcess`. Rejected, because it builds an application's machinery, a view registry, a theme, and a rendering policy, inside the unit test.
- **Defaults taken from core.** A sealed `host` with `mockProcess`'s defaults, and a style with no color, which needs a core export that reads any token name. Rejected, because each carries core into the unit test: the function reads a value the test never stated, and the test passes or fails on it.
- **Core's own measures in `viewContext`.** `width`, `plain`, `wrap`, and `expandTabs` from new core exports. Rejected for the same reason: the view's test would measure with core's resolver, glyph forms, and token rules rather than the measures the test states.
- **Inputs filled where their type allows.** A key typed with `undefined` omitted, and a record whose keys may all be omitted left out. Rejected. Filling them is a default the builder invents, and stating every input whole, as the context types it, needs no type machinery and no assertion.
- **One generic `contextFor(function, values)`.** Rejected. Its return type is the context parameter of whatever function it receives, which needs a pinned type assertion, and it needs a rule for which parameter is the context, because an `onFailure` hook's is its second.
- **A declaration as the subject.** A builder that takes a Command or a plugin. Rejected. The subject is the function the test calls: a Command reaches an inline handler only through the run machinery, and a plugin holds several functions.
- **`next` and `invoke` resolve invented answers.** Such as `'dispatched'` from `next` and a completed outcome with empty output from `invoke`. Rejected. The function reads the answer and branches on it, so an invented answer can pass a test the function would fail, and a rejection that names the member tells the test to state the answer it means.
- **A core `attachedCommand` builder for `onCommandAttach`.** Rejected. The hook reads a Command as graph build attaches it, and a test that installs the plugin on a small Application reads the same thing through `inspect()`, so a second way to build one is not needed.

## Consequences

The five context types stay public for use, not construction. An author reads them and never builds them; Loom's own testing package builds them, and its build fails in the same change when core adds a required member to one of them, so that change also gives the member its unstated behavior in the builder. Adding a member to one of these contexts therefore stays non-breaking under the changelog rule for objects core constructs. A member a later release adds follows the classes above: a function that returns nothing does nothing, a function whose answer the unit reads asks to be stated, and any other member throws its sentence when read unstated.

A test states every input and every other member its function reads, so a test's setup lists exactly what the function depends on. The reference tells an author to extract an action handler to unit-test it. A test of `run()` or `invoke` still substitutes a provider's opener through module mocking, because a run takes no provided value. Core gains no export.

## Status

Proposed. It moves to accepted with the release that ships the five builders, once each builder returns its core context with no type assertion and Loom's own tests call a first-party middleware, `onFailure` hook, opener, and view through them under Node and Bun.

## Changelog

- 2026-10-26: Proposed.
