import { checkShortSetting, plugin } from '@loomcli/core';
import type { Plugin, StringOption } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { attachFormat } from './attach.js';

const identity = `${Package.name}/format`;

export { json, jsonl } from './views.js';

/** What an application tells the formatter: the short spelling of `--format`, none by default. */
export interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>;
}

/**
 * A plugin that puts `--format` on every Command that declares a result and copies a supplied name
 * into `view`. It judges the settings at the call, under core's rules for a short spelling, and
 * reads them once. The annotated return type is the boundary that breaks the cycle between this
 * module and the middleware module `load` names.
 */
export function format(settings?: FormatSettings): Plugin<{}> {
  checkShortSetting(settings, { call: 'format', option: 'format', plugin: identity });
  return plugin(identity, {
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat(settings?.short),
  });
}
