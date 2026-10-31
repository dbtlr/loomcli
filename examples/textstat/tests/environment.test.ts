import { expect, test } from 'vite-plus/test';

import { run } from './run.js';

/** One textstat run over piped text, with the variables one test sets. */
async function count(argv: string[], env: Record<string, string>, input = 'abc') {
  return run(argv, { env, input });
}

/** The same run, read as the text it printed. */
async function counted(argv: string[], env: Record<string, string>) {
  const { stdout } = await count(argv, env);
  return stdout;
}

test('TEXTSTAT_MIN_BYTES stands in for --min-bytes, and the flag wins over it', async () => {
  await expect(count([], { TEXTSTAT_MIN_BYTES: '4' })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n',
  });
  await expect(count(['--min-bytes', '3'], { TEXTSTAT_MIN_BYTES: '4' })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    3  stdin\n',
  });
  // An empty variable is unset, so the declared default applies.
  await expect(counted([], { TEXTSTAT_MIN_BYTES: '' })).resolves.toBe(
    'COUNT  SOURCE\n    3  stdin\n',
  );
});

test('a rejected TEXTSTAT_MIN_BYTES names the variable after the option', async () => {
  await expect(count([], { TEXTSTAT_MIN_BYTES: '10KB' })).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
});

test('TEXTSTAT_TOTAL reads the Boolean grammar', async () => {
  await expect(counted([], { TEXTSTAT_TOTAL: 'TRUE' })).resolves.toBe(
    'COUNT  SOURCE\n    3  stdin\n    3  total\n',
  );
  await expect(counted([], { TEXTSTAT_TOTAL: '0' })).resolves.toBe('COUNT  SOURCE\n    3  stdin\n');
  await expect(count([], { TEXTSTAT_TOTAL: 'maybe' })).resolves.toEqual({
    status: 2,
    stderr:
      'textstat: Option "--total" (from TEXTSTAT_TOTAL): Use true, false, yes, no, y, n, on, off, 1, or 0.\nRun "textstat --help" to see the usage.\n',
    stdout: '',
  });
});

test('help takes over a run whose variable is outside the grammar', async () => {
  const result = await count(['--help'], { TEXTSTAT_TOTAL: 'maybe' });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('USAGE');
});
