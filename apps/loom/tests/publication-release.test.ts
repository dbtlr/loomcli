import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { publishPublication } from '../src/helpers/publication-release.js';
import { verifyArtifacts } from '../src/helpers/publication.js';

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'loom-release-recovery-'));
const artifacts = join(root, 'retained');
const options = {
  artifact: '56',
  artifacts,
  digest: '',
  head: '',
  repository: 'sample/fixture',
  run: '12',
};
function retainedManifest() {
  return verifyArtifacts(root, options);
}
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 });
  expect(result.error).toBeUndefined();
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({
    status: 0,
    stderr: '',
  });
  return result.stdout.trim();
}
function put(path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
function commit() {
  run('git', ['add', '.']);
  run('git', [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'Fixture',
  ]);
  return run('git', ['rev-parse', 'HEAD']);
}
beforeAll(() => {
  run('git', ['init', '-q']);
  run('git', ['config', 'core.autocrlf', 'false']);
  put('.gitignore', 'node_modules\ndist\nretained\n');
  put('.changes/README.md', '# Guide\n');
  put('.changes/first.md', '- Add the initial libraries.\n');
  put('CHANGELOG.md', '# Changelog\n\n');
  put('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  put('package.json', JSON.stringify({ private: true, scripts: { verify: 'node -e "0"' } }));
  for (const name of ['core', 'other']) {
    put(
      `packages/${name}/package.json`,
      JSON.stringify({
        exports: { '.': { import: './index.js', types: './index.d.ts' } },
        files: ['index.js', 'index.d.ts'],
        name: `@sample/${name}`,
        repository: { type: 'git', url: 'git+https://github.com/sample/fixture.git' },
        type: 'module',
        version: '0.0.0',
      }),
    );
    put(`packages/${name}/index.js`, 'export const value = 42;\n');
    put(`packages/${name}/index.d.ts`, 'export declare const value: 42;\n');
  }
  const base = commit();
  run('node', [cli, 'changelog', 'write', '--initial', '--date', '2026-09-08']);
  options.head = commit();
  const prepared = z
    .object({ digest: z.string() })
    .parse(
      JSON.parse(
        run('node', [
          cli,
          'publication',
          'prepare',
          '--base',
          base,
          '--head',
          options.head,
          '--title',
          'chore(release): Release v0.1.0 - Initial libraries',
          '--output',
          artifacts,
        ]),
      ),
    );
  options.digest = prepared.digest;
  verifyArtifacts(root, options);
  put('machinery-repair', 'This later checkout must never become the release source.\n');
  commit();
}, 120_000);

afterAll(() => rmSync(root, { force: true, recursive: true }));

function boundaries() {
  const manifest = retainedManifest();
  const writes: string[] = [];
  const versions = new Map<string, string>();
  const tags = new Map<string, string>();
  const assets = new Map<string, { id: number; bytes: Buffer; state?: string }>();
  let release:
    | {
        id: number;
        tag_name: string;
        name: string;
        body: string;
        draft: boolean;
        prerelease: boolean;
        target_commitish: string;
      }
    | undefined = undefined;
  let tag: { type: string; sha: string } | undefined = undefined;
  return {
    assets,
    services: {
      async download(id: number) {
        const asset = [...assets.values()].find((entry) => entry.id === id);
        if (!asset) {
          throw new Error('Missing asset');
        }
        return asset.bytes;
      },
      async github(method: string, path: string, body?: unknown): Promise<unknown> {
        if (
          method === 'GET' &&
          path === '/repos/sample/fixture/contents/ledger.json?ref=publication-ledger'
        ) {
          return {
            content: Buffer.from(
              JSON.stringify({
                records: [
                  {
                    ...manifest,
                    artifact: '56',
                    digest: options.digest,
                    fragments: undefined,
                    packages: undefined,
                    run: '12',
                    schema: undefined,
                    state: 'retained',
                  },
                ],
                schema: 1,
              }),
            ).toString('base64'),
            encoding: 'base64',
            type: 'file',
          };
        }
        if (method === 'GET' && path.includes('/actions/artifacts/')) {
          return { expired: false, name: `release-${options.head}`, workflow_run: { id: 12 } };
        }
        if (method === 'GET' && path.endsWith('/releases/1')) {
          return release;
        }
        if (method === 'GET' && path.endsWith('/releases?per_page=100&page=1')) {
          return release ? [release] : [];
        }
        if (method === 'GET' && path.includes('/git/ref/tags/')) {
          return tag ? { object: tag } : undefined;
        }
        if (method === 'GET' && path.endsWith('/git/tags/tag-object')) {
          return { object: { sha: options.head, type: 'commit' }, tag: 'v0.1.0' };
        }
        if (method === 'GET' && path.endsWith('/releases/1/assets?per_page=100&page=1')) {
          return [...assets].map(([name, asset]) => ({
            id: asset.id,
            name,
            size: asset.bytes.length,
            state: asset.state ?? 'uploaded',
          }));
        }
        if (method === 'DELETE' && path.includes('/releases/assets/')) {
          const found = [...assets].find(
            ([, asset]) => String(asset.id) === path.split('/').at(-1),
          );
          if (!found) {
            throw new Error('Missing placeholder');
          }
          assets.delete(found[0]);
          writes.push(`remove placeholder ${found[0]}`);
          return undefined;
        }
        if (method === 'POST' && path.endsWith('/git/tags')) {
          writes.push('annotate');
          return { sha: 'tag-object' };
        }
        if (method === 'POST' && path.endsWith('/git/refs')) {
          tag = { sha: 'tag-object', type: 'tag' };
          writes.push('tag');
          return {};
        }
        if (method === 'POST' && path.endsWith('/releases')) {
          release = {
            ...z
              .object({
                body: z.string(),
                draft: z.boolean(),
                name: z.string(),
                prerelease: z.boolean(),
                tag_name: z.string(),
                target_commitish: z.string(),
              })
              .parse(body),
            id: 1,
          };
          writes.push('draft');
          return release;
        }
        if (method === 'PATCH' && path.endsWith('/releases/1')) {
          if (!release) {
            throw new Error('Missing draft');
          }
          release.draft = false;
          writes.push('release');
          return release;
        }
        throw new Error(`Unexpected GitHub call: ${method} ${path}`);
      },
      async npm(args: string[]) {
        const [command, spec, field] = args;
        if (command === 'whoami') {
          return { status: 0, stdout: '"operator"' };
        }
        if (command === 'dist-tag' && spec === 'ls') {
          if (!versions.has(field ?? '') && !tags.has(field ?? '')) {
            return { status: 1, stdout: '{"error":{"code":"E404"}}' };
          }
          return {
            status: 0,
            stdout: `loom-staging: 0.1.0\n${tags.has(field ?? '') ? `latest: ${tags.get(field ?? '')}\n` : ''}`,
          };
        }
        if (command === 'view') {
          const pkg = manifest.packages.find((entry) => `${entry.name}@${entry.version}` === spec);
          if (!pkg || !versions.has(pkg.name)) {
            return { status: 1, stdout: '{"error":{"code":"E404"}}' };
          }
          return {
            status: 0,
            stdout: JSON.stringify({
              dist: { integrity: versions.get(pkg.name) },
              name: pkg.name,
              version: pkg.version,
            }),
          };
        }
        if (command === 'publish') {
          const pkg = manifest.packages.find((entry) => join(artifacts, entry.file) === spec);
          if (!pkg) {
            throw new Error('Unexpected package');
          }
          expect(args.slice(2)).toEqual([
            '--access',
            'public',
            '--provenance',
            '--tag',
            'loom-staging',
            '--ignore-scripts',
            '--json',
          ]);
          versions.set(pkg.name, pkg.integrity);
          writes.push(`publish ${pkg.name}`);
          return { status: 0, stdout: '{}' };
        }
        if (command === 'dist-tag' && spec === 'add') {
          const pkg = manifest.packages.find((entry) => `${entry.name}@${entry.version}` === field);
          if (!pkg) {
            throw new Error('Unexpected promotion');
          }
          expect([...versions.keys()]).toHaveLength(2);
          tags.set(pkg.name, pkg.version);
          writes.push(`promote ${pkg.name}`);
          return { status: 0, stdout: '{}' };
        }
        throw new Error(`Unexpected npm call: ${args.join(' ')}`);
      },
      async upload(id: number, name: string, bytes: Buffer) {
        expect(id).toBe(1);
        assets.set(name, { bytes, id: assets.size + 1 });
        writes.push(`attach ${name}`);
      },
    },
    tags,
    versions,
    writes,
  };
}

test('publication accepts E404 for missing packages and tags, then retries without writes', async () => {
  const boundary = boundaries();
  const result = await publishPublication(root, options, boundary.services);
  expect(result).toMatchObject({
    digest: options.digest,
    source: options.head,
    status: 'complete',
    version: '0.1.0',
  });
  expect(boundary.writes).toEqual([
    'publish @sample/core',
    'publish @sample/other',
    'promote @sample/core',
    'promote @sample/other',
    'draft',
    'annotate',
    'tag',
    'attach manifest.json',
    'attach package-0.tgz',
    'attach package-1.tgz',
    'attach publication.json',
    'release',
  ]);
  expect(boundary.assets.get('package-0.tgz')?.bytes).toEqual(
    readFileSync(join(artifacts, 'package-0.tgz')),
  );
  boundary.writes.length = 0;
  await expect(publishPublication(root, options, boundary.services)).resolves.toMatchObject({
    status: 'complete',
  });
  expect(boundary.writes).toEqual([]);
});

test.each([
  'publish @sample/core',
  'publish @sample/other',
  'promote @sample/core',
  'promote @sample/other',
  'draft',
  'annotate',
  'tag',
  'attach manifest.json',
  'attach package-0.tgz',
  'attach package-1.tgz',
  'attach publication.json',
  'release',
])('resume reconciles lost acknowledgement after %s', async (interrupted) => {
  const boundary = boundaries();
  let interruptedOnce = false;
  function interrupt() {
    if (!interruptedOnce && boundary.writes.at(-1) === interrupted) {
      interruptedOnce = true;
      throw new Error('Connection lost after external commit');
    }
  }
  const original = boundary.services;
  const services = {
    ...original,
    async github(method: string, path: string, body?: unknown) {
      const result = await original.github(method, path, body);
      interrupt();
      return result;
    },
    async npm(args: string[]) {
      const result = await original.npm(args);
      interrupt();
      return result;
    },
    async upload(id: number, name: string, bytes: Buffer) {
      await original.upload(id, name, bytes);
      interrupt();
    },
  };
  await expect(publishPublication(root, options, services)).rejects.toThrow('Connection lost');
  await expect(publishPublication(root, options, services)).resolves.toMatchObject({
    status: 'complete',
  });
  expect(boundary.writes.filter((write) => write === interrupted)).toHaveLength(
    interrupted === 'annotate' ? 2 : 1,
  );
});

test('integrity conflict in the second package refuses even the first publication', async () => {
  const boundary = boundaries();
  boundary.versions.set('@sample/other', 'sha512-wrong');
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'registry integrity differs',
  );
  expect(boundary.writes).toEqual([]);
});

test('missing retained bytes refuse all external operations', async () => {
  const boundary = boundaries();
  await expect(
    publishPublication(root, { ...options, artifacts: join(root, 'missing') }, boundary.services),
  ).rejects.toThrow('ENOENT');
  expect(boundary.writes).toEqual([]);
});

test('publication reads the final GitHub Release instead of trusting the update acknowledgement', async () => {
  const boundary = boundaries();
  const original = boundary.services.github.bind(boundary.services);
  boundary.services.github = async (method, path, body) => {
    if (method === 'PATCH' && path.endsWith('/releases/1')) {
      const draft = z
        .object({ draft: z.boolean() })
        .passthrough()
        .parse(await original('GET', path));
      return { ...draft, draft: false };
    }
    return original(method, path, body);
  };
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow('incomplete');
});

test.each(['E401', 'E403', 'ETIMEDOUT'])('registry %s is not package absence', async (code) => {
  const boundary = boundaries();
  const original = boundary.services.npm.bind(boundary.services);
  boundary.services.npm = async (args) =>
    args[0] === 'view'
      ? { status: 1, stdout: JSON.stringify({ error: { code } }) }
      : original(args);
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'authenticated registry state',
  );
  expect(boundary.writes).toEqual([]);
});

