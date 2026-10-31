// Acceptance plan: see packages/plugins/tests/skills.test.ts.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Program } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { runOnMock } from './fixtures/in-process.ts';
import { refreshApplication } from './fixtures/refresh-app.ts';
import type { Observed } from './fixtures/refresh-app.ts';

const fixture = new URL('fixtures/skills-refresh.mjs', import.meta.url);

/** Where the mock runs the application and where the refreshed binary lies. */
const work = '/loom-test/work';
const binary = '/loom-test/bin/notes';

/**
 * Runs the application's `refresh` Command on mockProcess against the binary at `path`, whose
 * child is the script `programs` holds for it. A run whose controller aborts is cancelled.
 */
async function refresh(
  path: string,
  programs: Record<string, Program>,
  controller = new AbortController(),
) {
  const events: Observed[] = [];
  let resolved = false;
  const app = refreshApplication('skills', path, {
    observe: (event) => events.push(event),
    resolved: () => {
      resolved = true;
    },
  });
  const result = await runOnMock(
    app,
    { argv: ['refresh'], cwd: work, env: { FROM_HOST: 'yes' }, programs },
    { signal: controller.signal },
  );
  return { ...result, events, resolved };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox for the process cases: the child, its marker and handler files, and the logs. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-skills-refresh-'));
  roots.push(root);
  return {
    child: join(root, 'child.mjs'),
    events: join(root, 'events.jsonl'),
    marker: join(root, 'abort'),
    resolved: join(root, 'resolved'),
    root,
    scenario: join(root, 'scenario.json'),
    term: join(root, 'term'),
  };
}

type Box = ReturnType<typeof sandbox>;

/** Writes a child program that runs under the test's runtime, as an executable with a shebang. */
function childProgram(box: Box, body: string): string {
  writeFileSync(box.child, `#!${process.execPath}\n${body}\n`);
  chmodSync(box.child, 0o755);
  return box.child;
}

/**
 * Runs the process fixture's `refresh` Command against the binary at `path`, aborting the run once
 * the marker appears.
 */
function refreshProcess(box: Box, path: string) {
  writeFileSync(
    box.scenario,
    JSON.stringify({
      abortMarker: box.marker,
      cwd: box.root,
      env: { FROM_HOST: 'yes', MARK: box.marker, TERM_FILE: box.term },
      events: box.events,
      path,
      resolved: box.resolved,
    }),
  );
  return invoke(fixture, [], { env: { SKILLS_SCENARIO: box.scenario } });
}

/** The log events the process fixture observed. */
function processEvents(box: Box): Observed[] {
  return existsSync(box.events)
    ? readFileSync(box.events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

/** A script for a binary that could not start, as a missing file cannot. */
const unstartable: Program = (call) => {
  throw new Error(`spawn ${call.command} ENOENT`);
};

const warning = 'Skills were not refreshed after the update.';

test('runs the binary with skills update, host.env, and host.cwd, pipes its output, and resolves', async () => {
  const result = await refresh(binary, {
    [binary]: (call) => ({
      stderr: 'child says hello\n',
      stdout: `${JSON.stringify({ argv: call.args, cwd: call.cwd, from: call.env.FROM_HOST })}\n`,
    }),
  });
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({ argv: ['skills', 'update'], from: 'yes' });
  expect(JSON.parse(printed ?? '{}').cwd).toMatch(/work$/u);
  expect(result.stderr).toContain('child says hello\n');
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([]);
});

test('adds the warn event with the exit code for a child that exits 1, and resolves', async () => {
  const path = binary;
  const result = await refresh(path, { [path]: () => ({ code: 1, stderr: 'the child failed\n' }) });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('the child failed\n');
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([{ fields: { code: 1, path }, level: 'warn', message: warning }]);
});

test('adds the warn event with the error and writes the pinned line for a path that cannot start', async () => {
  const path = '/loom-test/missing/notes';
  const result = await refresh(path, { [path]: unstartable });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${path} could not start. Run notes skills update.\n`,
  );
  expect(result.resolved).toBe(true);
  const [event, ...rest] = result.events;
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
  expect(event?.fields).not.toHaveProperty('code');
});

// A process test: the runtime's own spawn throws for a path through a regular file, which only the
// Real process handle meets; a mock's spawn has no runtime under it.
test('adds the warn event and writes the pinned line for a file the runtime throws on starting, and resolves', () => {
  const box = sandbox();
  // A path through a regular file fails with ENOTDIR, which spawn throws itself on every platform.
  // A file the kernel cannot execute is no portable case: Linux retries it through /bin/sh.
  writeFileSync(box.child, 'not a directory\n');
  const path = join(box.child, 'notes');
  const result = refreshProcess(box, path);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${path} could not start. Run notes skills update.\n`,
  );
  expect(existsSync(box.resolved)).toBe(true);
  const [event, ...rest] = processEvents(box);
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
  expect(event?.fields).not.toHaveProperty('code');
});

test('escapes control characters in the path the line repeats', async () => {
  const path = '/loom-test/missing/no\u0007tes';
  const result = await refresh(path, { [path]: unstartable });
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${path.replace('\u0007', String.raw`\u0007`)} could not start. Run no${String.raw`\u0007`}tes skills update.\n`,
  );
});

// A process test under ADR-0103: a real child's SIGTERM handler chooses its own exit code, while a
// Mock child ended by a signal always ends with 128 plus the signal's number.
test('ends the child with SIGTERM when the run is aborted while it runs, warns with its code, and resolves', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {
  writeFileSync(process.env.TERM_FILE, 'term');
  process.exit(7);
});
writeFileSync(process.env.MARK, 'started');
setInterval(() => {}, 1000);`,
  );
  // The child writes the marker once its handler is installed, and the fixture aborts the run on it.
  const result = refreshProcess(box, path);
  expect(result.status).toBe(130);
  expect(readFileSync(box.term, 'utf8')).toBe('term');
  expect(existsSync(box.resolved)).toBe(true);
  expect(processEvents(box)).toEqual([
    { fields: { code: 7, path }, level: 'warn', message: warning },
  ]);
});

test('reports the shell status of the signal for a child with no SIGTERM handler, and exits 130', async () => {
  const path = binary;
  const controller = new AbortController();
  const result = await refresh(
    path,
    {
      // The child cancels the run once it has started, and runs until it is ended.
      [path]: async (call) => {
        controller.abort();
        await new Promise((resolve) => {
          call.signal.addEventListener('abort', resolve, { once: true });
        });
        return {};
      },
    },
    controller,
  );
  expect(result.status).toBe(130);
  expect(result.resolved).toBe(true);
  expect(result.events).toEqual([{ fields: { code: 143, path }, level: 'warn', message: warning }]);
});
