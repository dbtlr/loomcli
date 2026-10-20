import { registerRule } from './diagnostic-text.js';
import type { Mark } from './marks.js';

const interactionMark = registerRule('@loomcli/core/interaction-mark', {
  explanation:
    'One Boolean global option may turn questions off, so two options that carry the mark would each claim the decision for the run.',
  headline: 'Invalid interaction mark',
});

/** The interaction mark, which carries no rule beyond one marked option per Application. */
const interaction: Mark = { fact: 'interaction', rule: interactionMark, type: 'boolean' };

export { interaction };
