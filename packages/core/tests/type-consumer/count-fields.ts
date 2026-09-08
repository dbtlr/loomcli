import type { ActionHandler } from '@loomcli/core';

import type { count } from './spellings.js';

export const countFields: ActionHandler<typeof count> = ({ options }) => {
  const field: boolean = options.field;
  const total: boolean = options.total;
  const file: string | undefined = options.file;
  // @ts-expect-error TS2322: This Command declares the shared name as a Boolean flag.
  const names: string[] = options.field;
  // @ts-expect-error TS2339: A sibling Command's own options stay out of this handler.
  options.raw;
  // @ts-expect-error TS7053: A negative spelling is not a handler key.
  options['no-field'];
  return { field, file, names, total };
};
