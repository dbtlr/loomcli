import type { Middleware, MiddlewareContext } from '@loomcli/core';

import { json, jsonl } from '../json-views.js';
import type { version } from './plugin.js';
import { versionFacts, versionLine } from './views.js';
import type { VersionFacts } from './views.js';

/** What one `version()` call tells its middleware. */
interface VersionBehavior {
  readonly extended: boolean;
  readonly postfix: string | undefined;
}

/**
 * The JSON object: the eight keys in the order the contract fixes, strings, and `null` for an
 * absent fact. The key order is the document's contract, so this module turns `eslint/sort-keys`
 * off and the literal below keeps that order.
 */
interface VersionDocument {
  readonly name: string;
  readonly version: string;
  readonly channel: string | null;
  readonly build: string;
  readonly asset: string | null;
  readonly installationMethod: string | null;
  readonly runtime: string | null;
  readonly platform: string;
}

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

/** The JSON object: the name, the declared version, and the six facts, `null` for an absent one. */
function documentOf(context: MiddlewareContext, facts: VersionFacts): VersionDocument {
  const { graph } = context;
  return {
    name: graph.name,
    version: graph.version,
    channel: facts.channel ?? null,
    build: facts.build,
    asset: facts.asset ?? null,
    installationMethod: facts.installationMethod ?? null,
    runtime: facts.runtime ?? null,
    platform: facts.platform,
  };
}

/**
 * The run's media type, when it is one of the two JSON ones: the selected view's on a Command that
 * declares a result, and the one a middleware ahead of this one stated on a Command that declares
 * none, as the formatter does at a group.
 */
function documentType({ mediaType }: MiddlewareContext): keyof typeof documentViews | undefined {
  return mediaType === 'application/json' || mediaType === 'application/jsonl'
    ? mediaType
    : undefined;
}

/**
 * The middleware for one `version()` call. It renders the version line with that call's postfix,
 * and with `extended` the facts below it, or as one JSON object when the run's media type is a
 * JSON one. It ends the invocation by returning without calling `next()`, so nothing after
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
    const mediaType = documentType(context);
    if (mediaType !== undefined) {
      return out.render(documentOf(context, facts), documentViews[mediaType]);
    }
    await out.render({ graph, postfix }, versionLine);
    return out.render(facts, versionFacts);
  };
}
