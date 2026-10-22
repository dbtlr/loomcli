import { EX_USAGE, FatalError, translate } from '@loomcli/core';

import { formatDistance, SplitLongerThanRunError } from './pace.js';

/**
 * A split longer than the run. The operator chose the split with --every, so the failure exits
 * with `EX_USAGE`, and a script branches on its failure code, `split-too-long`.
 */
export class SplitTooLongError extends FatalError {
  static override readonly code = 'split-too-long';
  static override readonly exitCode = EX_USAGE;

  constructor(split: string, run: string, options?: ErrorOptions) {
    super(
      `A split of ${split} is longer than the ${run} run. Supply a shorter --every, or run pace calc for the pace of the whole run.`,
      options,
    );
    this.name = 'SplitTooLongError';
  }
}

/** The domain module throws its own error, so no action catches it to report it. */
export const splitTooLong = translate(
  SplitLongerThanRunError,
  (error) =>
    new SplitTooLongError(
      formatDistance(error.every, error.unit),
      formatDistance(error.metres, error.unit),
      {
        cause: error,
      },
    ),
);
