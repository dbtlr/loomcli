import { plugin } from '@loomcli/core';
import type { Phrasebook, Plugin } from '@loomcli/core';

import { packageName } from '../constants.js';

/**
 * The phrasebooks the localization plugin installs: a map from a canonical language subtag, such
 * as `de`, to the list of phrasebooks for that language, each made by `phrasebook()`. Within one
 * list, the first phrasebook of a package that holds a sentence wins.
 *
 * @public
 */
interface LocalizationSettings {
  /** The phrasebooks for each language, keyed by its canonical language subtag. */
  readonly locales: Readonly<Record<string, readonly Phrasebook[]>>;
}

/**
 * Installs phrasebooks per language, so core renders Loom's own sentences in the operator's
 * language wherever it renders text for a person. A sentence no phrasebook holds, and every
 * sentence of a run whose language has no list, renders in English. Its whole contribution is the
 * map: it declares no option, middleware, Command, view, or hook, and claims no slot.
 *
 * @example
 * ```ts
 * import { Application, phrasebook } from '@loomcli/core';
 * import { localization } from '@loomcli/plugins/localization';
 *
 * const coreDe = phrasebook('@loomcli/core', {
 *   failures: { genericDefect: 'Etwas ist schiefgelaufen.' },
 * });
 *
 * export const notes = new Application('notes', {
 *   plugins: [localization({ locales: { de: [coreDe] } })],
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/localization.md
 *
 * @public
 */
function localization(settings: LocalizationSettings): Plugin {
  return plugin(`${packageName}/localization`, { phrasebooks: settings.locales });
}

export type { LocalizationSettings };
export { localization };
export type { PluginMessageModules } from '../registry.js';
