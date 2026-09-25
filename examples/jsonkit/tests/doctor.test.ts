import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { main } from './documents.js';

// The private @loom/doctor plugin attaches one ordinary Command to the root, ahead of jsonkit's own.

test('jsonkit doctor routes to the plugin Command and runs its action', () => {
  expect(invoke(main, ['doctor'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'All checks passed.\n',
  });
});

test('jsonkit doctor --help prints its page like any other Command', () => {
  expect(invoke(main, ['doctor', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'jsonkit doctor · Check the host this application runs on.',
      '',
      'USAGE',
      '  jsonkit doctor [options]',
      '',
      'GLOBAL OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
      "      --manifest     Print this command's manifest as JSON.",
      '      --explain      Explain the selected command and exit.',
      '',
    ].join('\n'),
  });
});

test('inspect() lists the plugin Command as the root first child, with nothing marking its plugin', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.status).toBe(0);
  const graph = z
    .object({ root: z.object({ children: z.array(z.record(z.string(), z.unknown())) }) })
    .parse(JSON.parse(result.stdout));
  expect(graph.root.children.map((child) => child.name)).toEqual([
    'doctor',
    'get',
    'keys',
    'select',
    'fetch',
    'debug',
    'paths',
  ]);
  expect(graph.root.children[0]).toEqual({
    aliases: [],
    arguments: [],
    children: [],
    description: 'Check the host this application runs on.',
    extensions: {},
    hasAction: true,
    hidden: false,
    name: 'doctor',
    options: [],
    path: ['doctor'],
    result: null,
  });
});
