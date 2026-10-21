import { DeclarationError } from '@loomcli/core';

import { packageName } from '../constants.js';
import { serviceSettings } from '../rules.js';
import type { ServiceSettings } from './types.js';

const identity = `${packageName}/service`;

/** The longest label, so `<label>.service` fits systemd's 255-character unit name. */
const longestLabel = 247;

/** Two or more segments joined by `.`, each a letter or digit followed by letters, digits, and `-`. */
const labelGrammar = /^[\dA-Za-z][\dA-Za-z-]*(?:\.[\dA-Za-z][\dA-Za-z-]*)+$/u;

/** Whether a label follows the grammar and fits its length. */
function isLabel(label: string): boolean {
  return label.length <= longestLabel && labelGrammar.test(label);
}

/**
 * Judges the label at the `service()` call, the one setting whose grammar the types cannot carry,
 * and answers the settings. The graph judges the run words.
 */
function judgeSettings(settings: ServiceSettings): ServiceSettings {
  if (!isLabel(settings.label)) {
    throw new DeclarationError(serviceSettings, {
      correction: 'Supply a label such as com.acme.notes.',
      findings: [{ arguments: [settings], call: 'service', mark: '0.label' }],
      sentence: `Plugin "${identity}" setting "label" is not a reverse-DNS name.`,
    });
  }
  return settings;
}

export { identity, isLabel, judgeSettings };