test.each(['', '{', '{"error":{"code":"E404"}', '{}', 'null'])(
  'malformed npm error %j preserves registry recovery guidance',
  async (stdout) => {
    const boundary = boundaries();
    const original = boundary.services.npm.bind(boundary.services);
    boundary.services.npm = async (args) =>
      args[0] === 'view' ? { status: 1, stdout } : original(args);
    await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
      'npm view failed. Stop and inspect the authenticated registry state.',
    );
    expect(boundary.writes).toEqual([]);
  },
);

test.each(['', '{'])(
  'malformed successful npm response %j stops for reconciliation',
  async (stdout) => {
    const boundary = boundaries();
    const original = boundary.services.npm.bind(boundary.services);
    boundary.services.npm = async (args) =>
      args[0] === 'view' ? { status: 0, stdout } : original(args);
    await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
      'Invalid npm view JSON response. Stop for reconciliation.',
    );
    expect(boundary.writes).toEqual([]);
  },
);

test('E404 cannot turn a failed authentication check into absence', async () => {
  const boundary = boundaries();
  const original = boundary.services.npm.bind(boundary.services);
  boundary.services.npm = async (args) =>
    args[0] === 'whoami' ? { status: 1, stdout: '{"error":{"code":"E404"}}' } : original(args);
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'npm whoami failed. Stop and inspect the authenticated registry state.',
  );
  expect(boundary.writes).toEqual([]);
});

