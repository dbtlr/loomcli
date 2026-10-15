import { registerRule } from './diagnostic-text.js';
import { factFault } from './facts.js';
import type { FactSite } from './facts.js';
import type { OptionConfig } from './types.js';

export const interactionMark = registerRule('@loomcli/core/interaction-mark', {
  explanation:
    'One Boolean global option may turn questions off. No local option or value-taking option decides interaction for the run.',
  headline: 'Invalid interaction mark',
});

/** The mark belongs only to a Boolean global option, at the earliest informed declaration. */
export function checkInteraction(config: OptionConfig, site: FactSite, global: boolean): void {
  if (!('interaction' in config)) {
    return;
  }
  const reject = (sentence: string, correction: string) => {
    throw factFault(interactionMark, site, { correction, fact: 'interaction', sentence });
  };
  if (!global) {
    reject(
      `${site.subject} declares interaction but is not a global option.`,
      'Declare it with globalOption().',
    );
  }
  if (config.type !== 'boolean') {
    reject(`${site.subject} declares interaction but is not Boolean.`, 'Use type "boolean".');
  }
  const mark: unknown = Reflect.get(config, 'interaction');
  if (mark !== true) {
    reject(
      `${site.subject} declares interaction that is not true.`,
      'Remove interaction or set it to true.',
    );
  }
}
