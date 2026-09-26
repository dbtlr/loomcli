import { posix, win32 } from 'node:path';

import { createValidator } from './create.js';
import type { ParseResult, Validator } from './create.js';
import { fault, readOptions } from './faults.js';
import { reject } from './issues.js';
import { readable, writable } from './probe.js';
import type { PathKind } from './probe.js';

interface PathOptions {
  access?: 'read' | 'write';
  kind?: PathKind;
}

type PathAccess = 'read' | 'write';

const sentences: Record<PathAccess, Record<PathKind, string>> = {
  read: {
    any: 'Expected a readable file or directory that exists.',
    directory: 'Expected a readable directory that exists.',
    file: 'Expected a readable file that exists.',
  },
  write: {
    any: 'Expected a writable path, or a new path in a writable directory.',
    directory: 'Expected a writable directory, or a new directory in a writable directory.',
    file: 'Expected a writable file, or a new file in a writable directory.',
  },
};

function accessOf(value: unknown): PathAccess | undefined {
  if (value === undefined || value === 'read' || value === 'write') {
    return value;
  }
  throw fault('path() access is not "read" or "write". Supply "read" or "write".');
}

function kindOf(value: unknown, access: PathAccess | undefined): PathKind {
  if (value !== undefined && access === undefined) {
    throw fault('path() kind has no access to check. Supply an access or leave out kind.');
  }
  if (value === undefined || value === 'file' || value === 'directory' || value === 'any') {
    return value ?? 'file';
  }
  throw fault('path() kind is not "file", "directory", or "any". Supply one of them.');
}

/**
 * A path resolved against the host's cwd under the host platform's rules, and normalized.
 * With `access`, the filesystem is probed; the probe is advisory, since the filesystem can change.
 */
function path(options?: PathOptions): Validator<string> {
  const declared = readOptions('path', options);
  const access = accessOf(declared.access);
  const kind = kindOf(declared.kind, access);
  const sentence = access === undefined ? 'Expected a path.' : sentences[access][kind];
  return createValidator({
    inputSchema: { minLength: 1, type: 'string' },
    parse: (raw, context): ParseResult<string> | Promise<ParseResult<string>> => {
      if (raw === '' || raw.includes('\0')) {
        return reject(sentence);
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
      return probe.then((passes) => (passes ? { value: resolved } : reject(sentence)));
    },
  });
}

export { path };
export type { PathOptions };
