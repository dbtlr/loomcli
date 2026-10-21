import { dirname, resolve } from 'node:path';

import { pathIssue, pathReadableIssue, pathWritableIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { readOptions } from './faults.js';
import { reject } from './issues.js';
import { readable, writable } from './probe.js';
import type { PathKind } from './probe.js';

type PathAccess = 'read' | 'write';

/**
 * What `path()` checks on the filesystem: an access, read or write, which `kind` narrows to a
 * file, a directory, or any entry. `kind` has no meaning without an access, so the type takes it
 * only beside one.
 */
type PathOptions =
  | { access: PathAccess; kind?: PathKind }
  | { access?: undefined; kind?: undefined };

/**
 * A path resolved against the host's cwd under the running process's path rules, and normalized.
 * With `access`, the filesystem is probed; the probe is advisory, since the filesystem can change.
 */
function path(options?: PathOptions): Validator<string> {
  readOptions('path', options);
  const access = options?.access;
  const kind = options?.kind ?? 'file';
  const issue =
    access === undefined
      ? pathIssue.issue({})
      : (access === 'read' ? pathReadableIssue : pathWritableIssue).issue({ kind });
  return createValidator({
    inputSchema: { type: 'string', minLength: 1 },
    parse: (raw, context): ParseResult<string> | Promise<ParseResult<string>> => {
      if (raw === '' || raw.includes('\0')) {
        return reject(issue);
      }
      const resolved = resolve(context.host.cwd, raw);
      if (access === undefined) {
        return { value: resolved };
      }
      const probe =
        access === 'read' ? readable(resolved, kind) : writable(resolved, kind, dirname(resolved));
      return probe.then((passes) => (passes ? { value: resolved } : reject(issue)));
    },
  });
}

export { path };
export type { PathOptions };