test('malformed npm dist-tag error cannot become an absent latest tag', async () => {
  const boundary = boundaries();
  const original = boundary.services.npm.bind(boundary.services);
  boundary.services.npm = async (args) =>
    args[0] === 'dist-tag' && args[1] === 'ls' ? { status: 1, stdout: '' } : original(args);
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'npm dist-tag failed. Stop and inspect the authenticated registry state.',
  );
  expect(boundary.writes).toEqual([]);
});

test.each(['0.2.0-beta.1', '1.0.0', 'invalid'])(
  'unsupported latest %s stops before publication',
  async (latest) => {
    const boundary = boundaries();
    boundary.tags.set('@sample/other', latest);
    await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
      `@sample/other: unsupported npm latest version ${latest}. Stop for reconciliation.`,
    );
    expect(boundary.writes).toEqual([]);
    expect(boundary.tags.get('@sample/other')).toBe(latest);
  },
);

test.each(['0.2.0-beta.1', '1.0.0'])(
  'unsupported latest %s appearing before promotion is not overwritten',
  async (latest) => {
    const boundary = boundaries();
    const original = boundary.services.npm.bind(boundary.services);
    boundary.services.npm = async (args) => {
      const result = await original(args);
      if (args[0] === 'publish') {
        boundary.tags.set('@sample/core', latest);
      }
      return result;
    };
    await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
      `@sample/core: unsupported npm latest version ${latest}. Stop for reconciliation.`,
    );
    expect(boundary.writes).toEqual(['publish @sample/core', 'publish @sample/other']);
    expect(boundary.tags.get('@sample/core')).toBe(latest);
  },
);

