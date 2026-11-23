import type { AttestationCheck } from '../attestation-setting.js';
import { fatal } from '../fatal.js';
import type { AttestedRelease } from '../messages.js';
import { selfUpdatePhrase } from '../phrases.js';
import { follow, ok, readBody, RequestError } from '../request.js';

/** The API version the Command asks for, and the media type GitHub's REST API answers in. */
const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2026-03-10',
};

/** The statuses GitHub answers an address that reached its limit with. */
const forbidden = 403;
const tooManyRequests = 429;

/** The units a reset time is counted in. */
const millisecondsPerSecond = 1000;
const secondsPerMinute = 60;

/** The fewest minutes a rate-limit sentence names. */
const oneMinute = 1;

/** The length of a list that names no attestation. */
const noAttestations = 0;

/** One attestation the list names: its bundle when GitHub gives it inline, and its bundle's URL. */
interface Listed {
  readonly bundle: unknown;
  readonly bundleUrl: unknown;
}

/** The release the attestation sentences name. */
function releaseOf(check: AttestationCheck): AttestedRelease {
  return { asset: check.asset, repository: check.repository, version: check.version };
}

/** The URL of the one page of provenance attestations the Command reads for the digest. */
function listUrl(repository: string, digest: string): URL {
  return new URL(
    `https://api.github.com/repos/${repository}/attestations/sha256:${digest}?per_page=10&predicate_type=provenance`,
  );
}

/** The whole minutes, rounded up and at least one, until `seconds` from now. */
function minutesFrom(seconds: number): number {
  return Math.max(oneMinute, Math.ceil(seconds / secondsPerMinute));
}

/**
 * The minutes until the limit resets: from `retry-after` in seconds, else from `x-ratelimit-reset`
 * in epoch seconds, or `undefined` when neither gives a time.
 */
function minutesUntilReset(headers: Headers, now: number): number | undefined {
  const retryAfter = Number(headers.get('retry-after') ?? Number.NaN);
  if (Number.isFinite(retryAfter)) {
    return minutesFrom(retryAfter);
  }
  const reset = Number(headers.get('x-ratelimit-reset') ?? Number.NaN);
  return Number.isFinite(reset) ? minutesFrom(reset - now / millisecondsPerSecond) : undefined;
}

/** Whether a response is GitHub's limit for the address. */
function isRateLimited(response: Response): boolean {
  return (
    (response.status === forbidden || response.status === tooManyRequests) &&
    (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))
  );
}

/** Whether a parsed JSON value is an object, which a listed attestation is. */
function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** The JSON value `text` parses to, or `undefined` for text that is not JSON. */
function parsedJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** The attestations a `200` body lists, or `undefined` for a body that is not that form. */
function listedOf(text: string): Listed[] | undefined {
  const body = parsedJson(text);
  const attestations: unknown = isObject(body) ? Reflect.get(body, 'attestations') : undefined;
  if (!Array.isArray(attestations)) {
    return undefined;
  }
  const entries: unknown[] = attestations;
  if (!entries.every(isObject)) {
    return undefined;
  }
  return entries.map((entry) => ({
    bundle: Reflect.get(entry, 'bundle'),
    bundleUrl: Reflect.get(entry, 'bundle_url'),
  }));
}

/**
 * The API's `200` response for the digest. A rate limit and any other status each fail the run;
 * no response and a redirect fault throw the `RequestError` the Command reports.
 */
async function listResponse(check: AttestationCheck, url: URL, now: number): Promise<Response> {
  const followed = await follow(url, { ...check.requesting, headers: apiHeaders });
  if ('stopped' in followed) {
    throw new RequestError('status', url.href);
  }
  const { response } = followed;
  if (response.status === ok) {
    return response;
  }
  await response.body?.cancel();
  throw fatal(
    isRateLimited(response)
      ? selfUpdatePhrase(
          'attestationsRateLimited',
          releaseOf(check),
          minutesUntilReset(response.headers, now),
        )
      : selfUpdatePhrase('attestationsNotListed', releaseOf(check), response.status),
  );
}

/**
 * The provenance attestations GitHub lists for the digest, at most ten, one page with no `Link`
 * followed. A body of another form and an empty list each fail the run, as `listResponse` states
 * for the response itself.
 */
async function listAttestations(check: AttestationCheck, now: number): Promise<Listed[]> {
  const url = listUrl(check.repository, check.digest);
  const response = await listResponse(check, url, now);
  const listed = listedOf(await readBody(url, check.requesting.signal, () => response.text()));
  if (listed === undefined) {
    throw fatal(
      selfUpdatePhrase('attestationsUnreadable', releaseOf(check), check.name, check.running),
    );
  }
  if (listed.length === noAttestations) {
    throw fatal(selfUpdatePhrase('noAttestation', releaseOf(check)));
  }
  return listed;
}

export type { Listed };
export { listAttestations, releaseOf };
