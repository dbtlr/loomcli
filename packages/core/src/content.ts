import { close, constants, createReadStream, fstatSync, open } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Host } from './types.js';

/** A prepared source whose contents are read only when the action asks for them. */
type Content =
  | (ContentReader & { readonly kind: 'file'; readonly path: string })
  | (ContentReader & { readonly kind: 'stdin'; readonly path: undefined });

interface ContentReader {
  readonly name: string;
  stream(): Readable;
  text(): Promise<string>;
}

interface ContentSettings {
  readonly stdin?: boolean;
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
}

interface ContentScope {
  host: Host;
  named: boolean;
  collected: boolean;
  signal?: AbortSignal;
}

type PreparedContent = StandardSchemaV1.Result<Content | Content[] | undefined> & {
  readonly missing?: boolean;
};

/** Requiredness and an explicit lower bound describe one effective source minimum. */
function minimumSources(config: ContentSettings): number {
  const required = Number(config.required === true);
  return Math.max(required, config.min ?? required);
}

/** A stdin handle borrows the run's stream; repeated handles share its current position. */
function stdinContent(host: Host): Content {
  return Object.freeze({
    kind: 'stdin',
    name: 'stdin',
    path: undefined,
    stream: () => host.stdin,
    text: () => (host.stdin.readableEnded ? Promise.resolve('') : text(host.stdin)),
  });
}

const verdicts = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ENAMETOOLONG',
  'EINVAL',
]);
const unknownInode = 0n;

function openFile(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    open(path, 'r', (error, fd) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(fd);
    });
  });
}

function closeFile(fd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    close(fd, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/** Named calls cannot reopen the process stream through a filesystem alias. */
function aliasesProcessStdin(source: BigIntStats): boolean {
  try {
    const stdin = fstatSync(0, { bigint: true });
    // Windows may report no inode identity for a device; zero cannot identify an alias.
    if (
      process.platform === 'win32' &&
      (source.ino === unknownInode || stdin.ino === unknownInode)
    ) {
      return false;
    }
    return source.dev === stdin.dev && source.ino === stdin.ino;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EBADF') {
      return false;
    }
    throw error;
  }
}

function acceptsSource(source: BigIntStats, named: boolean): boolean {
  return (
    source.isFile() ||
    ((source.isFIFO() || source.isCharacterDevice() || source.isBlockDevice()) &&
      (!named || !aliasesProcessStdin(source)))
  );
}

/** Metadata and access checks do not open a FIFO or consume an input stream. */
async function readableSource(path: string, named: boolean): Promise<boolean> {
  try {
    const info = await stat(path, { bigint: true });
    if (!acceptsSource(info, named)) {
      return false;
    }
    await access(path, constants.R_OK);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      verdicts.has(error.code)
    ) {
      return false;
    }
    throw error;
  }
}

/** Preserve the operand's dot segments and trailing separators for filesystem resolution. */
function absoluteSource(name: string, host: Host): string {
  const paths = host.platform === 'win32' ? win32 : posix;
  const root = paths.parse(name).root;
  if (paths.isAbsolute(name) && (host.platform !== 'win32' || root !== paths.sep)) {
    return name;
  }
  const cwd = paths.isAbsolute(host.cwd) ? host.cwd : paths.resolve(host.cwd);
  const base = root === '' ? cwd : paths.resolve(cwd, root);
  const tail = root === '' ? name : name.slice(root.length);
  return `${base}${base.endsWith(paths.sep) ? '' : paths.sep}${tail}`;
}

/** Open only on consumption; native open preserves filesystem traversal on Node and Bun. */
async function* fileChunks(path: string): AsyncGenerator {
  const fd = await openFile(path);
  try {
    yield* createReadStream(path, { autoClose: false, fd });
  } finally {
    await closeFile(fd);
  }
}

/** A successful probe leaves opening the file to the action's first read. */
async function fileContent(
  name: string,
  { host, named }: ContentScope,
): Promise<StandardSchemaV1.Result<Content>> {
  const issues = [{ message: 'Expected a readable file that exists.' }];
  if (name.length === 0 || name.includes('\0')) {
    return { issues };
  }
  const path = absoluteSource(name, host);
  if (!(await readableSource(path, named))) {
    return { issues };
  }
  const stream = () => Readable.from(fileChunks(path), { objectMode: false });
  return { value: Object.freeze({ kind: 'file', name, path, stream, text: () => text(stream()) }) };
}

function tokensOf(raw: string | readonly string[] | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return typeof raw === 'string' ? [raw] : [...raw];
}

function sourceTokens(
  raw: string | readonly string[] | undefined,
  config: ContentSettings,
  scope: ContentScope,
): string[] {
  const tokens = tokensOf(raw);
  if (
    config.stdin &&
    !scope.named &&
    !scope.host.terminal.stdin.isTTY &&
    !tokens.includes('-') &&
    (scope.collected || tokens.length === 0)
  ) {
    tokens.push('-');
  }
  return tokens;
}

function sourceContent(
  token: string,
  config: ContentSettings,
  scope: ContentScope,
): Promise<StandardSchemaV1.Result<Content>> {
  if (token !== '-') {
    return fileContent(token, scope);
  }
  if (!config.stdin) {
    return Promise.resolve({
      issues: [{ message: 'This input accepts file paths only. Use ./- for a file named -.' }],
    });
  }
  if (scope.named || scope.host.terminal.stdin.isTTY) {
    return Promise.resolve({ issues: [{ message: 'Expected piped or redirected stdin.' }] });
  }
  return Promise.resolve({ value: stdinContent(scope.host) });
}

function countIssues(count: number, config: ContentSettings): StandardSchemaV1.Issue[] {
  const issues: StandardSchemaV1.Issue[] = [];
  const minimum = minimumSources(config);
  if (count < minimum) {
    issues.push({
      message: `Expected at least ${minimum} readable ${minimum === 1 ? 'source' : 'sources'}.`,
    });
  }
  if (config.max !== undefined && count > config.max) {
    issues.push({
      message: `Expected at most ${config.max} readable ${config.max === 1 ? 'source' : 'sources'}.`,
    });
  }
  return issues;
}

async function readSources(
  tokens: readonly string[],
  config: ContentSettings,
  scope: ContentScope,
) {
  const sources: Content[] = [];
  const issues: StandardSchemaV1.Issue[] = [];
  for (const [index, token] of tokens.entries()) {
    if (scope.signal?.aborted) {
      break;
    }
    const result = await sourceContent(token, config, scope);
    if (result.issues !== undefined) {
      issues.push(
        ...result.issues.map((issue) => (scope.collected ? { ...issue, path: [index] } : issue)),
      );
    } else {
      sources.push(result.value);
    }
  }
  return { issues, sources };
}

/** Source assembly precedes count checks, and never consumes stdin or file contents. */
async function prepareContent(
  raw: string | readonly string[] | undefined,
  config: ContentSettings,
  scope: ContentScope,
): Promise<PreparedContent> {
  const tokens = sourceTokens(raw, config, scope);
  const { sources, issues } = await readSources(tokens, config, scope);
  issues.unshift(...countIssues(tokens.length, config));
  if (issues.length > 0) {
    return {
      issues,
      ...(tokens.length === 0 && minimumSources(config) > 0 ? { missing: true } : {}),
    };
  }
  return { value: scope.collected ? sources : sources[0] };
}

export { minimumSources, prepareContent };
export type { Content, ContentSettings };
