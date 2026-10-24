/**
 * The sealed process handle a test runs an Application on. It reads nothing from the process the
 * test runs in: every fact has a fixed default, its streams record what a run writes, and its
 * signal source is its own.
 */
import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type {
  Background,
  ExitCode,
  OutputTerminal,
  ProcessFields,
  ProcessHandle,
  ProcessSignal,
  ProcessTerminal,
  SignalListener,
  SignalSource,
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

/** The facts a test supplies; each replaces its default whole. */
interface MockFields extends Omit<ProcessFields, 'stdin' | 'stdout' | 'stderr' | 'terminal'> {
  /** Piped text; empty when omitted. */
  readonly stdin?: string;
  /** No terminal when omitted. */
  readonly terminal?: MockTerminal;
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
}

/** Whether a listener belongs to the `exit` event. */
function isExitListener(
  event: ProcessSignal | 'exit',
  _listener: unknown,
): _listener is SignalListener<'exit'> {
  return event === 'exit';
}

/** Whether a listener belongs to a signal. */
function isSignalListener(
  event: ProcessSignal | 'exit',
  _listener: unknown,
): _listener is SignalListener<ProcessSignal> {
  return event !== 'exit';
}

/** A signal source of its own, which ends the mock's life on an ending signal nobody listens for. */
function mockSignals(life: Life): SignalSource {
  const signalListeners = new Map<ProcessSignal, Set<() => void>>();
  const exitListeners = new Set<(code: number) => void>();
  return {
    off<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      if (isExitListener(event, listener)) {
        exitListeners.delete(listener);
      } else if (isSignalListener(event, listener) && event !== 'exit') {
        signalListeners.get(event)?.delete(listener);
      }
    },
    on<Event extends ProcessSignal | 'exit'>(event: Event, listener: SignalListener<Event>) {
      if (isExitListener(event, listener)) {
        exitListeners.add(listener);
      } else if (isSignalListener(event, listener) && event !== 'exit') {
        const held = signalListeners.get(event) ?? new Set();
        held.add(listener);
        signalListeners.set(event, held);
      }
    },
    raise(signal: ProcessSignal) {
      if (life.ended !== undefined) {
        return;
      }
      const held = signalListeners.get(signal);
      if (held !== undefined && held.size > noListeners) {
        for (const listener of held) {
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

/** `glibc` on Linux, and no C library elsewhere. */
function defaultLibc(platform: string): 'glibc' | undefined {
  return platform === 'linux' ? 'glibc' : undefined;
}

/**
 * A process handle that reads nothing from the process the test runs in. Supplied fields replace
 * their defaults whole. The streams record what a run writes, `exitCode` records what `run()`
 * writes, and the signal source is the mock's own. The handle has no `publishEnv`.
 */
function mockProcess(fields: MockFields = {}): MockProcess {
  const { cwd = '/loom-test', platform = 'linux', terminal } = fields;
  const life: Life = { ended: undefined };
  const transcript: Write[] = [];
  const size: Size = { columns: terminal?.columns, rows: terminal?.rows };
  const libc = 'libc' in fields ? fields.libc : defaultLibc(platform);
  const uid = 'uid' in fields ? fields.uid : defaultUid;
  let written: ExitCode | undefined = undefined;
  return {
    arch: fields.arch ?? 'x64',
    argv: fields.argv ?? [],
    cwd: typeof cwd === 'function' ? cwd : () => cwd,
    get endedBy() {
      return life.ended;
    },
    env: fields.env ?? {},
    get exitCode() {
      return written;
    },
    set exitCode(code: ExitCode | undefined) {
      if (life.ended === undefined) {
        written = code;
      }
    },
    libc,
    platform,
    program: fields.program ?? defaultProgram,
    release: fields.release ?? { build: 'source' },
    resize(columns: number, rows: number) {
      size.columns = columns;
      size.rows = rows;
    },
    signals: mockSignals(life),
    stderr: new Recorder('stderr', life, transcript),
    stdin: mockStdin(fields.stdin ?? ''),
    stdout: new Recorder('stdout', life, transcript),
    terminal: mockTerminal(terminal, size),
    timeZone: fields.timeZone ?? 'UTC',
    transcript,
    uid,
    ...(fields.readSource === undefined ? {} : { readSource: fields.readSource }),
  };
}

export { mockProcess };
export type { MockFields, MockProcess, MockTerminal, RecordingStream };
