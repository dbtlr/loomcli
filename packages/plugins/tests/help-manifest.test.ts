import { expect, test } from 'vite-plus/test';

import { run as fixtureRun } from './fixtures/help-manifest.mjs';
import { run as rulesRun } from './fixtures/manifest-rules.mjs';

/** The manifest values each Command carries, then help's own value on `noted`, for one scenario. */
async function read(scenario: string): Promise<unknown[]> {
  const result = await fixtureRun([scenario]);
  expect(result.stderr).toBe('');
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

test('help supplies its details and examples to the manifest, after the author value, with no manifest plugin', async () => {
  const fixtureResult1 = await read('supplied');
  expect(fixtureResult1[0]).toEqual({
    detailed: [{ details: 'Details alone.' }],
    empty: [],
    noted: [{ details: 'Only an agent needs this.' }, { examples: [{ command: 'noted y' }] }],
    plain: [],
    root: [
      {
        details: 'The whole fixture.\nIts second line.',
        examples: [{ command: 'noted x', note: 'One example.' }],
      },
    ],
  });
});

test('help supplies what it read at its own turn, whatever a later hook does to its value', async () => {
  const [manifest, help] = await read('replaced-later');
  expect(manifest).toMatchObject({
    noted: [{ details: 'Only an agent needs this.' }, { examples: [{ command: 'noted y' }] }],
  });
  expect(help).toEqual({ helpOnNoted: { details: 'Replaced after help.' } });
});

test('without help installed, the manifest holds the author values alone', async () => {
  const fixtureResult2 = await read('no-help');
  expect(fixtureResult2[0]).toEqual({
    detailed: [],
    empty: [],
    noted: [{ details: 'Only an agent needs this.' }],
    plain: [],
    root: [],
  });
});

/** What one manifest value case reports: no fault, or the declaration error its call raised. */
async function rule(name: string): Promise<unknown> {
  const result = await rulesRun([name]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The declaration error one rejected manifest value on `get` reports. */
function invalid(message: string) {
  return {
    fault: 'DeclarationError',
    message: `Command "get" holds an invalid "@loomcli/plugins/manifest/command" value: ${message} Correct the value.`,
  };
}

test('manifestCommand applies the line and Markdown rules help applies', async () => {
  const line = 'Supply one line that holds a character other than whitespace.';
  await expect(rule('valid')).resolves.toEqual({ fault: null });
  await expect(rule('markdown-blank-lines')).resolves.toEqual({ fault: null });
  await expect(rule('blank-details')).resolves.toEqual(
    invalid('Supply Markdown that holds a character other than whitespace.'),
  );
  await expect(rule('command-on-two-lines')).resolves.toEqual(invalid(line));
  await expect(rule('note-on-two-lines')).resolves.toEqual(invalid(line));
});
