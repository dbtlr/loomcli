import { expect, test } from 'vite-plus/test';

/**
 * `LOOM_TEST_RUNTIME` names the runtime the whole suite runs on: the test workers and the children
 * a process test starts. A Bun job whose workers ran on Node would test in-process code on Node
 * alone.
 */
test('a test worker runs on the runtime LOOM_TEST_RUNTIME names', () => {
  const requested = process.env.LOOM_TEST_RUNTIME ?? 'node';
  const running = process.versions.bun === undefined ? 'node' : 'bun';
  expect(running, 'Run the suite under Bun with pnpm verify:bun.').toBe(requested);
});
