import { FatalError } from '@loomcli/core';

/**
 * One failure the Command reports, which exits 1, with the runtime's error kept as its cause when
 * there is one. The sentence comes from the plugin's message module.
 */
function fatal(sentence: string, cause?: unknown): FatalError {
  return new FatalError(sentence, cause === undefined ? undefined : { cause });
}

export { fatal };
