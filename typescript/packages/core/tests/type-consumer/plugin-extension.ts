import { extension } from '@loomcli/core';
import { z } from 'zod';

// The descriptor module a plugin's consumers import statically. It holds declarations alone.
export const helpCommand = extension('@fixture/help/command', {
  schema: z.object({
    details: z.string().optional(),
    examples: z.array(z.object({ command: z.string(), note: z.string().optional() })).optional(),
  }),
  target: 'command',
});

export const helpInput = extension('@fixture/help/input', {
  schema: z.object({ placeholder: z.string().optional() }),
  target: 'option',
});

export const helpArgument = extension('@fixture/help/argument', {
  schema: z.object({ hint: z.string() }),
  target: 'argument',
});
