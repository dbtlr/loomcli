/*
 * Acceptance plan for self-update's attestation (docs/plugins/self-update.md#attestation, ADR-0212).
 *
 * The attestation is proven when these in-process runs produce these results. Each run installs
 * `selfUpdate({ attestation: attestation({ workflow }) })` in a sandbox whose home, state, and cache
 * directories are temporary, against the fake GitHub of the self-update acceptance cases. The fake
 * also answers the attestations API, the bundle host, and Sigstore's TUF repository from recorded
 * fixtures (tests/fixtures/attestation/README.md), and the clock stands at the TUF recording's time,
 * so no run reaches the network:
 *
 * - Passing. A real provenance attestation of `axodotdev/cargo-dist`'s v0.34.0 release asset, from
 *   `.github/workflows/release.yml` run on `refs/tags/v0.34.0`, passes: the run lists the
 *   attestations with the pinned headers, brings the trust root current from the root
 *   `@sigstore/tuf` ships, reads the bundle, then downloads, places, and records the asset, in
 *   that order. `-v` names the trust root's folder and the verified attestation before the
 *   download, and `-vv` names the API and bundle requests, the bundle's without its query. A
 *   bundle GitHub gives inline needs no bundle request.
 * - Failing. Each of these exits 1 with its own sentence, makes no asset request, and leaves the
 *   binary and `install.json` alone: another workflow; another repository, including aquaproj/aqua's
 *   attestation, whose signing workflow is a reusable workflow of another repository; a run on a
 *   branch, j178/prek's attestation from `refs/heads/main`; a subject with the digest under another
 *   name; another digest; a tampered signature; a body that does not decode, one that declares more
 *   than 1 MiB, and an attestation with no bundle and no HTTPS `bundle_url`; no attestation, which
 *   makes no TUF request; and a rate-limit response, with the minutes from `retry-after` or
 *   `x-ratelimit-reset`. When several attestations fail, the sentence is the furthest fault's. A
 *   bundle request that fails fails the run under the request rows and tries no other bundle.
 * - The trust root. A file in place of its folder, a folder that cannot be written, a temporary
 *   folder that cannot be used, a host that answers 503 or not at all, metadata that does not
 *   verify, and snapshot metadata that is missing each fail with the sentence their facts name. A
 *   planted `root.json`, `snapshot.json`, and `targets/trusted_root.json` do not change what
 *   verifies.
 * - Renames. The certificate's repository passes as the baked repository after GitHub redirects
 *   it to a new name, and as the new name.
 * - `--check` makes no attestation request and resolves no cache directory, so an unresolvable one
 *   still reports; a run that would replace refuses before any request.
 * - Without the setting, a run makes the requests it made before.
 */

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
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

import { decodeSnappyBlock } from '../src/self-update/attestation/snappy.js';
import { runSelfUpdate } from './fixtures/self-update-mock.ts';

/** The fixtures recorded for these runs. */
const recorded = new URL('fixtures/attestation/', import.meta.url);

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

/** Aqua's attestation: signed by a reusable workflow of suzuki-shunsuke/go-release-workflow. */
const aqua: Recorded = {
  asset: 'aqua_2.66.1_checksums.txt',
  digest: '5ca3f7583946d5120325676d06f4978b828e46351f5928b641bef5d8edea7d33',
  fixture: 'aqua',
  repository: 'aquaproj/aqua',
  version: '2.66.1',
  workflow: '.github/workflows/release.yaml',
};

