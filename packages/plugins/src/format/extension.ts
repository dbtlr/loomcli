import { extension } from '@loomcli/core';
import type { Extension, StandardSchemaV1 } from '@loomcli/core';
import { array, string } from 'valibot';

import { packageName } from '../constants.js';

/** Typed as a Standard Schema so the published declaration names no validator library. */
const viewNames: StandardSchemaV1<string[], string[]> = array(string());

/** The view names the formatter appended, so field selection never reshapes an author's view. */
export const providedViews: Extension<'command', StandardSchemaV1<string[], string[]>> = extension(
  `${packageName}/format/provided-views`,
  { schema: viewNames, target: 'command' },
);
