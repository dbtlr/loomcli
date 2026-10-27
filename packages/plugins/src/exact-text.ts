import type { View } from '@loomcli/core';

/**
 * The text as it is, with no markup resolved and no newline added, because another program reads
 * these bytes: a shell sources a completion script, and an MCP client reads a configuration. It
 * renders through `out`, so a reader that closes stdout ends the run as it does any write.
 */
const exactText: View<string> = {
  render: (text, { style }) => style.escape(text),
};

export { exactText };
