/*
 * The operator sentences of the MCP plugin, under ADR-0164: the failures its children raise, the
 * lines they write about their work, and the error text its server returns to a client. Each is a
 * function of the values it repeats, or a constant, and the code that raises the failure, writes
 * the line, or answers the client calls it. `tests/message-voice.test.ts` holds this module to the
 * failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every path, name, agent, and line of agent output a sentence repeats, escaped as a failure quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** A command line as its words joined by single spaces, each escaped. */
const shownCommand = (command: readonly string[]): string => command.map(shown).join(' ');

/**
 * The two names a sentence uses: the application's, which starts its own commands, and the
 * registration's, which an agent knows the server by.
 *
 * @example
 * ```ts
 * const names: Names = { app: 'notes', registration: 'notes' };
 * ```
 */
interface Names {
  readonly app: string;
  readonly registration: string;
}

/**
 * Which child a sentence names.
 *
 * @example
 * ```ts
 * const child: Child = 'install';
 * ```
 */
type Child = 'install' | 'uninstall';

/** The words of a list of agents, such as `claude and codex`. */
const joined = (agents: readonly string[]): string => agents.map(shown).join(' and ');

/** One agent's name in the possessive, such as `claude's`. */
function possessive(agent: string): string {
  return `${shown(agent)}'s`;
}

/** The possessives of a list of agents, such as `claude's and codex's`. */
const possessives = (agents: readonly string[]): string => agents.map(possessive).join(' and ');

/** The call that failed, such as `claude mcp add`. */
function callOf(agent: string, verb: string): string {
  return `${shown(agent)} mcp ${shown(verb)}`;
}

/** How a call that exited with a code ended. */
function exitedWithCode(code: number): string {
  return `exited with code ${String(code)}`;
}

/** How a call ended: it could not start, or it exited with a code. */
function callEnded(code: number | undefined): string {
  return code === undefined ? 'could not start' : exitedWithCode(code);
}

/** The correction of an `add` that failed: the held name to remove for claude, or the agent's report. */
function addCorrection({ app, registration }: Names, agent: string): string {
  return agent === 'claude'
    ? `If claude already has a server named ${shown(registration)}, remove it with claude mcp remove ${shown(registration)} -s user, or run ${shown(app)} mcp install --force to replace it.`
    : `Fix what ${shown(agent)} reported, then run ${shown(app)} mcp install again.`;
}

/**
 * The failure of an agent's `add` that exited with a code or could not start.
 *
 * @example
 * ```ts
 * addFailed({ app: 'notes', registration: 'notes' }, 'codex', 1);
 * // 'notes could not register with codex, because codex mcp add exited with code 1. Fix what codex reported, then run notes mcp install again.'
 * ```
 */
function addFailed(names: Names, agent: string, code: number | undefined): string {
  return `${shown(names.app)} could not register with ${shown(agent)}, because ${callOf(agent, 'add')} ${callEnded(code)}. ${addCorrection(names, agent)}`;
}

/**
 * The failure of an install whose `--agent` cannot start.
 *
 * @example
 * ```ts
 * agentMissing('notes', 'codex');
 * ```
 */
function agentMissing(name: string, agent: string): string {
  return `${shown(name)} mcp install cannot register with ${shown(agent)}, because ${shown(agent)} could not start. Install ${shown(agent)}, or leave out --agent.`;
}

/**
 * The failure of an install that cannot tell whether an agent holds the name.
 *
 * @example
 * ```ts
 * cannotTell({ app: 'notes', registration: 'notes' }, 'claude', undefined);
 * ```
 */
function cannotTell({ app, registration }: Names, agent: string, code: number | undefined): string {
  return `${shown(app)} cannot tell whether ${shown(agent)} already has a server named ${shown(registration)}, because ${callOf(agent, 'get')} ${callEnded(code)}. Fix what ${shown(agent)} reported, then run ${shown(app)} mcp install again.`;
}

/**
 * The failure of an install whose path holds a control character.
 *
 * @example
 * ```ts
 * pathHoldsControl('notes');
 * ```
 */
function pathHoldsControl(name: string): string {
  return `${shown(name)} cannot register its MCP server because its path holds a control character. Install ${shown(name)} where its path has none.`;
}

/**
 * The failure of an install that a registration it did not make is in the way of.
 *
 * @example
 * ```ts
 * registrationInTheWay({ app: 'notes', registration: 'notes' });
 * ```
 */
function registrationInTheWay({ app, registration }: Names): string {
  return `${shown(app)} mcp install changed nothing, because a registration it did not make is in the way. Remove it with codex mcp remove ${shown(registration)}, or run ${shown(app)} mcp install --force to replace it.`;
}

/**
 * The failure of an install with no agent that starts.
 *
 * @example
 * ```ts
 * noAgent('notes');
 * ```
 */
function noAgent(name: string): string {
  return `${shown(name)} mcp install found no agent to register with, because neither claude nor codex could start. Install one of them, then run ${shown(name)} mcp install again.`;
}

/**
 * The failure of a registering child on Windows.
 *
 * @example
 * ```ts
 * registersNotOnWindows('notes', 'install');
 * ```
 */
function registersNotOnWindows(name: string, child: Child): string {
  return `${shown(name)} mcp ${shown(child)} registers with claude and codex on Linux and macOS. Print a client configuration with ${shown(name)} mcp config and add it to your agent yourself.`;
}

/**
 * The failure of an installation record that cannot be read.
 *
 * @example
 * ```ts
 * recordUnreadable('notes', '/home/ada/.local/state/notes/mcp.claude.json', 'uninstall');
 * ```
 */
