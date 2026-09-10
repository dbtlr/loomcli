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

/** The help page the packed plugins render, written by hand from the page rules. */
const page = [
  'greeter · Greet one subject.',
  '',
  '  The greeting is printed before the subject.',
  '',
  'USAGE',
  '  greeter <subject> [options]',
  '',
  'ARGUMENTS',
  '  subject  Who to greet.',
  '',
  'OPTIONS',
  '  -g, --greeting <word>  The greeting to print.  (default: hello)',
  '  -h, --help             Show this help.',
  '  -V, --version          Print the version.',
  '',
  'EXAMPLES',
  '  $ greeter world --greeting packed',
  '    The line this check compares.',
  '',
].join('\n');

// Three fixed invocations, so the printed bytes are the whole contract the packed packages satisfy.
const invocations = [
  {
    argv: ['world', '--greeting', 'packed'],
    expected: 'packed: world\n',
    reads: 'the action line',
  },
  { argv: ['--help'], expected: page, reads: 'the help page' },
  { argv: ['--version'], expected: 'greeter v1.0.0\n', reads: 'the version line' },
];

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
  pnpm(['pack', '--out', join(temporary, 'core.tgz')], join(root, 'packages/core'));
  pnpm(['pack', '--out', join(temporary, 'plugins.tgz')], join(root, 'packages/plugins'));
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@loomcli/core': 'file:./core.tgz',
        '@loomcli/plugins': 'file:./plugins.tgz',
      },
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
    for (const { argv, expected, reads } of invocations) {
      const runtime = run(runtimes.get(name), [entry, ...argv], temporary);
      assert.equal(runtime.status, 0, `${name} exited with ${runtime.status}: ${runtime.output}`);
      assert.equal(
        runtime.stdout,
        expected,
        `${name} printed unexpected bytes for ${reads}: ${runtime.output}`,
      );
    }
  }
  process.stdout.write(
    `Packed @loomcli/core and @loomcli/plugins ${version}: ${selected.join(' and ')} ran the installed tarballs and printed ${invocations.length} expected outputs, the action line, the help page, and the version line.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
