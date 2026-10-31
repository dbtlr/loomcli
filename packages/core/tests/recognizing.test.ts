import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/** Whether `instanceof Application` recognized each value the fixture names. */
async function recognized(): Promise<unknown> {
  const result = await invokeFixture(new URL('fixtures/recognizing.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test('instanceof Application holds for an Application in every authoring state, whichever declaring call returned it', async () => {
  await expect(recognized()).resolves.toMatchObject({
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

test('instanceof Application is false for a Command, a plain object, a copy, null, and a function', async () => {
  await expect(recognized()).resolves.toMatchObject({
    aCommand: false,
    aFunction: false,
    aNull: false,
    aPlainObject: false,
    aPrototypeCopy: false,
  });
});

test("instanceof an author's subclass of Application reads that subclass's prototype chain alone", async () => {
  await expect(recognized()).resolves.toMatchObject({
    subclass: { aSubclassInstance: true, anApplication: false },
  });
});
