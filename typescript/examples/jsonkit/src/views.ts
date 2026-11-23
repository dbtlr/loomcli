import type { FailureView, FatalError } from '@loomcli/core';

/**
 * A `FatalError`'s message is marked text its author wrote, so the view prints the context's
 * `message` as it is: a plugin's `nowrap` frame resolves, and the sentence reads in the run's
 * language. Each site that puts an operator's value into the message escapes it there. The view
 * prints no hints, so a fatal failure reads as its one sentence.
 */
export const fatalError: FailureView<FatalError> = {
  render: (_failure, { message }) => `${message}\n`,
};