/** Prek's attestation: the pinned workflow run on `refs/heads/main`, not on the tag. */
const prek: Recorded = {
  asset: 'prek-aarch64-apple-darwin.tar.gz.sha256',
  digest: '5ed7791f0cedc79d9f5572f4edeee4ea7530372bc43ba5399593163e3ad3c3c1',
  fixture: 'prek',
  repository: 'j178/prek',
  version: '0.5.11',
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

/** The bundle's JSON a recorded Snappy body decodes to. */
function bundleJson(name: string): Record<string, any> {
  const decoded = decodeSnappyBlock(fixture(`${name}.bundle.snappy`));
  if (!(decoded instanceof Uint8Array)) {
    throw new Error(`The ${name} bundle does not decode.`);
  }
  return JSON.parse(new TextDecoder().decode(decoded));
}

/** A Snappy block of `bytes` as literals alone, which the block format allows. */
function snappyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const header: number[] = [];
  let length = bytes.length;
  do {
    header.push((length & 0x7f) | (length > 0x7f ? 0x80 : 0));
    length = Math.floor(length / 128);
  } while (length > 0);
  const parts: number[] = [...header];
  for (let at = 0; at < bytes.length; at += 65_536) {
    const chunk = bytes.subarray(at, at + 65_536);
    // Tag 61 is a literal whose length less one follows in two bytes.
    parts.push(61 << 2, (chunk.length - 1) & 0xff, (chunk.length - 1) >> 8, ...chunk);
  }
  return new Uint8Array(parts);
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

/** The line the installation record holds for a binary at `path` with these bytes. */
function recordLine(path: string, bytes: string): string {
  // The members keep the record's order, which an object literal would not survive formatting in.
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

/** The lines a run wrote to stderr, each with any lane glyph and the space after it removed. */
function lines(stderr: string): string[] {
  return stderr
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\P{ASCII} /u, ''));
}

/** The binary and the record, read back to show a run left them alone. */
function untouched(box: Sandbox): void {
  expect(readFileSync(box.binary, 'utf8')).toBe(oldBytes);
  expect(readFileSync(box.record, 'utf8')).toBe(recordLine(box.binary, oldBytes));
}

/** Whether a run requested the release asset itself. */
function downloadedAsset(ran: Ran, asset: string): boolean {
  return ran.requests.some((url) => url.endsWith(`/${asset}`));
}

/** The API URL a run lists the attestations of a digest at. */
function apiUrl(repository: string, digest: string): string {
  return `https://api.github.com/repos/${repository}/attestations/sha256:${digest}?per_page=10&predicate_type=provenance`;
}

const tuf = 'https://tuf-repo-cdn.sigstore.dev';

/** The release a sentence names, as `<asset> from v<version> of <repository>`. */
function named(release: Recorded, asset = release.asset): string {
  return `${asset} from v${release.version} of ${release.repository}`;
}

const anotherVersion = 'name another version to install a release that verifies.';

