/**
 * The sealed process handle a test runs an Application on. It reads nothing from the process the
 * test runs in: every fact has a fixed default, its streams record what a run writes, and its
 * signal source is its own.
 */
import { isAbsolute } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type {
  Background,
  Child,
  ChildExit,
  ChildOutput,
  ExitCode,
  OutputTerminal,
  ProcessFields,
  ProcessHandle,
  ProcessSignal,
  ProcessTerminal,
  SignalListener,
  SignalSource,
  SpawnOptions,
} from '@loomcli/core';

/** A terminal the mock's streams sit on. */
interface MockTerminal {
  readonly columns: number;
  readonly rows: number;
  /** Settles the run's background, so no query runs. */
  readonly background?: Background;
  /** The streams on the terminal; stdout and stderr when omitted. */
  readonly streams?: readonly ('stdout' | 'stderr')[];
}

/** One child program a run started, as the script for its command receives it. */
interface ProgramCall {
  /** As the run's spawn named it. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * What the spawn wrote to the child's stdin, or the mock's stdin text under `stdin: 'inherit'`,
   * decoded as UTF-8.
   */
  readonly input: string;
  readonly detached: boolean;
  /** Aborts when the child is ended, by the spawn's signal or a kill of an ending signal. */
  readonly signal: AbortSignal;
}

/** What a script answers for the child it stands for. */
interface ProgramAnswer {
  /** 0 when omitted. */
  readonly code?: number;
  /** Empty when omitted. */
  readonly stdout?: string | Uint8Array;
  /** Empty when omitted. */
  readonly stderr?: string | Uint8Array;
}

/** The script of one child program; a throw stands for a program that could not start. */
type Program = (call: ProgramCall) => ProgramAnswer | Promise<ProgramAnswer>;

/** The facts a test supplies; each replaces its default whole. */
interface MockFields extends Omit<ProcessFields, 'stdin' | 'stdout' | 'stderr' | 'terminal'> {
  /** Piped text; empty when omitted. */
  readonly stdin?: string;
  /** No terminal when omitted. */
  readonly terminal?: MockTerminal;
  /** Each child program by its command; none when omitted. */
  readonly programs?: Readonly<Record<string, Program>>;
}

/** A writable stream that keeps what it was given. */
interface RecordingStream extends Writable {
  /** Everything written to the stream, decoded as UTF-8. */
  readonly text: string;
}

/** One write a run made, tagged by the stream it went to. */
interface Write {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

/** The mock handle and what a test reads from it. */
interface MockProcess extends ProcessHandle {
  readonly stdin: Readable;
  readonly stdout: RecordingStream;
  readonly stderr: RecordingStream;
  readonly transcript: readonly Write[];
  /** The signal that ended the mock's process, if one did. */
  readonly endedBy: ProcessSignal | undefined;
  /** Changes the width and height the next terminal read returns. */
  resize(columns: number, rows: number): void;
}

/** The signals whose default effect ends a process. */
const endingSignals: ReadonlySet<ProcessSignal> = new Set([
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGTERM',
]);

/** The count of listeners at which nothing listens. */
const noListeners = 0;

/** The default user id, an ordinary account's. */
const defaultUid = 1000;

/** The default `program` words: a runtime and a script that do not exist. */
const defaultProgram = ['/loom-test/runtime', '/loom-test/app.js'];

/** Whether the mock's process ended, and by which signal. */
interface Life {
  ended: ProcessSignal | undefined;
}

/** A writable that decodes what it receives as UTF-8 and reports each write unless the mock ended. */
class Recorder extends Writable implements RecordingStream {
  #text = '';
  readonly #decoder = new StringDecoder('utf8');
  readonly #life: Life;
  readonly #name: 'stdout' | 'stderr';
  readonly #transcript: Write[];

  constructor(name: 'stdout' | 'stderr', life: Life, transcript: Write[]) {
    super();
    this.#name = name;
    this.#life = life;
    this.#transcript = transcript;
  }

  get text(): string {
    return this.#text;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    if (this.#life.ended === undefined) {
      const text = this.#decoder.write(chunk);
      if (text !== '') {
        this.#text += text;
        this.#transcript.push({ stream: this.#name, text });
      }
    }
    done();
  }

