import { registerRule } from './diagnostic-text.js';

export const stdinClaimedTwice = registerRule('@loomcli/core/stdin-claimed-twice', {
  explanation:
    'A Command has one stdin stream, so at most one local content input or stdin-only declaration claims it.',
  headline: 'Stdin claimed twice',
});
