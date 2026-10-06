import { spawn } from 'node:child_process';
import { setTimeout as after } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/** How long a session may wait for a message before the test fails. */
const deadline = 10_000;

/** The fixture server, run under the runtime the test run names: `LOOM_TEST_RUNTIME`, Node by default. */
const fixture = new URL('fixtures/server.mjs', import.meta.url);

/** The `_meta` every request of the pinned revision carries. */
const meta = {
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
};

/** The identity the fixture server declares, as every result's `_meta` carries it. */
const serverInfo = {
  description: 'A conformance fixture.',
  name: 'fixture',
  version: '1.2.3',
};

/** A request of the pinned revision: the method, the id, and params carrying the required `_meta`. */
function request(id: number | string, method: string, params: Record<string, unknown> = {}) {
  return { id, jsonrpc: '2.0', method, params: { ...params, _meta: meta } };
}

/** One parsed message the server wrote. */
type Message = Record<string, unknown>;

/** One line the server wrote, which must be one JSON object. */
function parse(line: string): Message {
  const value: unknown = JSON.parse(line);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The server wrote a line that is not a JSON object: ${line}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** How the fixture process ended, with everything it wrote. */
interface Ending {
  status: number | null;
  messages: Message[];
  lines: string[];
  stderr: string;
}

/**
 * One server process driven over stdio. `send` writes a message or a raw line, `next` reads the
 * next message the server wrote, and `close` ends stdin and waits for the process to exit.
 */
function open(scenario = 'default') {
  const child = spawn(process.env.LOOM_TEST_RUNTIME ?? 'node', [fileURLToPath(fixture), scenario], {
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: deadline,
  });
  let stdout = '';
  let stderr = '';
  let read = 0;
  let ended = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => {
      ended = true;
      resolve(status);
    });
  });
  const lines = () => stdout.split('\n').slice(0, -1);

  /** Writes one message as a line, or a raw string as it is. */
  const send = (message: unknown) => {
    child.stdin.write(typeof message === 'string' ? message : `${JSON.stringify(message)}\n`);
  };

  /** The next message the server wrote, in order. */
  const next = async (): Promise<Message> => {
    const start = Date.now();
    while (lines().length <= read) {
      if (ended || Date.now() - start > deadline) {
        throw new Error(`The server wrote no further message. It wrote:\n${stdout}${stderr}`);
      }
      await after(5);
    }
    const line = lines()[read] ?? '';
    read += 1;
    return parse(line);
  };

  /** Waits until the fixture's stderr holds the line, which is how a handler reports what it saw. */
  const observed = async (line: string) => {
    const start = Date.now();
    while (!stderr.includes(`${line}\n`)) {
      if (ended || Date.now() - start > deadline) {
        throw new Error(`The fixture never reported "${line}". It wrote:\n${stdout}${stderr}`);
      }
      await after(5);
    }
  };

  /** Ends stdin, waits for the process to exit, and answers everything it wrote. */
  const close = async (): Promise<Ending> => {
    child.stdin.end();
    return finish();
  };

  /**
   * Stops reading stdout, as a client that exits does, then ends stdin and waits for the process
   * to exit. A write the server makes after this fails with a broken pipe.
   */
  const hangUp = async (): Promise<Ending> => {
    child.stdout.destroy();
    return close();
  };

  /** Waits for the process to exit on its own, with stdin left open. */
  const finish = async (): Promise<Ending> => {
    const status = await exit;
    return { lines: lines(), messages: lines().map(parse), status, stderr };
  };

  return { close, finish, hangUp, next, observed, send };
}

export { meta, open, request, serverInfo };
export type { Ending, Message };
