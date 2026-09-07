import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { readFragments } from './changelog/fragments.ts';
import { prepareRelease } from './changelog/release.ts';
import { writeRelease } from './changelog/write.ts';

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      date: { type: 'string' },
      initial: { type: 'boolean' },
      narrative: { type: 'string' },
      since: { type: 'string' },
    },
  });
  const [mode] = positionals;
  if (positionals.length !== 1 || (mode !== 'check' && mode !== 'preview' && mode !== 'write')) {
    throw new Error(
      'Usage: changelog check | preview | write [--date YYYY-MM-DD] [--since REF] [--initial] [--narrative FILE]',
    );
  }
  if (mode === 'check') {
    const fragments = readFragments(process.cwd());
    process.stdout.write(
      `Checked ${fragments.length} fragment${fragments.length === 1 ? '' : 's'}.\n`,
    );
  } else {
    const date = values.date ?? new Date().toISOString().slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      throw new Error('Expected a calendar date: YYYY-MM-DD.');
    }
    const release = prepareRelease(process.cwd(), {
      date,
      initial: values.initial ?? false,
      narrative:
        values.narrative === undefined ? undefined : readFileSync(values.narrative, 'utf8'),
      since: values.since,
    });
    if (mode === 'write') {
      writeRelease(process.cwd(), release);
    }
    process.stdout.write(release.section);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
