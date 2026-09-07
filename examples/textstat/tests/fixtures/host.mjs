import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

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
    await textstat.run({ host: { argv: ['./-notes.txt'], cwd: directory } });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
} else if (scenario === 'words-across-chunks') {
  await textstat.run({
    host: {
      argv: ['--metric', 'words'],
      stdin: chunkStream(['hel', 'lo world']),
      terminal: piped,
    },
  });
} else if (scenario === 'character-across-chunks') {
  // The split falls inside the two bytes of "ï", so a decoder that forgets it would count twice.
  const text = Buffer.from('naïve café');
  await textstat.run({
    host: {
      argv: ['--metric', metric],
      stdin: chunkStream([text.subarray(0, 3), text.subarray(3)]),
      terminal: piped,
    },
  });
} else if (scenario === 'terminal') {
  await textstat.run({
    host: {
      argv: [],
      stdin: chunkStream([]),
      terminal: { ...piped, stdin: { isTTY: true } },
    },
  });
} else if (scenario === 'unreadable') {
  const stdin = new Readable({
    read() {
      this.destroy(new Error('The connection failed.'));
    },
  });
  await textstat.run({ host: { argv: [], stdin, terminal: piped } });
} else if (scenario === 'files-only') {
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
    await textstat.run({ host: { argv: ['notes.txt'], cwd: directory, stdin, terminal: piped } });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  process.stdout.write(`${reads}\treads\n`);
}
