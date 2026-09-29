import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { removeRoots, temporaryRoot } from './fixture.js';

/** The built writer, which a fixture build script imports by its file URL. */
const writer = new URL('../dist/build.js', import.meta.url);

/** How long a Bun build may take before the test fails. */
const buildTimeout = 60_000;

afterEach(() => {
  removeRoots();
});

/** One command's output, failing the test when it does not exit 0. */
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: buildTimeout });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/**
 * An application package whose entry prints the packet it imports, and a build script that bundles
 * it with `packet()` into `dist/main.js` and compiles it into `dist/app`.
 */
function application() {
  const root = temporaryRoot('loom-packet-');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'loom.packet.json'), '{ "build": "development", "channel": "npm" }\n');
  writeFileSync(
    join(root, 'src/main.ts'),
    "import packet from '../loom.packet.json' with { type: 'json' };\n\nconsole.log(JSON.stringify(packet));\n",
  );
  writeFileSync(
    join(root, 'build.ts'),
    [
      `import { packet } from '${writer.href}';`,
      '',
      "const bundled = await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });",
      "const compiled = await Bun.build({ compile: { outfile: 'dist/app' }, entrypoints: ['src/main.ts'], plugins: [packet()] });",
      'if (!bundled.success || !compiled.success) {',
      '  throw new AggregateError([...bundled.logs, ...compiled.logs]);',
      '}',
      '',
    ].join('\n'),
  );
  return root;
}

test('packet() writes distributed into the bundle and the compiled binary, and leaves the source packet alone', () => {
  const root = application();
  run('bun', ['build.ts'], root);
  const distributed = '{"build":"distributed","channel":"npm"}\n';
  expect(run('node', ['dist/main.js'], root)).toBe(distributed);
  expect(run('bun', ['dist/main.js'], root)).toBe(distributed);
  expect(run(join(root, 'dist/app'), [], root)).toBe(distributed);
  // The source run still reads the development packet, which the build never rewrote.
  expect(run('bun', ['src/main.ts'], root)).toBe('{"build":"development","channel":"npm"}\n');
  expect(readFileSync(join(root, 'loom.packet.json'), 'utf8')).toBe(
    '{ "build": "development", "channel": "npm" }\n',
  );
});

/** The probe application, whose action throws a foreign error. */
const probe = new URL('fixtures/probe/', import.meta.url);

/** The probe bundled with `packet()` and compiled, in a directory the test removes. */
function builtProbe() {
  const out = temporaryRoot('loom-probe-');
  run('bun', [fileURLToPath(new URL('build.mjs', probe)), out], fileURLToPath(probe));
  return out;
}

/** One run of a probe artifact or source file: its exit status and what it wrote. */
function attempt(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: buildTimeout });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** The runtime the process tests run a bundle under. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

const generic = { status: 1, stderr: 'probe: Something went wrong.\n', stdout: '' };

test('a defect writes the generic message from a bundle and a compiled binary, and its Developer Diagnostic from source', () => {
  const out = builtProbe();
  expect(attempt(runtime, [join(out, 'main.js')])).toEqual(generic);
  expect(attempt(join(out, 'probe'), [])).toEqual(generic);
  const source = attempt('bun', [fileURLToPath(new URL('src/main.ts', probe))]);
  expect(source.status).toBe(1);
  expect(source.stderr).toMatch(
    /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe probe cannot read its input\.\n\n/u,
  );
  expect(source.stderr).toContain('TypeError: The probe cannot read its input.\n');
});

test('a probe given no packet writes the generic message from source and from a bundle', () => {
  const out = builtProbe();
  expect(attempt(runtime, [join(out, 'unpacked.js')])).toEqual(generic);
  expect(attempt('bun', [fileURLToPath(new URL('src/unpacked.ts', probe))])).toEqual(generic);
});
