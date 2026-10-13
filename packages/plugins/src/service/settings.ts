import { checkPluginSettings, DeclarationError } from '@loomcli/core';

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

/** The length of an empty list. */
const empty = 0;

/** Whether a label follows the grammar and fits its length. */
function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= longestLabel && labelGrammar.test(value);
}

/** Whether the text holds a control character, U+0000 to U+001F or U+007F to U+009F. */
function holdsControlCharacter(text: string): boolean {
  return controlCharacter.test(text);
}

/** Whether a value is a nonempty list of strings. */
function isWordList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.length > empty && value.every((word) => typeof word === 'string')
  );
}

/** What a setting's fault says: the rest of its sentence after the key, and its correction. */
interface FaultText {
  readonly sentence: string;
  readonly correction: string;
}

/** The fault of one setting, marked on its key. */
function settingFault(settings: unknown, key: string, text: FaultText): DeclarationError {
  return new DeclarationError(serviceSettings, {
    correction: text.correction,
    findings: [
      { arguments: settings === undefined ? [] : [settings], call: 'service', mark: `0.${key}` },
    ],
    sentence: `Plugin "${identity}" setting "${key}" ${text.sentence}`,
  });
}

/** The fault of the `run` words, or none. */
function runFault(settings: ServiceSettings): DeclarationError | undefined {
  const run: unknown = settings.run;
  if (!isWordList(run)) {
    return settingFault(settings, 'run', {
      correction: "Supply the words that run the service's Command, such as ['serve'].",
      sentence: 'is not a list of argument words.',
    });
  }
  if (run.some(holdsControlCharacter)) {
    return settingFault(settings, 'run', {
      correction: 'Remove the control character from the word.',
      sentence: 'holds a word with a control character.',
    });
  }
  return undefined;
}

/** The settings with a label in the grammar, or the label fault. Settings are required. */
function labelled(settings: ServiceSettings | undefined): ServiceSettings {
  const label: unknown = settings?.label;
  if (settings === undefined || !isLabel(label)) {
    throw settingFault(settings, 'label', {
      correction: 'Supply a label such as com.acme.notes.',
      sentence: 'is not a reverse-DNS name.',
    });
  }
  return settings;
}

/**
 * Judges the settings at the `service()` call: their shape under core's rules, then the label, the
 * run words, and the probe, throwing the first fault. Settings are required, so none is the label
 * fault.
 */
function judgeSettings(given: ServiceSettings | undefined): ServiceSettings {
  checkPluginSettings(given, { call: 'service', plugin: identity });
  const settings = labelled(given);
  const fault = runFault(settings);
  if (fault !== undefined) {
    throw fault;
  }
  const probe: unknown = settings.probe;
  if (probe !== undefined && typeof probe !== 'function') {
    throw settingFault(settings, 'probe', {
      correction: 'Supply a function, or omit the setting.',
      sentence: 'is not a function.',
    });
  }
  return settings;
}

export { holdsControlCharacter, identity, isLabel, judgeSettings };
