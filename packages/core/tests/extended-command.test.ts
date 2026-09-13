import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(mode: string) {
  const result = invoke(new URL('fixtures/extended-command.mjs', import.meta.url), [mode]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

test('an imported-style completed Command accepts immutable whole-value extension replacement', () => {
  expect(JSON.parse(run('inspect'))).toEqual({
    after: { details: 'Application help.' },
    aliases: ['r'],
    before: { details: 'Library help.', examples: ['library'] },
    cloned: true,
    description: 'Reads a value.',
    frozen: true,
    identities: ['test/help', 'test/other'],
    other: 'retained',
    root: 'root',
  });
  expect(JSON.parse(run('invoke'))).toEqual({
    args: { path: 'document' },
    options: { quiet: true, raw: true },
  });
});

test.each([
  ['duplicate', 'holds extension "test/help" twice'],
  ['invalid', 'holds an invalid "test/help" value'],
  [
    'twin',
    'Extension "test/help" is defined twice. Install one copy of the package that defines it.',
  ],
  ['target', 'which applies to options'],
  ['late', 'declares option "extra" after its action'],
])('extension layering rejects %s without hiding earlier declarations', (scenario, message) => {
  expect(run(scenario)).toContain(message);
});
