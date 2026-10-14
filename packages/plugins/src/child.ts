/**
 * The one way the pack runs another program: with an argument array and no shell, an environment
 * and a working directory the caller names, no input, and no time limit, ended with SIGTERM when
 * the run signal aborts. The skills, completion, and manpage refreshes, the completion plugin's
 * profile query, and the service plugin's manager calls each call it with their own words.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import type { Writable } from 'node:stream';

/**
 * What a child answered: the code it ended with and the standard output it captured, empty when the
 * output went to a stream, or the error that kept it from starting.
 */
type ChildAnswer =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string }
  | { readonly kind: 'missing'; readonly error: unknown };

/** What a child runs and where its output goes. */
interface ChildRequest {
  /** The program's path, or a name the environment's `PATH` resolves, run without a shell. */
  readonly program: string;
  readonly words: readonly string[];
  /** The working directory, the process's own when left out. */
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  /** The stream the child's standard output is piped into, or `capture` to answer it as text. */
  readonly stdout: Writable | 'capture';
  /** The stream the child's standard error is piped into, discarded when left out. */
  readonly stderr?: Writable;
}

/** The shell's status for a process a signal ended, 128 plus the signal's number. */
const signalBase = 128;

/** The code a child reports: its exit code, or the shell's status for the signal that ended it. */
function codeOf(code: number | null, ended: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return ended === null ? signalBase : signalBase + constants.signals[ended];
}

/** Starts the child, its standard error piped into the caller's stream or discarded. */
function start(request: ChildRequest): ChildProcess {
  const { stderr } = request;
  const child = spawn(request.program, [...request.words], {
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    env: { ...request.env },
    shell: false,
    stdio: ['ignore', 'pipe', stderr === undefined ? 'ignore' : 'pipe'],
  });
  if (request.stdout !== 'capture') {
    child.stdout?.pipe(request.stdout, { end: false });
  }
  if (stderr !== undefined) {
    child.stderr?.pipe(stderr, { end: false });
  }
  return child;
}

/** Ends the child with SIGTERM when the signal aborts, and answers the call that stops listening. */
function endOnAbort(child: ChildProcess, signal: AbortSignal): () => void {
  const end = () => child.kill('SIGTERM');
  signal.addEventListener('abort', end, { once: true });
  if (signal.aborted) {
    end();
  }
  return () => signal.removeEventListener('abort', end);
}

/** Starts the child, or answers the error a synchronous throw of the runtime carried (ENOEXEC, ENOTDIR, and others). */
function tryStart(request: ChildRequest): ChildProcess | Extract<ChildAnswer, { kind: 'missing' }> {
  try {
    return start(request);
  } catch (error) {
    return { error, kind: 'missing' };
  }
}

/** Collects the child's standard output when the request captures it, and answers the text so far. */
function captured(child: ChildProcess, request: ChildRequest): () => string {
  const chunks: Buffer[] = [];
  if (request.stdout === 'capture') {
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  }
  return () => Buffer.concat(chunks).toString('utf8');
}

/** Runs the program with the words until it exits or cannot start. It never rejects. */
function runChild(request: ChildRequest): Promise<ChildAnswer> {
  return new Promise((resolve) => {
    const child = tryStart(request);
    if ('kind' in child) {
      resolve(child);
      return;
    }
    const output = captured(child, request);
    const release = endOnAbort(child, request.signal);
    let settled = false;
    const settle = (answer: ChildAnswer) => {
      if (!settled) {
        settled = true;
        release();
        resolve(answer);
      }
    };
    child.on('error', (error) => settle({ error, kind: 'missing' }));
    child.on('close', (code, ended) =>
      settle({ code: codeOf(code, ended), kind: 'exited', stdout: output() }),
    );
  });
}

export type { ChildAnswer, ChildRequest };
export { runChild };
