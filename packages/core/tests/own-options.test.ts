import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The record the fixture plugin's middleware read, the run's exit code, and its stderr. */
function owned(words: string[]) {
  const { stderr, stdout } = invoke(new URL('fixtures/own-options.mjs', import.meta.url), words);
  const [record = '{}', exit = ''] = stdout.split('\n');
  const { frozen, own }: { frozen: boolean; own: unknown } = JSON.parse(record);
  return { exit, frozen, own, stderr };
}

test("a middleware reads its plugin's own validated options, global and hook-declared, and no one else's", () => {
  expect(owned(['get', '--mine', 'abc', '--local', 'xyz', '--app', 'q', '--theirs', 't'])).toEqual({
    exit: 'exit:0',
    frozen: true,
    own: { local: 'XYZ', mine: 'ABC', spare: '<undefined>' },
    stderr: '',
  });
});

test('its own options stand under a validation problem on another input', () => {
  expect(owned(['get', '--mine', 'abc', '--local', 'xyz', '--depth', 'x'])).toMatchObject({
    exit: 'exit:2',
    own: { local: 'XYZ', mine: 'ABC', spare: '<undefined>' },
  });
});

test('under a held structural fault core still validates a hook-declared option whose tokens parsed, and the fault stays held', () => {
  const bogus = owned(['get', '--mine', 'abc', '--local', 'xyz', '--bogus']);
  expect(bogus).toMatchObject({
    exit: 'exit:2',
    own: { local: 'XYZ', mine: 'ABC', spare: '<undefined>' },
  });
  expect(bogus.stderr).toContain('owns: Unknown option "--bogus".');
  for (const value of ['bad', 'throw']) {
    const rejected = owned(['get', '--bogus', '--local', value]);
    expect(rejected).toMatchObject({
      exit: 'exit:2',
      own: { mine: '<undefined>', spare: '<undefined>' },
    });
    expect(rejected.stderr).toBe(
      'owns: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
    );
  }
});

test('an option is absent when its validator rejected its own value', () => {
  expect(owned(['get', '--local', 'bad']).own).toEqual({
    mine: '<undefined>',
    spare: '<undefined>',
  });
  expect(owned(['get', '--mine', 'bad', '--local', 'xyz']).own).toEqual({
    local: 'XYZ',
    spare: '<undefined>',
  });
});

test('an option is absent when its own occurrence faulted, or when a structural fault is held and it was omitted', () => {
  expect(owned(['get', '--bogus', '--local']).own).toEqual({
    mine: '<undefined>',
    spare: '<undefined>',
  });
  expect(owned(['get', '--local', 'abc', '--local', 'def']).own).toEqual({
    mine: '<undefined>',
    spare: '<undefined>',
  });
  expect(owned(['get', '--mine', 'abc', '--mine', 'def', '--local', 'xyz']).own).toEqual({
    local: 'XYZ',
    spare: '<undefined>',
  });
  expect(owned(['get', '--bogus']).own).toEqual({ mine: '<undefined>', spare: '<undefined>' });
});
