import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'apps/loom/dist/main.js');
const temporary = mkdtempSync(join(tmpdir(), 'loom-publication-rehearsal-'));
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
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
  const base = run(source, 'git', ['rev-parse', 'HEAD']);
  run(source, 'node', [cli, 'changelog', 'write', '--initial', '--date', '2026-09-08']);
  run(source, 'git', ['add', '.']);
  run(source, 'git', [
    '-c',
    'user.name=Release rehearsal',
    '-c',
    'user.email=rehearsal@example.invalid',
    'commit',
    '-m',
    'chore(release): Release v0.1.0 - Rehearsal',
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
      'chore(release): Release v0.1.0 - Rehearsal',
      '--output',
      artifacts,
      '--runtime',
      runtime,
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
  for (const [file, bytes] of retained) {
    assert.deepEqual(readFileSync(join(downloaded, file)), bytes);
  }
  process.stdout.write(
    `${JSON.stringify({ ...result, packages: manifest.packages.map(({ name, integrity }) => ({ integrity, name })), reused: true, runtime }, null, 2)}\n`,
  );
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
