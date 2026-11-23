// JavaScript intentionally supplies declarations and settings that the public types reject.
import { version } from '@loomcli/plugins/version';

/** Report declaration outcomes through the public API. */
async function run(args = []) {
  let stdout = '';
  const write = (text) => {
    stdout += text;
  };

  /** One `version()` call with the settings the argument spells as JSON, and the fault it throws. */
  try {
    version(JSON.parse(args[0]));
    write('"returned"\n');
  } catch (error) {
    const { correction, findings, rule, sentence } = error;
    const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
    write(`${JSON.stringify({ correction, findings: marks, rule: rule?.identity, sentence })}\n`);
  }
  return { stdout };
}

export { run };
