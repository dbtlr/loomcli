import { json, jsonl } from '@loomcli/plugins/format/views';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  const captured = output;
  // Each pack view declares its media type, whatever map it was built with.
  const declared = {
    json: json().mediaType,
    jsonl: jsonl().mediaType,
    mappedJson: json({ map: (data) => data }).mediaType,
    mappedJsonl: jsonl({ map: (data) => data }).mediaType,
  };

  captured.stdout.write(`${JSON.stringify(declared)}\n`);
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