test('a valid attestation from the pinned workflow on the release tag passes, and the update completes', async () => {
  const box = sandbox();
  const ran = await run(box, ['-v', 'self-update'], {
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  const folder = join(box.cache, 'notes', 'sigstore');
  expect(lines(ran.stderr)).toEqual([
    'Resolved v0.34.0 on the stable channel.',
    `Checked Sigstore's trust root in ${folder}.`,
    `Verified ${cargoDist.asset} against its attestation from .github/workflows/release.yml.`,
    `Downloading ${named(cargoDist)}.`,
    `Verified ${cargoDist.asset} against SHA256SUMS.`,
    `Binary replaced. from=0.0.1 path=${box.binary} to=0.34.0`,
    `File written. path=${box.record}`,
    'Updated notes from 0.0.1 to 0.34.0.',
    'The hook ran for notes.',
  ]);
  expect(ran.status).toBe(0);
  expect(readFileSync(box.binary, 'utf8')).toBe(cargoDistAsset);
  const github = `https://github.com/${cargoDist.repository}`;
  const assets = 'https://release-assets.example';
  expect(ran.requests).toEqual([
    `${github}/releases/latest`,
    `${github}/releases/download/v0.34.0/SHA256SUMS`,
    `${assets}/v0.34.0/SHA256SUMS`,
    apiUrl(cargoDist.repository, cargoDist.digest),
    `${tuf}/17.root.json`,
    `${tuf}/timestamp.json`,
    `${tuf}/166.snapshot.json`,
    `${tuf}/14.targets.json`,
    listOf('cargo-dist').url,
    `${github}/releases/download/v0.34.0/${cargoDist.asset}`,
    `${assets}/v0.34.0/${cargoDist.asset}`,
  ]);
  expect(ran.apiHeaders.map((headers) => Object.fromEntries(headers))).toEqual([
    { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10' },
  ]);
  // The trust root lives in the cache directory, seeded from the root @sigstore/tuf ships.
  expect(
    existsSync(join(folder, 'tuf-repo-cdn.sigstore.dev', 'targets', 'trusted_root.json')),
  ).toBe(true);
});

test('-vv names the API and bundle requests, the bundle URL without its query, and no TUF request', async () => {
  const box = sandbox();
  const ran = await run(box, ['-vv', 'self-update'], {
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
  const requested = ran.events
    .filter((event) => event.message === 'Requested {url}.')
    .map((event) => event.fields?.url);
  const bundle = new URL(listOf('cargo-dist').url);
  expect(requested).toContain(
    `https://api.github.com/repos/${cargoDist.repository}/attestations/sha256:${cargoDist.digest}`,
  );
  expect(requested).toContain(`https://${bundle.host}${bundle.pathname}`);
  expect(requested.some((url) => typeof url === 'string' && url.startsWith(tuf))).toBe(false);
});

test('a bundle GitHub gives inline passes with no bundle request', async () => {
  const box = sandbox();
  const body = JSON.stringify({ attestations: [{ bundle: bundleJson('cargo-dist') }] });
  const ran = await run(box, ['self-update'], {
    api: { body, status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
  expect(ran.requests.some((url) => url.includes('blob.core.windows.net'))).toBe(false);
});

test('a warm cache brings the trust root current with two requests', async () => {
  const box = sandbox();
  await run(box, ['self-update'], { release: cargoDist, workflow: cargoDist.workflow });
  writeFileSync(box.binary, oldBytes, { mode: 0o755 });
  writeFileSync(box.record, recordLine(box.binary, oldBytes));
  rmSync(box.requests);
  const again = await run(box, ['self-update'], {
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(again.status).toBe(0);
  expect(again.requests.filter((url) => url.startsWith(tuf))).toEqual([
    `${tuf}/17.root.json`,
    `${tuf}/timestamp.json`,
  ]);
});

test('planted root, snapshot, and trust root files in the cache do not change what verifies', async () => {
  const box = sandbox();
  const repository = join(box.cache, 'notes', 'sigstore', 'tuf-repo-cdn.sigstore.dev');
  mkdirSync(join(repository, 'targets'), { recursive: true });
  writeFileSync(join(repository, 'root.json'), '{"signed":{"version":99},"signatures":[]}');
  writeFileSync(join(repository, 'snapshot.json'), '{"signed":{"version":9999},"signatures":[]}');
  writeFileSync(join(repository, 'targets', 'trusted_root.json'), '{"tlogs":[]}');
  const ran = await run(box, ['self-update'], { release: cargoDist, workflow: cargoDist.workflow });
  expect(ran.status).toBe(0);
  expect(readFileSync(box.binary, 'utf8')).toBe(cargoDistAsset);
});

/** What a refused run shows: its lines, its status, whether it left the binary and record alone, and whether it requested the asset. */
interface Outcome {
  readonly lines: string[];
  readonly status: number;
  readonly untouched: boolean;
  readonly downloaded: boolean;
}

/** The outcome of a run refused with `sentence`, which places nothing and requests no asset. */
function refused(sentence: string): Outcome {
  return { downloaded: false, lines: [sentence], status: 1, untouched: true };
}

/** Runs `notes self-update` under the scenario, and reads what it left behind as its outcome. */
async function refuse(scenario: Scenario): Promise<Ran & { outcome: Outcome }> {
  const box = sandbox();
  const ran = await run(box, ['self-update'], scenario);
  const outcome = {
    downloaded: downloadedAsset(ran, scenario.asset?.name ?? scenario.release.asset),
    lines: lines(ran.stderr),
    status: ran.status,
    untouched:
      readFileSync(box.binary, 'utf8') === oldBytes &&
      readFileSync(box.record, 'utf8') === recordLine(box.binary, oldBytes),
  };
  return { ...ran, outcome };
}

test('an attestation from another workflow fails and places nothing', async () => {
  const refusal = await refuse({ release: cargoDist, workflow: '.github/workflows/publish.yml' });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(cargoDist)} was not made by .github/workflows/publish.yml in ${cargoDist.repository}. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
});

test('an attestation from another repository fails and places nothing', async () => {
  const other: Recorded = { ...cargoDist, repository: 'acme/notes' };
  const refusal = await refuse({
    api: { body: listOf('cargo-dist').text, status: 200 },
    bundles: recordedBundles('cargo-dist'),
    release: other,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(other)} was not made by .github/workflows/release.yml in acme/notes. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
});

test('a run of another repository that calls the pinned workflow as a reusable workflow fails', async () => {
  /*
   * The aqua release ran suzuki-shunsuke/go-release-workflow's release.yaml, so its subject
   * alternative name names that repository's file while its Source Repository URI names aqua.
   */
  const reusable: Recorded = { ...aqua, repository: 'suzuki-shunsuke/go-release-workflow' };
  const refusal = await refuse({
    api: { body: listOf('aqua').text, status: 200 },
    bundles: recordedBundles('aqua'),
    release: reusable,
    workflow: aqua.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(reusable)} was not made by .github/workflows/release.yaml in suzuki-shunsuke/go-release-workflow. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
  // Named as aqua's own, the subject alternative name names another repository's workflow.
  const own = await refuse({ release: aqua, workflow: aqua.workflow });
  expect(own.outcome).toEqual(
    refused(
      `The attestation of ${named(aqua)} was not made by .github/workflows/release.yaml in aquaproj/aqua. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
});

test('an attestation from a run on a branch fails and places nothing', async () => {
  const refusal = await refuse({ release: prek, workflow: prek.workflow });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(prek)} comes from a run that was not on tag v0.5.11. Tell its maintainers to attest from the tag, and ${anotherVersion}`,
    ),
  );
});

test('an attestation for a release whose tag is another version fails', async () => {
  const later: Recorded = { ...cargoDist, version: '0.34.1' };
  const refusal = await refuse({ release: later, workflow: cargoDist.workflow });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(later)} comes from a run that was not on tag v0.34.1. Tell its maintainers to attest from the tag, and ${anotherVersion}`,
    ),
  );
});

test('a subject with the digest under another name fails', async () => {
  // The release lists the attested bytes under another asset name, which the statement does not name.
  const renamed = 'cargo-dist-renamed.sha256';
  const refusal = await refuse({
    asset: { bytes: cargoDistAsset, name: renamed },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(cargoDist, renamed)} does not name ${renamed} with the digest its SHA256SUMS lists. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
});

test('another digest fails', async () => {
  // SHA256SUMS lists other bytes under the asset's name, and GitHub lists the attestation anyway.
  const ran = await refuse({
    asset: { bytes: 'other bytes\n', name: cargoDist.asset },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.outcome).toEqual(
    refused(
      `The attestation of ${named(cargoDist)} does not name ${cargoDist.asset} with the digest its SHA256SUMS lists. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
  expect(ran.requests).toContain(apiUrl(cargoDist.repository, digestOf('other bytes\n')));
});

test('a tampered signature fails Sigstore’s checks', async () => {
  const bundle = bundleJson('cargo-dist');
  const signature = Buffer.from(bundle.dsseEnvelope.signatures[0].sig, 'base64');
  const last = signature.length - 1;
  signature.writeUInt8(signature.readUInt8(last) ^ 0x01, last);
  bundle.dsseEnvelope.signatures[0].sig = signature.toString('base64');
  const refusal = await refuse({
    api: { body: JSON.stringify({ attestations: [{ bundle }] }), status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(cargoDist)} does not verify against Sigstore's trust root. Tell its maintainers, and ${anotherVersion}`,
    ),
  );
});

const unreadableSentence = `notes cannot read the attestation of ${named(cargoDist)}. Run self-update again later. If it fails again, install the newest release with install.sh.`;

test.each([
  ['a body that is not a Snappy block', new TextEncoder().encode('not snappy at all')],
  // A varint of 2 MiB and no elements: the bound refuses it before anything is allocated.
  ['a body that declares more than 1 MiB', new Uint8Array([0x80, 0x80, 0x80, 0x01])],
  ['a body that decodes to text that is not JSON', snappyOf(new TextEncoder().encode('{not json'))],
  [
    'a body that is not a Sigstore bundle',
    snappyOf(new TextEncoder().encode('{"mediaType":"application/json"}')),
  ],
])('%s does not read', async (_case, body) => {
  const path = new URL(listOf('cargo-dist').url).pathname;
  const refusal = await refuse({
    bundles: { [path]: body },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(refused(unreadableSentence));
});

test('an attestation with no bundle and no HTTPS bundle URL does not read and makes no request', async () => {
  const body = JSON.stringify({
    attestations: [{ bundle: null }, { bundle_url: 'http://example.com/bundle' }, { bundle: 'x' }],
  });
  const ran = await refuse({
    api: { body, status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.outcome).toEqual(refused(unreadableSentence));
  expect(ran.requests.some((url) => url.includes('example.com'))).toBe(false);
});

test('when every attestation fails, the sentence is the fault that got furthest', async () => {
  const body = JSON.stringify({
    attestations: [{ bundle: null }, ...JSON.parse(listOf('prek').text).attestations],
  });
  const refusal = await refuse({
    api: { body, status: 200 },
    release: prek,
    workflow: prek.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `The attestation of ${named(prek)} comes from a run that was not on tag v0.5.11. Tell its maintainers to attest from the tag, and ${anotherVersion}`,
    ),
  );
});

test('an attestation that passes after one that fails passes', async () => {
  const box = sandbox();
  const body = JSON.stringify({
    attestations: [{ bundle: null }, ...JSON.parse(listOf('cargo-dist').text).attestations],
  });
  const ran = await run(box, ['self-update'], {
    api: { body, status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
});

test('an attestation that fails after one that passes passes', async () => {
  const box = sandbox();
  const body = JSON.stringify({
    attestations: [...JSON.parse(listOf('cargo-dist').text).attestations, { bundle: null }],
  });
  const ran = await run(box, ['self-update'], {
    api: { body, status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
  expect(readFileSync(box.binary, 'utf8')).toBe(cargoDistAsset);
});

test.each([
  ['a named version', ['self-update', '0.34.0']],
  ['a channel', ['self-update', '--channel', 'next']],
])('%s still verifies the attestation and places nothing when it fails', async (_case, argv) => {
  const box = sandbox();
  const ran = await run(box, argv, {
    release: cargoDist,
    workflow: '.github/workflows/publish.yml',
  });
  expect(lines(ran.stderr)).toEqual([
    `The attestation of ${named(cargoDist)} was not made by .github/workflows/publish.yml in ${cargoDist.repository}. Tell its maintainers, and ${anotherVersion}`,
  ]);
  expect(ran.status).toBe(1);
  expect(downloadedAsset(ran, cargoDist.asset)).toBe(false);
  untouched(box);
});

test('a bundle request that fails fails the run under the request rows and tries no other bundle', async () => {
  const { url } = listOf('cargo-dist');
  const body = JSON.stringify({
    attestations: [{ bundle_url: url }, { bundle: bundleJson('cargo-dist') }],
  });
  const shown = new URL(url);
  const ran = await refuse({
    api: { body, status: 200 },
    bundles: { [shown.pathname]: 503 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.outcome).toEqual(
    refused(
      `notes could not download https://${shown.host}${shown.pathname} (503). Run self-update again later.`,
    ),
  );
  expect(ran.requests.filter((request) => request === url)).toHaveLength(1);
});

test('no attestation fails before the trust root', async () => {
  const ran = await refuse({
    api: { body: '{"attestations":[]}', status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.outcome).toEqual(
    refused(
      `Release v0.34.0 of ${cargoDist.repository} has no attestation for ${cargoDist.asset}. Install a release that has one by naming its version, or ask its maintainers to attest their release assets.`,
    ),
  );
  expect(ran.requests.some((url) => url.startsWith(tuf))).toBe(false);
});

test("a list that is not GitHub's form fails", async () => {
  const refusal = await refuse({
    api: { body: '{"attestations":[1]}', status: 200 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `GitHub's list of the attestations of ${named(cargoDist)} is not in a form notes 0.0.1 reads. Install the newest release with install.sh.`,
    ),
  );
});

test('another API status fails with it', async () => {
  const refusal = await refuse({
    api: { body: '{"message":"Not Found"}', status: 404 },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(refusal.outcome).toEqual(
    refused(
      `GitHub could not list the attestations of ${named(cargoDist)} (404). Run self-update again later. If it fails again, install the newest release with install.sh.`,
    ),
  );
});

/** The rate-limit sentence, ending in its step. */
function limited(step: string): string {
  return `GitHub refused to list the attestations of ${named(cargoDist)}, because this address reached its hourly limit of requests. ${step}`;
}

const resetIn = (seconds: number) => String(Math.floor(recordedAt.getTime() / 1000) + seconds);

test.each([
  [
    403,
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': resetIn(690) },
    'Run self-update again in 12 minutes.',
  ],
  [429, { 'retry-after': '30' }, 'Run self-update again in 1 minute.'],
  [
    403,
    { 'retry-after': '120', 'x-ratelimit-reset': resetIn(3000) },
    'Run self-update again in 2 minutes.',
  ],
  [403, { 'x-ratelimit-remaining': '0' }, 'Run self-update again later.'],
])('a rate-limit response (%i) fails with the time it resets', async (status, headers, step) => {
  const ran = await refuse({
    api: { body: '{}', headers, status },
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.outcome).toEqual(refused(limited(step)));
  expect(ran.requests.some((url) => url.startsWith(tuf))).toBe(false);
});

/** The temporary folder and trust root's folder the trust-root sentences name. */
function trustRootPlaces(box: Sandbox) {
  return { folder: join(box.cache, 'notes', 'sigstore'), temporary: '/tmp' };
}

test('a file in place of the trust root folder fails with the folder sentence', async () => {
  const box = sandbox();
  const { folder } = trustRootPlaces(box);
  mkdirSync(join(box.cache, 'notes'), { recursive: true });
  writeFileSync(folder, 'not a folder');
  const ran = await run(box, ['self-update'], {
    release: cargoDist,
    tmpdir: '/tmp',
    workflow: cargoDist.workflow,
  });
  expect(lines(ran.stderr)).toEqual([
    `notes could not use ${folder}, where it keeps Sigstore's trust root. Free space there, check its permissions, or remove it, then run self-update again.`,
  ]);
  expect(ran.status).toBe(1);
  untouched(box);
});

test('a trust root folder that cannot be written fails with the folder sentence', async () => {
  const box = sandbox();
  const { folder } = trustRootPlaces(box);
  mkdirSync(folder, { recursive: true });
  chmodSync(folder, 0o555);
  try {
    const ran = await run(box, ['self-update'], {
      release: cargoDist,
      workflow: cargoDist.workflow,
    });
    expect(lines(ran.stderr)).toEqual([
      `notes could not use ${folder}, where it keeps Sigstore's trust root. Free space there, check its permissions, or remove it, then run self-update again.`,
    ]);
  } finally {
    chmodSync(folder, 0o755);
  }
});

test('a temporary folder sigstore-js cannot stage in fails with the temporary folder sentence', async () => {
  const box = sandbox();
  const missing = join(box.root, 'no-such-temporary-folder');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = missing;
  try {
    const ran = await run(box, ['self-update'], {
      release: cargoDist,
      tmpdir: missing,
      workflow: cargoDist.workflow,
    });
    expect(lines(ran.stderr)).toEqual([
      `notes could not use the temporary folder ${missing} to download Sigstore's trust root. Free space there or check its permissions, then run self-update again.`,
    ]);
    expect(ran.status).toBe(1);
  } finally {
    if (previous === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previous;
    }
  }
});

test.each([
  ['answers 503', 503, '(503)'],
  ['does not answer', 'no-response' as const, '(no response)'],
])(
  'a TUF host that %s fails with the unreachable sentence',
  async (_case, answer, shown) => {
    const box = sandbox();
    const ran = await run(box, ['self-update'], {
      release: cargoDist,
      tuf: { ...recordedTuf(), '/17.root.json': answer },
      workflow: cargoDist.workflow,
    });
    expect(lines(ran.stderr)).toEqual([
      `notes could not reach tuf-repo-cdn.sigstore.dev to bring Sigstore's trust root current ${shown}. Run self-update again later.`,
    ]);
    expect(ran.status).toBe(1);
    untouched(box);
  },
  15_000,
);

test.each([
  [
    'timestamp metadata that does not verify',
    (): Record<string, TufAnswer> => {
      const timestamp = JSON.parse(new TextDecoder().decode(fixture('tuf/timestamp.json')));
      timestamp.signed.version += 1;
      return { '/timestamp.json': new TextEncoder().encode(JSON.stringify(timestamp)) };
    },
  ],
  [
    'snapshot metadata that is missing',
    (): Record<string, TufAnswer> => ({ '/166.snapshot.json': 404 }),
  ],
])('%s fails with the sentence that names the clock and both folders', async (_case, changes) => {
  const box = sandbox();
  const { folder } = trustRootPlaces(box);
  const ran = await run(box, ['self-update'], {
    release: cargoDist,
    tmpdir: '/tmp',
    tuf: { ...recordedTuf(), ...changes() },
    workflow: cargoDist.workflow,
  });
  expect(lines(ran.stderr)).toEqual([
    `notes could not bring Sigstore's trust root current from tuf-repo-cdn.sigstore.dev. Check that this computer's clock is right and that ${folder} and the temporary folder /tmp have free space and can be written, then run self-update again later.`,
  ]);
  expect(ran.status).toBe(1);
  untouched(box);
});

test('an attestation that names the baked repository passes after GitHub redirects it to a new name', async () => {
  // The binary bakes axodotdev/cargo-dist, which the fake GitHub now serves as axodotdev/dist.
  const box = sandbox();
  const moved: Recorded = { ...cargoDist, repository: 'axodotdev/dist' };
  const ran = await run(box, ['self-update'], {
    api: { body: listOf('cargo-dist').text, status: 200 },
    baked: cargoDist.repository,
    bundles: recordedBundles('cargo-dist'),
    release: moved,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
  expect(ran.requests).toContain(apiUrl('axodotdev/dist', cargoDist.digest));
  expect(readFileSync(box.binary, 'utf8')).toBe(cargoDistAsset);
});

test('an attestation that names the new name passes after GitHub redirects the baked repository', async () => {
  const box = sandbox();
  const ran = await run(box, ['self-update'], {
    baked: 'axodotdev/old-dist',
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(ran.status).toBe(0);
  expect(ran.requests).toContain(apiUrl(cargoDist.repository, cargoDist.digest));
});

test('--check makes no attestation request and still reports when the cache directory cannot be resolved', async () => {
  const box = sandbox();
  const ran = await run(box, ['self-update', '--check'], {
    env: { XDG_CACHE_HOME: '' },
    home: 'relative/home',
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(lines(ran.stderr)).toEqual([
    'notes can update from 0.0.1 to 0.34.0 on the stable channel.',
  ]);
  expect(ran.status).toBe(0);
  expect(
    ran.requests.some(
      (url) =>
        !url.startsWith('https://github.com/') &&
        !url.startsWith('https://release-assets.example/'),
    ),
  ).toBe(false);
});

test('a run that would replace refuses before any request when the cache directory cannot be resolved', async () => {
  const box = sandbox();
  const ran = await run(box, ['self-update'], {
    env: { XDG_CACHE_HOME: '' },
    home: 'relative/home',
    release: cargoDist,
    workflow: cargoDist.workflow,
  });
  expect(lines(ran.stderr)).toEqual([
    "notes cannot find its cache directory, where it keeps Sigstore's trust root, because HOME is not an absolute path. Set HOME to an absolute path, then run self-update again.",
  ]);
  expect(ran.status).toBe(1);
  expect(ran.requests).toEqual([]);
});

test('without the setting, a run makes the requests it made before', async () => {
  const box = sandbox();
  const ran = await run(box, ['self-update'], { release: cargoDist });
  expect(ran.status).toBe(0);
  const github = `https://github.com/${cargoDist.repository}`;
  const assets = 'https://release-assets.example';
  expect(ran.requests).toEqual([
    `${github}/releases/latest`,
    `${github}/releases/download/v0.34.0/SHA256SUMS`,
    `${assets}/v0.34.0/SHA256SUMS`,
    `${github}/releases/download/v0.34.0/${cargoDist.asset}`,
    `${assets}/v0.34.0/${cargoDist.asset}`,
  ]);
  expect(lines(ran.stderr)).toEqual([
    `Downloading ${named(cargoDist)}.`,
    'Updated notes from 0.0.1 to 0.34.0.',
  ]);
});
