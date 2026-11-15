/**
 * The formatter's views module. The encoders live in a module no subpath owns, so another plugin's
 * middleware encodes with them without importing this views module.
 */
export { json, jsonl } from '../json-views.js';
export type { EncodingConfig } from '../json-views.js';
