// @module-tag docs

/*
 * Acceptance plan for self-update's attestation in a compiled binary (ADR-0212's proof, the
 * docs/plugins/self-update.md#attestation section): `loom build --release` compiles a fixture
 * application that sets `attestation({ workflow })` from `@loomcli/plugins/self-update/attestation`
 * into a Bun binary. Run as `probe self-update`, the binary lists the attestations, brings Sigstore's
 * trust root current through TUF from the root `@sigstore/tuf` ships, verifies the recorded
 * attestation of axodotdev/cargo-dist's v0.34.0 asset with the sigstore-js code bundled into it, and
 * replaces itself with the asset. The entry replaces `fetch` with a fake that serves the recorded
 * fixtures of packages/plugins/tests/fixtures/attestation, stands the clock at the TUF recording's
 * time, and names the recorded asset as the release facts' asset, because a build names its asset
 * for the application and the platform. The same binary refuses an attestation of another
 * repository, placing nothing.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applicationDirectory } from '@loomcli/core';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';

import { recordInstallation } from '../../../scripts/test-installation.js';
import { removeRoots, temporaryRoot } from './fixture.js';
import { execute, fixturePackage, loom } from './package.js';

/** How long compiling the probe may take. */
const slow = 300_000;

/** The recorded fixtures the fake serves. */
const fixtures = fileURLToPath(
  new URL('../../plugins/tests/fixtures/attestation/', import.meta.url),
);

/** The application: self-update with an attestation pinned to cargo-dist's release workflow. */
const application = `import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { attestation } from '@loomcli/plugins/self-update/attestation';
import { verbose } from '@loomcli/plugins/verbose';

export const probe = new Application('probe', {
  description: 'Probe attested self-update.',
  plugins: [
    selfUpdate({ attestation: attestation({ workflow: '.github/workflows/release.yml' }), notices: false }),
    verbose(),
  ],
});
`;

/**
 * The entry. It stands the clock at PROBE_NOW, answers every request from the fixtures in
 * PROBE_FIXTURES, recording each URL to PROBE_REQUESTS, and runs with the baked release facts, the
 * asset renamed to PROBE_ASSET, the installation PROBE_RECORD holds, and the attestation list and
 * bundle of PROBE_CASE.
 */
const entry = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { processHandle } from '@loomcli/core';

import { probe } from './application.js';

const now = Date.parse(process.env.PROBE_NOW ?? '');
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) {
      super(now);
    } else {
      super(...args);
    }
  }
  static override now(): number {
    return now;
  }
}
globalThis.Date = FixedDate as DateConstructor;

const fixtures = process.env.PROBE_FIXTURES ?? '';
const asset = process.env.PROBE_ASSET ?? '';
const named = process.env.PROBE_CASE ?? '';
const read = (name: string) => readFileSync(join(fixtures, name));
const list = JSON.parse(read(named + '.list.json').toString('utf8'));
const bundle = new URL(list.attestations[0].bundle_url);
const bytes = read('cargo-dist.asset');
const digest = process.env.PROBE_DIGEST ?? '';
const github = 'https://github.com/axodotdev/cargo-dist';
const tuf: Record<string, string | number> = {
  '/14.targets.json': 'tuf/14.targets.json',
  '/166.snapshot.json': 'tuf/166.snapshot.json',
  '/17.root.json': 404,
  '/timestamp.json': 'tuf/timestamp.json',
};

globalThis.fetch = async (input: string | URL | Request) => {
  const text = input instanceof Request ? input.url : String(input);
  appendFileSync(process.env.PROBE_REQUESTS ?? '', text + '\\n');
  const url = new URL(text);
  if (text === github + '/releases/latest') {
    return new Response(null, { headers: { location: github + '/releases/tag/v0.34.0' }, status: 302 });
  }
  if (text === github + '/releases/download/v0.34.0/SHA256SUMS') {
    return new Response(digest + '  ' + asset + '\\n', { status: 200 });
  }
  if (text === github + '/releases/download/v0.34.0/' + asset) {
    return new Response(bytes, { status: 200 });
  }
  if (url.origin === 'https://api.github.com') {
    return new Response(JSON.stringify(list), { status: 200 });
  }
  if (url.origin === bundle.origin && url.pathname === bundle.pathname) {
    return new Response(read(named + '.bundle.snappy'), { status: 200 });
  }
  if (url.origin === 'https://tuf-repo-cdn.sigstore.dev') {
    const answer = tuf[url.pathname] ?? 404;
    return typeof answer === 'number'
      ? new Response('Not Found', { status: answer })
      : new Response(read(answer), { status: 200 });
  }
  return new Response('Not Found', { status: 404 });
};

