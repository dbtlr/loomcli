import { plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';
import { attachHelp } from './attach.js';
import { helpArgument, helpCommand, helpInput } from './extension.js';
import { helpHint } from './hint.js';
import { helpPage } from './views.js';

const options = {
  help: { control: true, description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;

export type HelpOptions = typeof options;

/** What an application tells the help plugin. */
export interface HelpSettings {
  /** Page a help page that outgrows the terminal through the operator's pager. Off by default. */
  readonly paging?: boolean;
}

/**
 * A plugin that renders the help page of the routed Command and ends the invocation, whose attach
 * hook supplies each Command's help prose to the manifest's collecting extension, and whose failure
 * hook points every usage error at the page. With `paging`, a long page goes to the operator's
 * pager. The annotated return type is the boundary that breaks the cycle between this module and the
 * middleware module `load` names.
 */
export function help(settings?: HelpSettings): Plugin<HelpOptions> {
  const paging = settings?.paging ?? false;
  return plugin(`${packageName}/help`, {
    extensions: [helpArgument, helpCommand, helpInput],
    middleware: {
      activate: ['help'],
      load: async () => {
        const { helpMiddleware } = await import('./middleware.js');
        return { default: helpMiddleware(paging) };
      },
    },
    onCommandAttach: attachHelp,
    onFailure: helpHint,
    options,
    views: [helpPage],
  });
}
