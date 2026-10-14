import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';
import { refreshManpages } from '@loomcli/plugins/manpage';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills } from '@loomcli/plugins/skills';

/**
 * One run of an application that installs `selfUpdate()`, against a fake GitHub that replaces
 * `fetch`. The scenario file names the release facts, the hook, where the run aborts, and what
 * GitHub serves; every request the fake answers is appended to the scenario's `requests` file.
 */
const [scenarioPath, ...argv] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const github = scenario.github;
const controller = new AbortController();

if (process.env.FIXTURE_UMASK !== undefined) {
  process.umask(Number.parseInt(process.env.FIXTURE_UMASK, 8));
}

const assetHost = 'https://release-assets.example';

/** The canonical repository a path names, or `undefined` for one GitHub does not know. */
function canonical(owner, name) {
  const named = `${owner}/${name}`.toLowerCase();
  if (named === github.repository.toLowerCase()) {
    return { moved: false, repository: github.repository };
  }
  if (github.renamedFrom !== undefined && named === github.renamedFrom.toLowerCase()) {
    return { moved: true, repository: github.repository };
  }
  return undefined;
}

function redirect(status, location) {
  return new Response(null, { headers: { location }, status });
}

/** The Atom feed GitHub serves: one entry per tag, newest first, each linking its tag page. */
function feed(repository) {
  // An entry for another repository's tag, which a feed never holds for this one, must be passed over.
  const foreign = (github.foreign ?? [])
    .map(
      ({ owner, tag }) =>
        `<entry><link rel="alternate" type="text/html" href="https://github.com/${owner}/releases/tag/${tag}"/></entry>`,
    )
    .join('');
  const entries = github.feed
    .map(
      (tag) =>
        `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><link rel="alternate" type="text/html" href="https://github.com/${repository}/releases/tag/${tag}"/><title>${tag}</title><content type="html">&lt;a href=&quot;https://github.com/${repository}/releases/tag/v99.0.0&quot;&gt;notes&lt;/a&gt;</content></entry>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><link type="text/html" rel="alternate" href="https://github.com/${repository}/releases"/><link type="application/atom+xml" rel="self" href="https://github.com/${repository}/releases.atom"/>${foreign}${entries}</feed>`;
}

/** What GitHub answers for one URL on github.com. */
function answerGitHub(url) {
  const [owner, name, ...rest] = url.pathname.slice(1).split('/');
  const found = canonical(owner, name);
  if (found === undefined) {
    return new Response('Not Found', { status: 404 });
  }
  if (found.moved) {
    return redirect(301, `https://github.com/${found.repository}/${rest.join('/')}`);
  }
  const path = rest.join('/');
  if (path === 'releases/latest') {
    return github.latest === null
      ? redirect(302, `https://github.com/${found.repository}/releases`)
      : redirect(302, `https://github.com/${found.repository}/releases/tag/${github.latest}`);
  }
  if (path === 'releases' || path.startsWith('releases/tag/')) {
    return new Response('<html></html>', { status: 200 });
  }
  if (path === 'releases.atom') {
    return new Response(feed(found.repository), { status: 200 });
  }
  const download = /^releases\/download\/(?<tag>[^/]+)\/(?<file>[^/]+)$/u.exec(path)?.groups;
  const file =
    download === undefined ? undefined : assetOf(github.releases[download.tag], download.file);
  if (download === undefined || file === undefined || file === null) {
    return new Response('Not Found', { status: 404 });
  }
  return redirect(302, `${assetHost}/${download.tag}/${download.file}`);
}

/** The contents a release lists under a file name: its sums, or one of its assets. */
function assetOf(release, file) {
  if (file === 'SHA256SUMS') {
    return release?.sums;
  }
  return release?.assets?.[file];
}

/** What the asset host answers: the file's bytes. */
function answerAssets(url) {
  const [tag, file] = url.pathname.slice(1).split('/');
  const release = github.releases[tag];
  const body = file === 'SHA256SUMS' ? release.sums : release.assets[file];
  return new Response(body, { status: 200 });
}

/** What one rule answers for a URL, or `undefined` when the request goes on to GitHub. */
function answerRule(rule, text, signal) {
  if (rule === 'insecure') {
    return redirect(302, text.replace('https:', 'http:'));
  }
  if (rule === 'loop') {
    return redirect(302, `${text.split('?')[0]}?again=${Math.random()}`);
  }
  if (rule === 'no-response') {
    throw new TypeError('fetch failed');
  }
  if (rule === 'lock') {
    // The install directory turns read-only after the checks passed, as a full disk would refuse the write.
    chmodSync(dirname(scenario.release.installation.path), 0o555);
    return undefined;
  }
  if (rule === 'cut') {
    // The connection ends partway through the body, as a dropped download does.
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('partial'));
        stream.error(new TypeError('terminated'));
      },
    });
    return new Response(body, { status: 200 });
  }
  if (rule === 'late-abort') {
    // The run is cancelled once the download has its answer, so the abort lands before the rename.
    controller.abort();
    return undefined;
  }
  if (rule === 'offsite') {
    return redirect(302, 'https://example.com/elsewhere');
  }
  if (typeof rule === 'object' && rule !== null) {
    return hop(rule.hops, text);
  }
  if (rule === 'abort') {
    controller.abort();
    throw signal.reason;
  }
  return typeof rule === 'number' ? new Response('Unavailable', { status: rule }) : undefined;
}

