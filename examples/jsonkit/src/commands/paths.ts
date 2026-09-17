import { Command } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

import { listPaths } from '../actions/list-paths.js';
import type { Entry } from '../entries.js';

// `paths` is a hidden Command, so no listing shows it and no candidate names it.
// It declares a sequence of rows, so stdout carries the walk and nothing else the action writes.
export const paths = new Command('paths', {
  description: 'List every path in the document.',
  hidden: true,
})
  .rows<Entry>({
    views: {
      list: records({ identifier: 'path' }),
      table: table({ columns: ['path', 'kind'] }),
    },
  })
  .action(listPaths);
