import { Command } from '@loomcli/core';

import { listPaths } from '../actions/list-paths.js';
import { pathList, pathTable } from '../entries.js';
import type { Entry } from '../entries.js';

// `paths` is a hidden Command, so no listing shows it and no candidate names it.
// It declares a sequence of rows, so stdout carries the walk and nothing else the action writes.
export const paths = new Command('paths', {
  description: 'List every path in the document.',
  hidden: true,
})
  .rows<Entry>({ views: { list: pathList, table: pathTable } })
  .action(listPaths);
