import { version } from '@loomcli/plugins/version';

/** One `version()` call with the settings the argument spells as JSON, and the fault it throws. */
try {
  version(JSON.parse(process.argv[2]));
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, rule, sentence } = error;
  const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, rule: rule?.identity, sentence })}\n`,
  );
}