function recordUnreadable(name: string, record: string, child: Child): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the registration it lists. Remove it, then run ${shown(name)} mcp ${shown(child)} again.`;
}

/**
 * The failure of an uninstall that could not remove every registration.
 *
 * @example
 * ```ts
 * uninstallIncomplete({ app: 'notes', registration: 'notes' }, ['codex']);
 * ```
 */
function uninstallIncomplete({ app, registration }: Names, agents: readonly string[]): string {
  return `${shown(app)} mcp uninstall could not remove every registration. Make ${joined(agents)} available and run ${shown(app)} mcp uninstall again, or remove ${shown(registration)} from ${possessives(agents)} MCP configuration yourself.`;
}

/**
 * The line of a registration made from a source or development build.
 *
 * @example
 * ```ts
 * buildNote('notes', 'source');
 * ```
 */
function buildNote(name: string, build: 'development' | 'source'): string {
  return `${shown(name)} is ${build === 'source' ? 'a source build' : 'a development build'}, so the registration runs it from this checkout. Run mcp install from an installed ${shown(name)} to register that one instead.`;
}

/**
 * The warning of an agent that holds the name with a server install did not register.
 *
 * @example
 * ```ts
 * nameHeld({ app: 'notes', registration: 'notes' }, 'codex');
 * ```
 */
function nameHeld({ app, registration }: Names, agent: string): string {
  return `${shown(agent)} already has an MCP server named ${shown(registration)}, which ${shown(app)} mcp install did not register.`;
}

/**
 * The line of a registration the agent no longer holds.
 *
 * @example
 * ```ts
 * noLongerRecorded({ app: 'notes', registration: 'notes' }, 'claude');
 * ```
 */
function noLongerRecorded({ registration }: Names, agent: string): string {
  return `${shown(registration)} is no longer recorded as registered with ${shown(agent)}.`;
}

/**
 * The confirmation of an uninstall with no registration recorded.
 *
 * @example
 * ```ts
 * nothingToRemove({ app: 'notes', registration: 'notes' }, undefined);
 * // 'notes is not registered with any agent by notes mcp install, so there is nothing to remove.'
 * ```
 */
function nothingToRemove({ app, registration }: Names, agent: string | undefined): string {
  return `${shown(registration)} is not registered with ${agent === undefined ? 'any agent' : shown(agent)} by ${shown(app)} mcp install, so there is nothing to remove.`;
}

/**
 * The confirmation of a registration.
 *
 * @example
 * ```ts
 * registered({ app: 'notes', registration: 'notes' }, 'claude', ['/usr/local/bin/notes', 'mcp', 'serve']);
 * ```
 */
function registered({ registration }: Names, agent: string, command: readonly string[]): string {
  return `Registered ${shown(registration)} with ${shown(agent)} to run ${shownCommand(command)}.`;
}

/**
 * The confirmation of a removed registration.
 *
 * @example
 * ```ts
 * removedRegistration({ app: 'notes', registration: 'notes' }, 'codex'); // 'Removed notes from codex.'
 * ```
 */
function removedRegistration({ registration }: Names, agent: string): string {
  return `Removed ${shown(registration)} from ${shown(agent)}.`;
}

/**
 * The line of a server `--force` replaced.
 *
 * @example
 * ```ts
 * replacedServer({ app: 'notes', registration: 'notes' }, 'claude');
 * ```
 */
function replacedServer({ app, registration }: Names, agent: string): string {
  return `Replaced the ${shown(registration)} server ${shown(agent)} had, which ${shown(app)} mcp install did not register.`;
}

/**
 * The line that a registration passes no runtime flags on.
 *
 * @example
 * ```ts
 * console.log(runtimeFlagsDropped);
 * ```
 */
const runtimeFlagsDropped =
  'The registration keeps no runtime flags, so a loader such as --import tsx is not passed on.';

/**
 * The line of an agent that could not start and was skipped.
 *
 * @example
 * ```ts
 * skippedAgent('codex'); // 'Skipped codex, because codex could not start.'
 * ```
 */
function skippedAgent(agent: string): string {
  return `Skipped ${shown(agent)}, because ${shown(agent)} could not start.`;
}

/**
 * The warning of a registration that stays because its agent could not start.
 *
 * @example
 * ```ts
 * staysRegistered({ app: 'notes', registration: 'notes' }, 'codex');
 * ```
 */
function staysRegistered({ registration }: Names, agent: string): string {
  return `${shown(agent)} could not start, so ${shown(registration)} stays registered with it.`;
}

/**
 * The error text of a tool call whose arguments are not an object.
 *
 * @example
 * ```ts
 * argumentsNotObject('notes_add');
 * // 'Tool "notes_add" arguments must be an object. Supply a JSON object of named inputs.'
 * ```
 */
function argumentsNotObject(tool: string): string {
  return `Tool "${shown(tool)}" arguments must be an object. Supply a JSON object of named inputs.`;
}

/**
 * The text of a tool execution error for a key the tool's input schema does not list.
 *
 * @example
 * ```ts
 * unlistedArgument('notes_add', 'titel');
 * // 'Tool "notes_add" takes no argument "titel". Use a property its input schema lists.'
 * ```
 */
function unlistedArgument(tool: string, key: string): string {
  return `Tool "${shown(tool)}" takes no argument "${shown(key)}". Use a property its input schema lists.`;
}

/**
 * The error text of a call that names no tool the server lists.
 *
 * @example
 * ```ts
 * unknownTool('notes_ad'); // 'Unknown tool "notes_ad". Call tools/list for the tool names.'
 * ```
 */
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