test('an older incomplete release cannot roll latest back', async () => {
  const boundary = boundaries();
  boundary.tags.set('@sample/other', '0.2.0');
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'older incomplete release',
  );
  expect(boundary.writes).toEqual([]);
});

test('a completed historical retry leaves newer latest tags unchanged', async () => {
  const boundary = boundaries();
  await publishPublication(root, options, boundary.services);
  boundary.tags.set('@sample/core', '0.2.0');
  boundary.tags.set('@sample/other', '0.2.0');
  boundary.writes.length = 0;
  await expect(publishPublication(root, options, boundary.services)).resolves.toMatchObject({
    status: 'complete',
  });
  expect(boundary.writes).toEqual([]);
  expect([...boundary.tags.values()]).toEqual(['0.2.0', '0.2.0']);
});

test('a conflicting retained asset is never overwritten', async () => {
  const boundary = boundaries();
  await publishPublication(root, options, boundary.services);
  boundary.assets.set('package-0.tgz', { bytes: Buffer.from('wrong bytes'), id: 2 });
  boundary.writes.length = 0;
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'attachment package-0.tgz differs',
  );
  expect(boundary.writes).toEqual([]);
});

test('a conflicting annotated tag refuses registry mutations', async () => {
  const boundary = boundaries();
  const original = boundary.services.github.bind(boundary.services);
  boundary.services.github = async (method, path, body) => {
    if (path.includes('/git/ref/tags/')) {
      return { object: { sha: 'wrong-tag', type: 'tag' } };
    }
    if (path.endsWith('/git/tags/wrong-tag')) {
      return { object: { sha: 'f'.repeat(40), type: 'commit' }, tag: 'v0.1.0' };
    }
    return original(method, path, body);
  };
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'Annotated source tag differs',
  );
  expect(boundary.writes).toEqual([]);
});

