// Acceptance plan: see packages/plugins/tests/manpage.test.ts.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/manpage-refresh.mjs', import.meta.url);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox with a working directory, and the files the fixture and its child write. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-manpage-refresh-'));
  roots.push(root);
  const work = join(root, 'work');
  mkdirSync(work);
  return {
    child: join(root, 'child.mjs'),
    events: join(root, 'events.jsonl'),
    resolved: join(root, 'resolved'),
    root,
    scenario: join(root, 'scenario.json'),
    work,
  };
}

type Box = ReturnType<typeof sandbox>;

/** Writes a child program that runs under the test's runtime, as an executable with a shebang. */
function childProgram(box: Box, body: string): string {
  writeFileSync(box.child, `#!${process.execPath}\n${body}\n`);
  chmodSync(box.child, 0o755);
  return box.child;
}

/** Runs the fixture's `refresh` Command against the binary at `path`. */
function refresh(box: Box, path: string) {
  writeFileSync(
    box.scenario,
    JSON.stringify({
      cwd: box.work,
      env: { FROM_HOST: 'yes' },
      events: box.events,
      path,
      resolved: box.resolved,
    }),
  );
  return invoke(fixture, [], { env: { MANPAGE_SCENARIO: box.scenario } });
}

/** The log events the fixture observed. */
function events(box: Box): { level: string; message: string; fields: Record<string, unknown> }[] {
  return existsSync(box.events)
    ? readFileSync(box.events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

const warning = 'Man pages were not refreshed after the update.';

test('runs the binary with manpage update, host.env, and host.cwd, pipes its output, and resolves', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), from: process.env.FROM_HOST }) + '\\n');
process.stderr.write('child says hello\\n');`,
  );
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({ argv: ['manpage', 'update'], from: 'yes' });
  expect(JSON.parse(printed ?? '{}').cwd).toMatch(/work$/u);
  expect(result.stderr).toContain('child says hello\n');
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([]);
});

test('adds the warn event with the exit code for a child that exits 1, and resolves', () => {
  const box = sandbox();
  const path = childProgram(box, 'process.exitCode = 1;');
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([{ fields: { code: 1, path }, level: 'warn', message: warning }]);
});

test('adds the warn event and writes the pinned line for a path that cannot start, and resolves', () => {
  const box = sandbox();
  const path = join(box.root, 'missing', 'notes');
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The man pages were not refreshed because ${path} could not start. Run notes manpage update.\n`,
  );
  expect(existsSync(box.resolved)).toBe(true);
  const [event, ...rest] = events(box);
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
});
