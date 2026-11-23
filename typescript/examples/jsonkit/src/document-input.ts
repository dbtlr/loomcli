import type { ContentOption } from '@loomcli/core';
import { helpInput } from '@loomcli/plugins/help/extension';

/** Each document Command owns its source; unrelated Commands have no document input. */
export const documentInput = {
  description: 'The document to read. Omit it to read piped text.',
  extensions: [helpInput({ placeholder: 'path' })],
  required: true,
  short: 'f',
  stdin: true,
  type: 'content',
} satisfies ContentOption;
