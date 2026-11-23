// Acceptance plan: see packages/plugins/tests/list.test.ts.
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';

const fixture = fileURLToPath(new URL('fixtures/pty-pack-views.mjs', import.meta.url));
const line = '─';

test.skipIf(zsh === undefined)(
  'on a real terminal a rule and a box fit 100 columns, then 60 after a resize',
  () => {
    const summary = 'All three services passed their health checks, and the deploy can continue.';
    const wrapped = 'All three services passed their health checks, and the';
    expect(ptyTranscript(fixture, 100)).toBe(
      [
        `── Checks ${line.repeat(90)}`,
        `╭─ Result ${line.repeat(summary.length - 7)}╮`,
        `│ ${summary} │`,
        `╰${line.repeat(summary.length + 2)}╯`,
        `── Checks ${line.repeat(50)}`,
        `╭─ Result ${line.repeat(wrapped.length - 7)}╮`,
        `│ ${wrapped} │`,
        `│ ${'deploy can continue.'.padEnd(wrapped.length)} │`,
        `╰${line.repeat(wrapped.length + 2)}╯`,
        '@@DONE@@',
      ].join('\n'),
    );
  },
);
