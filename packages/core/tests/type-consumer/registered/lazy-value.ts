import type { ActionHandler } from '@loomcli/core';

import type { fetch } from './lazy.js';

// The handler a declaration loads with import() reads the same typed context as a static one.
const fetchValue: ActionHandler<typeof fetch> = async ({ args, options, out }) => {
  const path: string = args.path;
  const file: string = options.file;
  const raw: boolean = options.raw;
  // @ts-expect-error TS2339: A Command's own options hold only what it and the globals declare.
  options.pretty;
  await out.print(`${path}:${file}:${String(raw)}`);
};

export { fetchValue };
