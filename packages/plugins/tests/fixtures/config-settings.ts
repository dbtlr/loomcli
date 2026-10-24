import { DeclarationError } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';

/**
 * `config` seen through a method signature, which compares its parameter loosely, so a test hands
 * it the invalid settings it exists to reject.
 */
const loose: { config(settings?: object): unknown } = { config };

/**
 * Calls `config()` with the settings given, or with none when they are absent, and answers the
 * fault the call throws as plain data: its rule, sentence, correction, and findings. A call that
 * returns answers "returned".
 */
function settingsFault(settings?: object) {
  try {
    if (settings === undefined) {
      config();
    } else {
      loose.config(settings);
    }
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
