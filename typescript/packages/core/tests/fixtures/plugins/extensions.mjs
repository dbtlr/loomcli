import { extension } from '@loomcli/core';
import { z } from 'zod';

const line = z.string();
const examples = z.array(line).optional();

/** The facts one fixture plugin defines, one per target, each with its own Standard Schema. */
export const commandFact = extension('@fixture/facts/command', {
  schema: z.object({ details: line, examples }),
  target: 'command',
});

export const optionFact = extension('@fixture/facts/option', {
  schema: z.object({ placeholder: line }),
  target: 'option',
});

export const argumentFact = extension('@fixture/facts/argument', {
  schema: z.object({ hint: line }),
  target: 'argument',
});
