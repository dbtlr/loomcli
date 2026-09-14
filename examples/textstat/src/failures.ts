import type { FatalError, Renderer } from '@loomcli/core';

export const fatalError: Renderer<FatalError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};
