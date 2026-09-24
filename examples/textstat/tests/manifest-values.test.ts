import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

/** The root's extension record, which is where help supplies the manifest's values. */
const inspected = z.object({ root: z.object({ extensions: z.record(z.string(), z.unknown()) }) });

test('help supplies the root help values to the manifest with no manifest plugin installed', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  const { root } = inspected.parse(JSON.parse(result.stdout));
  expect(root.extensions['@loomcli/plugins/manifest/command']).toEqual([
    {
      details: 'With no files, textstat counts the text piped to it and names the source "stdin".',
      examples: [{ command: 'one.txt two.txt' }, { command: '--metric words --total *.md' }],
    },
  ]);
});
