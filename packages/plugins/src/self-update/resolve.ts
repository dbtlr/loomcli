import { fetchText, follow, notFound, ok, RequestError } from './request.js';
import { channelOf, compareVersions, equalPrecedence, versionOfTag } from './version.js';
import type { Version } from './version.js';

/** A release the Command found: its repository after any rename, its version, and its sums. */
interface Release {
  readonly repository: string;
  readonly version: Version;
  /** The release's `SHA256SUMS`, when finding the release already downloaded it. */
  readonly sums?: string;
}

/** The characters before an owner in a URL path: the leading slash. */
const leadingSlash = 1;

/** A tag page on github.com, its owner, name, and tag captured. */
const tagPage = /^\/(?<owner>[^/]+)\/(?<name>[^/]+)\/releases\/tag\/(?<tag>[^/]+)$/u;

/** Each tag page the feed links to, its owner, name, and tag captured. */
const feedLink =
  /href="https:\/\/github\.com\/(?<owner>[^/"]+)\/(?<name>[^/"]+)\/releases\/tag\/(?<tag>[^/"]+)"/gu;

/** The repository a github.com URL names, as `owner/name`, or `fallback` for another path. */
function repositoryOf(url: URL, fallback: string): string {
  const [owner, name] = url.pathname.slice(leadingSlash).split('/');
  return owner && name ? `${owner}/${name}` : fallback;
}

/** Whether two repositories are one, comparing owners and names without regard to case. */
function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function downloadUrl(repository: string, version: Version, file: string): URL {
  return new URL(`https://github.com/${repository}/releases/download/v${version.text}/${file}`);
}

/** A release's `SHA256SUMS` and the repository it came from after any rename. */
async function fetchSums(
  repository: string,
  version: Version,
  signal: AbortSignal,
): Promise<{ repository: string; sums: string }> {
  const { github, text } = await fetchText(downloadUrl(repository, version, 'SHA256SUMS'), signal);
  return { repository: repositoryOf(github, repository), sums: text };
}

/** The stable release a tag page names, or `undefined` for a page that is not one. */
function stableAt(page: URL): Release | undefined {
  const groups = tagPage.exec(page.pathname)?.groups;
  const version = groups?.tag === undefined ? undefined : versionOfTag(groups.tag);
  if (page.origin !== 'https://github.com' || version === undefined) {
    return undefined;
  }
  if (channelOf(version) !== 'stable') {
    return undefined;
  }
  return { repository: `${groups?.owner}/${groups?.name}`, version };
}

/**
 * The newest stable release: the tag page `releases/latest` redirects to, which is not requested.
 * A redirect that leaves github.com, a tag page whose version is not stable, or a 200 at the end
 * of the redirects means there is none; any other status fails the request.
 */
async function latestStable(repository: string, signal: AbortSignal): Promise<Release | undefined> {
  const start = new URL(`https://github.com/${repository}/releases/latest`);
  const followed = await follow(
    start,
    signal,
    (location) => location.origin !== 'https://github.com' || tagPage.test(location.pathname),
  );
  if ('response' in followed) {
    await followed.response.body?.cancel();
    if (followed.response.status !== ok) {
      throw new RequestError('status', start.href, { status: followed.response.status });
    }
    return undefined;
  }
  return stableAt(followed.stopped);
}

/** `sorted`, highest first, with `version` inserted after every version that is not lower. */
function insertHighestFirst(sorted: Version[], version: Version): Version[] {
  const notLower = sorted.filter((other) => compareVersions(other, version) >= equalPrecedence);
  return [...notLower, version, ...sorted.slice(notLower.length)];
}

/** The feed's versions of `repository` on `channel` or `stable`, highest first. */
function feedVersions(feed: string, repository: string, channel: string): Version[] {
  const versions = [...feed.matchAll(feedLink)]
    .filter(({ groups }) => sameRepository(`${groups?.owner}/${groups?.name}`, repository))
    .map(({ groups }) => (groups?.tag === undefined ? undefined : versionOfTag(groups.tag)))
    .filter((version): version is Version => version !== undefined)
    .filter((version) => [channel, 'stable'].includes(channelOf(version)));
  return versions.reduce<Version[]>(insertHighestFirst, []);
}

/**
 * The newest release on a prerelease channel: of the feed's tags whose channel is that channel or
 * `stable`, highest first, the first whose `SHA256SUMS` answers 200. A tag with no release answers
 * 404 and is passed over; any other failure fails the run.
 */
async function latestOnChannel(
  repository: string,
  channel: string,
  signal: AbortSignal,
): Promise<Release | undefined> {
  const { github, text } = await fetchText(
    new URL(`https://github.com/${repository}/releases.atom`),
    signal,
  );
  const named = repositoryOf(github, repository);
  for (const version of feedVersions(text, named, channel)) {
    try {
      const { repository: found, sums } = await fetchSums(named, version, signal);
      return { repository: found, sums, version };
    } catch (error) {
      if (!(error instanceof RequestError && error.status === notFound)) {
        throw error;
      }
    }
  }
  return undefined;
}

/** The newest release on a channel, through `releases/latest` for stable and the feed otherwise. */
function latestRelease(
  repository: string,
  channel: string,
  signal: AbortSignal,
): Promise<Release | undefined> {
  return channel === 'stable'
    ? latestStable(repository, signal)
    : latestOnChannel(repository, channel, signal);
}

export type { Release };
export { downloadUrl, fetchSums, latestRelease };
