import { json, jsonl } from '@loomcli/plugins/format/views';

// Each pack view declares its media type, whatever map it was built with.
const declared = {
  json: json().mediaType,
  jsonl: jsonl().mediaType,
  mappedJson: json({ map: (data) => data }).mediaType,
  mappedJsonl: jsonl({ map: (data) => data }).mediaType,
};
process.stdout.write(`${JSON.stringify(declared)}\n`);
