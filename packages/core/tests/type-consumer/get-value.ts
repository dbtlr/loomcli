import type { ActionHandler } from '@loom/core';

import type { get } from './commands.js';

export const getValue: ActionHandler<typeof get> = ({ args, options, passthrough }) => {
  const path: string = args.path;
  const file: string = options.file;
  const quiet: boolean = options.quiet;
  const raw: boolean = options.raw;
  const limit: number | undefined = options.limit;
  const tail: string[] = passthrough;
  // @ts-expect-error TS2339: A parent's local options never reach a child's handler.
  options.pretty;
  return { file, limit, path, quiet, raw, tail };
};
