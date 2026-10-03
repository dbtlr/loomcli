import { format } from '@loomcli/plugins/format';

/**
 * Calls `format()` with the settings the first argument holds as JSON, or with none when it is
 * absent, and prints the fault the call throws: its rule, sentence, correction, findings, and the
 * Developer Diagnostic its message holds. A call that returns prints "returned".
 */
const [settings] = process.argv.slice(2);

try {
  if (settings === undefined) {
    format();
  } else {
    format(JSON.parse(settings));
  }
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, message, rule, sentence } = error;
  const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, message, rule: rule?.identity, sentence })}\n`,
  );
}
