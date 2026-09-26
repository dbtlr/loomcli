import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/spellings.mjs', import.meta.url);

/** The spellings record the fixture plugin's middleware read for one invocation. */
function spellingsOf(argv: string[], env: Record<string, string> = {}) {
  const result = invoke(fixture, argv, { env });
  expect(result.stderr).toBe('');
  const lines = result.stdout.split('\n');
  // Each line the middleware printed is `<label>:<JSON>`.
  const read = (label: string) =>
    JSON.parse(lines.find((line) => line.startsWith(`${label}:`))?.slice(label.length + 1) ?? '');
  return { frozen: read('frozen'), options: read('options'), spellings: read('spellings') };
}

test.each([
  [['--flag'], { flag: '--flag' }],
  [['-f'], { flag: '-f' }],
  [['--no-flag'], { flag: '--no-flag' }],
  [['--mode=fancy'], { mode: '--mode' }],
  [['-qf'], { flag: '-f', quiet: '-q' }],
  [['-n', 'a', '--name', 'b'], { name: '--name' }],
  [['--name', 'a', '-n', 'b'], { name: '-n' }],
] satisfies [string[], Record<string, string>][])(
  'a middleware reads the spelling that supplied each of its options for %j',
  (argv, spellings) => {
    expect(spellingsOf(argv).spellings).toEqual(spellings);
  },
);

test('an option filled by an input source or left to its default has no spelling', () => {
  const read = spellingsOf([], {
    FIXTURE_LEVEL: 'debug',
    FIXTURE_SETTINGS: JSON.stringify({ from: 'settings' }),
  });
  expect(read.options).toMatchObject({ from: 'settings', level: 'debug', mode: 'plain' });
  expect(read.spellings).toEqual({});
});

test('another plugin and the application keep their spellings from a middleware', () => {
  expect(spellingsOf(['--loud', '-F', 'doc.json', '--local', '-q']).spellings).toEqual({
    quiet: '-q',
  });
});

test('the spellings record is frozen', () => {
  expect(spellingsOf(['-q']).frozen).toBe(true);
});
