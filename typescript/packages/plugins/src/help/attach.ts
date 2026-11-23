import { readExtension } from '@loomcli/core';
import type { CommandAttachHook } from '@loomcli/core';

import { manifestCommand } from '../manifest/extension.js';
import { helpCommand } from './extension.js';

/**
 * Help's hook: it decides that its prose belongs in the manifest and supplies it through the
 * manifest's collecting extension, so the manifest carries no code for help. It reads the help
 * value as it stands at help's turn, and a Command with nothing to supply gets nothing.
 */
export const attachHelp: CommandAttachHook = (command) => {
  const value = readExtension(command, helpCommand);
  if (value === undefined || (value.details === undefined && value.examples === undefined)) {
    return command;
  }
  return command.extend(
    manifestCommand({
      ...(value.details === undefined ? {} : { details: value.details }),
      ...(value.examples === undefined ? {} : { examples: [...value.examples] }),
    }),
  );
};
