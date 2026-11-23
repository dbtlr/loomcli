import { FatalError, isPortableName } from '@loomcli/core';
import type { ExitCode, Middleware, MiddlewareContext } from '@loomcli/core';

import { externalCommandsPhrase } from './phrases.js';
import type { externalCommands } from './plugin.js';
import { findProgram } from './search.js';
import { notIn, running } from './wording.js';

/** The lowest and highest codes a process exit status holds. */
const lowestStatus = 0;
const highestStatus = 255;

/** The code a Windows child's status above 255 becomes, because its low byte may read as success. */
const outOfRange = 1;

/** Whether a child's code is a whole number a process exit status holds, so the run may end with it. */
function isExitCode(code: number): code is ExitCode {
  return Number.isInteger(code) && code >= lowestStatus && code <= highestStatus;
}

/** The word the plugin runs a program for, or `undefined` when the run is not one it acts on. */
function wordToRun(context: MiddlewareContext): string | undefined {
  const { host, invokedBy, unknownCommand } = context;
  if (unknownCommand === null || invokedBy !== 'argv') {
    return undefined;
  }
  // Only argv's very first word runs a program, so options and a group before it stay the application's.
  const { rest, word } = unknownCommand;
  const [first, ...after] = host.argv;
  return first === word && after.length === rest.length && isPortableName(word) ? word : undefined;
}

/** The system error's code a failed start carries, which names its cause, or `undefined`. */
function startCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** How the program ended: its exit code, or the system error's code of a start that failed. */
type Ended =
  | { readonly code: number; readonly kind: 'exited' }
  | { readonly code: string | undefined; readonly kind: 'unstarted' };

/** Starts the program with the words after the unknown one, the terminal lent to it. */
async function start(
  context: MiddlewareContext,
  program: string,
  rest: readonly string[],
): Promise<Ended | undefined> {
  const { host, out, signal } = context;
  return out.lendTerminal(async () => {
    try {
      const exit = await host.spawn(program, rest, {
        signal,
        stderr: 'inherit',
        stdin: 'inherit',
        stdout: 'inherit',
      }).exited;
      if (exit.kind === 'unstarted') {
        return { code: startCode(exit.error), kind: 'unstarted' };
      }
      return exit.kind === 'exited' ? { code: exit.code, kind: 'exited' } : undefined;
    } catch (error) {
      // A handle whose spawn throws, such as a mock with no script, reports a program that did not start.
      return { code: startCode(error), kind: 'unstarted' };
    }
  });
}

/** The program the search found for the word, logging each entry it passed over. */
function programFor(context: MiddlewareContext, word: string): string | undefined {
  const { graph, host, log } = context;
  const name = `${graph.name}-${word}`;
  return findProgram(name, host, (folder) => {
    const line = notIn(name, folder);
    log.trace(line.template, line.fields);
  });
}

/** Runs the program and ends the run with its code, or fails the run when it did not start. */
async function runProgram(
  context: MiddlewareContext,
  program: string,
  rest: readonly string[],
): Promise<void> {
  const line = running(program);
  context.log.debug(line.template, line.fields);
  const ended = await start(context, program, rest);
  if (ended?.kind === 'unstarted') {
    throw new FatalError(
      externalCommandsPhrase('cannotRun', context.graph.name, program, ended.code),
    );
  }
  context.exitCode = ended !== undefined && isExitCode(ended.code) ? ended.code : outOfRange;
}

/**
 * Runs `<application>-<word>` from the run's `PATH` when the first word of argv names no Command,
 * and ends the run with the program's exit code. Every other run continues, so the unknown command
 * core holds raises as it would without the plugin.
 */
const middleware: Middleware<typeof externalCommands> = async (context) => {
  const word = wordToRun(context);
  const program = word === undefined ? undefined : programFor(context, word);
  if (program === undefined || context.unknownCommand === null) {
    await context.next();
    return;
  }
  await runProgram(context, program, context.unknownCommand.rest);
};

export default middleware;
