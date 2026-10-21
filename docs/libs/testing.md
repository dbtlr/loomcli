---
description: The @loomcli/testing reference. The assembly check, assertAssembles, which a bun test or vitest test calls with the Application, what it throws for each declaration fault, and which faults it covers and which a first run reports.
---

# Testing reference

`@loomcli/testing` ships the test helpers for a Loom application. [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) records the decision: the assembly check is a test, so the author's own test runner runs it while the author works and in CI. The package imports no test runner. Its function only returns or throws, so it runs under `bun test` and vitest alike. A later release adds a run harness to this package.

## Install

```sh
bun add -d @loomcli/testing
```

`@loomcli/core` is a peer dependency. The package needs the same core version as the application.

## assertAssembles

```ts
function assertAssembles(application: Pick<Application, 'check'>): void;
```

`assertAssembles` calls `application.check()`. It returns when the list of faults is empty. Otherwise it throws one `Error` whose message holds a lead line, then the Developer Diagnostic of each fault in the order `check()` returns them, each after a blank line. The test runner prints the message and fails the test.

```text
The application does not assemble: 2 faults.

-- SHARED NAME -------------------------------------- @fixture/probe/shared-name

The first hook rejects the graph.

Each Command answers to a name of its own.

-- SHARED NAME -------------------------------------- @fixture/probe/shared-name

The second hook rejects the graph.

Each Command answers to a name of its own.
```

The error's `cause` is the list of `DeclarationError` values, so a test that wants one fault reads its `rule` or `sentence` from there.

The parameter accepts an application in any authoring state, because `check()` is published in every state. The test passes the application as the module exports it.

### A test under bun test

```ts
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { application } from '../src/application.js';

// Keep this test. It fails CI for a fault that only the assembled application reveals, which
// the operator would otherwise meet on the first run.
test('the application assembles', () => {
  assertAssembles(application);
});
```

### A test under vitest

```ts
import { assertAssembles } from '@loomcli/testing';
import { test } from 'vitest';

import { application } from '../src/application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

## What it covers

`assertAssembles` covers what `Application.check()` covers, and builds no rule of its own:

- Every build rule `inspect()` applies. A build-rule fault ends the build, so it is the one fault in the list.
- The input-schema converter check, whatever the release facts read, and every `onGraphBuilt` hook. Past a built graph, each failing converter and each rejecting or broken hook is its own fault, and the build goes on.

It does not pass a declared default or an implied value through its validator. A validator may answer asynchronously and read the run's host, so a bad default surfaces on the application's first run, which reports it.
