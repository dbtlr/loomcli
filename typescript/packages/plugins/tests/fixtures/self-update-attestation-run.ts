import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LogEvent, ReleaseFacts } from '@loomcli/core';
import { afterEach, beforeEach, vi } from 'vite-plus/test';

import { runSelfUpdate } from './self-update-mock.ts';

/** The fixtures recorded for these runs. */
const recorded = new URL('attestation/', import.meta.url);

function fixture(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(name, recorded)));
}

/** The time the TUF fixtures were recorded, when their timestamp metadata was current. */
const recordedAt = new Date('2026-11-19T17:48:00Z');

const oldBytes = 'binary before the update\n';

function digestOf(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A release one recorded attestation belongs to, and the asset it attests. */
interface Recorded {
  readonly repository: string;
  readonly version: string;
  readonly asset: string;
  readonly digest: string;
  readonly workflow: string;
  /** The fixture name of the list and the bundle. */
  readonly fixture: string;
}

/** Cargo-dist's attestation: the pinned workflow in the same repository, run on the release's tag. */
const cargoDist: Recorded = {
  asset: 'cargo-dist-aarch64-apple-darwin.tar.xz.sha256',
  digest: '01fbf81e1c37247656aecabb3f496433d6f9b39832f75ebb832e8f131300aed5',
  fixture: 'cargo-dist',
  repository: 'axodotdev/cargo-dist',
  version: '0.34.0',
  workflow: '.github/workflows/release.yml',
};

/** Cargo-dist's release asset, whose digest the attestation names. */
const cargoDistAsset = new TextDecoder().decode(fixture('cargo-dist.asset'));

/** A list the API answers, and its one attestation's bundle URL. */
function listOf(name: string): { text: string; url: string } {
  const text = new TextDecoder().decode(fixture(`${name}.list.json`));
  const { attestations } = JSON.parse(text);
  return { text, url: attestations[0].bundle_url };
}

/** The sandbox: the home, state, and cache directories, the binary, and the files a run writes. */
interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly state: string;
  readonly cache: string;
  readonly bin: string;
  readonly binary: string;
  readonly record: string;
  readonly requests: string;
  readonly hookLog: string;
}

const roots: string[] = [];

