import { DeclarationError } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { z } from 'zod';

import type { Settings } from './config-run.ts';

/**
 * Calls `configuration()` with the settings given, or with none beside the schema when they are
 * absent, and answers the fault the call throws as plain data: its rule, sentence, correction, and
 * findings. A call that returns answers "returned".
 */
function settingsFault(settings?: Settings) {
  try {
    configuration({ ...settings, schema: z.object({}) });
    return 'returned';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    const { correction, findings, rule, sentence } = error;
    const marks = findings.map(({ call, mark }) => ({ call, mark }));
    return { correction, findings: marks, rule: rule?.identity, sentence };
  }
}

export { settingsFault };
