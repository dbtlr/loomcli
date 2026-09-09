import { extension, readExtension } from '@loomcli/core';
import { z } from 'zod';

import { argumentFact, commandFact, optionFact } from '../extensions.mjs';

/**
 * A second descriptor under one identity, defined here and never attached to a graph, so the read
 * below meets the mismatch rule rather than the one-identity-one-descriptor rule at build.
 */
const twin = extension('@fixture/facts/command', {
  schema: z.object({ details: z.string() }),
  target: 'command',
});

/** A descriptor no declaration carries, so a read through it answers `undefined`. */
const absent = extension('@fixture/facts/absent', {
  schema: z.object({ note: z.string() }),
  target: 'option',
});

/** Reads every node kind through its own descriptor, then reads one through the wrong descriptor. */
const middleware = async ({ command, graph, next, out }) => {
  const read = {
    absent: readExtension(command.options[0], absent) ?? 'undefined',
    argument: readExtension(command.arguments[0], argumentFact),
    command: readExtension(command, commandFact),
    global: readExtension(graph.globals[0], optionFact),
    option: readExtension(command.options[0], optionFact),
    root: readExtension(graph.root, commandFact),
  };
  await out.print(`read:${JSON.stringify(read)}`);
  try {
    readExtension(command, twin);
  } catch (error) {
    await out.print(`mismatch:${error.name}:${error.message}`);
  }
  await next();
};

export default middleware;
