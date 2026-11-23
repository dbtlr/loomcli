/*
 * The patch-console plugin where only a process can show it (docs/plugins/patch-console.md): a real
 * terminal and the process's own exit, under Node and Bun.
 *
 * - At the process's end. A dependency's `console.error` followed by `process.exit(1)` while a frame
 *   is drawn prints the message above the frame, which stays on the screen, the cursor shows after
 *   it, and the shell sees status 1.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';

const fixture = fileURLToPath(new URL('fixtures/patch-console-exit.mjs', import.meta.url));

/** The runtime a fixture runs on, by the name the shell finds it under. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

test.skipIf(zsh === undefined)(
  'a console.error followed by process.exit while a frame is drawn prints above the frame',
  async () => {
    const terminal = drive([
      'sh',
      '-c',
      ['"$0" "$1"', 'echo "status=$?"', 'echo @@DONE@@'].join('; '),
      runtime,
      fixture,
    ]);
    try {
      const ended = await terminal.expect('@@DONE@@');
      const message = ended.indexOf('CONSOLE-MESSAGE');
      expect(message).toBeGreaterThan(-1);
      expect(ended.indexOf('WORKING-FRAME', message)).toBeGreaterThan(message);
      expect(ended.indexOf('\u001B[?25h', message)).toBeGreaterThan(message);
      expect(ended).toContain('status=1');
    } finally {
      await terminal.close();
    }
  },
);
