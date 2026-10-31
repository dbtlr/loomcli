// JavaScript intentionally supplies declarations and settings that the public types reject.
import { format } from '@loomcli/plugins/format';

/** Report declaration outcomes through the public API. */
async function run(args = []) {
  let stdout = '';
  const write = (text) => {
    stdout += text;
  };

  /**
   * Calls `format()` with the settings the first argument holds as JSON, or with none when it is
   * absent, and prints the fault the call throws: its rule, sentence, correction, findings, and the
   * Developer Diagnostic its message holds. A call that returns prints "returned".
   */
  const [settings] = args;

  try {
    if (settings === undefined) {
      format();
    } else {
      format(JSON.parse(settings));
    }
    write('"returned"\n');
  } catch (error) {
    const { correction, findings, message, rule, sentence } = error;
    const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
    write(
      `${JSON.stringify({ correction, findings: marks, message, rule: rule?.identity, sentence })}\n`,
    );
  }
  return { stdout };
}

export { run };
