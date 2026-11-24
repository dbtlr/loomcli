import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('conformance rejects unexpected entries in the folders it checks', () => {
  const scratch = fileURLToPath(new URL('../../../../.scratch/', import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'conformance-test-'));
  try {
    const workspace = join(root, 'typescript');
    const corpus = join(root, 'conformance');
    const script = pathToFileURL(join(workspace, 'scripts/check-conformance.mjs'));
    const dist = join(workspace, 'examples/jsonkit/dist');
    const expected = join(corpus, 'expected');
    for (const directory of [
      join(workspace, 'scripts'),
      dist,
      join(corpus, 'cases'),
      join(corpus, 'fixtures'),
      join(expected, 'jsonkit-known'),
      join(expected, 'jsonkit-old'),
      join(expected, 'textstat-old'),
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    copyFileSync(new URL('../../../scripts/check-conformance.mjs', import.meta.url), script);
    writeFileSync(join(dist, 'main.js'), '');
    writeFileSync(
      join(corpus, 'cases/jsonkit.json'),
      JSON.stringify({ cases: [{ app: 'jsonkit', argv: [], id: 'jsonkit-known' }] }),
    );
    writeFileSync(join(expected, 'META.json'), '{}');
    writeFileSync(join(expected, 'NOTES'), 'stray file');
    writeFileSync(join(expected, 'jsonkit-known/exit'), '0\n');
    writeFileSync(join(expected, 'jsonkit-known/stderr'), '');
    writeFileSync(join(expected, 'jsonkit-known/stdout'), '');

    const options = {
      cwd: workspace,
      env: { GIT_CEILING_DIRECTORIES: root, HOME: root },
      runtime: 'node',
    };
    const full = invoke(script, [], options);
    expect(full.status).toBe(1);
    expect(full.stderr).toContain('expected/jsonkit-old');
    expect(full.stderr).toContain('expected/textstat-old');
    expect(full.stderr).toContain('expected/NOTES');
    expect(full.stderr).not.toContain('META.json');

    const filtered = invoke(script, ['--only', 'jsonkit-known'], options);
    expect(filtered.status).toBe(0);
    expect(filtered.stdout).toContain('Checked 1 conformance cases');

    writeFileSync(join(expected, 'jsonkit-known/extra'), 'unexpected file');
    writeFileSync(join(expected, 'jsonkit-known/stdin'), 'the case has no input');
    const unexpected = invoke(script, ['--only', 'jsonkit-known'], options);
    expect(unexpected.status).toBe(1);
    expect(unexpected.stderr).toContain('expected/jsonkit-known/extra');
    expect(unexpected.stderr).toContain('expected/jsonkit-known/stdin');
  } finally {
    rmSync(root, { recursive: true });
  }
});
