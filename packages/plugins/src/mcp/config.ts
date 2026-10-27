/*
 * `mcp config`: the client configuration that starts this application's server, for an agent that
 * has no registration CLI. It starts no program, reads no record, and writes no file.
 */
import type { Host } from '@loomcli/core';

import { commandLine, registrationName } from './registration.js';

/** The indent of the configuration's JSON. */
const indent = 2;

/** The configuration's bytes: an `mcpServers` object with this application's server, and a line feed. */
function clientConfiguration(name: string, host: Host): string {
  const [command, ...args] = commandLine(host);
  return `${JSON.stringify({ mcpServers: { [registrationName(name)]: { command, args } } }, undefined, indent)}\n`;
}

export { clientConfiguration };
