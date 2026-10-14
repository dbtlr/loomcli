import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { bashScript } from '../src/completion/bash.js';

const fixture = new URL('fixtures/completion-refresh.mjs', import.meta.url);
const updateFixture = new URL('fixtures/self-update-run.mjs', import.meta.url);
const installFixture = fileURLToPath(new URL('fixtures/completion-install.mjs', import.meta.url));

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A sandbox with a working directory, and the files the fixture and its child write. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-completion-refresh-'));
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
  return invoke(fixture, [], { env: { COMPLETION_SCENARIO: box.scenario } });
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

const warning = 'Completion was not refreshed after the update.';

test('runs the binary with completion update, host.env, and host.cwd, pipes its output, and resolves', () => {
  const box = sandbox();
  const path = childProgram(
    box,
    `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), from: process.env.FROM_HOST }) + '\\n');
process.stderr.write('child says hello\\n');`,
  );
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  const printed = result.stdout.split('\n').find((line) => line.startsWith('{'));
  expect(JSON.parse(printed ?? '{}')).toMatchObject({
    argv: ['completion', 'update'],
    from: 'yes',
  });
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

test('adds the warn event and writes the pinned line for a path that cannot start', () => {
  const box = sandbox();
  const path = join(box.root, 'missing', 'jsonkit');
  const result = refresh(box, path);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `Completion was not refreshed because ${path} could not start. Run jsonkit completion update.\n`,
  );
  expect(existsSync(box.resolved)).toBe(true);
  const [event, ...rest] = events(box);
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ level: 'warn', message: warning });
  expect(event?.fields.path).toBe(path);
  expect(event?.fields.error).toBeTypeOf('string');
});

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

test('a self-update rewrites a recorded script to the replaced binary’s version', () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-completion-update-'));
  roots.push(root);
  const home = join(root, 'home');
  const data = join(root, 'data');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  // The self-update fixture's application is notes, and the binary it installs is jsonkit.
  const updating = join(state, 'notes', 'installation');
  const installation = join(state, 'jsonkit', 'installation');
  for (const directory of [home, data, state, bin, updating, installation]) {
    mkdirSync(directory, { recursive: true });
  }
  const oldBytes = 'jsonkit 1.4.2 binary\n';
  const binary = join(bin, 'jsonkit');
  writeFileSync(binary, oldBytes);
  chmodSync(binary, 0o755);
  writeFileSync(
    join(updating, 'install.json'),
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  // The old version installed its Bash script, so the record lists it and the file holds it.
  const script = join(data, 'jsonkit', 'completion', 'jsonkit.bash');
  mkdirSync(join(data, 'jsonkit', 'completion'), { recursive: true });
  writeFileSync(script, 'old script\n');
  writeFileSync(
    join(installation, 'completion.bash.json'),
    `{"format":1,"state":"committed","directories":[],"files":[{"path":${JSON.stringify(script)},"digest":"sha256:${digestOf('old script\n')}"}]}\n`,
  );
  // The replacing binary runs the completion fixture application with the arguments it was given.
  const bytes = `#!${process.execPath}\nimport(${JSON.stringify(installFixture)});\n`;
  const scenario = join(root, 'completion-scenario.json');
  writeFileSync(
    scenario,
    JSON.stringify({
      cwd: root,
      env: { HOME: home, XDG_DATA_HOME: data, XDG_STATE_HOME: state },
    }),
  );
  const asset = 'jsonkit-linux-x64';
  const file = join(root, 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      env: { COMPLETION_SCENARIO: scenario, HOME: home, XDG_STATE_HOME: state },
      github: {
        feed: ['v1.5.0'],
        latest: 'v1.5.0',
        releases: {
          'v1.5.0': { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` },
        },
        repository: 'acme/jsonkit',
      },
      hook: 'completion',
      release: {
        build: 'distributed',
        installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: binary },
        release: { asset, channel: 'stable', repository: 'acme/jsonkit', version: '1.4.2' },
      },
      requests: join(root, 'requests.txt'),
    }),
  );
  const result = invoke(updateFixture, [file, 'self-update']);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(`Updated the bash completion script in ${script}.`);
  expect(readFileSync(script, 'utf8')).toBe(bashScript('jsonkit'));
});
