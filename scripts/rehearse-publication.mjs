import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'apps/loom/dist/main.js');
const temporary = mkdtempSync(join(tmpdir(), 'loom-publication-rehearsal-'));
const runtimes = (
  process.env.LOOM_REHEARSAL_RUNTIMES ??
  process.env.LOOM_TEST_RUNTIME ??
  'node'
).split(',');
assert.ok(
  runtimes.length > 0 && runtimes.every((runtime) => ['node', 'bun'].includes(runtime)),
  'Expected node, bun, or node,bun.',
);
function run(cwd, command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 600_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}
try {
  const source = join(temporary, 'source');
  const artifacts = join(temporary, 'artifacts');
  const downloaded = join(temporary, 'downloaded');
  run(root, 'git', ['clone', '--no-hardlinks', '--', root, source]);
  const currentVersion = JSON.parse(
    readFileSync(join(source, 'packages/core/package.json'), 'utf8'),
  ).version;
  const initial = currentVersion === '0.0.0';
  if (!initial) {
    // An unpublished cut has no version tag yet. Only this isolated clone treats it as a baseline.
    const baseline = `v${currentVersion}`;
    if (run(source, 'git', ['tag', '--list', baseline]) === '') {
      run(source, 'git', ['tag', baseline]);
    }
    writeFileSync(
      join(source, '.changes/publication-rehearsal.md'),
      '- Verify the isolated publication rehearsal.\n',
    );
    run(source, 'git', ['add', '.changes/publication-rehearsal.md']);
    run(source, 'git', [
      '-c',
      'user.name=Release rehearsal',
      '-c',
      'user.email=rehearsal@example.invalid',
      'commit',
      '-m',
      'Prepare a rehearsal fragment',
    ]);
  }
  const base = run(source, 'git', ['rev-parse', 'HEAD']);
  run(source, 'node', [
    cli,
    'changelog',
    'write',
    ...(initial ? ['--initial'] : []),
    '--date',
    '2026-09-08',
  ]);
  const version = JSON.parse(
    readFileSync(join(source, 'packages/core/package.json'), 'utf8'),
  ).version;
  const title = `chore(release): Release v${version} - Rehearsal`;
  run(source, 'git', ['add', '.']);
  run(source, 'git', [
    '-c',
    'user.name=Release rehearsal',
    '-c',
    'user.email=rehearsal@example.invalid',
    'commit',
    '-m',
    title,
  ]);
  const head = run(source, 'git', ['rev-parse', 'HEAD']);
  process.stdout.write(`Preparing ${head} from ${base}.\n`);
  const result = JSON.parse(
    run(source, 'node', [
      cli,
      'publication',
      'prepare',
      '--base',
      base,
      '--head',
      head,
      '--title',
      title,
      '--output',
      artifacts,
      '--runtime',
      'node',
    ]),
  );
  const manifest = JSON.parse(readFileSync(join(artifacts, 'manifest.json'), 'utf8'));
  cpSync(artifacts, downloaded, { recursive: true });
  rmSync(artifacts, { recursive: true });
  const retained = new Map(
    manifest.packages.map((library) => [
      library.file,
      readFileSync(join(downloaded, library.file)),
    ]),
  );
  writeFileSync(
    join(source, 'repair-marker'),
    'A machinery repair must not replace the release source.\n',
  );
  run(source, 'git', ['add', 'repair-marker']);
  run(source, 'git', [
    '-c',
    'user.name=Release rehearsal',
    '-c',
    'user.email=rehearsal@example.invalid',
    'commit',
    '-m',
    'Rehearse a later machinery repair',
  ]);
  for (const runtime of runtimes) {
    process.stdout.write(`Verifying downloaded set ${result.digest} under ${runtime}.\n`);
    run(source, 'node', [
      cli,
      'publication',
      'verify',
      '--artifacts',
      downloaded,
      '--digest',
      result.digest,
      '--head',
      head,
      '--runtime',
      runtime,
    ]);
  }
  for (const [file, bytes] of retained) {
    assert.deepEqual(readFileSync(join(downloaded, file)), bytes);
  }
  process.stdout.write(
    `${JSON.stringify({ ...result, packages: manifest.packages.map(({ name, integrity }) => ({ integrity, name })), reused: true, runtimes }, null, 2)}\n`,
  );
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
