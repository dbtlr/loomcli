import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { processHandle } from '@loomcli/core';

import { textstat } from '../../dist/application.js';

const [scenario, metric = 'words'] = process.argv.slice(2);

/** A connection that delivers exactly the supplied chunks, so a boundary falls where a case wants it. */
function chunkStream(chunks) {
  let index = 0;
  return new Readable({
    read() {
      this.push(index < chunks.length ? chunks[index++] : null);
    },
  });
}

const piped = {
  stderr: { columns: undefined, isTTY: false, rows: undefined },
  stdin: { isTTY: false },
  stdout: { columns: undefined, isTTY: false, rows: undefined },
};

if (scenario === 'cwd') {
  const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
  try {
    writeFileSync(join(directory, '-notes.txt'), 'three');
    await textstat.run({ process: processHandle({ argv: ['./-notes.txt'], cwd: directory }) });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
} else if (scenario === 'words-across-chunks') {
  await textstat.run({
    process: processHandle({
      argv: ['--metric', 'words'],
      stdin: chunkStream(['hel', 'lo world']),
      terminal: piped,
    }),
  });
} else if (scenario === 'character-across-chunks') {
  // The split falls inside the two bytes of "ï", so a decoder that forgets it would count twice.
  const text = Buffer.from('naïve café');
  const stdin = chunkStream([text.subarray(0, 3), text.subarray(3)]);
  await textstat.run({
    process: processHandle({
      argv: ['--metric', metric],
      stdin,
      terminal: piped,
    }),
  });
} else if (scenario === 'terminal' || scenario === 'terminal-hyphen') {
  await textstat.run({
    process: processHandle({
      argv: scenario === 'terminal-hyphen' ? ['-'] : [],
      stdin: chunkStream([]),
      terminal: { ...piped, stdin: { isTTY: true } },
    }),
  });
} else if (scenario === 'long-token') {
  // One unbroken token across many chunks, so a counter that keeps the open word grows with it.
  const chunk = 'a'.repeat(64 * 1024);
  let remaining = 128;
  const stdin = new Readable({
    read() {
      remaining -= 1;
      this.push(remaining >= 0 ? chunk : null);
    },
  });
  await textstat.run({
    process: processHandle({ argv: ['--metric', 'words'], stdin, terminal: piped }),
  });
} else if (scenario === 'closed-early') {
  // A connection destroyed without an error emits "close" and never "end".
  let sent = false;
  const stdin = new Readable({
    read() {
      if (sent) {
        this.destroy();
        return;
      }
      sent = true;
      this.push('one two');
    },
  });
  await textstat.run({
    process: processHandle({ argv: ['--metric', 'words'], stdin, terminal: piped }),
  });
} else if (scenario === 'unreadable') {
  const stdin = new Readable({
    read() {
      this.destroy(new Error('The connection failed.'));
    },
  });
  await textstat.run({ process: processHandle({ argv: [], stdin, terminal: piped }) });
} else if (scenario === 'terminal-files') {
  let reads = 0;
  const stdin = new Readable({
    read() {
      reads++;
      this.push(null);
    },
  });
  const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
  try {
    writeFileSync(join(directory, 'notes.txt'), 'three');
    await textstat.run({
      process: processHandle({
        argv: ['notes.txt'],
        cwd: directory,
        stdin,
        terminal: { ...piped, stdin: { isTTY: true } },
      }),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  process.stdout.write(`reads: ${reads}\n`);
}
