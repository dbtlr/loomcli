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

const fixture = new URL('fixtures/skills-refresh.mjs', import.meta.url);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox with a working directory, and the files the fixture and its child write. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-skills-refresh-'));
  roots.push(root);
  const work = join(root, 'work');
  mkdirSync(work);
  return {
    child: join(root, 'child.mjs'),
    events: join(root, 'events.jsonl'),
    marker: join(root, 'abort'),
    resolved: join(root, 'resolved'),
    root,
    scenario: join(root, 'scenario.json'),
    term: join(root, 'term'),
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
function refresh(box: Box, path: string, extra: { abort?: boolean } = {}) {
  writeFileSync(
    box.scenario,
    JSON.stringify({
      abortMarker: extra.abort === true ? box.marker : undefined,
      cwd: box.work,
      env: { FROM_HOST: 'yes', MARK: box.marker, TERM_FILE: box.term },
      events: box.events,
      path,
      resolved: box.resolved,
    }),
  );
  return invoke(fixture, [], { env: { SKILLS_SCENARIO: box.scenario } });
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

const warning = 'Skills were not refreshed after the update.';

test('runs the binary with skills update, host.env, and host.cwd, pipes its output, and resolves', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), from: process.env.FROM_HOST, tty: process.stdout.isTTY === true }) + '\\n');
process.stderr.write('child says hello\\n');`,
  );
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({
    argv: ['skills', 'update'],
    from: 'yes',
    tty: false,
  });
  expect(JSON.parse(printed ?? '{}').cwd).toMatch(/work$/u);
  expect(result.stderr).toContain('child says hello\n');
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([]);
});

test('adds the warn event with the exit code for a child that exits 1, and resolves', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    "process.stderr.write('the child failed\\n');\nprocess.exitCode = 1;",
  );
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('the child failed\n');
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([{ fields: { code: 1, path }, level: 'warn', message: warning }]);
});

test('adds the warn event with the error and writes the pinned line for a path that cannot start', () => {
  const box = sandbox();
  const path = join(box.root, 'missing', 'notes');
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${path} could not start. Run notes skills update.\n`,
  );
  expect(existsSync(box.resolved)).toBe(true);
  const [event, ...rest] = events(box);
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
  expect(event?.fields).not.toHaveProperty('code');
});

test('adds the warn event and writes the pinned line for a file the runtime throws on starting, and resolves', () => {
  const box = sandbox();
  // A mode-755 file with no shebang and no executable format fails with ENOEXEC from spawn itself.
  writeFileSync(box.child, 'garbage, not a program\n');
  chmodSync(box.child, 0o755);
  const result = refresh(box, box.child);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${box.child} could not start. Run child.mjs skills update.\n`,
  );
  expect(existsSync(box.resolved)).toBe(true);
  const [event, ...rest] = events(box);
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(box.child);
  expect(event?.fields.error).toBeTypeOf('string');
  expect(event?.fields).not.toHaveProperty('code');
});

test('escapes control characters in the path the line repeats', () => {
  const box = sandbox();
  const path = join(box.root, 'missing', 'no\u0007tes');
  const result = refresh(box, path);
  expect(result.stderr).toBe(
    `The skills were not refreshed because ${path.replace('\u0007', String.raw`\u0007`)} could not start. Run no${String.raw`\u0007`}tes skills update.\n`,
  );
});

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
  const result = refresh(box, path, { abort: true });
  expect(result.status).toBe(130);
  expect(readFileSync(box.term, 'utf8')).toBe('term');
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([{ fields: { code: 7, path }, level: 'warn', message: warning }]);
});

test('reports the shell status of the signal for a child with no SIGTERM handler, and exits 130', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.MARK, 'started');
setInterval(() => {}, 1000);`,
  );
  const result = refresh(box, path, { abort: true });
  expect(result.status).toBe(130);
  expect(existsSync(box.resolved)).toBe(true);
  expect(events(box)).toEqual([{ fields: { code: 143, path }, level: 'warn', message: warning }]);
});
