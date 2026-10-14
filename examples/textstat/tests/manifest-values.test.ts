import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

/** The root's extension record, which is where help supplies the manifest's values. */
const inspected = z.object({ root: z.object({ extensions: z.record(z.string(), z.unknown()) }) });

test("help supplies the root help values to the manifest's collecting extension", () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  const { root } = inspected.parse(JSON.parse(result.stdout));
  expect(root.extensions['@loomcli/plugins/manifest/command']).toEqual([
    {
      details:
        'Textstat counts files and piped text in order. Use - to place stdin among the files.',
      examples: [{ command: 'one.txt two.txt' }, { command: '--metric words --total *.md' }],
    },
  ]);
});
