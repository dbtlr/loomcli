import { DeclarationError, isProseLine, plugin } from '@loomcli/core';
import type { Plugin, PluginOptions } from '@loomcli/core';

import { packageName } from '../constants.js';
import { versionPostfix } from '../rules.js';
import { versionFacts, versionLine } from './views.js';

const identity = `${packageName}/version`;

const options = {
  version: { control: true, description: 'Print the version.', short: 'V', type: 'boolean' },
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

/**
 * The options record `version()` declares: the global `--version` option, spelled `-V` too.
 *
 * @public @sealed
 */
export type VersionOptions = typeof options;

/**
 * What an application tells the version plugin: the text it prints after the standard line, and
 * whether `-V` and `--version` print the extended output.
 *
 * @public
 */
export interface VersionSettings {
  /** One line printed after the name and version, such as `(Report schema v1)`. None by default. */
  readonly postfix?: string;
  /**
   * Whether `-V` and `--version` print the release facts, runtime, and platform below the line, or
   * one JSON object when the run's media type is `application/json` or `application/jsonl`, as
   * the formatter's `--format json` states. Only `true` turns it on. `false` by default, which
   * prints the line alone.
   */
  readonly extended?: boolean;
}

/**
 * A plugin that prints the Application's version, then the settings' postfix when there is one, and
 * ends the invocation. It judges the postfix at the call. The annotated return type is the boundary
 * that breaks the cycle between this module and the middleware module `load` names.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { version } from '@loomcli/plugins/version';
 *
 * export const app = new Application('notes', { plugins: [version({ postfix: '(Report schema v1)' })] });
 * ```
 *
 * @example
 * With `extended: true`, `-V` and `--version` also print the release channel, build, asset,
 * installation method, runtime, and platform. With `format()` installed ahead of the version
 * plugin, `notes --version --format json` prints them as one JSON object, at the group root as
 * under `notes list`.
 * ```ts
 * import { Application, Command } from '@loomcli/core';
 * import { format } from '@loomcli/plugins/format';
 * import { prose } from '@loomcli/plugins/prose';
 * import { version } from '@loomcli/plugins/version';
 *
 * const list = new Command('list')
 *   .result<string>({ views: { text: prose() } })
 *   .action(({ out }) => out.results('notes'));
 *
 * export const app = new Application('notes', {
 *   plugins: [format(), version({ extended: true })],
 *   version: '1.0.0',
 * }).command(list);
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/version.md
 *
 * @public
 */
export function version(settings?: VersionSettings): Plugin<VersionOptions> {
  const postfix = postfixOf(settings);
  const extended = settings?.extended === true;
  return plugin(identity, {
    middleware: {
      activate: ['version'],
      load: async () => {
        const { versionMiddleware } = await import('./middleware.js');
        return { default: versionMiddleware({ extended, postfix }) };
      },
    },
    options,
    views: [versionLine, versionFacts],
  });
}
