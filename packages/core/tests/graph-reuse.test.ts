/*
 * Acceptance plan for reusing the built graph (docs/core/graph-inspection.md#reusing-the-built-graph).
 *
 * Reuse is proven when public APIs alone produce these results, counting the build hooks' calls:
 *
 * - Two runs. A second `run()` on one Application in one build calls no `onCommandAttach` or
 *   `onGraphBuilt` hook, in a development and in a distributed build, a usage refusal included.
 * - Two builds. A run in one build and a run in the other each build once, so one Application keeps
 *   two graphs and no more.
 * - inspect(). Two `inspect()` calls build once and return the same object, and an `inspect()`
 *   after a run in its build reuses the run's graph, the object the run's action read, from source
 *   and from a bundle whose baked facts read distributed.
 * - app.invoke(). A call by name reuses the graph a run kept, and a run reuses one a call kept.
 * - check(). Every call builds anew and calls every hook, and it keeps nothing a run reuses.
 * - A fault. A build a hook or converter rejects keeps nothing, so a later call builds again.
 * - Overlap. Two runs started together share the graph of the first successful build.
 * - Defaults. A declared default passes through its validator on every run.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Application, Command, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
import type { CommandGraph } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { afterAll, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Where the distributed bundle of the probe is written. */
const root = mkdtempSync(join(tmpdir(), 'loom-graph-reuse-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

type Build = 'development' | 'distributed';

/** The build hooks' calls so far: one `onCommandAttach` per Command, one `onGraphBuilt` per build. */
interface Calls {
  attached: number;
  built: number;
}

/** An Application of two Commands whose plugin counts its build hooks' calls. */
function counted() {
  const calls: Calls = { attached: 0, built: 0 };
  const graphs: unknown[] = [];
  const counting = plugin('@fixture/counting', {
    onCommandAttach: (command) => {
      calls.attached += 1;
      return command;
    },
    onGraphBuilt: (graph) => {
      calls.built += 1;
      graphs.push(graph);
      return undefined;
    },
  });
  const read: unknown[] = [];
  const app = new Application('probe', { plugins: [counting] })
    .command(
      new Command('count').action(({ graph }) => {
        read.push(graph);
      }),
    )
    .command(
      new Command('caller').action(async ({ invoke: call }) => {
        await expect(call(['count'], {})).resolves.toMatchObject({ status: 'completed' });
      }),
    );
  return { app, calls, read };
}

/** A process for one run in `build`, with `argv`. */
function processFor(build: Build, argv: string[] = ['count']) {
  return mockProcess({ argv, release: { build } });
}

const builds: Build[] = ['development', 'distributed'];

test.each(builds)('a second run() in a %s build calls no build hook', async (build) => {
  const { app, calls, read } = counted();
  await expect(app.run({ process: processFor(build) })).resolves.toBe(0);
  expect(calls).toEqual({ attached: 3, built: 1 });
  await expect(app.run({ process: processFor(build) })).resolves.toBe(0);
  expect(calls).toEqual({ attached: 3, built: 1 });
  expect(read[1]).toBe(read[0]);
});

test.each(builds)('overlapping first runs in a %s build share one graph', async (build) => {
  const { app, calls, read } = counted();
  const first = app.run({ process: processFor(build) });
  const second = app.run({ process: processFor(build) });
  await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);
  expect(calls).toEqual({ attached: 3, built: 1 });
  expect(read).toHaveLength(2);
  expect(read[1]).toBe(read[0]);
});

test.each(builds)(
  'a usage refusal on a second run() in a %s build calls no build hook',
  async (build) => {
    const { app, calls } = counted();
    await expect(app.run({ process: processFor(build, ['--unknown']) })).resolves.toBe(2);
    await expect(app.run({ process: processFor(build, ['--unknown']) })).resolves.toBe(2);
    expect(calls).toEqual({ attached: 3, built: 1 });
  },
);

test('one Application keeps one graph for each build, and no more', async () => {
  const { app, calls, read } = counted();
  await app.run({ process: processFor('development') });
  await app.run({ process: processFor('distributed') });
  expect(calls).toEqual({ attached: 6, built: 2 });
  await app.run({ process: processFor('development') });
  await app.run({ process: processFor('distributed') });
  expect(calls).toEqual({ attached: 6, built: 2 });
  expect(read[2]).toBe(read[0]);
  expect(read[3]).toBe(read[1]);
  expect(read[1]).not.toBe(read[0]);
});

test('two inspect() calls build once and return the same graph', () => {
  const { app, calls } = counted();
  const first = app.inspect();
  const second = app.inspect();
  expect(calls).toEqual({ attached: 3, built: 1 });
  expect(second).toBe(first);
});

test('an inspect() after a run in its build returns the graph the run read', async () => {
  // A source run reads no baked facts, so inspect() names a development build.
  const { app, calls, read } = counted();
  await app.run({ process: processFor('development') });
  expect(app.inspect()).toBe(read[0]);
  expect(calls).toEqual({ attached: 3, built: 1 });
});

test('a run after inspect() in its build reuses the inspected graph', async () => {
  const { app, calls, read } = counted();
  const inspected = app.inspect();
  await app.run({ process: processFor('development') });
  expect(read[0]).toBe(inspected);
  expect(calls).toEqual({ attached: 3, built: 1 });
});

test('an inspect() after a run in the other build builds its own graph once', async () => {
  const { app, calls, read } = counted();
  await app.run({ process: processFor('distributed') });
  const inspected = app.inspect();
  expect(inspected).not.toBe(read[0]);
  expect(calls).toEqual({ attached: 6, built: 2 });
  app.inspect();
  expect(calls).toEqual({ attached: 6, built: 2 });
});

test.each(builds)(
  'app.invoke() in a %s build reuses the graph a run kept, and a run reuses one it kept',
  async (build) => {
    const ran = counted();
    await ran.app.run({ process: processFor(build) });
    const called = await ran.app.invoke(['count'], {}, { process: processFor(build, []) });
    expect(called.status).toBe('completed');
    await expect(
      ran.app.invoke(['caller'], {}, { process: processFor(build, []) }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(ran.calls).toEqual({ attached: 3, built: 1 });
    expect(ran.read).toHaveLength(3);
    expect(new Set(ran.read).size).toBe(1);

    const invoked = counted();
    await invoked.app.invoke(['count'], {}, { process: processFor(build, []) });
    await invoked.app.run({ process: processFor(build) });
    expect(invoked.calls).toEqual({ attached: 3, built: 1 });
    expect(invoked.read[1]).toBe(invoked.read[0]);
  },
);

test('check() builds anew on every call, and a run reuses nothing it built', async () => {
  const { app, calls, read } = counted();
  expect(app.check()).toEqual([]);
  expect(calls).toEqual({ attached: 3, built: 1 });
  expect(app.check()).toEqual([]);
  expect(calls).toEqual({ attached: 6, built: 2 });
  await app.run({ process: processFor('development') });
  expect(calls).toEqual({ attached: 9, built: 3 });
  expect(app.check()).toEqual([]);
  expect(calls).toEqual({ attached: 12, built: 4 });
  await app.run({ process: processFor('development') });
  expect(calls).toEqual({ attached: 12, built: 4 });
  expect(read[1]).toBe(read[0]);
});

const sharedName = diagnosticRule('@fixture/judge/shared-name', {
  explanation: 'Each Command describes its own job.',
  headline: 'Two Commands share one description',
});

test('a build a hook rejects keeps nothing, so every later call builds again and meets the same fault', async () => {
  let judged = 0;
  const judge = plugin('@fixture/judge', {
    onGraphBuilt: () => {
      judged += 1;
      throw new DeclarationError(sharedName, {
        correction: 'Describe what each Command does in its own words.',
        sentence: 'The graph shares a name.',
      });
    },
  });
  const app = new Application('probe', { plugins: [judge] }).action(() => undefined);
  for (const build of builds) {
    const first = processFor(build, []);
    await expect(app.run({ process: first })).resolves.toBe(1);
    const second = processFor(build, []);
    await expect(app.run({ process: second })).resolves.toBe(1);
    expect(second.stderr.text).toBe(first.stderr.text);
  }
  expect(judged).toBe(4);
  expect(() => app.inspect()).toThrow('The graph shares a name.');
  expect(() => app.inspect()).toThrow('The graph shares a name.');
  expect(judged).toBe(6);
});

test('a converter fault keeps no development graph and a distributed run still builds', async () => {
  let attached = 0;
  let converted = 0;
  const built: CommandGraph[] = [];
  const read: CommandGraph[] = [];
  const observer = plugin('@fixture/observer', {
    onCommandAttach: (command) => {
      attached += 1;
      return command;
    },
    onGraphBuilt: (graph) => {
      built.push(graph);
      return undefined;
    },
  });
  const app = new Application('probe', { plugins: [observer] })
    .option('path', {
      type: 'string',
      validate: {
        '~standard': {
          jsonSchema: {
            input() {
              converted += 1;
              throw new Error('No JSON Schema for a transform.');
            },
            output: () => ({}),
          },
          validate: (value) => ({ value }),
          vendor: 'fixture',
          version: 1,
        },
      },
    })
    .action(({ graph }) => {
      read.push(graph);
    });

  for (const attempts of [1, 2]) {
    const process = processFor('development', []);
    await expect(app.run({ process })).resolves.toBe(1);
    expect(process.stderr.text).toContain('No JSON Schema for a transform.');
    expect(attached).toBe(attempts);
    expect(converted).toBe(attempts);
  }
  expect(built).toHaveLength(0);
  expect(read).toHaveLength(0);

  await expect(app.run({ process: processFor('distributed', []) })).resolves.toBe(0);
  expect(attached).toBe(3);
  expect(converted).toBe(3);
  expect(built).toHaveLength(1);
  expect(read).toHaveLength(1);
  expect(read[0]).toBe(built[0]);
  expect(read[0]?.root.options).toMatchObject([{ name: 'path', schema: null }]);
});

test('a declared default passes through its validator on every run', async () => {
  const validated: unknown[] = [];
  let attached = 0;
  const counting = plugin('@fixture/counting', {
    onCommandAttach: (command) => {
      attached += 1;
      return command;
    },
  });
  const app = new Application('probe', { plugins: [counting] })
    .option('level', {
      default: '3',
      type: 'string',
      validate: {
        '~standard': {
          validate(value) {
            validated.push(value);
            return { value: Number(value) };
          },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(() => undefined);
  await expect(app.run({ process: processFor('development', []) })).resolves.toBe(0);
  const once = validated.length;
  expect(once).toBeGreaterThan(0);
  await expect(app.run({ process: processFor('development', []) })).resolves.toBe(0);
  expect(attached).toBe(1);
  expect(validated).toEqual([...validated.slice(0, once), ...validated.slice(0, once)]);
  expect(validated).toHaveLength(once * 2);
});

/** The probe that runs and inspects one Application, from source or from a bundle. */
const fixture = new URL('fixtures/graph-reuse.mjs', import.meta.url);

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

const suiteRuntime = process.env.LOOM_TEST_RUNTIME ?? 'node';

/** The bundle of the probe whose baked facts read distributed. */
function distributedBundle(): string {
  const built = spawnSync(
    'bun',
    [bundler, 'graph-reuse.mjs', root, JSON.stringify({ build: 'distributed' })],
    { encoding: 'utf8' },
  );
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  return join(root, 'graph-reuse.js');
}

/** Every step builds nothing past the first run: two runs, then two inspect() calls. */
const reused = {
  marks: [
    { attached: 1, built: 1, label: 'run' },
    { attached: 1, built: 1, label: 'run' },
    { attached: 1, built: 1, label: 'inspect' },
    { attached: 1, built: 1, label: 'inspect' },
  ],
  sameAsRun: true,
  sameInspect: true,
};

test('run() then inspect() share one graph from source, a development build', () => {
  const result = invoke(fixture, ['run-then-inspect'], { runtime: suiteRuntime });
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual(reused);
});

test('run() then inspect() share one graph in a bundle whose baked facts read distributed', () => {
  const result = spawnSync(suiteRuntime, [distributedBundle(), 'run-then-inspect'], {
    encoding: 'utf8',
  });
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual(reused);
});
