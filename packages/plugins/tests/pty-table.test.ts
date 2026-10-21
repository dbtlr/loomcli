// Acceptance plan: see packages/plugins/tests/table-fit.test.ts.
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';

const fixture = fileURLToPath(new URL('fixtures/pty-table.mjs', import.meta.url));

test.skipIf(zsh === undefined)(
  'on a real terminal a table fits 100 columns, then 60 after a resize, and a streamed records row wraps at the new width',
  () => {
    expect(ptyTranscript(fixture, 100)).toBe(
      [
        'COUNT  SOURCE',
        '    6  docs/guides/getting started with the loom command line framework.md',
        '    2  notes.md',
        'COUNT  SOURCE',
        '    6  docs/guides/getting started with the loom command',
        '       line framework.md',
        '    2  notes.md',
        'key   before',
        `kind  array of 12 strings, none empty or longer than 40 characters`,
        '',
        'key   after',
        'kind  array of 12 strings, none empty or longer than 40',
        '      characters',
        '',
        '2 records',
        '@@DONE@@',
      ].join('\n'),
    );
  },
);