/** Redirects `text` back to itself until it has been redirected `hops` times, then lets GitHub answer. */
function hop(hops, text) {
  const url = new URL(text);
  const done = Number(url.searchParams.get('hop') ?? '0');
  if (done >= hops) {
    return undefined;
  }
  url.searchParams.set('hop', String(done + 1));
  return redirect(302, url.href);
}

/** A rule the scenario sets for URLs that contain a fragment, applied before GitHub answers. */
function ruled(text, signal) {
  for (const [fragment, rule] of Object.entries(scenario.rules ?? {})) {
    const response = text.includes(fragment) ? answerRule(rule, text, signal) : undefined;
    if (response !== undefined) {
      return response;
    }
  }
  return undefined;
}

globalThis.fetch = async (input, init = {}) => {
  const text = input instanceof Request ? input.url : String(input);
  appendFileSync(scenario.requests, `${text}\n`);
  if (init.redirect !== 'manual') {
    throw new TypeError(`The fake GitHub only answers manual redirects, not ${init.redirect}.`);
  }
  init.signal?.throwIfAborted();
  const url = new URL(text);
  const rule = ruled(text, init.signal);
  if (rule !== undefined) {
    return rule;
  }
  if (url.origin === 'https://github.com') {
    return answerGitHub(url);
  }
  if (url.origin === assetHost) {
    return answerAssets(url);
  }
  throw new TypeError(`The fake GitHub does not serve ${text}.`);
};

/** The hook the scenario names: one that records what it read, one that throws, or the skills or man pages refresh. */
function settings() {
  if (scenario.hook === undefined) {
    return undefined;
  }
  if (scenario.hook === 'refresh') {
    return { afterReplace: refreshSkills };
  }
  if (scenario.hook === 'refresh-manpages') {
    return { afterReplace: refreshManpages };
  }
  return {
    afterReplace: ({ current, host, path, previous, signal }) => {
      writeFileSync(
        scenario.hookLog,
        `${JSON.stringify({ aborted: signal.aborted, current, host: host.release.release.version, path, previous })}\n`,
        { flag: 'a' },
      );
      if (scenario.hook === 'throw') {
        throw new Error('The service did not restart.');
      }
    },
  };
}

/** Stderr, which aborts the run once the update line is written when the scenario asks. */
const stderr = new Writable({
  write(chunk, _encoding, done) {
    process.stderr.write(chunk);
    if (scenario.abortAfterRename === true && String(chunk).includes('Updated ')) {
      controller.abort();
    }
    done();
  },
});

const app = new Application('notes', {
  description: 'A fixture application.',
  plugins: [selfUpdate(settings())],
  version: scenario.release?.release?.version ?? '0.0.0',
});

process.exitCode = await app.run({
  // The platform is pinned so the record directory reads the same row on every machine.
  host: {
    argv,
    env: { ...process.env, ...scenario.env },
    platform: 'linux',
    release: scenario.release,
    stderr,
  },
  signal: controller.signal,
});
