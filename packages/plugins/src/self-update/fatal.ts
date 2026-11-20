import { FatalError } from '@loomcli/core';
import type { Phrase } from '@loomcli/core';

/**
 * One failure the Command reports, which exits 1, with the runtime's error kept as its cause when
 * there is one. The sentence is a phrase of the plugin's message module.
 */
function fatal(sentence: Phrase, cause?: unknown): FatalError {
  return new FatalError(sentence, cause === undefined ? undefined : { cause });
}

export { fatal };
