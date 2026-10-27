import { escapeControlCharacters, FatalError, nowrap } from '@loomcli/core';

/** Every path, name, agent, and line of agent output a sentence repeats, escaped as a failure quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** A command line as its words joined by single spaces, each escaped. */
const shownCommand = (command: readonly string[]): string => command.map(shown).join(' ');

/**
 * The two names a sentence uses: the application's, which starts its own commands, and the
 * registration's, which an agent knows the server by.
 */
interface Names {
  readonly app: string;
  readonly registration: string;
}

/** Which child a sentence names. */
type Child = 'install' | 'uninstall';

/** One failure a child reports, which exits 1. */
function fatal(...sentences: readonly string[]): FatalError {
  return new FatalError(sentences.join(' '));
}

/** The words of a list of agents, such as `claude and codex`. */
const joined = (agents: readonly string[]): string => agents.join(' and ');

/** The call that failed, such as `claude mcp add`. */
const callOf = (agent: string, verb: string): string => `${agent} mcp ${verb}`;

const refusals = {
  /** An `add` that exited with a code or could not start. */
  addFailed: ({ app, registration }: Names, agent: string, code: number | undefined) =>
    fatal(
      `${shown(app)} could not register with ${agent}, because ${callOf(agent, 'add')} ${
        code === undefined ? 'could not start' : `exited with code ${code}`
      }.`,
      agent === 'claude'
        ? `If claude already has a server named ${shown(registration)}, remove it with claude mcp remove ${shown(registration)} -s user, or run ${shown(app)} mcp install --force to replace it.`
        : `Fix what ${agent} reported, then run ${shown(app)} mcp install again.`,
    ),
  agentMissing: (name: string, agent: string) =>
    fatal(
      `${shown(name)} mcp install cannot register with ${agent}, because ${agent} could not start.`,
      `Install ${agent}, or leave out --agent.`,
    ),
  cannotTell: ({ app, registration }: Names, agent: string, code: number | undefined) =>
    fatal(
      `${shown(app)} cannot tell whether ${agent} already has a server named ${shown(registration)}, because ${callOf(agent, 'get')} ${
        code === undefined ? 'could not start' : `exited with code ${code}`
      }.`,
      `Fix what ${agent} reported, then run ${shown(app)} mcp install again.`,
    ),
  controlCharacter: (name: string) =>
    fatal(
      `${shown(name)} cannot register its MCP server because its path holds a control character.`,
      `Install ${shown(name)} where its path has none.`,
    ),
  inTheWay: ({ app, registration }: Names) =>
    fatal(
      `${shown(app)} mcp install changed nothing, because a registration it did not make is in the way.`,
      `Remove it with codex mcp remove ${shown(registration)}, or run ${shown(app)} mcp install --force to replace it.`,
    ),
  noAgent: (name: string) =>
    fatal(
      `${shown(name)} mcp install found no agent to register with, because neither claude nor codex could start.`,
      `Install one of them, then run ${shown(name)} mcp install again.`,
    ),
  notOnWindows: (name: string, child: Child) =>
    fatal(
      `${shown(name)} mcp ${child} registers with claude and codex on Linux and macOS.`,
      `Print a client configuration with ${shown(name)} mcp config and add it to your agent yourself.`,
    ),
  record: (name: string, record: string, child: Child) =>
    fatal(
      `${shownPath(record)} cannot be read, so ${shown(name)} will not change the registration it lists.`,
      `Remove it, then run ${shown(name)} mcp ${child} again.`,
    ),
  uninstallIncomplete: ({ app, registration }: Names, agents: readonly string[]) =>
    fatal(
      `${shown(app)} mcp uninstall could not remove every registration.`,
      `Make ${joined(agents)} available and run ${shown(app)} mcp uninstall again, or remove ${shown(registration)} from ${agents.map((agent) => `${agent}'s`).join(' and ')} MCP configuration yourself.`,
    ),
};

/** The lines each child writes about its work. */
const lines = {
  buildNote: (name: string, build: 'development' | 'source') =>
    `${shown(name)} is ${build === 'source' ? 'a source build' : 'a development build'}, so the registration runs it from this checkout. Run mcp install from an installed ${shown(name)} to register that one instead.`,
  heldName: ({ app, registration }: Names, agent: string) =>
    `${agent} already has an MCP server named ${shown(registration)}, which ${shown(app)} mcp install did not register.`,
  noLongerRecorded: ({ registration }: Names, agent: string) =>
    `${shown(registration)} is no longer recorded as registered with ${agent}.`,
  nothingToRemove: ({ app, registration }: Names, agent: string | undefined) =>
    `${shown(registration)} is not registered with ${
      agent === undefined ? 'any agent' : agent
    } by ${shown(app)} mcp install, so there is nothing to remove.`,
  registered: ({ registration }: Names, agent: string, command: readonly string[]) =>
    `Registered ${shown(registration)} with ${agent} to run ${shownCommand(command)}.`,
  removed: ({ registration }: Names, agent: string) =>
    `Removed ${shown(registration)} from ${agent}.`,
  replaced: ({ app, registration }: Names, agent: string) =>
    `Replaced the ${shown(registration)} server ${agent} had, which ${shown(app)} mcp install did not register.`,
  runtimeFlags:
    'The registration keeps no runtime flags, so a loader such as --import tsx is not passed on.',
  skipped: (agent: string) => `Skipped ${agent}, because ${agent} could not start.`,
  staysRegistered: ({ registration }: Names, agent: string) =>
    `${agent} could not start, so ${shown(registration)} stays registered with it.`,
};

export type { Child, Names };
export { lines, refusals, shown };
