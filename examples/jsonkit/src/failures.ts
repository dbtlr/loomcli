import { PathNotFoundError } from './resolve-path.js';
import { InvalidJsonError } from './translators.js';

// The failures jsonkit's Commands declare to the manifest, each with one line of meaning.
// The manifest lists each by the failure code its class declares.
// A Command inherits no failure from its parent, so each Command lists the ones it can raise.
// These shared lists keep the Commands in step.

/** Shared by every Command that reads a document. */
export const readFailures = [
  { failure: InvalidJsonError, meaning: 'The document is not valid JSON.' },
];

/** Shared by every Command that resolves a path the operator supplies. */
export const pathFailures = [
  { failure: PathNotFoundError, meaning: 'The path names no value in the document.' },
];
