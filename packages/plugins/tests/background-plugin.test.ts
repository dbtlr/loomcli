import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/background-run.mjs', import.meta.url);

/** The Loom theme's highlight on each background at truecolor, around the word it styles. */
const highlight = {
  dark: '\u001b[38;2;201;123;54mSaved\u001b[39m',
  light: '\u001b[38;2;156;90;30mSaved\u001b[39m',
};

test('the scripted light terminal answers the query, and the Loom theme prints its light side', () => {
  expect(invoke(fixture, [])).toEqual({
    status: 0,
    stderr: 'queried 1\n',
    stdout: `${highlight.light} light\n`,
  });
});

test('--background=dark prints the dark side and writes no query', () => {
  expect(invoke(fixture, ['--background=dark'])).toEqual({
    status: 0,
    stderr: 'queried 0\n',
    stdout: `${highlight.dark} dark\n`,
  });
});

test('--background=blue fails validation with exit 2 and the plugin issue', () => {
  const result = invoke(fixture, ['--background=blue']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Supply dark or light.');
});

test('help lists the option with its description and accepted values', () => {
  const page = invoke(fixture, ['--help'])
    .stdout.replaceAll(String.fromCodePoint(27), '')
    .replaceAll(/\[[\d;]*m/gu, '');
  expect(page).toContain(
    '--background <background>  Pick colors for this terminal background instead of detecting it.',
  );
  expect(page).toContain('One of: dark, light.');
});

test('the manifest marks the option control and background with the enum schema', () => {
  const document = JSON.parse(invoke(fixture, ['--manifest']).stdout);
  const globals = Object.fromEntries(
    document.globals.map((entry: { name: string }) => [entry.name, entry]),
  );
  expect(globals.background).toMatchObject({
    background: true,
    control: true,
    schema: { enum: ['dark', 'light'] },
    type: 'string',
  });
  expect(globals.tag.background).toBe(false);
});
