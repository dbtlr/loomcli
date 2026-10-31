import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const current = output;
  const [mode, value] = args;

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
