import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { jsonkit } from '../../dist/application.js';

const scenario = process.argv[2];
const contents = '{"name":"loom"}';

const piped = {
  stderr: { columns: undefined, isTTY: false, rows: undefined },
  stdin: { isTTY: false },
  stdout: { columns: undefined, isTTY: false, rows: undefined },
};

/** A document delivered on the connection, so the reader is exercised without a pipe. */
function documentStream() {
  return Readable.from([contents]);
}

/** A directory holding the document, so a file case reads a real path under a supplied cwd. */
async function withDocument(name, run) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
  try {
    writeFileSync(join(directory, name), contents);
    await run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

if (scenario === 'cwd') {
  await withDocument('-data.json', (cwd) =>
    jsonkit.run({ host: { argv: ['get', 'name', '--file', './-data.json'], cwd } }),
  );
} else if (scenario === 'stdin') {
  await jsonkit.run({
    host: { argv: ['get', 'name'], stdin: documentStream(), terminal: piped },
  });
} else if (scenario === 'terminal') {
  await jsonkit.run({
    host: {
      argv: ['get', 'name'],
      stdin: documentStream(),
      terminal: { ...piped, stdin: { isTTY: true } },
    },
  });
} else if (scenario === 'unreadable') {
  const stdin = new Readable({
    read() {
      this.destroy(new Error('The connection failed.'));
    },
  });
  await jsonkit.run({ host: { argv: ['get', 'name'], stdin, terminal: piped } });
} else if (scenario === 'file-only') {
  let reads = 0;
  const stdin = new Readable({
    read() {
      reads++;
      this.push(null);
    },
  });
  await withDocument('data.json', (cwd) =>
    jsonkit.run({
      host: { argv: ['get', 'name', '--file', 'data.json'], cwd, stdin, terminal: piped },
    }),
  );
  process.stdout.write(`${reads}\treads\n`);
}
