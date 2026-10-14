import { registerRule } from './diagnostic-text.js';

export const contentDeclaration = registerRule('@loomcli/core/content-declaration', {
  explanation:
    'A content input is local and prepares readable sources into lazy handles. It declares no default, implied value, custom validator, or omission validator. Count bounds apply to collections of sources.',
  headline: 'Invalid content declaration',
});

export const stdinClaimedTwice = registerRule('@loomcli/core/stdin-claimed-twice', {
  explanation:
    'A Command has one stdin stream, so at most one local content input or stdin-only declaration claims it.',
  headline: 'Stdin claimed twice',
});
