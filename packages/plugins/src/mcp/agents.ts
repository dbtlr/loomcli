/*
 * The agents `mcp install` and `mcp uninstall` register with, in the order every child follows.
 * Each is one program with a registration command-line interface, so this table is the MCP
 * plugin's own and is not the skills plugin's table of folder layouts.
 */

/** The agent names `--agent` accepts. */
const agentNames = ['claude', 'codex'] as const;

type AgentName = (typeof agentNames)[number];

/** One agent: the program that starts it and the words of each call the plugin makes. */
interface Agent {
  readonly name: AgentName;
  /** The words of the call that shows the agent's CLI can start. */
  readonly version: readonly string[];
  /** The words of the call that tells whether the agent holds a name, for an agent that has one. */
  readonly nameCheck?: (name: string) => readonly string[];
  readonly add: (name: string, command: readonly string[]) => readonly string[];
  readonly remove: (name: string) => readonly string[];
}

const claude: Agent = {
  add: (name, command) => ['mcp', 'add', '-s', 'user', name, '--', ...command],
  name: 'claude',
  remove: (name) => ['mcp', 'remove', '-s', 'user', name],
  version: ['--version'],
};

const codex: Agent = {
  add: (name, command) => ['mcp', 'add', name, '--', ...command],
  name: 'codex',
  nameCheck: (name) => ['mcp', 'get', name, '--json'],
  remove: (name) => ['mcp', 'remove', name],
  version: ['--version'],
};

/** Every agent, in table order. */
const agents: readonly Agent[] = [claude, codex];

/** The agents a child acts on: the one `--agent` names, or every agent. */
function selectedAgents(agent: AgentName | undefined): readonly Agent[] {
  return agent === undefined ? agents : agents.filter(({ name }) => name === agent);
}

/** The plugin's file in the installation record for an agent, `mcp.<agent>.json`. */
function recordName(agent: Agent): string {
  return `mcp.${agent.name}`;
}

export type { Agent, AgentName };
export { agentNames, agents, recordName, selectedAgents };
