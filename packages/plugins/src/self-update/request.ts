/** The most redirects one request follows; one more fails it. */
const maxRedirects = 20;

/** The statuses that redirect to another URL. */
const movedPermanently = 301;
const found = 302;
const seeOther = 303;
const temporaryRedirect = 307;
const permanentRedirect = 308;

/** The status of a response that has what was asked for. */
const ok = 200;

/** The status of a release or tag that does not exist. */
const notFound = 404;

/** The step from one redirect count to the next. */
const oneMore = 1;

const redirectStatuses = new Set([
  movedPermanently,
  found,
  seeOther,
  temporaryRedirect,
  permanentRedirect,
]);

/** Why a request failed before the Command could read what it asked for. */
type RequestErrorKind = 'insecure' | 'too-many' | 'status' | 'no-response';

/** A request that failed, named by the URL it started at. The runtime's own error is its cause. */
class RequestError extends Error {
  readonly kind: RequestErrorKind;
  readonly url: string;
  readonly status: number | undefined;

  constructor(
    kind: RequestErrorKind,
    url: string,
    options: { readonly status?: number | undefined; readonly cause?: unknown } = {},
  ) {
    super(`The request for ${url} failed: ${kind}.`, { cause: options.cause });
    this.name = 'RequestError';
    this.kind = kind;
    this.url = url;
    this.status = options.status;
  }
}

/** Where a request ended: a response, or a redirect the caller asked to stop at. */
type Followed =
  | { readonly response: Response; readonly github: URL }
  | { readonly stopped: URL; readonly github: URL };

/** Where a response redirects to, `undefined` when it does not; a redirect away from HTTPS fails. */
async function redirectOf(response: Response, url: URL, start: URL): Promise<URL | undefined> {
  const location = response.headers.get('location');
  if (!redirectStatuses.has(response.status) || location === null) {
    return undefined;
  }
  await response.body?.cancel();
  const next = new URL(location, url);
  if (next.protocol !== 'https:') {
    throw new RequestError('insecure', start.href);
  }
  return next;
}

/** Where a walk has got to: the URL to request next, the last github.com URL, redirects followed. */
interface Walk {
  readonly start: URL;
  readonly url: URL;
  readonly github: URL;
  readonly redirects: number;
}

/** One request of a walk, then the rest of the walk after the redirect it was answered with. */
async function walk(
  state: Walk,
  signal: AbortSignal,
  stop: (location: URL) => boolean,
): Promise<Followed> {
  const response = await request(state.url, state.start, signal);
  const next = await redirectOf(response, state.url, state.start);
  if (next === undefined) {
    return { github: state.github, response };
  }
  // The bound comes before the stop rule, so a 21st redirect fails wherever it leads.
  if (state.redirects === maxRedirects) {
    throw new RequestError('too-many', state.start.href);
  }
  const github = next.origin === 'https://github.com' ? next : state.github;
  if (stop(next)) {
    return { github, stopped: next };
  }
  return walk({ ...state, github, redirects: state.redirects + oneMore, url: next }, signal, stop);
}

/**
 * Requests `start` and follows each redirect itself, only to an HTTPS URL and at most 20 times,
 * until a response that is not a redirect, or a redirect `stop` accepts, which is not requested.
 * `github` is the last github.com URL the request reached or a redirect named, which names the
 * repository after GitHub redirected a renamed one. A rejection that carries the run signal's reason propagates as it is.
 */
function follow(
  start: URL,
  signal: AbortSignal,
  stop: (location: URL) => boolean = () => false,
): Promise<Followed> {
  return walk({ github: start, redirects: 0, start, url: start }, signal, stop);
}

/** One request with no redirect followed, its failure before a response named for `start`. */
async function request(url: URL, start: URL, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { redirect: 'manual', signal });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new RequestError('no-response', start.href, { cause: error });
  }
}

/** The response at the end of the redirects from `url`, when its status is 200; any other fails. */
async function okResponse(url: URL, signal: AbortSignal): Promise<{ body: Response; github: URL }> {
  const followed = await follow(url, signal);
  if ('stopped' in followed) {
    throw new RequestError('status', url.href);
  }
  if (followed.response.status !== ok) {
    await followed.response.body?.cancel();
    throw new RequestError('status', url.href, { status: followed.response.status });
  }
  return { body: followed.response, github: followed.github };
}

/**
 * Reads a body whole. A connection that ends before the body does is no response, named for
 * `url`, its runtime error kept as the cause; an abort propagates as it is.
 */
async function readBody<Body>(
  url: URL,
  signal: AbortSignal,
  read: () => Promise<Body>,
): Promise<Body> {
  try {
    return await read();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new RequestError('no-response', url.href, { cause: error });
  }
}

/** The text at `url` after its redirects, and the last github.com URL they visited. */
async function fetchText(url: URL, signal: AbortSignal): Promise<{ text: string; github: URL }> {
  const { body, github } = await okResponse(url, signal);
  return { github, text: await readBody(url, signal, () => body.text()) };
}

/** The bytes at `url` after its redirects. */
async function fetchBytes(url: URL, signal: AbortSignal): Promise<Uint8Array> {
  const { body } = await okResponse(url, signal);
  const buffer = await readBody(url, signal, () => body.arrayBuffer());
  return new Uint8Array(buffer);
}

export type { Followed };
export { fetchBytes, fetchText, follow, notFound, ok, RequestError };
