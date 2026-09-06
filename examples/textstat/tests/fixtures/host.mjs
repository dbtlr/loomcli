import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { textstat } from '../../dist/application.js';

const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
try {
  writeFileSync(join(directory, '-notes.txt'), 'three');
  await textstat.run({ host: { argv: ['./-notes.txt'], cwd: directory } });
} finally {
  rmSync(directory, { force: true, recursive: true });
}