test('publication requires the packed repository to match its GitHub destination', async () => {
  const boundary = boundaries();
  await expect(
    publishPublication(root, { ...options, repository: 'sample/different' }, boundary.services),
  ).rejects.toThrow('repository URL');
  expect(boundary.writes).toEqual([]);
});

test('resume removes only an empty starter attachment left by a failed GitHub upload', async () => {
  const boundary = boundaries();
  const original = boundary.services.upload.bind(boundary.services);
  let failed = false;
  boundary.services.upload = async (id, name, bytes) => {
    if (!failed && name === 'manifest.json') {
      failed = true;
      boundary.assets.set(name, { bytes: Buffer.alloc(0), id: 99, state: 'starter' });
      throw new Error('Upload gateway failed');
    }
    await original(id, name, bytes);
  };
  await expect(publishPublication(root, options, boundary.services)).rejects.toThrow(
    'Upload gateway',
  );
  await expect(publishPublication(root, options, boundary.services)).resolves.toMatchObject({
    status: 'complete',
  });
  expect(boundary.writes).toContain('remove placeholder manifest.json');
});

test('pinned npm promotes a staging-only package without resolving a nonexistent latest version', async () => {
  const boundary = boundaries();
  const server = createServer((request, response) => {
    const name = decodeURIComponent(request.url ?? '').includes('@sample/core')
      ? '@sample/core'
      : '@sample/other';
    response.setHeader('content-type', 'application/json');
    if (!boundary.versions.has(name)) {
      response.statusCode = 404;
      response.end('{"error":"Not found"}');
      return;
    }
    const tags = {
      'loom-staging': '0.1.0',
      ...(boundary.tags.has(name) ? { latest: boundary.tags.get(name) } : {}),
    };
    response.end(
      JSON.stringify(
        request.url?.startsWith('/-/package/')
          ? tags
          : {
              'dist-tags': tags,
              name,
              versions: {
                '0.1.0': {
                  dist: { integrity: boundary.versions.get(name) },
                  name,
                  version: '0.1.0',
                },
              },
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing local registry');
  }
  const npmCli = join(
    dirname(fileURLToPath(import.meta.resolve('npm/package.json'))),
    'bin/npm-cli.js',
  );
  const directory = mkdtempSync(join(tmpdir(), 'loom-npm-boundary-'));
  const original = boundary.services.npm.bind(boundary.services);
  boundary.services.npm = async (args) => {
    if (
      !(
        (args[0] === 'view' && args[2] === 'dist-tags') ||
        (args[0] === 'dist-tag' && args[1] === 'ls')
      )
    ) {
      return original(args);
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          npmCli,
          ...args,
          `--registry=http://127.0.0.1:${address.port}`,
          `--userconfig=${join(directory, 'user')}`,
          `--globalconfig=${join(directory, 'global')}`,
          `--cache=${join(directory, 'cache')}`,
        ],
        { cwd: directory },
      );
      let stdout = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (status) => resolve({ status: status ?? 1, stdout }));
    });
  };
  try {
    await expect(publishPublication(root, options, boundary.services)).resolves.toMatchObject({
      status: 'complete',
    });
    expect([...boundary.tags.values()]).toEqual(['0.1.0', '0.1.0']);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { force: true, recursive: true });
  }
}, 60_000);
