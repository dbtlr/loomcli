import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { start } from '../../../scripts/test-process.js';
import { main } from './documents.js';

/**
 * A document with far more keys than a pipe buffers, so jsonkit is still printing them when the
 * reader closes after the first line.
 */
const manyKeys = JSON.stringify(
  Object.fromEntries(Array.from({ length: 200_000 }, (_unused, index) => [`k${index}`, index])),
);

test.each(['node', 'bun'])(
  'a reader that closes stdout after the first line ends the bundle under %s with 141 and nothing on stderr',
  async (runtime) => {
    const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-pipe-'));
    try {
      writeFileSync(join(directory, 'doc.json'), manyKeys);
      const { child, exit } = start(main, ['keys', '-f', 'doc.json'], { cwd: directory, runtime });
      // The reader closes its end once the first line arrives, as `head -1` does.
      child.stdout.on('data', (chunk: string) => {
        if (chunk.includes('\n')) {
          child.stdout.destroy();
        }
      });
      const ended = await exit;
      expect({ signal: ended.signal, status: ended.status, stderr: ended.stderr }).toEqual({
        signal: null,
        status: 141,
        stderr: '',
      });
      expect(ended.stdout.split('\n')[0]).toBe('k0');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test.each(['node', 'bun'])(
  'a reader that closes stdout before the completion script arrives ends the bundle under %s with 141 and nothing on stderr',
  async (runtime) => {
    const { child, exit } = start(main, ['completion', 'bash'], { runtime });
    // The reader is gone before the script is written, as a `head -1` that already exited is.
    child.stdout.destroy();
    const ended = await exit;
    expect({ signal: ended.signal, status: ended.status, stderr: ended.stderr }).toEqual({
      signal: null,
      status: 141,
      stderr: '',
    });
  },
);
