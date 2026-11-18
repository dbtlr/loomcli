import { Command, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { packageName } from '../constants.js';
import { exactText } from '../exact-text.js';
import { httpAddress } from './address.js';
import { agentNames } from './agents.js';
import { mcpArgument, mcpCommand, mcpInput } from './extension.js';
import { judgeTools } from './faults.js';
import type { ChildRun } from './run.js';

/** The agent names `--agent` accepts. */
const agentInput = oneOf(agentNames);

/** What every registering child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'log' | 'out' | 'signal'>;

/** The run a registering child acts on, read from its action context. */
function childRun({ graph, host, log, out, signal }: ChildContext): ChildRun {
  return {
    host,
    info: (message) => out.info(message),
    log,
    name: graph.name,
    signal,
    success: (message) => out.success(message),
    warn: (message) => out.warn(message),
  };
}

const installCommand = new Command('install', {
  description: "Register this application's MCP server with your coding agents.",
})
  .option('agent', {
    description:
      'The agent to register with: claude or codex. Every agent that starts when left out.',
    type: 'string',
    validate: agentInput,
  })
  .option('force', {
    description: 'Replace a registration of this name that mcp install did not make.',
    type: 'boolean',
  })
  .action(async (context) => {
    const { installRegistrations } = await import('./install.js');
    return installRegistrations(childRun(context), {
      agent: context.options.agent,
      force: context.options.force,
    });
  });

const uninstallCommand = new Command('uninstall', {
  description: "Remove this application's MCP server from your coding agents.",
})
  .option('agent', {
    description:
      'The agent to remove it from: claude or codex. Every agent it is registered with when left out.',
    type: 'string',
    validate: agentInput,
  })
  .action(async (context) => {
    const { uninstallRegistrations } = await import('./uninstall.js');
    return uninstallRegistrations(childRun(context), context.options.agent);
  });

const configCommand = new Command('config', {
  description: "Print a client configuration that starts this application's MCP server.",
}).action(async ({ graph, host, out }) => {
  const { clientConfiguration } = await import('./config.js');
  return out.render(clientConfiguration(graph.name, host), exactText);
});

/**
 * One HTTP request as the `authorize` hook reads it, before its body is read.
 *
 * @public
 * @sealed
 */
interface McpHttpRequest {
  /** A fresh copy of the request's headers, as the platform's `Headers`. */
  readonly headers: Headers;
}

/**
 * The settings `mcp()` takes. Each shapes the HTTP server that `mcp --http` runs, and none changes
 * a stdio server.
 *
 * @public
 */
interface McpSettings {
  /**
   * Judges each HTTP request from its headers, after the `Origin` check and before the body is
   * read: `true` serves it, and `false` answers 401. Never called over stdio.
   */
  readonly authorize?: ((request: McpHttpRequest) => boolean | Promise<boolean>) | undefined;
  /** The largest POST body the server reads, in bytes, 4_194_304 (4 MiB) by default. */
  readonly maxBodyBytes?: number | undefined;
  /**
   * How long an initialize-era session may sit idle before it ends, in milliseconds, 1_800_000
   * (30 minutes) by default.
   */
  readonly sessionIdleMs?: number | undefined;
}

// This package compiles outside any Application's registration, so the Command requires no globals.
/**
 * The `mcp` Command: it serves the tools, over stdio or with `--http` over HTTP, and its children
 * install, uninstall, and print a configuration.
 */
function mcpCommandTree(settings: McpSettings) {
  return new Command('mcp', {
    description:
      "Serve this application's tools to an MCP client, over stdin and stdout or, with --http, over HTTP.",
  })
    .option('http', {
      control: true,
      description:
        'Serve over HTTP at this address instead of stdin and stdout: a port, or host:port. A port alone listens on 127.0.0.1, and port 0 takes any free port.',
      type: 'string',
      validate: httpAddress,
    })
    .command(installCommand)
    .command(uninstallCommand)
    .command(configCommand)
    .action(async (context) => {
      const { serve } = await import('./serve.js');
      return serve(context, { http: context.options.http, settings });
    });
}

/**
 * A plugin that serves every Command carrying an `mcpCommand` value as one tool of a Model Context
 * Protocol server, over stdio or, with `mcp --http <address>`, over the protocol's streamable HTTP
 * transport, each call run through `invoke`. It contributes the `mcp` Command and its three
 * children, `install` and `uninstall`, which register the server with Claude Code and Codex and
 * record each registration, and `config`, the three extensions, and a hook that rejects a graph
 * whose tools cannot be served. Each Command loads its work when it runs. Its settings shape the
 * HTTP server alone.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { mcp } from '@loomcli/plugins/mcp';
 *
 * export const app = new Application('notes', { plugins: [mcp()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/mcp.md
 *
 * @public
 */
export function mcp(settings: McpSettings = {}): Plugin {
  return plugin(`${packageName}/mcp`, {
    commands: [mcpCommandTree(settings)],
    extensions: [mcpCommand, mcpInput, mcpArgument],
    onGraphBuilt: judgeTools,
  });
}

export type { McpHttpRequest, McpSettings };