  /** Flushes a character the last write left incomplete, so `text` holds everything written. */
  override _final(done: (error?: Error | null) => void) {
    if (this.#life.ended === undefined) {
      const text = this.#decoder.end();
      if (text !== '') {
        this.#text += text;
        this.#transcript.push({ stream: this.#name, text });
      }
    }
    done();
  }
}

/** The listeners held for each event, each set typed by its own event. */
type Registry = { [Event in ProcessSignal | 'exit']: Set<SignalListener<Event>> };

/** A signal source of its own, which ends the mock's life on an ending signal nobody listens for. */
function mockSignals(life: Life): SignalSource {
  const registry: Registry = {
    SIGCONT: new Set(),
    SIGHUP: new Set(),
    SIGINT: new Set(),
    SIGQUIT: new Set(),
    SIGTERM: new Set(),
    SIGTSTP: new Set(),
    exit: new Set(),
  };
  return {
    off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      registry[event].delete(listener);
    },
    on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      registry[event].add(listener);
    },
    raise(signal: ProcessSignal) {
      if (life.ended !== undefined) {
        return;
      }
      const held = registry[signal];
      if (held.size > noListeners) {
        // A copy, so a listener added during this raise waits for the next one.
        const listeners = [...held];
        for (const listener of listeners) {
          listener();
        }
      } else if (endingSignals.has(signal)) {
        life.ended = signal;
      }
    },
    terminal: undefined,
  };
}

/** The mock's stdin: the text once as a byte chunk, then the end. */
function mockStdin(text: string): Readable {
  return Readable.from(text === '' ? [] : [Buffer.from(text)], { objectMode: false });
}

/** The live width and height a resize changes. */
interface Size {
  columns: number | undefined;
  rows: number | undefined;
}

/** One output stream's terminal facts: on the terminal reads the live size, off it reads none. */
function outputTerminal(on: boolean, size: Size): OutputTerminal {
  return {
    get columns() {
      return on ? size.columns : undefined;
    },
    isTTY: on,
    get rows() {
      return on ? size.rows : undefined;
    },
  };
}

/** The terminal facts over the mock's streams, from the terminal a test stated or none. */
function mockTerminal(terminal: MockTerminal | undefined, size: Size): ProcessTerminal {
  const named = terminal === undefined ? [] : (terminal.streams ?? ['stdout', 'stderr']);
  return {
    stderr: outputTerminal(named.includes('stderr'), size),
    stdin: { isTTY: false },
    stdout: outputTerminal(named.includes('stdout'), size),
    ...(terminal?.background === undefined ? {} : { background: terminal.background }),
  };
}

/** The folders a mock names by default, neither of which exists. */
const defaultHome = '/loom-test/home';
const defaultTmpdir = '/loom-test/tmp';

/** A variable of the mock's environment when it holds an absolute path. */
function absoluteOf(env: ProcessHandle['env'], name: string): string | undefined {
  const value = env[name];
  return value !== undefined && isAbsolute(value) ? value : undefined;
}

/** A signal a child's `kill` delivers. */
type KillSignal = ProcessSignal | 'SIGKILL';

/** The shell's status for a child a signal ended: 128 plus the number of each ending signal. */
const endedCodes: Readonly<Partial<Record<KillSignal, number>>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGKILL: 137,
  SIGQUIT: 131,
  SIGTERM: 143,
};

