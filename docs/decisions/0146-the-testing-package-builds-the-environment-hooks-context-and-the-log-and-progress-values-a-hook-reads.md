---
type: adr
title: ADR-0146 - The testing package builds the environment hook's context and the log and progress values a hook reads
description: '@loomcli/testing adds environmentContext(hook, values), whose host is stated member by member and whose unstated host member throws its sentence when read, as ADR-0110''s builders do. It adds logEvent, logDestination, and progressEvent, which build the plain values an onLog hook and a progress observer read; each member a test does not state takes a fixed, documented default. It supersedes ADR-0110''s sentence that a test writes the arguments of onLog and onEnvironment by hand.'
status: proposed
created: 2026-11-12
modified: 2026-11-12
---

# ADR-0146 - The testing package builds the environment hook's context and the log and progress values a hook reads

## Context

[ADR-0110](0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md) gave `@loomcli/testing` five builders for the contexts a test calls one author function with. It left the arguments of `onLog` and `onEnvironment` to the test, as plain values and functions a test writes by hand. A progress observer, the `onProgress` function a caller hands to `invoke`, takes a `ProgressEvent`, which a test also writes by hand.

[ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md) tags `Log`, `LogEvent`, `LogDestination`, `EnvironmentContext`, and `ProgressEvent` as output types: Loom hands them to the author's code, so a release may add a member to any of them in a feature. A test that writes one of them whole stops compiling when that member arrives. The testing reference showed exactly such tests for `onLog` and `onEnvironment`.

A log event, a log destination, and a progress event are plain data, and a hook commonly reads them whole. The logging plugin's hook writes each event as one JSON record, and a test of such a hook compares or serializes the whole value. ADR-0110's rule for an unstated member, which throws its sentence when read, would make such a test state every member, which is the hand-written value again.

## Decision

- **`environmentContext(hook, values)`.** A sixth context builder, for an `onEnvironment` hook. It takes the hook first, as ADR-0110's builders take their function, and returns core's `EnvironmentContext`. `host` is stated member by member: an unstated `host.cwd` or `host.env` throws, when read, `environmentContext has no host.cwd. Add host.cwd to its values.`, naming the member. `log` and `out` follow ADR-0110: they are stated member by member, `log`'s levels do nothing, and `out.warn` resolves and writes nothing.
- **Three value builders.** `logEvent(values)` builds the `LogEvent` an `onLog` hook takes first, `logDestination(values)` the `LogDestination` it takes second, and `progressEvent(values)` the `ProgressEvent` a progress observer takes. Each takes only its values, because the value belongs to no one function. A stated member replaces the default whole.
- **Fixed defaults for the values.** Each member a test does not state takes a fixed default, which the testing reference lists:

  | Builder | Member | Default |
  | --- | --- | --- |
  | `logEvent` | `time` | `'2026-01-01T00:00:00.000Z'` |
  | | `level` | `'info'` |
  | | `message` | `''` |
  | | `fields` | `{}` |
  | | `application` | `{ name: 'app', version: '0.0.0' }` |
  | | `run` | `'0'.repeat(32)` |
  | | `path` | `[]` |
  | | `plugin` | `null` |
  | | `failure`, `defect` | absent |
  | `logDestination` | `env` | `{}` |
  | | `home` | `'/loom-test/home'` |
  | | `platform` | `'linux'` |
  | | `stderr` | `null` |
  | `progressEvent` | `id` | `1` |
  | | `label` | `''` |
  | | `state` | `'updated'` |
  | | `completed`, `total` | absent |

  Each builder returns a frozen copy, frozen as core freezes the value it hands a hook: a log event with everything it holds, and a destination and a progress event at their top level. The values the test stated stay as they were. A member a later release adds to one of these types takes a fixed default in the same change.
- **Types.** Each builder's values type is an input type, because the test writes it, and each returns core's own output type. The values types are exported as `EnvironmentValues`, `LogEventValues`, `LogDestinationValues`, and `ProgressEventValues`.

The supersession: the sentence of ADR-0110's "Functions with no builder" that the arguments of `onLog` and `onEnvironment` are plain values and functions a test writes by hand no longer holds. ADR-0110's rules for a context bind `environmentContext`, with one exception: `host` is stated member by member, not whole, and its unstated member, not `host` itself, throws its sentence when read. The fixed defaults apply to the three plain-data values alone, which ADR-0110 left to the test to write and gave no rule for unstated members.

## Considered options

- **The values throw an unstated member's sentence when read.** As ADR-0110's contexts do. Rejected for the plain values: a hook that serializes or compares a whole event reads every member, so its test states every member, and a member a release adds breaks that test.
- **The values require the members that have no neutral value.** A test states `time`, `level`, `message`, `application`, and `run`, and the builder fills the rest. Rejected: most of the hand-written value comes back, and a required member a release adds still breaks the test.
- **`environmentContext`'s `host` takes `mockProcess`'s defaults.** `cwd` `'/loom-test'` and `env` `{}`. Rejected for the reason ADR-0110 rejects defaults in a context: the hook reads a value the test never stated. An environment hook reads `host` member by member, so a member the test does not state throws only when the hook reads it, and a member a release adds breaks no test.
- **One builder for both `onLog` arguments.** `logHookArguments` returning the event and the destination as a pair. Rejected: a test that reads one argument builds only that one, and each builder's name matches the type it returns.
- **Core's type-consumer tests build their values through `@loomcli/testing`.** Rejected: `@loomcli/testing` depends on core, so core's tests importing it close a cycle. Core's type-consumer tests read these values instead of building them.

## Consequences

A test of an `onLog` hook, an `onEnvironment` hook, or a progress observer states only what it checks, and a release that adds a member to `Log`, `LogEvent`, `LogDestination`, `EnvironmentContext`, `EnvironmentContext`'s `host`, or `ProgressEvent` breaks none of these tests. A member the test states is written whole, as core types it, so a test that states a log event's `application`, `failure`, or `defect` breaks when a release adds a member inside it, as a context's whole-stated input does under ADR-0110. `@loomcli/testing`'s own build fails in the same change that adds a required member to one of these types, so that change gives the member its default or its sentence. A value builder's default is a value the hook may read without the test stating it, so the testing reference lists every default, and a test that checks a member states it. The [testing reference](../libs/testing.md) documents the four builders, and [Public exports](../core/public-exports.md) names the values they build beside the contexts.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-12: Proposed with the builders (LM-477). It supersedes ADR-0110's sentence that a test writes the arguments of `onLog` and `onEnvironment` by hand, and makes `environmentContext`'s `host` an exception to ADR-0110's rule that `host` is stated whole; ADR-0110 carries a dated entry.
