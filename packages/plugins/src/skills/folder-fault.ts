import { DeclarationError } from '@loomcli/core';

import { skillsFolder } from '../rules.js';

/** A fault of the skills folder, or of what a copy recorded, under the plugin's folder rule. */
function folderFault(sentence: string, correction: string): DeclarationError {
  return new DeclarationError(skillsFolder, { correction, sentence });
}

export { folderFault };
