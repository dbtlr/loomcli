import type { View } from '@loomcli/core';

/**
 * The text as it is, with no markup resolved and no newline added, because a client reads these
 * bytes. It renders through `out`, so a reader that closes stdout ends the run as it does any
 * write. The completion plugin's print children render their scripts the same way.
 */
const exactText: View<string> = {
  render: (script, { style }) => style.escape(script),
};

export { exactText };
