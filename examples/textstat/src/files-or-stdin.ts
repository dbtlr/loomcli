import { InputError } from '@loomcli/core';
import type { Host } from '@loomcli/core';

const MESSAGE = 'Supply file arguments or pipe text to stdin.';
/** An empty selection is the case this rule decides, so its length names it. */
const EMPTY = 0;

/**
 * Files are optional because piped text is the other source. An empty list passes only when the
 * host reports that stdin is not a terminal, so an operator who supplies nothing at a prompt reads
 * the rule instead of a hung run. The rule reads the whole list, so it lives in the action and
 * throws the input error a validator would have reported, with the same text and exit code.
 */
export function checkFilesOrStdin(files: readonly string[], host: Host): void {
  if (files.length > EMPTY || !host.terminal.stdin.isTTY) {
    return;
  }
  throw new InputError(`Argument "files": ${MESSAGE}`, [
    {
      input: { global: false, kind: 'argument', name: 'files' },
      issues: [{ message: MESSAGE }],
      reason: 'invalid',
      spelling: 'files',
    },
  ]);
}