/** The options the handle's spawn receives, with the run's place filled in. */
type SpawnCall = SpawnOptions & {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

/** One output stream's choice, as an attached child's options name it. */
type OutputChoice = 'capture' | 'ignore' | 'inherit' | Writable;

/** The length of an answer that holds nothing, which no stream is written. */
const noBytes = 0;

/** The code of an answer that omits its own. */
const succeeded = 0;

/** What a stream that was not captured holds. */
function noOutput(): ChildOutput {
  return { bytes: new Uint8Array(), text: '' };
}

/** A script's answer for one stream as bytes. */
function bytesOf(answer: string | Uint8Array | undefined): Uint8Array {
  if (answer === undefined) {
    return new Uint8Array();
  }
  return typeof answer === 'string' ? new TextEncoder().encode(answer) : new Uint8Array(answer);
}

/**
 * Delivers one stream of a script's answer where the spawn sent it: held in the exit when captured,
 * written to the mock's own stream when inherited, written to a `Writable`, or dropped.
 */
function deliver(choice: OutputChoice, bytes: Uint8Array, own: Writable): ChildOutput {
  if (choice === 'capture') {
    return { bytes, text: new TextDecoder().decode(bytes) };
  }
  if (choice !== 'ignore' && bytes.length > noBytes) {
    (choice === 'inherit' ? own : choice).write(Buffer.from(bytes));
  }
  return noOutput();
}

/** The text a spawn's input stands for, decoded as UTF-8. */
function inputOf(options: SpawnCall, stdin: string): string {
  if (options.detached === true) {
    return '';
  }
  if (options.stdin === 'inherit') {
    return stdin;
  }
  const { input } = options;
  return typeof input === 'string' ? input : new TextDecoder().decode(input ?? new Uint8Array());
}

/** Each output stream's choice: both ignored for a detached child, and captured when omitted. */
function outputChoices(options: SpawnCall): { stdout: OutputChoice; stderr: OutputChoice } {
  if (options.detached === true) {
    return { stderr: 'ignore', stdout: 'ignore' };
  }
  return { stderr: options.stderr ?? 'capture', stdout: options.stdout ?? 'capture' };
}

/** What a scripted child reads beside its call: its script, the mock's stdin text, and its streams. */
interface Scripted {
  readonly program: Program;
  readonly stdin: string;
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** One child a spawn names: its command, its words, and its options with the place filled in. */
interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnCall;
}

/**
 * One scripted child's end, settled once: by its script's answer, by a script that throws, or by an
 * ending signal, which aborts the call's signal and ends it with 128 plus the signal's number.
 */
class ChildEnd {
  readonly exited: Promise<ChildExit>;
  readonly #ending = new AbortController();
  #settled = false;
  #resolve: (exit: ChildExit) => void = () => undefined;

  constructor() {
    this.exited = new Promise<ChildExit>((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** The signal a script's call receives, which aborts when the child is ended. */
  get signal(): AbortSignal {
    return this.#ending.signal;
  }

  get settled(): boolean {
    return this.#settled;
  }

  settle(exit: ChildExit): void {
    if (!this.#settled) {
      this.#settled = true;
      this.#resolve(exit);
    }
  }

  /** Ends the child for an ending signal; `SIGTSTP` and `SIGCONT` end nothing. */
  end(signal: KillSignal): void {
    const code = endedCodes[signal];
    if (this.#settled || code === undefined) {
      return;
    }
    this.#ending.abort();
    this.settle({ code, kind: 'exited', stderr: noOutput(), stdout: noOutput() });
  }
}

/** The call a script receives for one spawn. */
function callOf(request: SpawnRequest, stdin: string, signal: AbortSignal): ProgramCall {
  const { args, command, options } = request;
  return {
    args: [...args],
    command,
    cwd: options.cwd,
    detached: options.detached === true,
    env: options.env,
    input: inputOf(options, stdin),
    signal,
  };
}

/** What a script answered, or what it threw, which stands for a program that could not start. */
async function answerOf(program: Program, call: ProgramCall): Promise<ProgramAnswer | Error> {
  try {
    return await program(call);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** The exit a script's answer stands for, each stream delivered where the spawn sent it. */
function exitFrom(answer: ProgramAnswer, options: SpawnCall, scripted: Scripted): ChildExit {
  const choices = outputChoices(options);
  return {
    code: answer.code ?? succeeded,
    kind: 'exited',
    stderr: deliver(choices.stderr, bytesOf(answer.stderr), scripted.stderr),
    stdout: deliver(choices.stdout, bytesOf(answer.stdout), scripted.stdout),
  };
}

/** Runs the script after `spawn` returned, as a real child starts after the call, and settles the end. */
async function runScript(request: SpawnRequest, scripted: Scripted, end: ChildEnd): Promise<void> {
  await Promise.resolve();
  const { options } = request;
  if (options.detached !== true && options.signal?.aborted === true) {
    end.end('SIGTERM');
  }
  const answer = await answerOf(scripted.program, callOf(request, scripted.stdin, end.signal));
  if (answer instanceof Error) {
    end.settle({ error: answer, kind: 'unstarted' });
    return;
  }
  if (!end.settled) {
    end.settle(exitFrom(answer, options, scripted));
  }
}

/**
 * The child a script stands for. Its script runs after `spawn` returns. An abort of the spawn's
 * signal or a kill of an ending signal ends it at once with 128 plus the signal's number and no
 * output, whatever the script answers later; a script that throws is a child that never started.
 */
function scriptedChild(request: SpawnRequest, scripted: Scripted): Child {
  const end = new ChildEnd();
  const { options } = request;
  if (options.detached !== true) {
    options.signal?.addEventListener('abort', () => end.end('SIGTERM'), { once: true });
  }
  void runScript(request, scripted, end);
  return { exited: end.exited, kill: (sent = 'SIGTERM') => end.end(sent) };
}

/** The sentence a spawn of a command with no script throws. */
function unscripted(command: string): Error {
  return new Error(
    `mockProcess has no program for "${command}". Add a "${command}" entry to programs.`,
  );
}

/** `glibc` on Linux, and no C library elsewhere. */
function defaultLibc(platform: string): 'glibc' | undefined {
  return platform === 'linux' ? 'glibc' : undefined;
}

/**
 * A process handle that reads nothing from the process the test runs in. Supplied fields replace
 * their defaults whole, and `home` and `tmpdir` follow an absolute `HOME` and `TMPDIR` in `env`.
 * The streams record what a run writes, `exitCode` records what `run()` writes, the signal source
 * is the mock's own, and each child program a run starts is answered by its script in `programs`,
 * with no program run. The handle has no `publishEnv`.
 */
function mockProcess(fields: MockFields = {}): MockProcess {
  const { cwd = '/loom-test', env = {}, platform = 'linux', programs = {}, terminal } = fields;
  const life: Life = { ended: undefined };
  const transcript: Write[] = [];
  const size: Size = { columns: terminal?.columns, rows: terminal?.rows };
  const libc = 'libc' in fields ? fields.libc : defaultLibc(platform);
  const uid = 'uid' in fields ? fields.uid : defaultUid;
  const stdinText = fields.stdin ?? '';
  const streams = {
    stderr: new Recorder('stderr', life, transcript),
    stdout: new Recorder('stdout', life, transcript),
  };
  let written: ExitCode | undefined = undefined;
  return {
    arch: fields.arch ?? 'x64',
    argv: fields.argv ?? [],
    cwd: typeof cwd === 'function' ? cwd : () => cwd,
    get endedBy() {
      return life.ended;
    },
    env,
    get exitCode() {
      return written;
    },
    set exitCode(code: ExitCode | undefined) {
      if (life.ended === undefined) {
        written = code;
      }
    },
    home: fields.home ?? absoluteOf(env, 'HOME') ?? defaultHome,
    libc,
    platform,
    program: fields.program ?? defaultProgram,
    release: fields.release ?? { build: 'source' },
    resize(columns: number, rows: number) {
      size.columns = columns;
      size.rows = rows;
    },
    signals: mockSignals(life),
    spawn(command, args, options) {
      const program = Object.hasOwn(programs, command) ? programs[command] : undefined;
      if (program === undefined) {
        throw unscripted(command);
      }
      const { stderr, stdout } = streams;
      return scriptedChild(
        { args, command, options },
        { program, stderr, stdin: stdinText, stdout },
      );
    },
    stderr: streams.stderr,
    stdin: mockStdin(stdinText),
    stdout: streams.stdout,
    terminal: mockTerminal(terminal, size),
    timeZone: fields.timeZone ?? 'UTC',
    tmpdir: fields.tmpdir ?? absoluteOf(env, 'TMPDIR') ?? defaultTmpdir,
    transcript,
    uid,
    ...(fields.readSource === undefined ? {} : { readSource: fields.readSource }),
  };
}

export { mockProcess };
export type {
  MockFields,
  MockProcess,
  MockTerminal,
  Program,
  ProgramAnswer,
  ProgramCall,
  RecordingStream,
};
