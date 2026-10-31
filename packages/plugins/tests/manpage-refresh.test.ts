// Acceptance plan: see packages/plugins/tests/manpage.test.ts.

import type { Program } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';
import { refreshApplication } from './fixtures/refresh-app.ts';
import type { Observed } from './fixtures/refresh-app.ts';

/** Where the mock runs the application and where the refreshed binary lies. */
const work = '/loom-test/work';
const binary = '/loom-test/bin/notes';

/**
 * Runs the application's `refresh` Command on mockProcess against the binary at `path`, whose
 * child is the script `programs` holds for it.
 */
async function refresh(path: string, programs: Record<string, Program>) {
  const events: Observed[] = [];
  let resolved = false;
  const app = refreshApplication('manpage', path, {
    observe: (event) => events.push(event),
    resolved: () => {
      resolved = true;
    },
  });
  const result = await runOnMock(app, {
    argv: ['refresh'],
    cwd: work,
    env: { FROM_HOST: 'yes' },
    programs,
  });
  return { ...result, events, resolved };
}

const warning = 'Man pages were not refreshed after the update.';

test('runs the binary with manpage update, host.env, and host.cwd, pipes its output, and resolves', async () => {
  const result = await refresh(binary, {
    [binary]: (call) => ({
      stderr: 'child says hello\n',
      stdout: `${JSON.stringify({ argv: call.args, cwd: call.cwd, from: call.env.FROM_HOST })}\n`,
    }),
  });
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({ argv: ['manpage', 'update'], from: 'yes' });
  expect(JSON.parse(printed ?? '{}').cwd).toMatch(/work$/u);
  expect(result.stderr).toContain('child says hello\n');
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([]);
});

test('adds the warn event with the exit code for a child that exits 1, and resolves', async () => {
  const path = binary;
  const result = await refresh(path, { [path]: () => ({ code: 1 }) });
  expect(result.status).toBe(0);
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([{ fields: { code: 1, path }, level: 'warn', message: warning }]);
});

test('adds the warn event and writes the pinned line for a path that cannot start, and resolves', async () => {
  const path = '/loom-test/missing/notes';
  const result = await refresh(path, {
    // A script that throws stands for a binary that could not start, as a missing file cannot.
    [path]: (call) => {
      throw new Error(`spawn ${call.command} ENOENT`);
    },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The man pages were not refreshed because ${path} could not start. Run notes manpage update.\n`,
  );
  expect(result.resolved).toBe(true);
  const [event, ...rest] = result.events;
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
});
