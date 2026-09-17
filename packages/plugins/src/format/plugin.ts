import { plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { attachFormat } from './attach.js';

export { json, jsonl } from './views.js';

/**
 * A plugin that puts `--format` on every Command that declares a result and copies a supplied name
 * into `view`. The annotated return type is the boundary that breaks the cycle between this module
 * and the middleware module `load` names.
 */
export function format(): Plugin<{}> {
  return plugin(`${Package.name}/format`, {
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat,
  });
}
