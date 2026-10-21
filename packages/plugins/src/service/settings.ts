import { DeclarationError } from '@loomcli/core';

import { packageName } from '../constants.js';
import { serviceSettings } from '../rules.js';
import type { ServiceSettings } from './types.js';

const identity = `${packageName}/service`;

/** The longest label, so `<label>.service` fits systemd's 255-character unit name. */
const longestLabel = 247;

/** Two or more segments joined by `.`, each a letter or digit followed by letters, digits, and `-`. */
const labelGrammar = /^[\dA-Za-z][\dA-Za-z-]*(?:\.[\dA-Za-z][\dA-Za-z-]*)+$/u;

/** A control character, U+0000 to U+001F or U+007F to U+009F. */
const controlCharacter = /\p{Cc}/u;

/** Whether a label follows the grammar and fits its length. */
function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= longestLabel && labelGrammar.test(value);
}

/** Whether the text holds a control character, U+0000 to U+001F or U+007F to U+009F. */
function holdsControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

/**
 * Judges the label at the `service()` call, the one setting whose grammar the types cannot carry,
 * and answers the settings. Settings are required, so none is the label fault. The graph judges
 * the run words.
 */
function judgeSettings(settings: ServiceSettings | undefined): ServiceSettings {
  const label: unknown = settings?.label;
  if (settings === undefined || !isLabel(label)) {
    throw new DeclarationError(serviceSettings, {
      correction: 'Supply a label such as com.acme.notes.',
      findings: [
        { arguments: settings === undefined ? [] : [settings], call: 'service', mark: '0.label' },
      ],
      sentence: `Plugin "${identity}" setting "label" is not a reverse-DNS name.`,
    });
  }
  return settings;
}

export { holdsControlCharacter, identity, isLabel, judgeSettings };
