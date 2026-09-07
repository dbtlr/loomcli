import { validationContext } from '@loom/core';
import type { StandardSchemaV1 } from '@loom/core';

const MESSAGE = 'Supply a file or pipe JSON to stdin.';

/**
 * The file is optional because piped text is the other source. Omission passes only when the host
 * reports that stdin is not a terminal, so an operator who supplies nothing at a prompt reads the
 * rule instead of a hung run. The declaration asks for this call with `validateOmitted: true`.
 * Another caller's run carries no context, so it reads as the terminal case and the rule stays
 * conservative.
 */
export const fileOrStdin: StandardSchemaV1<string | undefined, string | undefined> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      if (typeof value === 'string') {
        return { value };
      }
      const context = validationContext(options);
      const piped = context?.phase === 'invocation' && !context.host.terminal.stdin.isTTY;
      return piped ? { value: undefined } : { issues: [{ message: MESSAGE }] };
    },
    vendor: 'jsonkit',
    version: 1,
  },
};
