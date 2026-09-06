import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from 'vite-plus/test';

test('textstat counts file bytes through the built public package', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    writeFileSync(join(directory, 'two words.txt'), 'é');
    const stdout = execFileSync(
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      [resolve('examples/textstat/dist/main.js'), 'one.txt', 'two words.txt'],
      { cwd: directory, encoding: 'utf8' },
    );
    expect(stdout).toBe('6\tone.txt\n2\ttwo words.txt\n');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
