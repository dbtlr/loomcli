import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const { version } = require('../package.json');
const packageManager = process.env.npm_execpath;
assert.ok(packageManager, 'Run this check through pnpm run check:packed.');

// A runtime name selects an executable, the way the process tests select one.
const runtimes = new Map([
  ['bun', 'bun'],
  ['node', process.execPath],
]);
const requested = process.env.LOOM_TEST_RUNTIME ?? '';
const selected = requested === '' ? [...runtimes.keys()] : [requested];
for (const name of selected) {
  assert.ok(runtimes.has(name), `LOOM_TEST_RUNTIME accepts node or bun, not "${name}".`);
}

// One fixed invocation, so the printed line is the whole contract the packed package must satisfy.
const invocation = ['world', '--greeting', 'packed'];
const expected = 'packed: world\n';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return { output: result.stdout + result.stderr, status: result.status, stdout: result.stdout };
}

function pnpm(args, cwd) {
  let command = packageManager;
  let commandArgs = args;
  if (/\.[cm]?js$/.test(packageManager)) {
    command = process.execPath;
    commandArgs = [packageManager, ...args];
  }
  const result = run(command, commandArgs, cwd);
  assert.equal(result.status, 0, result.output);
}

const source = fileURLToPath(new URL('runtime-consumer', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'loom-runtime-consumer-'));
try {
  const tarball = join(temporary, 'core.tgz');
  pnpm(['pack', '--out', tarball], join(root, 'packages/core'));
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: { '@loomcli/core': 'file:./core.tgz' },
      private: true,
      type: 'module',
    }),
  );
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false'], temporary);

  // JavaScript emit proves the consumer runs what it compiled, not what a loader interpreted.
  const compiled = run(
    process.execPath,
    [compiler, '-p', 'tsconfig.json', '--pretty', 'false'],
    temporary,
  );
  assert.equal(compiled.status, 0, compiled.output);

  const entry = join(temporary, 'dist/main.js');
  for (const name of selected) {
    const runtime = run(runtimes.get(name), [entry, ...invocation], temporary);
    assert.equal(runtime.status, 0, `${name} exited with ${runtime.status}: ${runtime.output}`);
    assert.equal(runtime.stdout, expected, `${name} printed unexpected output: ${runtime.output}`);
  }
  process.stdout.write(
    `Packed @loomcli/core ${version}: ${selected.join(' and ')} ran the installed tarball and printed the expected line.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
