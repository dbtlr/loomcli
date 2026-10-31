import { json, jsonl } from '@loomcli/plugins/format/views';

/** Report declaration outcomes through the public API. */
async function run() {
  let stdout = '';
  const write = (text: string) => {
    stdout += text;
  };
  // Each pack view declares its media type, whatever map it was built with.
  const declared = {
    json: json().mediaType,
    jsonl: jsonl().mediaType,
    mappedJson: json({ map: (data) => data }).mediaType,
    mappedJsonl: jsonl({ map: (data) => data }).mediaType,
  };

  write(`${JSON.stringify(declared)}\n`);
  return { stdout };
}

export { run };
