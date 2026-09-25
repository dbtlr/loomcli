import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/help-manifest.mjs', import.meta.url);

/** The manifest values each Command carries, then help's own value on `noted`, for one scenario. */
function read(scenario: string): unknown[] {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

test('help supplies its details and examples to the manifest, after the author value, with no manifest plugin', () => {
  expect(read('supplied')[0]).toEqual({
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

test('help supplies what it read at its own turn, whatever a later hook does to its value', () => {
  const [manifest, help] = read('replaced-later');
  expect(manifest).toMatchObject({
    noted: [{ details: 'Only an agent needs this.' }, { examples: [{ command: 'noted y' }] }],
  });
  expect(help).toEqual({ helpOnNoted: { details: 'Replaced after help.' } });
});

test('without help installed, the manifest holds the author values alone', () => {
  expect(read('no-help')[0]).toEqual({
    detailed: [],
    empty: [],
    noted: [{ details: 'Only an agent needs this.' }],
    plain: [],
    root: [],
  });
});

/** What one manifest value case reports: no fault, or the declaration error its call raised. */
function rule(name: string): unknown {
  const result = invoke(new URL('fixtures/manifest-rules.mjs', import.meta.url), [name]);
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

test('manifestCommand applies the line and prose rules help applies', () => {
  const line = 'Supply one line that holds a character other than whitespace.';
  expect(rule('valid')).toEqual({ fault: null });
  expect(rule('blank-prose-line')).toEqual(
    invalid('Supply prose whose every line holds a character other than whitespace.'),
  );
  expect(rule('command-on-two-lines')).toEqual(invalid(line));
  expect(rule('note-on-two-lines')).toEqual(invalid(line));
});
