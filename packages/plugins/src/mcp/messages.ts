/*
 * The operator sentences of the MCP plugin, under ADR-0164, including the error text its server
 * returns. `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

const shownCommand = (command: readonly string[]): string => command.map(shown).join(' ');

interface Names {
  readonly app: string;
  readonly registration: string;
}

type Child = 'install' | 'uninstall';

const joined = (agents: readonly string[]): string => agents.map(shown).join(' and ');

function possessive(agent: string): string {
  return `${shown(agent)}'s`;
}

const possessives = (agents: readonly string[]): string => agents.map(possessive).join(' and ');

function callOf(agent: string, verb: string): string {
  return `${shown(agent)} mcp ${shown(verb)}`;
}

function exitedWithCode(code: number): string {
  return `exited with code ${String(code)}`;
}

function callEnded(code: number | undefined): string {
  return code === undefined ? 'could not start' : exitedWithCode(code);
}

function addCorrection({ app, registration }: Names, agent: string): string {
  return agent === 'claude'
    ? `If claude already has a server named ${shown(registration)}, remove it with claude mcp remove ${shown(registration)} -s user, or run ${shown(app)} mcp install --force to replace it.`
    : `Fix what ${shown(agent)} reported, then run ${shown(app)} mcp install again.`;
}

function addFailed(names: Names, agent: string, code: number | undefined): string {
  return `${shown(names.app)} could not register with ${shown(agent)}, because ${callOf(agent, 'add')} ${callEnded(code)}. ${addCorrection(names, agent)}`;
}

function agentMissing(name: string, agent: string): string {
  return `${shown(name)} mcp install cannot register with ${shown(agent)}, because ${shown(agent)} could not start. Install ${shown(agent)}, or leave out --agent.`;
}

function cannotTell({ app, registration }: Names, agent: string, code: number | undefined): string {
  return `${shown(app)} cannot tell whether ${shown(agent)} already has a server named ${shown(registration)}, because ${callOf(agent, 'get')} ${callEnded(code)}. Fix what ${shown(agent)} reported, then run ${shown(app)} mcp install again.`;
}

function pathHoldsControl(name: string): string {
  return `${shown(name)} cannot register its MCP server because its path holds a control character. Install ${shown(name)} where its path has none.`;
}

function registrationInTheWay({ app, registration }: Names): string {
  return `${shown(app)} mcp install changed nothing, because a registration it did not make is in the way. Remove it with codex mcp remove ${shown(registration)}, or run ${shown(app)} mcp install --force to replace it.`;
}

function noAgent(name: string): string {
  return `${shown(name)} mcp install found no agent to register with, because neither claude nor codex could start. Install one of them, then run ${shown(name)} mcp install again.`;
}

function registersNotOnWindows(name: string, child: Child): string {
  return `${shown(name)} mcp ${shown(child)} registers with claude and codex on Linux and macOS. Print a client configuration with ${shown(name)} mcp config and add it to your agent yourself.`;
}

function recordUnreadable(name: string, record: string, child: Child): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the registration it lists. Remove it, then run ${shown(name)} mcp ${shown(child)} again.`;
}

function uninstallIncomplete({ app, registration }: Names, agents: readonly string[]): string {
  return `${shown(app)} mcp uninstall could not remove every registration. Make ${joined(agents)} available and run ${shown(app)} mcp uninstall again, or remove ${shown(registration)} from ${possessives(agents)} MCP configuration yourself.`;
}

function buildNote(name: string, build: 'development' | 'source'): string {
  return `${shown(name)} is ${build === 'source' ? 'a source build' : 'a development build'}, so the registration runs it from this checkout. Run mcp install from an installed ${shown(name)} to register that one instead.`;
}

function nameHeld({ app, registration }: Names, agent: string): string {
  return `${shown(agent)} already has an MCP server named ${shown(registration)}, which ${shown(app)} mcp install did not register.`;
}

function noLongerRecorded({ registration }: Names, agent: string): string {
  return `${shown(registration)} is no longer recorded as registered with ${shown(agent)}.`;
}

function nothingToRemove({ app, registration }: Names, agent: string | undefined): string {
  return `${shown(registration)} is not registered with ${agent === undefined ? 'any agent' : shown(agent)} by ${shown(app)} mcp install, so there is nothing to remove.`;
}

function registered({ registration }: Names, agent: string, command: readonly string[]): string {
  return `Registered ${shown(registration)} with ${shown(agent)} to run ${shownCommand(command)}.`;
}

function removedRegistration({ registration }: Names, agent: string): string {
  return `Removed ${shown(registration)} from ${shown(agent)}.`;
}

function replacedServer({ app, registration }: Names, agent: string): string {
  return `Replaced the ${shown(registration)} server ${shown(agent)} had, which ${shown(app)} mcp install did not register.`;
}

const runtimeFlagsDropped =
  'The registration keeps no runtime flags, so a loader such as --import tsx is not passed on.';

function skippedAgent(agent: string): string {
  return `Skipped ${shown(agent)}, because ${shown(agent)} could not start.`;
}

function staysRegistered({ registration }: Names, agent: string): string {
  return `${shown(agent)} could not start, so ${shown(registration)} stays registered with it.`;
}

function argumentsNotObject(tool: string): string {
  return `Tool "${shown(tool)}" arguments must be an object. Supply a JSON object of named inputs.`;
}

function unlistedArgument(tool: string, key: string): string {
  return `Tool "${shown(tool)}" takes no argument "${shown(key)}". Use a property its input schema lists.`;
}

function unknownTool(tool: string): string {
  return `Unknown tool "${shown(tool)}". Call tools/list for the tool names.`;
}

export type { Child, Names };
export {
  addFailed,
  agentMissing,
  argumentsNotObject,
  buildNote,
  cannotTell,
  nameHeld,
  noAgent,
  noLongerRecorded,
  nothingToRemove,
  pathHoldsControl,
  recordUnreadable,
  registered,
  registersNotOnWindows,
  registrationInTheWay,
  removedRegistration,
  replacedServer,
  runtimeFlagsDropped,
  skippedAgent,
  staysRegistered,
  uninstallIncomplete,
  unknownTool,
  unlistedArgument,
};
