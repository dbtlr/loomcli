import { posix, win32 } from 'node:path';

import { pathIssue, pathReadableIssue, pathWritableIssue } from './codes.js';
import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, readOptions } from './faults.js';
import type { FactoryCall } from './faults.js';
import { reject } from './issues.js';
import { readable, writable } from './probe.js';
import type { PathKind } from './probe.js';
import { pathCheck } from './rules.js';

interface PathOptions {
  access?: 'read' | 'write';
  kind?: PathKind;
}

type PathAccess = 'read' | 'write';

function accessOf(call: FactoryCall, value: unknown): PathAccess | undefined {
  if (value === undefined || value === 'read' || value === 'write') {
    return value;
  }
  throw fault(
    pathCheck,
    { ...call, mark: '0.access' },
    {
      correction: 'Supply "read" or "write".',
      sentence: 'path() access is not "read" or "write".',
    },
  );
}

function kindOf(call: FactoryCall, value: unknown, access: PathAccess | undefined): PathKind {
  const at = { ...call, mark: '0.kind' };
  if (value !== undefined && access === undefined) {
    throw fault(pathCheck, at, {
      correction: 'Supply an access or leave out kind.',
      sentence: 'path() kind has no access to check.',
    });
  }
  if (value === undefined || value === 'file' || value === 'directory' || value === 'any') {
    return value ?? 'file';
  }
  throw fault(pathCheck, at, {
    correction: 'Supply one of them.',
    sentence: 'path() kind is not "file", "directory", or "any".',
  });
}

/**
 * A path resolved against the host's cwd under the host platform's rules, and normalized.
 * With `access`, the filesystem is probed; the probe is advisory, since the filesystem can change.
 */
function path(options?: PathOptions): Validator<string> {
  const declared = readOptions('path', options);
  const call = { arguments: [options], factory: 'path' };
  const access = accessOf(call, declared.access);
  const kind = kindOf(call, declared.kind, access);
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
      const { cwd, platform } = context.host;
      const rules = platform === 'win32' ? win32 : posix;
      const resolved = rules.resolve(cwd, raw);
      if (access === undefined) {
        return { value: resolved };
      }
      const probe =
        access === 'read'
          ? readable(resolved, kind)
          : writable(resolved, kind, rules.dirname(resolved));
      return probe.then((passes) => (passes ? { value: resolved } : reject(issue)));
    },
  });
}

export { path };
export type { PathOptions };
