/**
 * The formatter's views module. The encoders live in a module no subpath owns, so another plugin's
 * middleware encodes with them without importing this views module.
 */
export { json, jsonl, jsonlRows } from '../json-views.js';
export type { EncodingConfig } from '../json-views.js';

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
