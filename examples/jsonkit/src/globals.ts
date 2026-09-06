import { GlobalOptions } from '@loom/core';

export const globals = new GlobalOptions().option('file', {
  required: true,
  short: 'f',
  type: 'string',
});
