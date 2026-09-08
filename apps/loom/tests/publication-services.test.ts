import type ChildProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { publicationServices } from '../src/helpers/publication-services.js';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  spawnSync: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function credentials() {
  vi.stubEnv('GH_TOKEN', 'fixture-github-token');
  vi.stubEnv('NODE_AUTH_TOKEN', 'fixture-operations-token');
}

test('GitHub absence is limited to a missing version ref and authentication errors stop', async () => {
  credentials();
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const services = publicationServices('sample/fixture', 'trusted');
  await expect(
    services.github('GET', '/repos/sample/fixture/git/ref/tags/v0.1.0'),
  ).resolves.toBeUndefined();
  await expect(
    services.github('GET', '/repos/sample/fixture/contents/ledger.json'),
  ).rejects.toThrow('404');
  fetcher.mockResolvedValue(new Response('', { status: 401 }));
  await expect(services.github('GET', '/repos/sample/fixture/git/ref/tags/v0.1.0')).rejects.toThrow(
    '401',
  );
});

test('GitHub uploads unchanged bytes to the repository endpoint without trusting an upload URL', async () => {
  credentials();
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  const bytes = Buffer.from('retained bytes');
  await publicationServices('sample/fixture', 'trusted').upload(42, 'package-0.tgz', bytes);
  expect(fetcher).toHaveBeenCalledWith(
    'https://uploads.github.com/repos/sample/fixture/releases/42/assets?name=package-0.tgz',
    expect.objectContaining({ body: new Uint8Array(bytes), method: 'POST', redirect: 'error' }),
  );
});

test('trusted publication removes the token fallback while registry operations retain authentication', async () => {
  credentials();
  const run = vi
    .mocked(spawnSync)
    .mockReturnValue({ output: [], pid: 1, signal: null, status: 0, stderr: '', stdout: '{}' });
  vi.stubEnv('NPM_CONFIG_USERCONFIG', '/fixture/credential.npmrc');
  vi.stubEnv('npm_config_globalconfig', '/fixture/global.npmrc');
  vi.stubEnv('NPM_TOKEN', 'fixture-other-token');
  const services = publicationServices('sample/fixture', 'trusted');
  await services.npm(['publish', '/fixture/package.tgz']);
  expect(run).toHaveBeenLastCalledWith(
    process.execPath,
    [
      expect.stringMatching(/npm-cli\.js$/u),
      'publish',
      '/fixture/package.tgz',
      '--registry=https://registry.npmjs.org/',
    ],
    expect.objectContaining({
      env: expect.objectContaining({
        NODE_AUTH_TOKEN: '',
        NPM_CONFIG_GLOBALCONFIG: expect.stringMatching(/global\.npmrc$/u),
        NPM_CONFIG_USERCONFIG: expect.stringMatching(/user\.npmrc$/u),
        NPM_TOKEN: '',
      }),
    }),
  );
  await services.npm(['dist-tag', 'add', '@sample/core@0.1.0', 'latest']);
  expect(run).toHaveBeenLastCalledWith(
    process.execPath,
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({ NODE_AUTH_TOKEN: 'fixture-operations-token' }),
    }),
  );
  await publicationServices('sample/fixture', 'bootstrap').npm(['publish', '/fixture/package.tgz']);
  expect(run).toHaveBeenLastCalledWith(
    process.execPath,
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({ NODE_AUTH_TOKEN: 'fixture-operations-token' }),
    }),
  );
});

test('the publication CLI refuses a run whose provenance source differs before credentials or network access', async () => {
  const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));
  const realChild = await vi.importActual<typeof ChildProcess>('node:child_process');
  const result = realChild.spawnSync(
    process.env.LOOM_TEST_RUNTIME ?? 'node',
    [
      cli,
      'publication',
      'publish',
      '--artifacts',
      '/fixture/retained',
      '--digest',
      'a'.repeat(64),
      '--head',
      'b'.repeat(40),
      '--repository',
      'sample/fixture',
      '--run',
      '12',
      '--artifact',
      '56',
      '--auth',
      'trusted',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'sample/fixture',
        GITHUB_SHA: 'c'.repeat(40),
      },
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('run at the retained source');
});
