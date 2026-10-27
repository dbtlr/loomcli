/**
 * The Application's post-install declaration, under docs/core/application.md#the-post-install-declaration
 * and ADR-0113: what the installer script runs and prints after it installs and records the
 * binary. Core carries it on the graph and never acts on it at run time; a development build
 * checks only that the command's words route to a Command with an action.
 */
import type { BuiltGraph } from './command.js';
import { registerRule } from './diagnostic-text.js';
import type { DeclarationError } from './errors.js';
import { quoted, UnknownCommandError } from './errors.js';
import { factFault, slotSite } from './facts.js';
import { readWords } from './parse.js';

/**
 * What the installer script does after it installs and records the binary: `command` is the
 * argument words it runs the installed binary with, and `message` the text it prints last.
 */
interface PostInstall {
  readonly message?: string;
  readonly command?: readonly [string, ...string[]];
}

const postInstallUnrouted = registerRule('@loomcli/core/post-install-unrouted', {
  explanation:
    "The installer script runs the installed binary with the post-install command's words once it has installed the application. Words that route to no Command with an action fail on every operator's install, so a development build reports them before a release ships them.",
  headline: 'Post-install command unrouted',
});

/** A frozen copy of the words, so a later write to the declared list reaches no graph. */
function copied([first, ...rest]: readonly [string, ...string[]]): readonly [string, ...string[]] {
  return Object.freeze([first, ...rest]);
}

/**
 * The declaration as the graph carries it: the members the author declared, frozen, with a copy of
 * the words, or `undefined` when the Application declares neither member.
 */
function postInstallOf(declared: PostInstall | undefined): PostInstall | undefined {
  const { command, message } = declared ?? {};
  if (command === undefined && message === undefined) {
    return undefined;
  }
  return Object.freeze({
    ...(command === undefined ? {} : { command: copied(command) }),
    ...(message === undefined ? {} : { message }),
  });
}

/**
 * Whether words route, as an invocation's argv routes, to a Command with an action. An unknown
 * Command is the one fault routing raises, and it routes nowhere.
 */
function routesToAction(graph: BuiltGraph, words: readonly string[]): boolean {
  try {
    return readWords(graph, words).command.dispatch !== undefined;
  } catch (error) {
    if (error instanceof UnknownCommandError) {
      return false;
    }
    throw error;
  }
}

/**
 * The fault for post-install words that route to no Command with an action, or `undefined` when
 * they route to one. The words route as an invocation's argv routes, global options included, and
 * the routed Command's own inputs are read but never judged.
 */
function unroutedPostInstall(
  application: string,
  graph: BuiltGraph,
  postInstall: PostInstall | undefined,
): DeclarationError | undefined {
  const words = postInstall?.command;
  if (words === undefined) {
    return undefined;
  }
  if (routesToAction(graph, words)) {
    return undefined;
  }
  const site = slotSite(
    { call: 'new Application', named: application, subject: 'The Application' },
    'postInstall',
    postInstall,
  );
  return factFault(postInstallUnrouted, site, {
    correction: 'Name a Command that has an action in postInstall.command, or remove the command.',
    fact: 'command',
    sentence: `The post-install command ${quoted(words.join(' '))} routes to no Command with an action.`,
  });
}

export type { PostInstall };
export { postInstallOf, unroutedPostInstall };
