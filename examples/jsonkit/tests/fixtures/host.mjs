import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jsonkit } from '../../dist/application.js';

const directory = mkdtempSync(join(tmpdir(), 'loom-host-'));
try {
  writeFileSync(join(directory, '-data.json'), '{"name":"loom"}');
  await jsonkit.run({ host: { argv: ['get', 'name', '--file', './-data.json'], cwd: directory } });
} finally {
  rmSync(directory, { force: true, recursive: true });
}
