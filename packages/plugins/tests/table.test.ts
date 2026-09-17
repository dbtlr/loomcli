import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/table.mjs', import.meta.url);

test('table() renders explicit columns through out.render', () => {
  expect(invoke(fixture, ['explicit'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  source\n    6  one.txt\n    2  two words.txt\nresolved:0\n',
  });
});

test('table() discovers own keys in first-seen order when columns are omitted', () => {
  expect(invoke(fixture, ['defaults'])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'source         count  extra\none.txt        6      \ntwo words.txt  2      yes\nresolved:0\n',
  });
});

test('table() renders as a declared whole view through out.results', () => {
  expect(invoke(fixture, ['declared'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'source        count\ndeclared.txt  3\nresolved:0\n',
  });
});

test('table() permits one key twice with independent formatting', () => {
  expect(invoke(fixture, ['duplicate-key'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'COUNT  TENS\n2      20\nresolved:0\n',
  });
});

test('table() prints null and undefined as empty cells', () => {
  expect(invoke(fixture, ['nullish'])).toEqual({
    status: 0,
    stderr: '',
    stdout: `nullish  missing  end\n${' '.repeat(18)}x\nresolved:0\n`,
  });
});

test('table() measures wide and styled cells with the view context', () => {
  expect(invoke(fixture, ['styled-wide'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'N       count\n猫猫        1\nstyled     20\nresolved:0\n',
  });
});

test('table() leaves formatted text authored and escapes default data cells', () => {
  const result = invoke(fixture, ['escape']);
  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(marker);
  expect(result.stdout).toContain('  data\nresolved:0\n');
  expect(result.stdout.split(marker)).toHaveLength(2);
});

test('table() prints only configured headers for an empty sequence', () => {
  expect(invoke(fixture, ['empty-explicit'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'source  count\nresolved:0\n',
  });
});

test('table() prints nothing for an empty sequence with no known columns', () => {
  expect(invoke(fixture, ['empty-default'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'resolved:0\n',
  });
});
