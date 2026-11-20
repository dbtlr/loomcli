import { DeclarationError } from '@loomcli/core';

import { packageName } from '../constants.js';
import { serviceSettings } from '../rules.js';
import type { ServiceSettings } from './types.js';

const identity = `${packageName}/service`;

/** The longest label, so `<label>.service` fits systemd's 255-character unit name. */
const longestLabel = 247;

/** The smallest stop timeout the service accepts, in milliseconds. */
const minimumStopTimeout = 1;

/** Two or more segments joined by `.`, each a letter or digit followed by letters, digits, and `-`. */
const labelGrammar = /^[\dA-Za-z][\dA-Za-z-]*(?:\.[\dA-Za-z][\dA-Za-z-]*)+$/u;

/** Whether a label follows the grammar and fits its length. */
function isLabel(label: string): boolean {
  return label.length <= longestLabel && labelGrammar.test(label);
}

/** A setting whose value the types cannot express, marked at the `service()` call. */
function invalidSetting(
  settings: ServiceSettings,
  field: 'label' | 'output' | 'stopTimeout',
  { correction, problem }: { readonly correction: string; readonly problem: string },
): DeclarationError {
  return new DeclarationError(serviceSettings, {
    correction,
    findings: [{ arguments: [settings], call: 'service', mark: `0.${field}` }],
    sentence: `Plugin "${identity}" setting "${field}" ${problem}.`,
  });
}

/** Judges the settings at the `service()` call. The graph judges the run words. */
function judgeSettings(settings: ServiceSettings): ServiceSettings {
  if (!isLabel(settings.label)) {
    throw invalidSetting(settings, 'label', {
      correction: 'Supply a label such as com.acme.notes.',
      problem: 'is not a reverse-DNS name',
    });
  }
  if (settings.output === '') {
    throw invalidSetting(settings, 'output', {
      correction: 'Supply a file path or omit output.',
      problem: 'is empty',
    });
  }
  const { stopTimeout } = settings;
  if (
    stopTimeout !== undefined &&
    (!Number.isInteger(stopTimeout) || stopTimeout < minimumStopTimeout)
  ) {
    throw invalidSetting(settings, 'stopTimeout', {
      correction: 'Supply a positive whole number of milliseconds or omit stopTimeout.',
      problem: 'is not a positive whole number',
    });
  }
  return settings;
}

export { identity, isLabel, judgeSettings };
