import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.ts';

const scratch = fileURLToPath(new URL('../../../../.scratch/', import.meta.url));
const script = new URL('../../../scripts/check-conformance.mjs', import.meta.url);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixture() {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'test-conformance-'));
  roots.push(root);
  const workspace = join(root, 'typescript');
  const entry = join(workspace, 'scripts/check-conformance.mjs');
  const expected = join(root, 'conformance/expected');
  const env = childEnvironment({ CI: '1', GIT_CEILING_DIRECTORIES: scratch });
  const put = (path: string, contents: string) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  mkdirSync(dirname(entry), { recursive: true });
  copyFileSync(script, entry);
  put('typescript/package.json', '{"type":"module"}');
  put(
    'typescript/examples/jsonkit/dist/main.js',
    `import { readFileSync, writeFileSync } from 'node:fs';
     if (process.env.CI) process.exit(77);
     if (process.argv[2] === 'leak') console.error(process.execPath);
     else {
       console.log(readFileSync('message.txt', 'utf8'));
       writeFileSync(process.argv[2], process.env.WORK);
     }`,
  );
  put('typescript/examples/textstat/dist/main.js', '');
  put('conformance/fixtures/message.txt', 'from fixture');
  put(
    'conformance/cases/jsonkit.json',
    JSON.stringify({
      cases: [
        { app: 'jsonkit', argv: ['{sandbox}/out'], env: { WORK: '{sandbox}' }, id: 'jsonkit-ok' },
      ],
    }),
  );
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, env, stdio: 'ignore', timeout: 10_000 });
  git(['init']);
  git([
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.org',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);

  return {
    expected,
    put,
    run: (...args: string[]) =>
      spawnSync(process.execPath, [entry, ...args], {
        cwd: workspace,
        encoding: 'utf8',
        env,
        timeout: 10_000,
      }),
  };
}

test('updates sandboxed output and reports the case and parts that differ on a check', () => {
  const { expected, run } = fixture();
  const update = run('--update');
  expect(update.stderr).toBe('');
  expect(update.status).toBe(0);
  expect(run().status).toBe(0);
  expect(readFileSync(join(expected, 'jsonkit-ok/files/out'), 'utf8')).toBe('{sandbox}');
  writeFileSync(join(expected, 'jsonkit-ok/stdout'), 'changed');
  writeFileSync(join(expected, 'jsonkit-ok/files/out'), 'changed');
  const check = run();
  expect(check.status).toBe(1);
  expect(check.stderr).toContain('jsonkit-ok: stdout, files');
  expect(readFileSync(join(expected, 'jsonkit-ok/stdout'), 'utf8')).toBe('changed');
});

test('an --update --only replaces a selected folder that holds an entry its case no longer has', () => {
  const { expected, put, run } = fixture();
  expect(run('--update').status).toBe(0);
  put('conformance/expected/jsonkit-ok/stdin', 'stdin the case no longer sends');
  expect(run().status).toBe(1);
  const update = run('--update', '--only', 'jsonkit-ok');
  expect(update.stderr).toBe('');
  expect(update.status).toBe(0);
  expect(existsSync(join(expected, 'jsonkit-ok/stdin'))).toBe(false);
  expect(run().status).toBe(0);
});

test('a failed --update --only leaves every selected expectation untouched', () => {
  const { expected, put, run } = fixture();
  expect(run('--update').status).toBe(0);
  put('conformance/expected/jsonkit-ok/stdout', 'kept');
  put(
    'conformance/cases/jsonkit.json',
    JSON.stringify({
      cases: [
        { app: 'jsonkit', argv: ['{sandbox}/out'], env: { WORK: '{sandbox}' }, id: 'jsonkit-ok' },
        { app: 'jsonkit', argv: ['leak'], id: 'jsonkit-leak' },
      ],
    }),
  );
  const update = run('--update', '--only', 'jsonkit-');
  expect(update.status).toBe(1);
  expect(update.stderr).toContain('jsonkit-leak: output embeds machine path');
  expect(readFileSync(join(expected, 'jsonkit-ok/stdout'), 'utf8')).toBe('kept');
});
