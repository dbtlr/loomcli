import { explain } from '@loom/explain';
import { explainCommand } from '@loom/explain/extension';
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import Package from '../package.json' with { type: 'json' };
import { countFiles } from './count-files.js';
import { filesOrStdin } from './files-or-stdin.js';

export const textstat = new Application('textstat', {
  description: 'Count bytes, words, or lines across text sources.',
  extensions: [
    helpCommand({
      details: 'With no files, textstat counts the text piped to it and names the source "stdin".',
      examples: [{ command: 'one.txt two.txt' }, { command: '--metric words --total *.md' }],
    }),
    explainCommand({
      details: 'With no files, textstat counts the text piped to it and names the source "stdin".',
      examples: ['textstat one.txt two.txt', 'textstat --metric words --total *.md'],
    }),
  ],
  plugins: [help(), version(), explain()],
  version: Package.version,
})
  .argument('files', {
    description: 'The files to count. Omit them to read piped text.',
    validate: filesOrStdin,
    variadic: true,
  })
  .option('metric', {
    default: 'bytes',
    description: 'What each row counts.',
    short: 'm',
    type: 'string',
    validate: z.enum(['bytes', 'words', 'lines'], { error: 'Use bytes, words, or lines.' }),
  })
  .option('min-bytes', {
    default: '0',
    description: 'Drop a source smaller than this many bytes.',
    type: 'string',
    validate: z
      .string()
      .regex(/^[0-9]+$/, 'Use non-negative decimal digits.')
      .transform(Number)
      .refine(Number.isSafeInteger, 'Use a number within the safe integer range.'),
  })
  .option('total', { description: 'Add a total row.', short: 't', type: 'boolean' })
  .action(countFiles);
