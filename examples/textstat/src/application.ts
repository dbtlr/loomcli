import { explain } from '@loom/explain';
import { explainCommand } from '@loom/explain/extension';
import { Application, FatalError, override } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { table } from '@loomcli/plugins/table';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';
import { integer, oneOf } from '@loomcli/validators';

import Package from '../package.json' with { type: 'json' };
import { countFiles } from './count-files.js';
import type { Row } from './row.js';
import { fatalError, rowCell } from './views.js';

/**
 * The byte threshold rule, declared once because two option spellings carry it while the
 * deprecated one lives. It hands the action a non-negative whole number.
 */
const byteThreshold = integer({ min: 0 });

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
  plugins: [
    help(),
    version(),
    format(),
    manifest(),
    config({ files: ['.textstat.json'] }),
    loomTheme(),
    explain(),
  ],
  version: Package.version,
  views: [override(FatalError, fatalError)],
})
  .argument('files', {
    description: 'The files to count. Omit them to read piped text.',
    variadic: true,
  })
  .option('metric', {
    default: 'bytes',
    description: 'What each row counts.',
    short: 'm',
    type: 'string',
    validate: oneOf(['bytes', 'words', 'lines']),
  })
  .option('min-bytes', {
    default: '0',
    description: 'Drop a source smaller than this many bytes.',
    env: 'TEXTSTAT_MIN_BYTES',
    extensions: [configInput({ path: 'minBytes' })],
    type: 'string',
    validate: byteThreshold,
  })
  .option('minimum', {
    deprecated: 'Use --min-bytes instead.',
    description: 'Drop a source smaller than this many bytes. The larger threshold wins.',
    type: 'string',
    validate: byteThreshold,
  })
  .option('total', {
    description: 'Add a total row.',
    env: 'TEXTSTAT_TOTAL',
    extensions: [configInput({ path: 'total' })],
    short: 't',
    type: 'boolean',
  })
  .option('timing', {
    description: 'Report the elapsed time on stderr.',
    hidden: true,
    type: 'boolean',
  })
  // The counted sources are the rows this application produces, and the table is their default.
  // Stdout therefore carries the rows and nothing else the action writes.
  .rows<Row>({
    views: {
      table: table({
        columns: [
          { align: 'right', format: rowCell, header: 'COUNT', key: 'count' },
          { format: rowCell, header: 'SOURCE', key: 'source' },
        ],
      }),
    },
  })
  .action(countFiles);
