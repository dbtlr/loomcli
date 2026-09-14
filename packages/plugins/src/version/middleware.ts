import type { Middleware } from '@loomcli/core';

import type { version } from './plugin.js';
import { versionLine } from './views.js';

/**
 * Renders the version line and ends the invocation by returning without calling `next()`, so
 * nothing after routing runs and the exit code is 0. The routed Command never changes the line,
 * because the version is a fact of the Application.
 */
const middleware: Middleware<typeof version> = ({ graph, out }) => out.render(graph, versionLine);

export default middleware;
