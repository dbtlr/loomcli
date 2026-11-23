import { Connection } from './connection.js';
import type { Channel, McpServerOptions } from './connection.js';
import { HttpTransport } from './http.js';
import type { HttpOptions } from './http.js';
import { classify, errorMessage, frame, LineSplitter } from './json-rpc.js';

/**
 * The stream a server reads, such as a process's stdin: the members of a Node.js readable stream
 * the server uses.
 */
interface ServerInput {
  on(event: 'data', listener: (chunk: string | Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'data', listener: (chunk: string | Uint8Array) => void): unknown;
  off(event: 'end', listener: () => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
  destroy(): unknown;
}

/**
 * The stream a server writes, such as a process's stdout: the members of a Node.js writable stream
 * the server uses.
 */
interface ServerOutput {
  write(chunk: string, callback: (error?: Error | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
}

/** How a run ends early: when `signal` aborts, every call aborts and the server writes nothing more. */
interface RunOptions {
  readonly signal?: AbortSignal;
}

/** Listens for the output's error event. A write the client cannot read has no one to report to. */
function dropWriteError() {
  // The write's own callback has already settled it.
}

/**
 * Hands each chunk of the input to `read` until the input ends or the signal aborts. An abort
 * stops reading by destroying the input, since a run that ends on its signal reads nothing more,
 * and an open stdin would keep its process alive.
 */
function readChunks(
  input: ServerInput,
  signal: AbortSignal | undefined,
  read: (chunk: string | Uint8Array) => void,
) {
  if (signal?.aborted === true) {
    input.destroy();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const detach = () => {
      input.off('data', read);
      input.off('end', finish);
      input.off('error', fail);
      signal?.removeEventListener('abort', halt);
    };
    function finish() {
      detach();
      resolve();
    }
    function fail(error: Error) {
      detach();
      reject(error);
    }
    function halt() {
      detach();
      input.destroy();
      resolve();
    }
    input.on('data', read);
    input.on('end', finish);
    input.on('error', fail);
    signal?.addEventListener('abort', halt, { once: true });
  });
}

/**
 * One run of a server over one pair of streams: its connection, which every line of the input
 * reaches, and the writes not yet flushed.
 */
class StdioRun {
  readonly #output: ServerOutput;
  readonly #connection: Connection;
  readonly #writes = new Set<Promise<void>>();
  readonly #splitter = new LineSplitter();
  /** The one channel every request of the connection shares: the output. */
  readonly #channel: Channel = { end: () => {}, send: (message) => this.#write(message) };

  constructor(options: McpServerOptions, output: ServerOutput) {
    this.#connection = new Connection(options);
    this.#output = output;
    // A failed write, such as a broken pipe after the client exits, also emits "error" on the stream.
    // With no listener that ends the process, so the run listens until it ends.
    output.on('error', dropWriteError);
  }

  /** Handles each line a chunk of the input finishes. */
  read(chunk: string | Uint8Array) {
    for (const line of this.#splitter.push(chunk)) {
      this.#receive(line);
    }
  }

  /**
   * Ends the run once the input has ended or the run's signal aborted: a last line with no line
   * feed is handled, every call aborts and answers nothing, and once each has settled, each open
   * subscription is cancelled and answered with its closing result. Resolves when every message has
   * been handed to the output, and stops listening for the output's errors.
   */
  async end() {
    for (const line of this.#splitter.end()) {
      this.#receive(line);
    }
    this.#connection.abortAll();
    await this.#connection.settled();
    this.#connection.closeSubscriptions();
    await Promise.all(this.#writes);
    this.#output.off('error', dropWriteError);
  }

  /**
   * Ends the run on the caller's signal: every call aborts, and the server answers nothing more.
   * Each open subscription's teardown is still sent when the run ends.
   */
  silence() {
    this.#connection.silence();
  }

  /** Handles one line the client wrote. */
  #receive(line: string) {
    if (this.#connection.silenced) {
      return;
    }
    const message = classify(line);
    if (message.kind === 'invalid') {
      this.#write(errorMessage(message.id, message.error));
    } else if (message.kind === 'notification') {
      this.#connection.notify(message.method, message.params);
    } else if (message.kind === 'request') {
      const admission = this.#connection.admit(message.id, message.method, message.params);
      if (admission.kind === 'refused') {
        this.#write(errorMessage(message.id, admission.error));
      } else {
        admission.begin(this.#channel);
      }
    }
  }

  /** Writes one message as one line. */
  #write(message: object) {
    // A write the client can no longer read has no one to report to, so its callback drops the error.
    // The run's error listener drops the stream's error event the same way.
    const written = new Promise<void>((resolve) => {
      this.#output.write(frame(message), () => resolve());
    });
    this.#writes.add(written);
    void written.then(() => this.#writes.delete(written));
  }
}

/**
 * An MCP server of both eras, over a stdio-style pair of streams or over HTTP. A request carrying
 * per-request `_meta` is served on the per-request revision, which serves `server/discover`,
 * `tools/list`, `tools/call`, and `subscriptions/listen`. A connection that opens with `initialize`
 * is served on the initialize-era revision it negotiates, which serves `ping`, `tools/list`, and
 * `tools/call`. Every other method is not found.
 */
class McpServer {
  readonly #options: McpServerOptions;

  constructor(options: McpServerOptions) {
    this.#options = options;
  }

  /**
   * Serves one client until the input ends or `signal` aborts. When the input ends, the server
   * aborts every call in flight, answers none of them, waits for each to settle, closes each open
   * subscription, and resolves. When `signal` aborts, before or after the input ends, it stops
   * reading, aborts every call, answers no call, closes each open subscription, and resolves once
   * every call has settled.
   */
  async run(input: ServerInput, output: ServerOutput, options: RunOptions = {}): Promise<void> {
    const { signal } = options;
    const stdio = new StdioRun(this.#options, output);
    const silence = () => stdio.silence();
    if (signal?.aborted === true) {
      silence();
    }
    signal?.addEventListener('abort', silence, { once: true });
    try {
      await readChunks(input, signal, (chunk) => stdio.read(chunk));
    } finally {
      await stdio.end();
      signal?.removeEventListener('abort', silence);
    }
  }

  /**
   * The server's streamable HTTP transport, which answers each request its caller's `node:http`
   * server hands it until `options.signal` aborts.
   */
  http(options: HttpOptions): HttpTransport {
    return new HttpTransport(this.#options, options);
  }
}

export { McpServer };
export type { McpServerOptions } from './connection.js';
export type { HttpOptions, HttpTransport } from './http.js';
export type { RunOptions, ServerInput, ServerOutput };
