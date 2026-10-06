import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/**
 * The record the fixture plugin's middleware read, the run's exit code, its stderr, and how many
 * times the word validator was called with each value.
 */
function owned(words: string[], env: Record<string, string> = {}) {
  const { stderr, stdout } = invoke(new URL('fixtures/own-options.mjs', import.meta.url), words, {
    env,
  });
  const [record = '{}', exit = '', counted = '{}'] = stdout.split('\n');
  const { frozen, own }: { frozen: boolean; own: unknown } = JSON.parse(record);
  const calls: unknown = JSON.parse(counted);
  return { calls, exit, frozen, own, stderr };
}

test("a middleware reads its plugin's own validated options, global and hook-declared, and no one else's", () => {
  expect(owned(['get', '--mine', 'abc', '--local', 'xyz', '--app', 'q', '--theirs', 't'])).toEqual({
    calls: { abc: 1, xyz: 1 },
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

test('under an input-source fault core still validates its own options whose tokens parsed, and the source fault stays held', () => {
  // An option the invocation omitted has no tokens, so no pass validates it and it is absent.
  const failing = { FIXTURE_SOURCE: 'fails' };
  expect(owned(['get', '--mine', 'abc', '--local', 'xyz'], failing)).toEqual({
    calls: { abc: 1, xyz: 1 },
    exit: 'exit:2',
    frozen: true,
    own: { local: 'XYZ', mine: 'ABC' },
    stderr: 'owns: The settings file cannot be read.\n',
  });
  expect(owned(['get', '--mine', 'bad', '--local', 'throw'], failing)).toEqual({
    calls: { bad: 1, throw: 1 },
    exit: 'exit:2',
    frozen: true,
    own: {},
    stderr: 'owns: The settings file cannot be read.\n',
  });
});

test('under a validator that throws on another input core keeps the values validated before it and validates the rest once, and the developer error stays held', () => {
  // The main pass validated `--mine` and `--spare` before `--depth` threw, and never reached `--local`.
  const broken = owned(['get', '--depth', 'throw', '--mine', 'abc', '--local', 'xyz']);
  expect(broken).toEqual({
    calls: { abc: 1, xyz: 1 },
    exit: 'exit:1',
    frozen: true,
    own: { local: 'XYZ', mine: 'ABC', spare: '<undefined>' },
    stderr: 'owns: Something went wrong.\n',
  });
});

test("a validator of the plugin's own option that throws runs once, its option is absent, and the options after it validate once", () => {
  // The main pass stopped at `--mine`, so `--spare`, omitted, is never validated and is absent.
  expect(owned(['get', '--mine', 'throw', '--local', 'xyz'])).toEqual({
    calls: { throw: 1, xyz: 1 },
    exit: 'exit:1',
    frozen: true,
    own: { local: 'XYZ' },
    stderr: 'owns: Something went wrong.\n',
  });
});
