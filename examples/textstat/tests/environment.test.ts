import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** One textstat run over piped text, with the variables one test sets. */
function count(argv: string[], env: Record<string, string>, input = 'abc') {
  return invoke(main, argv, { env, input });
}

test('TEXTSTAT_MIN_BYTES stands in for --min-bytes, and the flag wins over it', () => {
  expect(count([], { TEXTSTAT_MIN_BYTES: '4' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n',
  });
  expect(count(['--min-bytes', '3'], { TEXTSTAT_MIN_BYTES: '4' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  SOURCE\n    3  stdin\n',
  });
  // An empty variable is unset, so the declared default applies.
  expect(count([], { TEXTSTAT_MIN_BYTES: '' }).stdout).toBe('COUNT  SOURCE\n    3  stdin\n');
});

test('a rejected TEXTSTAT_MIN_BYTES names the variable after the option', () => {
  expect(count([], { TEXTSTAT_MIN_BYTES: '10KB' })).toEqual({
    status: 2,
    stderr:
      'Invalid input: Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.\n',
    stdout: '',
  });
});

test('TEXTSTAT_TOTAL reads the Boolean grammar', () => {
  expect(count([], { TEXTSTAT_TOTAL: 'TRUE' }).stdout).toBe(
    'COUNT  SOURCE\n    3  stdin\n    3  total\n',
  );
  expect(count([], { TEXTSTAT_TOTAL: '0' }).stdout).toBe('COUNT  SOURCE\n    3  stdin\n');
  expect(count([], { TEXTSTAT_TOTAL: 'yes' })).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--total" (from TEXTSTAT_TOTAL): Use true, false, 1, or 0.\n',
    stdout: '',
  });
});

test('help takes over a run whose variable is outside the grammar', () => {
  const result = count(['--help'], { TEXTSTAT_TOTAL: 'yes' });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('USAGE');
});
