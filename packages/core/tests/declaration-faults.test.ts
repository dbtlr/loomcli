import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

// A faulty call is an uncaught exception in the module that makes it, so no run reports it.
test("a JavaScript author's faulty call throws while its module is imported, with a stack at the line", () => {
  const result = invoke(new URL('fixtures/import-fault.mjs', import.meta.url));
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'Option "verbose" is a boolean option and declares multiple. Remove multiple or declare a string option.',
  );
  expect(result.stderr).toContain('list.mjs:4:');
  expect(result.stderr).not.toContain('Invalid declaration:');
});
