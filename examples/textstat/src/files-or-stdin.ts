import { validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

const MESSAGE = 'Supply file arguments or pipe text to stdin.';
/** An empty selection is the case this rule decides, so its length names it. */
const EMPTY = 0;

/** The declared shape of the argument: every collected token is a file name. */
function isFileList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

/**
 * Files are optional because piped text is the other source. An empty list passes only when the
 * host reports that stdin is not a terminal, so an operator who supplies nothing at a prompt reads
 * the rule instead of a hung run. A default carries no invocation to judge, so only an invocation
 * answers this rule, and another caller's run, which carries no context at all, reads as the
 * terminal case and keeps the rule conservative.
 */
export const filesOrStdin: StandardSchemaV1<string[], string[]> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      if (!isFileList(value)) {
        return { issues: [{ message: MESSAGE }] };
      }
      const context = validationContext(options);
      const piped = context?.phase === 'invocation' && !context.host.terminal.stdin.isTTY;
      return value.length > EMPTY || piped ? { value } : { issues: [{ message: MESSAGE }] };
    },
    vendor: 'textstat',
    version: 1,
  },
};