/** The clock and sandbox cleanup for tests using the recorded TUF repository. */
function useRecordedAttestationFixtures(): void {
  beforeEach(() => {
    vi.useFakeTimers({ now: recordedAt, toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const root of roots.splice(0)) {
      chmodSync(root, 0o755);
      rmSync(root, { force: true, recursive: true });
    }
  });
}

/** The line the installation record holds for a binary at `path` with these bytes. */
function recordLine(path: string, bytes: string): string {
  // The literal keeps the record's key order through formatting.
  return `{"format":1,"method":"script","path":${JSON.stringify(path)},"digest":"sha256:${digestOf(bytes)}"}\n`;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-attestation-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const cache = join(root, 'cache');
  const bin = join(root, 'bin');
  for (const directory of [home, state, cache, bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, oldBytes, { mode: 0o755 });
  const record = join(state, 'notes', 'installation', 'install.json');
  writeFileSync(record, recordLine(binary, oldBytes));
  return {
    bin,
    binary,
    cache,
    home,
    hookLog: join(root, 'hook.jsonl'),
    record,
    requests: join(root, 'requests.txt'),
    root,
    state,
  };
}

/** What one TUF path answers: the recorded file, a status, or no response. */
type TufAnswer = Uint8Array<ArrayBuffer> | number | 'no-response';

/** The recorded TUF repository: no root after the seed's, then the timestamp, snapshot, and targets. */
function recordedTuf(): Record<string, TufAnswer> {
  return {
    '/14.targets.json': fixture('tuf/14.targets.json'),
    '/166.snapshot.json': fixture('tuf/166.snapshot.json'),
    '/17.root.json': 404,
    '/timestamp.json': fixture('tuf/timestamp.json'),
  };
}

/** What the attestations API answers. */
interface ApiAnswer {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

/** A run's scenario: the release, the attestation service, and the settings. */
interface Scenario {
  readonly release: Recorded;
  /** The workflow `attestation()` pins, or `undefined` for a run without the setting. */
  readonly workflow?: string | undefined;
  /** The repository the release facts hold, when GitHub redirects it to the release's. */
  readonly baked?: string;
  /** The asset's name and bytes, when they differ from the recorded release's. */
  readonly asset?: { readonly name: string; readonly bytes: string };
  readonly api?: ApiAnswer;
  /** Bundle bodies by URL path, or a status. */
  readonly bundles?: Record<string, Uint8Array<ArrayBuffer> | number>;
  readonly tuf?: Record<string, TufAnswer>;
  readonly env?: Record<string, string>;
  readonly home?: string;
  readonly tmpdir?: string;
}

/** What a run did: its outcome, the requests in order, the API request's headers, and its log. */
interface Ran {
  readonly status: number;
  readonly stderr: string;
  readonly requests: string[];
  readonly apiHeaders: Headers[];
  readonly events: LogEvent[];
}

/** Each recorded bundle body, by its URL's path. */
function recordedBundles(...names: string[]): Record<string, Uint8Array<ArrayBuffer>> {
  return Object.fromEntries(
    names.map((name) => [new URL(listOf(name).url).pathname, fixture(`${name}.bundle.snappy`)]),
  );
}

/** The answer of the attestation service the scenario names, beside the fake GitHub. */
function service(scenario: Scenario, apiHeaders: Headers[]) {
  const api = scenario.api ?? { body: listOf(scenario.release.fixture).text, status: 200 };
  const bundles = scenario.bundles ?? recordedBundles(scenario.release.fixture);
  const tuf = scenario.tuf ?? recordedTuf();
  return (url: URL, init: RequestInit): Response | undefined => {
    if (url.origin === 'https://api.github.com') {
      apiHeaders.push(new Headers(init.headers));
      return new Response(api.body, { headers: api.headers ?? {}, status: api.status });
    }
    if (url.origin === 'https://tmaproduction.blob.core.windows.net') {
      const body = bundles[url.pathname] ?? 404;
      return typeof body === 'number'
        ? new Response('Unavailable', { status: body })
        : new Response(body, { headers: { 'content-type': 'application/x-snappy' }, status: 200 });
    }
    if (url.origin === 'https://tuf-repo-cdn.sigstore.dev') {
      const answer = tuf[url.pathname] ?? 404;
      if (answer === 'no-response') {
        throw new TypeError('fetch failed');
      }
      return typeof answer === 'number'
        ? new Response('Not Found', { status: answer })
        : new Response(answer, { status: 200 });
    }
    return undefined;
  };
}

/** Runs `notes <argv>` in the sandbox under the scenario. */
async function run(box: Sandbox, argv: string[], scenario: Scenario): Promise<Ran> {
  const { release } = scenario;
  const asset = scenario.asset ?? { bytes: cargoDistAsset, name: release.asset };
  const sums = `${scenario.asset === undefined ? release.digest : digestOf(asset.bytes)}  ${asset.name}\n`;
  const facts: ReleaseFacts = {
    build: 'distributed',
    installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: box.binary },
    release: {
      asset: asset.name,
      channel: 'stable',
      repository: scenario.baked ?? release.repository,
      version: '0.0.1',
    },
  };
  const env = {
    HOME: scenario.home ?? box.home,
    XDG_CACHE_HOME: box.cache,
    XDG_STATE_HOME: box.state,
    ...scenario.env,
  };
  const apiHeaders: Headers[] = [];
  const events: LogEvent[] = [];
  const result = await runSelfUpdate(
    {
      attestation: scenario.workflow,
      github: {
        feed: [`v${release.version}`],
        latest: `v${release.version}`,
        releases: {
          [`v${release.version}`]: { assets: { [asset.name]: asset.bytes }, sums },
        },
        repository: release.repository,
        ...(scenario.baked === undefined ? {} : { renamedFrom: scenario.baked }),
      },
      hook: 'record',
      hookLog: box.hookLog,
      notices: false,
      release: facts,
      requests: box.requests,
      verbose: true,
    },
    {
      argv,
      env,
      home: env.HOME,
      release: facts,
      ...(scenario.tmpdir === undefined ? {} : { tmpdir: scenario.tmpdir }),
    },
    { answer: service(scenario, apiHeaders), observe: (event) => events.push(event) },
  );
  const requests = existsSync(box.requests)
    ? readFileSync(box.requests, 'utf8').trim().split('\n')
    : [];
  return { apiHeaders, events, requests, status: result.status, stderr: result.stderr };
}

export type { Ran, Recorded, Sandbox, Scenario, TufAnswer };
export {
  cargoDist,
  cargoDistAsset,
  digestOf,
  fixture,
  listOf,
  oldBytes,
  recordedAt,
  recordedBundles,
  recordedTuf,
  recordLine,
  run,
  sandbox,
  useRecordedAttestationFixtures,
};
