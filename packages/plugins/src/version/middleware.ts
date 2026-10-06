import type { Middleware } from '@loomcli/core';

import type { version } from './plugin.js';
import { versionLine } from './views.js';

/**
 * The middleware for one `version()` call. It renders the version line with that call's postfix and
 * ends the invocation by returning without calling `next()`, so nothing after routing runs and the
 * exit code is 0. The routed Command never changes the line, because the version is a fact of the
 * Application.
 */
export function versionMiddleware(postfix: string | undefined): Middleware<typeof version> {
  return ({ graph, out }) => out.render({ graph, postfix }, versionLine);
}
