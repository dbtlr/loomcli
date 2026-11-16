import { registerRule } from '../diagnostics/diagnostic-text.js';
import type { InputDeclaration } from './validation.js';

export const stdinClaimedTwice = registerRule('@loomcli/core/stdin-claimed-twice', {
  explanation:
    'A Command has one stdin stream, so at most one local content input or stdin-only declaration claims it.',
  headline: 'Stdin claimed twice',
});

/** Whether one input claims stdin, which at most one target of a Command may. */
export function claimsStdin(input: InputDeclaration): boolean {
  return input.config.type === 'content' && input.config.stdin === true;
}
