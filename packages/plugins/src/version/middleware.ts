import type { Middleware, MiddlewareContext } from '@loomcli/core';

import { json, jsonl } from '../format/views.js';
import type { version } from './plugin.js';
import { versionFacts, versionLine } from './views.js';
import type { VersionFacts } from './views.js';

/** What one `version()` call tells its middleware. */
interface VersionBehavior {
  readonly extended: boolean;
  readonly postfix: string | undefined;
}

/** The JSON object: strings, and `null` for an absent fact. */
type VersionDocument = Readonly<Record<string, string | null>>;

/** The bare views the JSON form writes through, which no declared view's override reaches. */
const documentViews = {
  'application/json': json<VersionDocument>(),
  'application/jsonl': jsonl<VersionDocument>(),
};

/** The facts the extended output prints, read from the run's host. */
function factsOf({ host }: MiddlewareContext): VersionFacts {
  const { installation, release } = host.release;
  return {
    asset: release?.asset,
    build: host.release.build,
    channel: release?.channel,
    installationMethod: installation?.method,
    platform: `${host.platform}-${host.arch}`,
    runtime:
      host.runtime === undefined ? undefined : `${host.runtime.name} ${host.runtime.version}`,
  };
}

/**
 * The JSON object: the name, the declared version, and the six facts, `null` for an absent one. The
 * keys go in as entries, in the order the contract fixes, because `eslint/sort-keys` would reorder
 * an object literal's keys.
 */
function documentOf(context: MiddlewareContext, facts: VersionFacts): VersionDocument {
  const { graph } = context;
  return Object.fromEntries([
    ['name', graph.name],
    ['version', graph.version],
    ['channel', facts.channel ?? null],
    ['build', facts.build],
    ['asset', facts.asset ?? null],
    ['installationMethod', facts.installationMethod ?? null],
    ['runtime', facts.runtime ?? null],
    ['platform', facts.platform],
  ]);
}

/**
 * The media type of the view the run selected, when it is one of the two JSON ones. A Command that
 * declares no result selects no view, so it has none.
 */
function selectedDocumentType(context: MiddlewareContext): keyof typeof documentViews | undefined {
  const { view } = context;
  const mediaType = view === null ? undefined : context.command.result?.mediaTypes[view];
  return mediaType === 'application/json' || mediaType === 'application/jsonl'
    ? mediaType
    : undefined;
}

/**
 * The middleware for one `version()` call. It renders the version line with that call's postfix,
 * and with `extended` the facts below it, or as one JSON object when the selected view declares a
 * JSON media type. It ends the invocation by returning without calling `next()`, so nothing after
 * routing runs and the exit code is 0. The routed Command never changes the output, because the
 * version is a fact of the Application.
 */
export function versionMiddleware({
  extended,
  postfix,
}: VersionBehavior): Middleware<typeof version> {
  return async (context) => {
    const { graph, out } = context;
    if (!extended) {
      return out.render({ graph, postfix }, versionLine);
    }
    const facts = factsOf(context);
    const mediaType = selectedDocumentType(context);
    if (mediaType !== undefined) {
      return out.render(documentOf(context, facts), documentViews[mediaType]);
    }
    await out.render({ graph, postfix }, versionLine);
    return out.render(facts, versionFacts);
  };
}
