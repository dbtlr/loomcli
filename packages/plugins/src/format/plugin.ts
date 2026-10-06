import { checkShortSetting, encodeFailure, plugin } from '@loomcli/core';
import type { FailureEncoder, Plugin, StringOption } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { escapeControls } from '../encode.js';
import { attachFormat } from './attach.js';

const identity = `${Package.name}/format`;

/**
 * One line on stderr: `{"error":{"code":…,"exitCode":…,"message":…,"hints":[…]}}` and a newline.
 * The form's keys keep their order, and DEL and the C1 controls are escaped as the views escape
 * them, so the line is the same bytes under every capability.
 */
const errorLine: FailureEncoder = (form) => `${escapeControls(JSON.stringify({ error: form }))}\n`;

export { json, jsonl } from './views.js';

/** What an application tells the formatter: the short spelling of `--format`, none by default. */
export interface FormatSettings {
  readonly short?: NonNullable<StringOption['short']>;
}

/**
 * A plugin that puts `--format` on every Command that declares a result, copies a supplied name
 * into `view`, and writes a failed run's form as one JSON line when the run selected a `json()` or
 * `jsonl()` view. It judges the settings at the call, under core's rules for a short spelling,
 * and reads them once. The annotated return type is the boundary that breaks the cycle between
 * this module and the middleware module `load` names.
 */
export function format(settings?: FormatSettings): Plugin<{}> {
  checkShortSetting(settings, { call: 'format', option: 'format', plugin: identity });
  return plugin(identity, {
    failureEncoders: [
      encodeFailure('application/json', errorLine),
      encodeFailure('application/jsonl', errorLine),
    ],
    middleware: { activate: 'always', load: () => import('./middleware.js') },
    onCommandAttach: attachFormat(settings?.short),
  });
}
