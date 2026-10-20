/**
 * Whether another occurrence of an option adds anything, the one rule behind help's `...` and
 * completion's re-offer. This module belongs to no subpath: help and completion both read it, and
 * neither imports the other's modules.
 */

import type { OptionNode } from '@loomcli/core';

/** No earlier occurrence, and the one occurrence after which a repeat is judged. */
const noOccurrence = 0;
const oneOccurrence = 1;

/**
 * The counts past which a marked option adds nothing, as the run's verbosity reads them: the
 * verbose count reads as 2 above 2, and the quiet count as 1 above 1.
 */
const loudest = 2;
const quietest = 1;

/**
 * Whether one more occurrence of an option, after `given` earlier ones, adds anything. A counted
 * option adds one, until a verbose-marked count reaches 2 or a quiet-marked count reaches 1. A
 * multiple string option collects another value. Any other option adds only its first occurrence.
 */
function addsOccurrence(option: OptionNode, given: number): boolean {
  switch (option.type) {
    case 'count': {
      if (option.verbose) {
        return given < loudest;
      }
      return option.quiet ? given < quietest : true;
    }
    case 'content':
    case 'string': {
      return option.multiple || given === noOccurrence;
    }
    case 'boolean': {
      return given === noOccurrence;
    }
    default: {
      const exhaustive: never = option;
      return exhaustive;
    }
  }
}

export { addsOccurrence, noOccurrence, oneOccurrence };
