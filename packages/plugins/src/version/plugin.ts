import { checkPluginSettings, DeclarationError, isProseLine, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { versionPostfix } from '../rules.js';
import { versionLine } from './views.js';

const identity = `${Package.name}/version`;

const options = {
  version: { description: 'Print the version.', short: 'V', type: 'boolean' },
} satisfies PluginOptions;

/**
 * The settings' postfix, judged at the call and read once: one line of prose under the rule every
 * core fact string follows, so the version line stays one line, or `undefined` when omitted.
 */
function postfixOf(settings: VersionSettings | undefined): string | undefined {
  const postfix: unknown = settings?.postfix;
  if (postfix === undefined || isProseLine(postfix)) {
    return postfix;
  }
  throw new DeclarationError(versionPostfix, {
    correction: 'Supply one line, such as "(Report schema v1)", or omit the postfix.',
    findings: [{ arguments: [settings], call: 'version', mark: '0.postfix' }],
    sentence: `Plugin "${identity}" postfix must be a string that holds a character other than whitespace and no line terminator.`,
  });
}

export type VersionOptions = typeof options;

/** What an application tells the version plugin: the text it prints after the standard line. */
export interface VersionSettings {
  /** One line printed after the name and version, such as `(Report schema v1)`. None by default. */
  readonly postfix?: string;
}

/**
 * A plugin that prints the Application's version, then the settings' postfix when there is one, and
 * ends the invocation. It judges the settings at the call, their shape under core's rules and then
 * the postfix. The annotated return type is the boundary that breaks the cycle between this module
 * and the middleware module `load` names.
 */
export function version(settings?: VersionSettings): Plugin<VersionOptions> {
  checkPluginSettings(settings, { call: 'version', plugin: identity });
  const postfix = postfixOf(settings);
  return plugin(identity, {
    middleware: {
      activate: ['version'],
      load: async () => {
        const { versionMiddleware } = await import('./middleware.js');
        return { default: versionMiddleware(postfix) };
      },
    },
    options,
    views: [versionLine],
  });
}
