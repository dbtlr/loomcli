import { appendFileSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';

import { Application, Command, FatalError, lanes, override } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { refreshCompletion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { refreshManpages } from '@loomcli/plugins/manpage';
import { selfUpdate } from '@loomcli/plugins/self-update';
import type { NoticeSettings, SelfUpdateSettings } from '@loomcli/plugins/self-update';
import { refreshSkills } from '@loomcli/plugins/skills';

interface GitHub {
  repository: string;
  renamedFrom?: string;
  latest: string | null;
  feed: readonly string[];
  foreign?: readonly { owner: string; tag: string }[];
  releases: Record<string, { assets: Record<string, string>; sums: string | null }>;
}
interface UpdateScenario {
  github: GitHub;
  requests: string;
  release?: ReleaseFacts | undefined;
  hook?: 'record' | 'throw' | 'refresh' | 'completion' | 'refresh-manpages' | undefined;
  hookLog?: string | undefined;
  rules?: Record<string, string | number | { readonly hops: number }> | undefined;
  notices?: false | NoticeSettings | undefined;
  help?: 'before' | 'after' | undefined;
  restyle?: boolean | undefined;
  abortAfterRename?: boolean | undefined;
}
function redirect(status: number, location: string) {
  return new Response(null, { headers: { location }, status });
}

function assetOf(release: GitHub['releases'][string] | undefined, file: string) {
  if (file === 'SHA256SUMS') {
    return release?.sums;
  }
  return release?.assets?.[file];
}

function hop(hops: number, text: string) {
  const url = new URL(text);
  const done = Number(url.searchParams.get('hop') ?? '0');
  if (done >= hops) {
    return undefined;
  }
  url.searchParams.set('hop', String(done + 1));
  return redirect(302, url.href);
}

/** One application definition shared by mock runs and process-only lifecycle evidence. */
function selfUpdateApplication(
  scenario: UpdateScenario,
  controller: AbortController,
  effects: {
    holdForRun: () => Promise<void>;
    record: (event: string, details: Record<string, unknown>) => void;
    writeStderr: (chunk: string | Uint8Array) => void;
  },
) {
  const { holdForRun, record } = effects;
  const github = scenario.github;
  const assetHost = 'https://release-assets.example';

  /** The canonical repository a path names, or `undefined` for one GitHub does not know. */
  function canonical(owner: string, name: string) {
    const named = `${owner}/${name}`.toLowerCase();
    if (named === github.repository.toLowerCase()) {
      return { moved: false, repository: github.repository };
    }
    if (github.renamedFrom !== undefined && named === github.renamedFrom.toLowerCase()) {
      return { moved: true, repository: github.repository };
    }
    return undefined;
  }

  /** The Atom feed GitHub serves: one entry per tag, newest first, each linking its tag page. */
  function feed(repository: string) {
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
  function answerGitHub(url: URL) {
    const [owner, name, ...rest] = url.pathname.slice(1).split('/');
    const found = canonical(owner ?? '', name ?? '');
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
      download === undefined
        ? undefined
        : assetOf(github.releases[download.tag ?? ''], download.file ?? '');
    if (download === undefined || file === undefined || file === null) {
      return new Response('Not Found', { status: 404 });
    }
    return redirect(302, `${assetHost}/${download.tag}/${download.file}`);
  }

  /** The contents a release lists under a file name: its sums, or one of its assets. */

  /** What the asset host answers: the file's bytes. */
  function answerAssets(url: URL) {
    const [tag, file] = url.pathname.slice(1).split('/');
    const release = github.releases[tag ?? ''];
    const body = file === 'SHA256SUMS' ? release?.sums : release?.assets[file ?? ''];
    return new Response(body, { status: 200 });
  }

  /** What one rule answers for a URL, or `undefined` when the request goes on to GitHub. */
  function answerRule(
    rule: string | number | { readonly hops: number },
    text: string,
    signal: AbortSignal | null | undefined,
  ) {
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
      chmodSync(dirname(scenario.release?.installation?.path ?? ''), 0o555);
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
      throw signal?.reason;
    }
    return typeof rule === 'number' ? new Response('Unavailable', { status: rule }) : undefined;
  }

  /** Redirects `text` back to itself until it has been redirected `hops` times, then lets GitHub answer. */

  /** A rule the scenario sets for URLs that contain a fragment, applied before GitHub answers. */
  function ruled(text: string, signal: AbortSignal | null | undefined) {
    for (const [fragment, rule] of Object.entries(scenario.rules ?? {})) {
      const response = text.includes(fragment) ? answerRule(rule, text, signal) : undefined;
      if (response !== undefined) {
        return response;
      }
    }
    return undefined;
  }

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const text = input instanceof Request ? input.url : String(input);
    await holdForRun();
    appendFileSync(scenario.requests, `${text}\n`);
    record('request', { url: text });
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

  /**
   * The hook the scenario names: one that records what it read, one that throws, the skills refresh,
   * the completion refresh, or the man pages refresh.
   */
  function hookSettings(): SelfUpdateSettings {
    if (scenario.hook === undefined) {
      return {};
    }
    if (scenario.hook === 'refresh') {
      return { afterReplace: refreshSkills };
    }
    if (scenario.hook === 'completion') {
      return { afterReplace: refreshCompletion };
    }
    if (scenario.hook === 'refresh-manpages') {
      return { afterReplace: refreshManpages };
    }
    return {
      afterReplace: ({ current, host, path, previous, signal }) => {
        writeFileSync(
          scenario.hookLog ?? '',
          `${JSON.stringify({ aborted: signal.aborted, current, host: host.release.release?.version, path, previous })}\n`,
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
      effects.writeStderr(chunk);
      if (scenario.abortAfterRename === true && String(chunk).includes('Updated ')) {
        controller.abort();
      }
      done();
    },
  });

  /** The settings the scenario names: the hook, and `notices` when it names one. */
  function settings() {
    const hook = hookSettings();
    return scenario.notices === undefined ? hook : { ...hook, notices: scenario.notices };
  }

  /** `selfUpdate()`, with the help plugin before or after it when the scenario names where. */
  function plugins() {
    const update = selfUpdate(settings());
    if (scenario.help === 'before') {
      return [help(), update];
    }
    return scenario.help === 'after' ? [update, help()] : [update];
  }

  const app = new Application('notes', {
    description: 'A fixture application.',
    plugins: plugins(),
    version: scenario.release?.release?.version ?? '0.0.0',
    views:
      scenario.restyle === true
        ? [override(lanes.info, { render: (message) => `[info] ${message}` })]
        : [],
  })
    // The Commands an update notices scenario runs: one that succeeds, one that fails, two cancelled.
    // Cancel throws the abort; interrupt returns once it sees it, as a handled Ctrl-C does.
    .command(
      new Command('add', { description: 'Add a note.' }).action(({ out }) =>
        out.success('Added note 12.'),
      ),
    )
    .command(
      new Command('fail', { description: 'Fail.' }).action(() => {
        throw new FatalError('The note could not be added.');
      }),
    )
    .command(
      new Command('cancel', { description: 'Cancel the run during the action.' }).action(
        ({ signal }) => {
          controller.abort();
          signal.throwIfAborted();
        },
      ),
    )
    .command(
      new Command('interrupt', { description: 'Return once the run is cancelled.' }).action(
        async ({ signal }) => {
          const aborted = new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          controller.abort();
          await aborted;
        },
      ),
    );

  return { app, fetch, stderr };
}

export { selfUpdateApplication };
export type { GitHub, UpdateScenario };
