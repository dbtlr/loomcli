import type { FatalError, View } from '@loomcli/core';

export const fatalError: View<FatalError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};
