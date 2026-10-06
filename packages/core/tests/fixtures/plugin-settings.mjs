import { checkPluginSettings } from '@loomcli/core';

/**
 * A third-party plugin factory's settings, given as JSON in the first argument, judged by the
 * public `checkPluginSettings` for the factory `retry` of plugin "@acme/retry". The fixture prints
 * the fault's rule, sentence, correction, and findings, or "returned".
 */
const [settings] = process.argv.slice(2);

try {
  checkPluginSettings(JSON.parse(settings), { call: 'retry', plugin: '@acme/retry' });
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, rule, sentence } = error;
  const marks = findings.map((finding) => ({
    args: finding.arguments,
    call: finding.call,
    mark: finding.mark,
    note: finding.note,
  }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, rule: rule.identity, sentence })}\n`,
  );
}
