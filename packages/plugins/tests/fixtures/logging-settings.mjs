import { logging } from '@loomcli/plugins/logging';

/** One `logging()` call with the settings the argument spells as JSON, or none without one, and the fault it throws. */
try {
  const [settings] = process.argv.slice(2);
  logging(settings === undefined ? undefined : JSON.parse(settings));
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, rule, sentence } = error;
  const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, rule: rule?.identity, sentence })}\n`,
  );
}
