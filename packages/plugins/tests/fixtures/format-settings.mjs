import { format } from '@loomcli/plugins/format';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const current = output;

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
    current.stdout.write('"returned"\n');
  } catch (error) {
    const { correction, findings, message, rule, sentence } = error;
    const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
    current.stdout.write(
      `${JSON.stringify({ correction, findings: marks, message, rule: rule?.identity, sentence })}\n`,
    );
  }
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
