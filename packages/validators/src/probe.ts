import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { access, stat } from 'node:fs/promises';

type PathKind = 'file' | 'directory' | 'any';

/** The probe failures that are a verdict about the operator's path rather than a broken host. */
const verdicts = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ENAMETOOLONG',
  'EINVAL',
]);

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** Runs one probe, reading a verdict failure as `false` and rethrowing any other failure. */
async function holds(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return await probe();
  } catch (error) {
    const code = codeOf(error);
    if (code !== undefined && verdicts.has(code)) {
      return false;
    }
    throw error;
  }
}

function isKind(stats: Stats, kind: PathKind): boolean {
  if (kind === 'file') {
    return stats.isFile();
  }
  return kind === 'directory' ? stats.isDirectory() : true;
}

/** Whether an entry exists, following symbolic links, is of `kind`, and grants `mode`. */
async function grants(target: string, kind: PathKind, mode: number): Promise<boolean> {
  const stats = await stat(target);
  if (!isKind(stats, kind)) {
    return false;
  }
  await access(target, mode);
  return true;
}

async function readable(target: string, kind: PathKind): Promise<boolean> {
  return await holds(async () => await grants(target, kind, constants.R_OK));
}

/**
 * Whether the process can write the entry, or create it when no entry exists: then the parent
 * must be an existing directory the process can write. Nothing is created.
 */
async function writable(target: string, kind: PathKind, parent: string): Promise<boolean> {
  return await holds(async () => {
    try {
      return await grants(target, kind, constants.W_OK);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') {
        throw error;
      }
      return await grants(parent, 'directory', constants.W_OK);
    }
  });
}

export { holds, readable, writable };
export type { PathKind };
