import { checkShortSetting } from '@loomcli/core';

/**
 * A third-party plugin factory's settings, given as JSON in the first argument, judged by the
 * public `checkShortSetting` for the factory `retry` of plugin "@acme/retry" and its option
 * `attempts`. The fixture prints the fault's rule, sentence, and findings, or "returned".
 */
const [settings] = process.argv.slice(2);

try {
  checkShortSetting(JSON.parse(settings), {
    call: 'retry',
    option: 'attempts',
    plugin: '@acme/retry',
  });
  process.stdout.write('"returned"\n');
} catch (error) {
  const { findings, rule, sentence } = error;
  const marks = findings.map((finding) => ({
    args: finding.arguments,
    call: finding.call,
    mark: finding.mark,
    note: finding.note,
  }));
  process.stdout.write(`${JSON.stringify({ findings: marks, rule: rule.identity, sentence })}\n`);
}
