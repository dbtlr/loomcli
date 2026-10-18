import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';

const fixture = fileURLToPath(new URL('fixtures/pty-columns.mjs', import.meta.url));

test.skipIf(zsh === undefined)(
  'on a real terminal a lane wraps at 40 columns, and two renders read the width either side of a resize',
  () => {
    expect(ptyTranscript(fixture, 40)).toBe(
      [
        '⚠ one two three four five six seven',
        '  eight nine ten eleven twelve',
        'first:100',
        'second:60',
        'host:60:60',
        '@@DONE@@',
      ].join('\n'),
    );
  },
);
