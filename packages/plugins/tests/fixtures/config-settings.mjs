import { config } from '@loomcli/plugins/config';

/**
 * Calls `config()` with the settings the first argument holds as JSON, or with none when it is
 * absent, and prints the fault the call throws: its rule, sentence, correction, and findings. A
 * call that returns prints "returned".
 */
const [settings] = process.argv.slice(2);

try {
  if (settings === undefined) {
    config();
  } else {
    config(JSON.parse(settings));
  }
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, rule, sentence } = error;
  const marks = findings.map(({ call, mark }) => ({ call, mark }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, rule: rule?.identity, sentence })}\n`,
  );
}