// Supplied release facts are taken as given, so the entry adds the installation the record holds.
const baked = processHandle().release;
const record = JSON.parse(readFileSync(process.env.PROBE_RECORD ?? '', 'utf8'));
const installation = { digest: record.digest, method: record.method, path: record.path };
const release = baked.release === undefined ? undefined : { ...baked.release, asset };
await probe.run({
  process: processHandle({
    release: { ...baked, installation, ...(release === undefined ? {} : { release }) },
  }),
});
`;

/** The compiled probe, built once for the file. */
let binary = '';

beforeAll(async () => {
  const root = fixturePackage(
    {
      'package.json': `${JSON.stringify({
        bin: { probe: 'dist/main.js' },
        name: '@acme/probe',
        repository: 'git+https://github.com/axodotdev/cargo-dist.git',
        type: 'module',
        version: '0.33.0',
      })}\n`,
      'src/application.ts': application,
      'src/main.ts': entry,
    },
    ['core', 'plugins'],
  );
  const result = await loom(root, ['build', '--release', '--out', 'bin/probe']);
  if (result.status !== 0) {
    throw new Error(`loom build --release failed:\n${result.stderr}`);
  }
  binary = join(root, 'bin/probe');
}, slow);

afterAll(() => {
  removeRoots();
});

const asset = 'cargo-dist-aarch64-apple-darwin.tar.xz.sha256';

/**
 * A file's SHA-256 digest. The tests compare files by digest, not by their bytes, because the
 * compiled binary is about 100 MB and a deep equality over a buffer that size exhausts the heap.
 */
function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const assetDigest = digestOf(join(fixtures, 'cargo-dist.asset'));

/** The probe's directory of a kind on this platform, resolved as the binary does. */
function directoryOf(
  kind: 'cache' | 'installation',
  env: Record<string, string | undefined>,
  home: string,
): string {
  const lookup = applicationDirectory(kind, 'probe', {
    env: { XDG_CACHE_HOME: env.XDG_CACHE_HOME, XDG_STATE_HOME: env.XDG_STATE_HOME },
    home,
    platform: process.platform,
  });
  if (!('path' in lookup)) {
    throw new Error(`Set ${lookup.variable} to an absolute path.`);
  }
  return lookup.path;
}

/** A copy of the probe installed by the installer script's recipe, and the environment it runs in. */
function installed(prefix: string) {
  const root = temporaryRoot(prefix);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const cacheHome = join(root, 'cache');
  const bin = join(root, 'bin');
  for (const directory of [home, state, cacheHome, bin]) {
    mkdirSync(directory);
  }
  const copy = join(bin, 'probe');
  copyFileSync(binary, copy);
  const requests = join(root, 'requests.txt');
  writeFileSync(requests, '');
  const base = {
    HOME: home,
    NO_COLOR: '1',
    PATH: process.env.PATH,
    PROBE_ASSET: asset,
    PROBE_DIGEST: '01fbf81e1c37247656aecabb3f496433d6f9b39832f75ebb832e8f131300aed5',
    PROBE_FIXTURES: fixtures,
    PROBE_NOW: '2026-11-19T17:48:00Z',
    PROBE_REQUESTS: requests,
    XDG_CACHE_HOME: cacheHome,
    XDG_STATE_HOME: state,
  };
  const env = {
    ...base,
    PROBE_RECORD: join(directoryOf('installation', base, home), 'install.json'),
  };
  expect(recordInstallation('probe', copy, env)).toMatchObject({ status: 0 });
  return { cache: directoryOf('cache', base, home), copy, env, requests };
}

test(
  'a compiled binary verifies a recorded attestation with its bundled sigstore code and updates itself',
  () => {
    const { cache, copy, env, requests } = installed('loom-attested-');
    const result = execute(copy, ['-v', 'self-update'], {
      env: { ...env, PROBE_CASE: 'cargo-dist' },
    });
    expect(result.stderr).toContain(`Checked Sigstore's trust root in ${join(cache, 'sigstore')}.`);
    expect(result.stderr).toContain(
      `Verified ${asset} against its attestation from .github/workflows/release.yml.`,
    );
    expect(result.stderr).toContain('Updated probe from 0.33.0 to 0.34.0.');
    expect(result.status).toBe(0);
    expect(digestOf(copy)).toBe(assetDigest);
    const made = readFileSync(requests, 'utf8').trim().split('\n');
    expect(made.filter((url) => url.startsWith('https://tuf-repo-cdn.sigstore.dev/'))).toEqual([
      'https://tuf-repo-cdn.sigstore.dev/17.root.json',
      'https://tuf-repo-cdn.sigstore.dev/timestamp.json',
      'https://tuf-repo-cdn.sigstore.dev/166.snapshot.json',
      'https://tuf-repo-cdn.sigstore.dev/14.targets.json',
    ]);
  },
  slow,
);

test(
  'a compiled binary refuses an attestation of another repository and places nothing',
  () => {
    const { copy, env, requests } = installed('loom-attested-branch-');
    const before = digestOf(copy);
    // Prek's attestation names its own repository, so it is not this release's.
    const result = execute(copy, ['self-update'], { env: { ...env, PROBE_CASE: 'prek' } });
    expect(result.stderr).toContain(
      `The attestation of ${asset} from v0.34.0 of axodotdev/cargo-dist was not made by .github/workflows/release.yml in axodotdev/cargo-dist. Tell its maintainers, and name another version to install a release that verifies.`,
    );
    expect(result.status).toBe(1);
    expect(digestOf(copy)).toBe(before);
    expect(readFileSync(requests, 'utf8')).not.toContain(`/releases/download/v0.34.0/${asset}`);
  },
  slow,
);
