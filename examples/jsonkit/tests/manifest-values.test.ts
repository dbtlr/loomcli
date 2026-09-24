import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const identity = '@loomcli/plugins/manifest/command';

/** The part of the inspected graph these tests read: each node's extension record. */
const inspected = z.object({
  root: z.object({
    children: z.array(
      z.object({ extensions: z.record(z.string(), z.unknown()), name: z.string() }),
    ),
    extensions: z.record(z.string(), z.unknown()),
  }),
});

function graph() {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  return inspected.parse(JSON.parse(result.stdout));
}

test("help supplies the root help values to the manifest's collecting extension", () => {
  expect(graph().root.extensions[identity]).toEqual([
    {
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: [{ command: '-f doc.json' }, { command: 'get user.name -f doc.json' }],
    },
  ]);
});

test('the author value on get is collected ahead of the value help supplies', () => {
  const get = graph().root.children.find((child) => child.name === 'get');
  expect(get?.extensions[identity]).toEqual([
    { details: 'Quote a path that holds a shell metacharacter.' },
    {
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: [
        { command: 'get name -f doc.json' },
        { command: 'get nested.deep.value -f doc.json' },
      ],
    },
  ]);
});
