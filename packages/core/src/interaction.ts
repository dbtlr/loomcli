import { registerRule } from './diagnostic-text.js';
import type { FactSite } from './facts.js';
import { checkMarkPlacement } from './marks.js';
import type { Mark } from './marks.js';
import type { OptionConfig } from './types.js';

const interactionMark = registerRule('@loomcli/core/interaction-mark', {
  explanation:
    'One Boolean global option may turn questions off. No local option or value-taking option decides interaction for the run.',
  headline: 'Invalid interaction mark',
});

/** The interaction mark, which carries no rule beyond where a mark sits. */
const interaction: Mark = { fact: 'interaction', rule: interactionMark };

/** The mark belongs only to a Boolean global option, at the earliest informed declaration. */
function checkInteraction(config: OptionConfig, site: FactSite, global: boolean): void {
  checkMarkPlacement(config, site, { global, mark: interaction });
}

export { checkInteraction, interaction };
