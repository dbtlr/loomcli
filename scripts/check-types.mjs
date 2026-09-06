import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const { version } = typescript;
const packageManager = process.env.npm_execpath;
assert.ok(packageManager, 'Run this check through pnpm run check:types.');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return { output: result.stdout + result.stderr, status: result.status };
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

function compile(cwd) {
  return run(process.execPath, [compiler, '-p', 'tsconfig.json', '--pretty', 'false'], cwd);
}

const source = join(root, 'tests/type-consumer');
const workspace = compile(source);
assert.equal(workspace.status, 0, workspace.output);

const temporary = await mkdtemp(join(tmpdir(), 'loom-type-consumer-'));
try {
  const tarball = join(temporary, 'core.tgz');
  pnpm(['pack', '--out', tarball], join(root, 'packages/core'));
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: { '@loom/core': 'file:./core.tgz' },
      private: true,
      type: 'module',
    }),
  );
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false'], temporary);
  const packed = compile(temporary);
  assert.equal(packed.status, 0, packed.output);

  const expected = [];
  const files = await readdir(temporary);
  for (const file of files.filter((entry) => entry.endsWith('.ts'))) {
    const path = join(temporary, file);
    const contents = await readFile(path, 'utf8');
    const lines = contents.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const directive = /@ts-expect-error TS(?<code>\d+):/.exec(lines[index]);
      if (directive) {
        const { code } = directive.groups;
        expected.push(`${file}:${index + 2}:TS${code}`);
        lines[index] = '';
      }
    }
    await writeFile(path, lines.join('\n'));
  }
  assert.ok(expected.length > 0, 'No negative declaration assertions found.');
  const negative = compile(temporary);
  assert.notEqual(negative.status, 0, 'Invalid SDK uses unexpectedly compiled.');
  const actual = [
    ...negative.output.matchAll(/(?<file>[^\n]+)\((?<line>\d+),\d+\): error TS(?<code>\d+):/g),
  ].map(({ groups: { file, line, code } }) => `${basename(file)}:${line}:TS${code}`);
  assert.deepEqual(actual.toSorted(), expected.toSorted(), negative.output);
  process.stdout.write(
    `TypeScript ${version}: workspace and packed declarations passed; ${expected.length} rejected SDK uses produced the expected diagnostics.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
