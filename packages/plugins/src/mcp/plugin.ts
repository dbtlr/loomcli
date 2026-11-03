import { Command, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { packageName } from '../constants.js';
import { exactText } from '../exact-text.js';
import { agentNames } from './agents.js';
import { mcpArgument, mcpCommand, mcpInput } from './extension.js';
import { judgeTools } from './faults.js';
import type { ChildRun } from './run.js';

/** The agent names `--agent` accepts. */
const agentInput = oneOf(agentNames);

/** What every registering child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'out' | 'signal'>;

/** The run a registering child acts on, read from its action context. */
function childRun({ graph, host, out, signal }: ChildContext): ChildRun {
  return {
    host,
    info: (message) => out.info(message),
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

// This package compiles outside any Application's registration, so the Command requires no globals.
/** The `mcp` Command: it serves the tools, and its children install, uninstall, and print a configuration. */
const mcpCommandTree = new Command('mcp', {
  description: "Serve this application's tools to an MCP client over stdin and stdout.",
})
  .command(installCommand)
  .command(uninstallCommand)
  .command(configCommand)
  .action(async (context) => {
    const { serve } = await import('./serve.js');
    return serve(context);
  });

/**
 * A plugin that serves every Command carrying an `mcpCommand` value as one tool of a Model Context
 * Protocol server over stdio, each call run through `invoke`. It contributes the `mcp` Command and
 * its three children, `install` and `uninstall`, which register the server with Claude Code and
 * Codex and record each registration, and `config`, the three extensions, and a hook that rejects a
 * graph whose tools cannot be served. Each Command loads its work when it runs.
 */
export function mcp(): Plugin {
  return plugin(`${packageName}/mcp`, {
    commands: [mcpCommandTree],
    extensions: [mcpCommand, mcpInput, mcpArgument],
    onGraphBuilt: judgeTools,
  });
}
