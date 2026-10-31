import { version } from '@loomcli/plugins/version';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const current = output;

  /** One `version()` call with the settings the argument spells as JSON, and the fault it throws. */
  try {
    version(JSON.parse(args[0]));
    current.stdout.write('"returned"\n');
  } catch (error) {
    const { correction, findings, rule, sentence } = error;
    const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
    current.stdout.write(
      `${JSON.stringify({ correction, findings: marks, rule: rule?.identity, sentence })}\n`,
    );
  }
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
