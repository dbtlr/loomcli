import type { ActionHandler } from '@loom/core';

import type { clear } from './nested.js';

// A leaf two levels below the root type-imports its own Command.
// It reads the globals and its own locals; nothing from its group or its sibling reaches it.
export const clearCache: ActionHandler<typeof clear> = ({ args, options, out }) => {
  const file: string = options.file;
  const quiet: boolean = options.quiet;
  const force: boolean = options.force;
  // @ts-expect-error TS2339: A sibling leaf's local options stay out of this handler.
  options.long;
  // @ts-expect-error TS2339: A Command without arguments has no argument keys.
  args.path;
  return out.print(`${file}:${String(quiet)}:${String(force)}`);
};
