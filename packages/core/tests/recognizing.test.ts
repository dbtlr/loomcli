import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Whether `instanceof Application` recognized each value the fixture names. */
function recognized(): unknown {
  const result = invoke(new URL('fixtures/recognizing.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('instanceof Application holds for an Application in every authoring state, whichever declaring call returned it', () => {
  expect(recognized()).toMatchObject({
    action: true,
    argument: true,
    bare: true,
    chained: true,
    command: true,
    extend: true,
    globalOption: true,
    option: true,
    plugins: true,
    result: true,
    rows: true,
    unconfigured: true,
    views: true,
  });
});

test('instanceof Application is false for a Command, a plain object, a copy, null, and a function', () => {
  expect(recognized()).toMatchObject({
    aCommand: false,
    aFunction: false,
    aNull: false,
    aPlainObject: false,
    aPrototypeCopy: false,
  });
});
