import { validationContext } from '@loom/core';
import type { StandardSchemaV1 } from '@loom/core';

const MESSAGE = 'Supply file arguments or pipe text to stdin.';
/** An empty selection is the case the rule decides, so its length names it. */
const EMPTY = 0;

/**
 * Files are optional because piped text is the other source. An empty list passes only when the
 * host reports that stdin is not a terminal, so an operator who supplies nothing at a prompt reads
 * the rule instead of a hung run. Another caller's run carries no context, so it reads as the
 * terminal case and the rule stays conservative.
 */
export const filesOrStdin: StandardSchemaV1<string[], string[]> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      const files = Array.isArray(value) ? value.map(String) : [];
      const context = validationContext(options);
      const piped = context?.phase === 'invocation' && !context.host.terminal.stdin.isTTY;
      return files.length > EMPTY || piped ? { value: files } : { issues: [{ message: MESSAGE }] };
    },
    vendor: 'textstat',
    version: 1,
  },
};
