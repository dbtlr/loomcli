import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';

const [mode, value] = process.argv.slice(2);

/** Public declarations that compete with the manifest's chosen spelling. */
const collisions = {
  global: () =>
    new Application('app', { plugins: [manifest({ short: 'M' })] }).globalOption('metric', {
      short: 'M',
      type: 'string',
    }),
  local: () =>
    new Application('app', { plugins: [manifest({ short: 'M' })] }).option('metric', {
      short: 'M',
      type: 'string',
    }),
  plugin: () => new Application('app', { plugins: [help(), manifest({ short: 'h' })] }),
};

try {
  if (mode === 'collision') {
    collisions[value]();
  } else if (value === undefined) {
    manifest();
  } else {
    manifest(JSON.parse(value));
  }
  process.stdout.write('"returned"\n');
} catch (error) {
  const { correction, findings, message, rule, sentence } = error;
  const marks = findings.map(({ call, mark, note }) => ({ call, mark, note }));
  process.stdout.write(
    `${JSON.stringify({ correction, findings: marks, message, rule: rule?.identity, sentence })}\n`,
  );
}
