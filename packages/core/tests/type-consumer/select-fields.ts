import type { ActionHandler } from '@loom/core';

import type { select } from './spellings.js';

export const selectFields: ActionHandler<typeof select> = ({ options }) => {
  const fields: string[] = options.field;
  const raw: boolean = options.raw;
  const file: string | undefined = options.file;
  // @ts-expect-error TS2322: This Command declares the shared name as a collection of strings.
  const flag: boolean = options.field;
  // @ts-expect-error TS2339: A sibling Command's own options stay out of this handler.
  options.total;
  // @ts-expect-error TS2339: A nested leaf's options stay out of this handler too.
  options.dry;
  return { field: fields, file, flag, raw };
};
