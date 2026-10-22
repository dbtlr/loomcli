import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

/** Imports the invoke example of the agents chapter, which runs `pace calc` by name. */
async function paceFor(distance: string, time: string): Promise<unknown> {
  const path = fileURLToPath(new URL('../src/07-agents/scripts/pace-for.ts', import.meta.url));
  const example: Record<string, unknown> = await import(/* @vite-ignore */ path);
  const run = example.paceFor;
  if (typeof run !== 'function') {
    throw new TypeError('07-agents/scripts/pace-for.ts must export a paceFor function.');
  }
  return run(distance, time);
}

test('the invoke example returns the pace calc writes for a run', async () => {
  await expect(paceFor('10k', '50:00')).resolves.toBe('5:00 /km\n');
});

test('the invoke example returns the failure message, which names the input by its declared name', async () => {
  await expect(paceFor('10k', '50')).resolves.toBe(
    'Argument "time": Expected a time above zero as mm:ss or h:mm:ss, such as 25:30.',
  );
});
