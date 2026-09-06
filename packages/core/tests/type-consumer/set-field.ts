import type { ActionHandler } from '@loom/core';

import type { set } from './spellings.js';

export const setField: ActionHandler<typeof set> = ({ options }) => {
  const size: number | undefined = options.field;
  const dry: boolean = options.dry;
  const file: string | undefined = options.file;
  // @ts-expect-error TS2322: This Command declares the shared name with a transforming schema.
  const text: string | undefined = options.field;
  // @ts-expect-error TS2339: A sibling Command's own options stay out of this handler.
  options.raw;
  return { dry, file, size, text };
};
