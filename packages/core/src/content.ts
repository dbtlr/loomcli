import { constants, createReadStream, open } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, sep } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import type { StandardSchemaV1 } from '@standard-schema/spec';

import { aliasesProcessStdin } from './process-handle.js';
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

/**
 * Whether a source may be read: a file, or a pipe or a device that is not, in a named call, the
 * process's own stdin reached through a filesystem alias. A path reaches the real file system,
 * so the check applies whatever the run's process handle.
 */
async function acceptsSource(source: BigIntStats, scope: ContentScope): Promise<boolean> {
  return (
    source.isFile() ||
    ((source.isFIFO() || source.isCharacterDevice() || source.isBlockDevice()) &&
      !(scope.named && (await aliasesProcessStdin(source))))
  );
}

/** Metadata and access checks do not open a FIFO or consume an input stream. */
async function readableSource(path: string, scope: ContentScope): Promise<boolean> {
  try {
    const info = await stat(path, { bigint: true });
    if (!(await acceptsSource(info, scope))) {
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

/**
 * The operand as a path under the run's working directory, joined to it without normalizing, so
 * its dot segments and trailing separators reach filesystem resolution.
 */
function absoluteSource(name: string, host: Host): string {
  if (isAbsolute(name)) {
    return name;
  }
  const { cwd } = host;
  return `${cwd}${cwd.endsWith(sep) ? '' : sep}${name}`;
}

/** Native open preserves traversal; the reader alone closes its descriptor after pending reads. */
async function* fileChunks(path: string): AsyncGenerator {
  const fd = await openFile(path);
  yield* createReadStream(path, { fd });
}

/** A successful probe leaves opening the file to the action's first read. */
async function fileContent(
  name: string,
  scope: ContentScope,
): Promise<StandardSchemaV1.Result<Content>> {
  const issues = [{ message: 'Expected a readable file that exists.' }];
  if (name.length === 0 || name.includes('\0')) {
    return { issues };
  }
  const path = absoluteSource(name, scope.host);
  if (!(await readableSource(path, scope))) {
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

export { prepareContent };
export type { Content, ContentSettings };
