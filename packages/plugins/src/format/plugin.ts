import { plugin } from '@loomcli/core';
import type { Plugin, StringOption } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { attachFormat } from './attach.js';

export { json, jsonl } from './views.js';

/** What an application tells the formatter: the short spelling of `--format`, none by default. */
export interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>;
}

/**
 * A plugin that puts `--format` on every Command that declares a result and copies a supplied name
 * into `view`. It reads the settings once, at the call. The annotated return type is the boundary
 * that breaks the cycle between this module and the middleware module `load` names.
 */
export function format(settings?: FormatSettings): Plugin<{}> {
  return plugin(`${Package.name}/format`, {
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat(settings?.short),
  });
}
