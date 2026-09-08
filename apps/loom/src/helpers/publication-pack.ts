import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { list } from 'tar';
import { z } from 'zod';

import type { readLibraries } from './repository.js';

export function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function integrity(bytes: Uint8Array) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

export function inspectPack(
  path: string,
  library: ReturnType<typeof readLibraries>[number],
  libraries: ReturnType<typeof readLibraries>,
) {
  const files = new Map<string, Buffer>();
  const names = new Set<string>();
  let total = 0;
  list({
    file: path,
    onReadEntry(entry) {
      const name = entry.path;
      const normalized = entry.type === 'Directory' ? name.replace(/\/$/u, '') : name;
      if (
        !normalized.startsWith('package/') ||
        /[\\:]/u.test(name) ||
        /\p{Cc}/u.test(name) ||
        posix.normalize(normalized) !== normalized ||
        normalized.split('/').some((part) => part === '..' || part === '.')
      ) {
        throw new Error(`Unsafe packed path: ${name}`);
      }
      if (entry.type !== 'File' && entry.type !== 'Directory') {
        throw new Error(`Packed links and special files are not supported: ${name}`);
      }
      if (names.has(normalized.toLowerCase())) {
        throw new Error(`Duplicate packed path: ${name}`);
      }
      names.add(normalized.toLowerCase());
      total += entry.size;
      if (total > 100 * 1024 * 1024) {
        throw new Error('Packed contents exceed 100 MiB.');
      }
      if (entry.type === 'File') {
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: unknown) => {
          if (!Buffer.isBuffer(chunk)) {
            throw new Error('Expected packed bytes.');
          }
          chunks.push(chunk);
        });
        entry.on('end', () => {
          files.set(name.slice('package/'.length), Buffer.concat(chunks));
        });
      }
    },
    strict: true,
    sync: true,
  });
  const manifestBytes = files.get('package.json');
  if (manifestBytes === undefined) {
    throw new Error('Packed package.json is missing.');
  }
  const manifest = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(manifestBytes.toString('utf8')));
  const expected = { ...library.manifest };
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const dependencies = z.record(z.string(), z.string()).optional().parse(expected[field]);
    if (dependencies !== undefined) {
      expected[field] = Object.fromEntries(
        Object.entries(dependencies).map(([name, version]) => {
          if (libraries.some((candidate) => candidate.manifest.name === name)) {
            if (version !== 'workspace:*') {
              throw new Error(`${name}: internal dependencies must use workspace:* in source.`);
            }
            return [name, library.manifest.version];
          }
          return [name, version];
        }),
      );
    }
  }
  for (const field of [
    'name',
    'version',
    'type',
    'exports',
    'types',
    'main',
    'module',
    'files',
    'engines',
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    if (!isDeepStrictEqual(manifest[field], expected[field])) {
      throw new Error(
        `${library.manifest.name}: packed ${field} differs from the release manifest.`,
      );
    }
  }
  if (JSON.stringify(manifest).includes('workspace:')) {
    throw new Error('Packed manifest contains a workspace: reference.');
  }
  if (manifest.private === true) {
    throw new Error('Packed library cannot be private.');
  }
  const allowed = z.array(z.string()).min(1).parse(manifest.files);
  for (const file of files.keys()) {
    if (
      !/^(?:package\.json|readme(?:\..*)?|licen[cs]e(?:\..*)?)$/iu.test(file) &&
      !allowed.some((pattern) => file === pattern || file.startsWith(`${pattern}/`))
    ) {
      throw new Error(`Unexpected packed file: ${file}. The files list must use literal paths.`);
    }
  }
  const exports = z
    .record(z.string(), z.object({ import: z.string(), types: z.string() }).strict())
    .parse(manifest.exports);
  if (Object.keys(exports).length === 0) {
    throw new Error('Packed exports cannot be empty.');
  }
  for (const [name, targets] of Object.entries(exports)) {
    if (name !== '.' && !/^\.\/[a-zA-Z0-9_/-]+$/u.test(name)) {
      throw new Error(`Unsupported export: ${name}`);
    }
    for (const target of [targets.types, targets.import]) {
      if (!target.startsWith('./') || !files.has(target.slice(2))) {
        throw new Error(`Missing packed export target: ${target}`);
      }
    }
    if (!targets.types.endsWith('.d.ts') || !targets.import.endsWith('.js')) {
      throw new Error(`Expected ESM JavaScript and declarations for ${name}.`);
    }
  }
  return { exports: Object.keys(exports), files: [...files.keys()].toSorted() };
}
