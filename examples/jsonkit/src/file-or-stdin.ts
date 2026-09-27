import { InputError } from '@loomcli/core';
import type { Host } from '@loomcli/core';

const MESSAGE = 'Supply a file or pipe JSON to stdin.';

/**
 * The file is optional because piped text is the other source. Omission passes only when the host
 * reports that stdin is not a terminal, so an operator who supplies nothing at a prompt reads the
 * rule instead of a hung run. `--file` is a global option, and a global declares no omission rule,
 * so the document reader checks it and throws the input error a validator would have reported, with
 * the same text and exit code. Commands that read no document, such as `doctor`, never meet it.
 */
export function checkFileOrStdin(file: string | undefined, host: Host): void {
  if (file !== undefined || !host.terminal.stdin.isTTY) {
    return;
  }
  throw new InputError(`Option "--file": ${MESSAGE}`, [
    {
      input: { global: true, kind: 'option', name: 'file' },
      issues: [{ message: MESSAGE }],
      reason: 'invalid',
      spelling: '--file',
    },
  ]);
}
