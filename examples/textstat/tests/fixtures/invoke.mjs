import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { textstat } from '../../dist/application.js';

// `textstat --metric nope one.txt`, run by name, with no view and with the json view.
const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-invoke-'));
try {
  writeFileSync(join(directory, 'one.txt'), 'hello\n');
  const values = { args: { files: ['one.txt'] }, options: { metric: 'nope' } };
  const host = { cwd: directory };
  const plain = await textstat.invoke([], values, { host });
  const json = await textstat.invoke([], values, { host, view: 'json' });
  process.stdout.write(`${JSON.stringify({ json, plain })}\n`);
} finally {
  rmSync(directory, { force: true, recursive: true });
}
