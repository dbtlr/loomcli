import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { main } from './documents.js';

// The private @loom/doctor plugin attaches one ordinary Command to the root, ahead of jsonkit's own.

/** The report doctor prints off a terminal, through the pack's heading, list, rule, and box. */
const pipedReport = [
  'Host checks',
  '───────────',
  `● Platform: ${process.platform}`,
  '● Output: not a terminal',
  '─'.repeat(80),
  '╭─ Result ───────────╮',
  '│ All checks passed. │',
  '╰────────────────────╯',
  '',
].join('\n');

test('jsonkit doctor routes to the plugin Command and runs its action', () => {
  expect(invoke(main, ['doctor'])).toEqual({
    status: 0,
    stderr: '',
    stdout: pipedReport,
  });
});

test('jsonkit doctor runs at a terminal, because only the document Commands need --file or piped text', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal-doctor'])).toEqual({
    status: 0,
    stderr: '',
    stdout: pipedReport,
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
      '  -h, --help        Show this help.',
      '  -V, --version     Print the version.',
      "  -M, --manifest    Print this command's manifest as JSON.",
      '  -e, --explain     Explain the selected command and exit.',
      '      --[no-]color  Turn color on or off, overriding NO_COLOR.',
      '  -v, --verbose...  Show more detail. Repeat it for more.',
      '  -q, --quiet       Hide info and success messages.',
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
    'completion',
    'mcp',
    'manpage',
    'get',
    'keys',
    'select',
    'stats',
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
    optionGroups: [],
    options: [],
    path: ['doctor'],
    result: null,
  });
});
